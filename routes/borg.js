'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

let borgCache = { data: null, ts: 0 };

function parseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch (_) { return fallback; }
}


function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  return bytes + ' B';
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0s';
  const s   = Math.floor(seconds);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h   > 0) parts.push(`${h}h`);
  if (m   > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

function timeSince(unix) {
  if (!unix || isNaN(unix)) return null;
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 0)     return 'just now';
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parsePrometheus(text) {
  const results = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const braceOpen = t.indexOf('{');
    let name, labelsStr, valueStr;
    if (braceOpen !== -1) {
      name = t.slice(0, braceOpen);
      const braceClose = t.indexOf('}', braceOpen);
      if (braceClose === -1) continue;
      labelsStr = t.slice(braceOpen + 1, braceClose);
      valueStr  = t.slice(braceClose + 2);
    } else {
      const sp = t.indexOf(' ');
      if (sp === -1) continue;
      name      = t.slice(0, sp);
      labelsStr = '';
      valueStr  = t.slice(sp + 1);
    }
    const value = parseFloat(valueStr.trim().split(/\s+/)[0]);
    if (isNaN(value)) continue;
    const labels = {};
    const re = /(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(labelsStr)) !== null) labels[m[1]] = m[2];
    results.push({ name, labels, value });
  }
  return results;
}

function metricVal(metrics, name, labelMatch = {}) {
  const found = metrics.find(m => {
    if (m.name !== name) return false;
    for (const [k, v] of Object.entries(labelMatch)) {
      if (m.labels[k] !== v) return false;
    }
    return true;
  });
  return found ? found.value : null;
}

