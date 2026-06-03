'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const db      = require('../database/db');

const DEMO_MODE = process.env.DEMO_MODE === 'true';

let pbsCache = { data: null, ts: 0 };

function parseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch (_) { return fallback; }
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  if (bytes >= 1e3)  return (bytes / 1e3).toFixed(1)  + ' KB';
  return bytes + ' B';
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

// Custom request helper that accepts self-signed TLS certs (PBS default)
function pbsRequest(urlStr, headers) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(new Error(`Invalid URL: ${urlStr}`)); }
    const isHttps = parsed.protocol === 'https:';
    const mod     = isHttps ? https : http;
    const opts    = {
      hostname:           parsed.hostname,
      port:               parsed.port || (isHttps ? 443 : 80),
      path:               parsed.pathname + (parsed.search || ''),
      method:             'GET',
      headers,
      rejectUnauthorized: false,
      timeout:            8000,
    };
    const req = mod.request(opts, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`PBS returned non-JSON (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
    req.end();
  });
}

// Build the final response shape from raw values. time_ago is always computed
// fresh from Unix timestamps so demo data stays current across requests.
function buildPbsResult({ connected, datastores, lastBackupTs, lastBackupStatus, lastVerifyTs, lastPruneTs, lastGcTs }) {
  const now      = Math.floor(Date.now() / 1000);
  const TEN_DAYS = 10 * 86400;
  const SEV_DAYS =  7 * 86400;

  const verificationStale = lastVerifyTs  ? (now - lastVerifyTs)  > TEN_DAYS : false;
  const pruneStale        = lastPruneTs   ? (now - lastPruneTs)   > SEV_DAYS : false;
  const gcStale           = lastGcTs      ? (now - lastGcTs)      > SEV_DAYS : false;

  let status = 'unknown';
  if (lastBackupTs !== null) {
    if (lastBackupStatus && lastBackupStatus !== 'OK') {
      status = 'degraded';
    } else if (verificationStale) {
      status = 'warning';
    } else {
      status = 'healthy';
    }
  }

  const enrichedStores = (datastores || []).map(ds => ({
    store:         ds.store,
    total:         ds.total    || 0,
    used:          ds.used     || 0,
    avail:         ds.avail    || 0,
    total_display: formatBytes(ds.total),
    used_display:  formatBytes(ds.used),
    avail_display: formatBytes(ds.avail),
    used_pct:      ds.total > 0 ? Math.round((ds.used / ds.total) * 100) : 0,
  }));

  return {
    connected,
    last_fetched:        new Date().toISOString(),
    status,
    datastores:          enrichedStores,
    last_backup:  lastBackupTs  ? { timestamp: lastBackupTs,  time_ago: timeSince(lastBackupTs),  status: lastBackupStatus } : null,
    last_verify:  lastVerifyTs  ? { timestamp: lastVerifyTs,  time_ago: timeSince(lastVerifyTs)  } : null,
    last_prune:   lastPruneTs   ? { timestamp: lastPruneTs,   time_ago: timeSince(lastPruneTs)   } : null,
    last_gc:      lastGcTs      ? { timestamp: lastGcTs,      time_ago: timeSince(lastGcTs)       } : null,
    verification_stale: verificationStale,
    prune_stale:        pruneStale,
    gc_stale:           gcStale,
  };
}

async function fetchPbsStatus(settings) {
  const url      = settings.pbs_url              || '';
  const token    = settings.pbs_token            || '';
  const interval = parseInt(settings.pbs_refresh_interval || '60', 10);
  const limit    = parseInt(settings.pbs_task_limit       || '50', 10);
  const nodeName = settings.pbs_node_name        || 'proxmox-backup-server';

  if (!url || !token) {
    return { connected: false, status: 'unknown', error: 'not configured' };
  }

  const now = Date.now();
  if (pbsCache.data && (now - pbsCache.ts) < interval * 1000) {
    return pbsCache.data;
  }

  const headers = {
    Authorization: `PBSAPIToken=${token}`,
    Accept:        'application/json',
  };

  try {
    // Parallel: datastore usage + task list
    const [datastoreRes, tasksRes] = await Promise.all([
      pbsRequest(`${url}/api2/json/status/datastore-usage`, headers),
      pbsRequest(`${url}/api2/json/nodes/${encodeURIComponent(nodeName)}/tasks?limit=${limit}`, headers),
    ]);

    const datastores = datastoreRes.ok ? (datastoreRes.data?.data || []) : [];
    const tasks      = tasksRes.ok     ? (tasksRes.data?.data     || []) : [];

    let lastBackupTs = null, lastBackupStatus = null;
    let lastVerifyTs = null, lastPruneTs = null, lastGcTs = null;

    for (const task of tasks) {
      const ts = task.starttime;
      if (!ts) continue;
      switch (task.worker_type) {
        case 'backup':
          if (lastBackupTs === null || ts > lastBackupTs) { lastBackupTs = ts; lastBackupStatus = task.status || 'unknown'; }
          break;
        case 'verificationjob':
          if (lastVerifyTs  === null || ts > lastVerifyTs)  lastVerifyTs  = ts; break;
        case 'prunejob':
          if (lastPruneTs   === null || ts > lastPruneTs)   lastPruneTs   = ts; break;
        case 'garbage_collection':
          if (lastGcTs      === null || ts > lastGcTs)      lastGcTs      = ts; break;
      }
    }

    const result = buildPbsResult({ connected: true, datastores, lastBackupTs, lastBackupStatus, lastVerifyTs, lastPruneTs, lastGcTs });
    pbsCache = { data: result, ts: now };
    return result;
  } catch (err) {
    return { connected: false, status: 'unknown', error: err.message };
  }
}

router.get('/api/pbs-status', async (req, res) => {
  const rows     = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

  if (DEMO_MODE && settings.demo_pbs_data) {
    const raw = parseJSON(settings.demo_pbs_data, null);
    if (raw) {
      return res.json(buildPbsResult({
        connected:        true,
        datastores:       raw.datastores       || [],
        lastBackupTs:     raw.last_backup_ts   ?? null,
        lastBackupStatus: raw.last_backup_status ?? null,
        lastVerifyTs:     raw.last_verify_ts   ?? null,
        lastPruneTs:      raw.last_prune_ts    ?? null,
        lastGcTs:         raw.last_gc_ts       ?? null,
      }));
    }
  }

  try {
    res.json(await fetchPbsStatus(settings));
  } catch (err) {
    res.json({ connected: false, status: 'unknown', error: err.message });
  }
});

module.exports = { router, fetchPbsStatus };