async function fetchBorgStatus(settings) {
  if (settings.borg_enabled === 'false') {
    return { connected: false, status: 'unknown', error: 'disabled' };
  }

  const url      = settings.borg_url              || 'http://localhost:8082';
  const token    = settings.borg_token            || '';
  const interval = parseInt(settings.borg_refresh_interval || '60', 10);
  const now      = Date.now();

  if (borgCache.data && (now - borgCache.ts) < interval * 1000) {
    return borgCache.data;
  }

  let response;
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    response = await fetch(`${url}/metrics`, {
      headers: token ? { 'X-Borg-Metrics-Token': token } : {},
      signal:  controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    return { connected: false, status: 'unknown', error: err.message };
  }

  if (!response.ok) {
    return { connected: false, status: 'unknown', error: `HTTP ${response.status}` };
  }

  const text      = await response.text();
  const metrics   = parsePrometheus(text);
  const repoNames = parseJSON(settings.borg_repository_names || '{}', {});

  const reposTotal     = metricVal(metrics, 'borg_ui_repositories_total');
  const scheduledTotal = metricVal(metrics, 'borg_ui_scheduled_jobs_total');
  const scheduledEn    = metricVal(metrics, 'borg_ui_scheduled_jobs_enabled');
  const activeJobs     = metricVal(metrics, 'borg_ui_active_jobs');

  // Collect all unique repository names from labelled metrics
  const repoSet = new Set();
  for (const m of metrics) {
    if (m.labels.repository) repoSet.add(m.labels.repository);
  }

  const repositories = [];
  for (const repoName of repoSet) {
    const repoSize       = metricVal(metrics, 'borg_repository_size_bytes',               { repository: repoName });
    const archiveCount   = metricVal(metrics, 'borg_repository_archive_count',            { repository: repoName });
    const lastBackupTs   = metricVal(metrics, 'borg_repository_last_backup_timestamp',    { repository: repoName });
    const lastCheckTs    = metricVal(metrics, 'borg_repository_last_check_timestamp',     { repository: repoName });
    const lastCompactTs  = metricVal(metrics, 'borg_repository_last_compact_timestamp',   { repository: repoName });
    const lastSuccess    = metricVal(metrics, 'borg_backup_last_job_success',             { repository: repoName });
    const lastDuration   = metricVal(metrics, 'borg_backup_last_duration_seconds',        { repository: repoName });
    const lastOrigSize   = metricVal(metrics, 'borg_backup_last_original_size_bytes',     { repository: repoName });
    const lastDedupSize  = metricVal(metrics, 'borg_backup_last_deduplicated_size_bytes', { repository: repoName });
    const backupOrphaned = metricVal(metrics, 'borg_backup_orphaned_jobs_total',          { repository: repoName });
    const restoreTotal   = metricVal(metrics, 'borg_restore_jobs_total',                  { repository: repoName });
    const checkTotal     = metricVal(metrics, 'borg_check_jobs_total',                    { repository: repoName });
    const compactTotal   = metricVal(metrics, 'borg_compact_jobs_total',                  { repository: repoName });
    const pruneTotal     = metricVal(metrics, 'borg_prune_jobs_total',                    { repository: repoName });

    let backupTotal = 0, backupFailed = 0;
    for (const m of metrics) {
      if (m.name === 'borg_backup_jobs_total' && m.labels.repository === repoName) {
        backupTotal += m.value;
        if (m.labels.status === 'failed') backupFailed = m.value;
      }
    }

    let repoStatus;
    if (lastSuccess === null) {
      repoStatus = 'unknown';
    } else if (lastSuccess === 0) {
      repoStatus = 'degraded';
    } else if (backupFailed > 0) {
      repoStatus = 'warning';
    } else {
      repoStatus = 'healthy';
    }

    const dedupRatio = (lastOrigSize && lastDedupSize && lastDedupSize > 0)
      ? (lastOrigSize / lastDedupSize).toFixed(1) + 'x'
      : null;

    repositories.push({
      name:          repoName,
      display_name:  repoNames[repoName] || '',
      size_bytes:    repoSize,
      size_display:  formatBytes(repoSize),
      archive_count: archiveCount !== null ? Math.round(archiveCount) : null,
      last_backup: lastBackupTs ? {
        timestamp:                 lastBackupTs,
        time_ago:                  timeSince(lastBackupTs),
        success:                   lastSuccess === 1,
        duration_seconds:          lastDuration,
        duration_display:          formatDuration(lastDuration),
        original_size_bytes:       lastOrigSize,
        original_size_display:     formatBytes(lastOrigSize),
        deduplicated_size_bytes:   lastDedupSize,
        deduplicated_size_display: formatBytes(lastDedupSize),
        dedup_ratio:               dedupRatio,
      } : null,
      last_check:   lastCheckTs   ? { timestamp: lastCheckTs,   time_ago: timeSince(lastCheckTs)   } : null,
      last_compact: lastCompactTs ? { timestamp: lastCompactTs, time_ago: timeSince(lastCompactTs) } : null,
      jobs: {
        backup_total:    Math.round(backupTotal),
        backup_failed:   Math.round(backupFailed),
        backup_orphaned: Math.round(backupOrphaned || 0),
        restore_total:   Math.round(restoreTotal   || 0),
        check_total:     Math.round(checkTotal     || 0),
        prune_total:     Math.round(pruneTotal     || 0),
        compact_total:   Math.round(compactTotal   || 0),
      },
      status: repoStatus,
    });
  }

  // Overall status is the worst across all repos
  let status = repositories.length === 0 ? 'unknown' : 'healthy';
  for (const repo of repositories) {
    if (repo.status === 'degraded') { status = 'degraded'; break; }
    if (repo.status === 'warning'  && status !== 'degraded') status = 'warning';
    if (repo.status === 'unknown'  && status === 'healthy')  status = 'unknown';
  }

  const result = {
    connected:    true,
    last_fetched: new Date().toISOString(),
    status,
    repositories,
    system: {
      repositories_total:     reposTotal,
      scheduled_jobs_total:   scheduledTotal,
      scheduled_jobs_enabled: scheduledEn,
      active_jobs:            activeJobs,
    },
  };

  borgCache = { data: result, ts: now };
  return result;
}

router.get('/api/borg-status', async (req, res) => {
  const rows     = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  try {
    res.json(await fetchBorgStatus(settings));
  } catch (err) {
    res.json({ connected: false, status: 'unknown', error: err.message });
  }
});

module.exports = { router, fetchBorgStatus };
