'use strict';

const express            = require('express');
const router             = express.Router();
const db                 = require('../database/db');
const { fetchBorgStatus } = require('./borg');

let cache = { data: null, ts: 0 };

function parseJSON(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

function formatUptime(seconds) {
  const s = parseFloat(seconds) || 0;
  if (s <= 0) return '0m';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function parseInfluxCSV(csv) {
  const results = [];
  const lines   = csv.split(/\r?\n/);
  let headers   = null;
  for (const line of lines) {
    if (!line.trim()) { headers = null; continue; }
    if (line.startsWith('#')) continue;
    if (!headers) {
      headers = line.split(',').map(h => h.trim());
    } else {
      const vals = line.split(',');
      const obj  = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      if (obj.host) results.push(obj);
    }
  }
  return results;
}

function capPercent(val, host, field) {
  if (val === null || val === undefined) return null;
  if (isNaN(val)) return null;
  if (val > 100) {
    console.warn(`[metrics] ${host}.${field} clamped from ${val.toFixed(2)}% to 100% (unit mismatch)`);
    return 100;
  }
  return val;
}

// CSV pivot fills missing columns with '' — parseFloat('') = NaN, not a valid number.
// This returns the numeric value or undefined so callers can distinguish missing vs zero.
function csvNum(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

function computeMetrics(row) {
  const host   = row.host   || '';
  const object = row.object || '';

  const cpu = csvNum(row.cpu) != null ? (csvNum(row.cpu) * 100) : 0;

  let ram  = null;
  let disk = null;

  // All Proxmox resources (nodes=nodes, lxc, qemu) report mem+maxmem bytes in system measurement.
  // Nodes additionally have memused+memtotal from the memory measurement (prefer those).
  // QEMU VMs with balloon also report actual+free_mem+total_mem from ballooninfo.
  let memUsed = undefined;
  let memMax  = undefined;

  const memused_v = csvNum(row.memused);
  if (memused_v !== undefined) {
    // memory measurement (nodes only)
    memUsed = memused_v;
    memMax  = csvNum(row.memtotal) ?? csvNum(row.maxmem);
  } else {
    const actual_v   = csvNum(row.actual);
    const free_mem_v = csvNum(row.free_mem);
    if (actual_v !== undefined && free_mem_v !== undefined) {
      // ballooninfo measurement (QEMU with balloon)
      memUsed = actual_v - free_mem_v;
      memMax  = csvNum(row.total_mem) ?? csvNum(row.maxmem);
    } else {
      // system measurement — mem=used bytes, maxmem=total bytes (nodes, lxc, qemu)
      memUsed = csvNum(row.mem);
      memMax  = csvNum(row.maxmem);
    }
  }

  ram = memUsed !== undefined && memMax !== undefined && memMax > 0
    ? (memUsed / memMax) * 100
    : null;

  const maxdsk = csvNum(row.maxdisk) ?? csvNum(row.rootfs_total) ?? 0;
  const dsk    = csvNum(row.disk)    ?? csvNum(row.rootfs_used)  ?? 0;
  disk = maxdsk > 1 && dsk > 0 ? (dsk / maxdsk) * 100 : null;

  return {
    host,
    object,
    cpu:     capPercent(cpu,  host, 'cpu'),
    ram:     capPercent(ram,  host, 'ram'),
    disk:    capPercent(disk, host, 'disk'),
    uptime:  formatUptime(row.uptime || 0),
    loadavg: row.loadavg !== undefined ? parseFloat(row.loadavg) : null,
  };
}

function applyOverrides(entry, overrides) {
  if (!Array.isArray(overrides)) return entry;
  for (const ov of overrides) {
    if (ov.host !== entry.host) continue;
    const field = ov.field;
    if (!(field in entry) || entry[field] === null) continue;
    const props = ov.overrides || {};
    if (props.exclude) { entry[field] = null; continue; }
    if (typeof props.divisor === 'number' && props.divisor !== 0) {
      entry[field] = entry[field] / props.divisor;
    }
    if (typeof props.max_value === 'number') {
      entry[field] = Math.min(entry[field], props.max_value);
    }
    if (typeof props.decimal_places === 'number') {
      entry[field] = parseFloat(entry[field].toFixed(props.decimal_places));
    }
  }
  return entry;
}

function processRows(rows, settings) {
  const nodeMappings = parseJSON(settings.influxdb_node_mappings || '[]', []);
  const thresholds   = parseJSON(settings.influxdb_thresholds    || '{}', {});
  const overrides    = parseJSON(settings.influxdb_overrides     || '[]', []);
  const statusConfig = parseJSON(settings.influxdb_status_config || '{}', {});
  const panelConfig  = parseJSON(settings.influxdb_panel_config  || '{}', {});

  const nodeHostSet    = new Set(nodeMappings.map(n => n.host));
  const nodeDisplayMap = Object.fromEntries(nodeMappings.map(n => [n.host, n.display || n.host.toUpperCase()]));

  const defaultWatchNodes = nodeMappings.map(n => n.host);
  const watchNodes    = new Set(statusConfig.watch_nodes   || defaultWatchNodes);
  const watchMetrics  = new Set(statusConfig.watch_metrics || ['cpu', 'ram', 'disk']);
  const alertOffline  = statusConfig.alert_on_offline !== false;

  const defaultThr = { cpu: 85, ram: 90, disk: 90 };

  let degraded = false;
  const nodes      = [];
  const containers = [];
  const seenHosts  = new Set();

  for (const row of rows) {
    let entry = computeMetrics(row);

    // Storage volumes (object=storages) share the node hostname but carry no CPU/RAM.
    // They clutter the panel as phantom node entries — skip them entirely.
    if (entry.object === 'storages') continue;

    entry = applyOverrides(entry, overrides);
    seenHosts.add(entry.host);

    const isNode = nodeHostSet.has(entry.host) || entry.object === 'node';
    const displayName = isNode
      ? (nodeDisplayMap[entry.host] || entry.host.toUpperCase())
      : entry.host.toUpperCase();

    const offline = entry.uptime === '0m' && (entry.ram === null || entry.ram === 0);
    const item = {
      host:         entry.host,
      display_name: displayName,
      object:       entry.object,
      cpu:          entry.cpu,
      ram:          entry.ram,
      disk:         entry.disk,
      uptime:       entry.uptime,
      loadavg:      entry.loadavg,
      offline,
    };

    if (isNode && watchNodes.has(entry.host)) {
      const thr = { ...defaultThr, ...(thresholds[entry.host] || {}) };
      if (watchMetrics.has('cpu')  && entry.cpu  !== null && entry.cpu  > thr.cpu)  degraded = true;
      if (watchMetrics.has('ram')  && entry.ram  !== null && entry.ram  > thr.ram)  degraded = true;
      if (watchMetrics.has('disk') && entry.disk !== null && entry.disk > thr.disk) degraded = true;
    }

    if (isNode) nodes.push(item);
    else        containers.push(item);
  }

  // Missing expected nodes trigger degraded if alert_on_offline
  if (alertOffline) {
    for (const n of nodeMappings) {
      if (watchNodes.has(n.host) && !seenHosts.has(n.host)) { degraded = true; break; }
    }
  }

  nodes.sort((a, b) => a.display_name.localeCompare(b.display_name));
  containers.sort((a, b) => a.display_name.localeCompare(b.display_name));

  return {
    status:       degraded ? 'degraded' : 'nominal',
    last_updated: new Date().toISOString(),
    nodes,
    containers,
  };
}

function processStorageRows(rows) {
  const seenShared = new Set();
  const storages   = [];

  for (const row of rows) {
    const name  = row.host     || '';
    const node  = row.nodename || '';
    const used  = csvNum(row.used)   ?? 0;
    const total = csvNum(row.total)  ?? 0;
    if (!name || total === 0) continue;

    const shared = csvNum(row.shared) === 1;
    if (shared) {
      if (seenShared.has(name)) continue;
      seenShared.add(name);
    }

    storages.push({
      name,
      node:        shared ? null : node,
      used_bytes:  used,
      total_bytes: total,
      disk:        total > 0 ? (used / total) * 100 : null,
      shared,
    });
  }

  storages.sort((a, b) => a.name.localeCompare(b.name) || (a.node || '').localeCompare(b.node || ''));
  return storages;
}

function escapeFlux(str) {
  return String(str).replace(/"/g, '\\"');
}

// Group by host AND object so we distinguish node vs lxc vs qemu
const FLUX_QUERY = (bucket) => `import "strings"

from(bucket: "${escapeFlux(bucket)}")
  |> range(start: -2m)
  |> filter(fn: (r) =>
    r["_measurement"] == "cpustat" or
    r["_measurement"] == "memory" or
    r["_measurement"] == "system" or
    r["_measurement"] == "storage" or
    r["_measurement"] == "ballooninfo"
  )
  |> filter(fn: (r) =>
    r["_field"] =~ /^(uptime|cpu|loadavg|mem|maxmem|memtotal|memused|disk|maxdisk|rootfs_total|rootfs_used|total|used|free|actual|free_mem|total_mem)$/
  )
  |> last()
  |> map(fn: (r) => ({ r with _value: float(v: r._value) }))
  |> map(fn: (r) => ({ r with host: strings.replace(v: r.host, t: "_", u: "-", i: -1) }))
  |> group(columns: ["host", "object"])
  |> pivot(rowKey:["host", "object"], columnKey: ["_field"], valueColumn: "_value")
  |> group()`;

const STORAGE_QUERY = (bucket) => `from(bucket: "${escapeFlux(bucket)}")
  |> range(start: -2m)
  |> filter(fn: (r) => r["_measurement"] == "system" and r["object"] == "storages")
  |> filter(fn: (r) => r["_field"] == "used" or r["_field"] == "total" or r["_field"] == "shared")
  |> last()
  |> map(fn: (r) => ({ r with _value: float(v: r._value) }))
  |> group(columns: ["host", "nodename"])
  |> pivot(rowKey: ["host", "nodename"], columnKey: ["_field"], valueColumn: "_value")
  |> group()`;

router.get('/api/metrics', async (req, res) => {
  const rows     = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const token = settings.influxdb_token || '';
  if (!token) return res.json({ status: 'unconfigured' });

  const url      = settings.influxdb_url    || 'http://localhost:8086';
  const org      = settings.influxdb_org    || 'proxmox';
  const bucket   = settings.influxdb_bucket || 'proxmox';
  const interval = parseInt(settings.influxdb_refresh_interval || '30', 10);

  const now = Date.now();
  if (cache.data && (now - cache.ts) < interval * 1000) {
    return res.json({
      ...cache.data,
      panel_config: parseJSON(settings.influxdb_panel_config || '{}', {}),
      thresholds:   parseJSON(settings.influxdb_thresholds   || '{}', {}),
    });
  }

  const influxFetch = (body) => fetch(
    `${url}/api/v2/query?org=${encodeURIComponent(org)}`,
    { method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' }, body }
  );

  try {
    const [mainResp, storageResp, borgData] = await Promise.all([
      influxFetch(FLUX_QUERY(bucket)),
      influxFetch(STORAGE_QUERY(bucket)),
      fetchBorgStatus(settings).catch(() => ({ status: 'unknown' })),
    ]);

    if (!mainResp.ok) {
      return res.json({ status: 'error', message: `InfluxDB returned ${mainResp.status}` });
    }

    const mainCsv     = await mainResp.text();
    const storageCsv  = storageResp.ok ? await storageResp.text() : '';
    const parsed      = parseInfluxCSV(mainCsv);
    const storageRows = parseInfluxCSV(storageCsv);
    const result      = processRows(parsed, settings);
    result.storages   = processStorageRows(storageRows);

    // Build per-(storageName, nodename) lookup from raw rows for disk_storage overrides
    const storageTable = {};
    for (const row of storageRows) {
      const name  = row.host     || '';
      const rnode = row.nodename || '';
      const used  = parseFloat(row.used)  || 0;
      const total = parseFloat(row.total) || 0;
      if (!name || total === 0) continue;
      if (!storageTable[name]) storageTable[name] = {};
      storageTable[name][rnode] = { used, total };
    }

    // Nodes don't report disk/maxdisk themselves — derive from local storages or a configured disk_storage
    const nodeDiskConfig = Object.fromEntries(
      parseJSON(settings.influxdb_node_mappings || '[]', [])
        .filter(n => n.disk_storage)
        .map(n => [n.host, n.disk_storage])
    );
    const storageByNode = {};
    for (const sv of result.storages) {
      if (!sv.node) continue;
      if (!storageByNode[sv.node]) storageByNode[sv.node] = { used: 0, total: 0 };
      storageByNode[sv.node].used  += sv.used_bytes;
      storageByNode[sv.node].total += sv.total_bytes;
    }
    for (const node of result.nodes) {
      const configured = nodeDiskConfig[node.host];
      if (configured) {
        const entries = storageTable[configured];
        if (entries) {
          const entry = entries[node.host] || Object.values(entries)[0];
          if (entry && entry.total > 0) node.disk = (entry.used / entry.total) * 100;
        }
      } else {
        const agg = storageByNode[node.host];
        if (agg && agg.total > 0) node.disk = (agg.used / agg.total) * 100;
      }
    }

    result.backup_status = borgData.status || 'unknown';
    if (borgData.repositories?.length) {
      const statusConfig   = parseJSON(settings.influxdb_status_config || '{}', {});
      const watchBorgRepos = statusConfig.watch_borg_repos;
      const hasDegraded    = borgData.repositories.some(r => {
        const watched = !Array.isArray(watchBorgRepos) || watchBorgRepos.includes(r.name);
        return watched && r.last_backup?.success === false;
      });
      if (hasDegraded) result.status = 'degraded';
    } else if (borgData.status === 'degraded') {
      result.status = 'degraded';
    }

    cache = { data: result, ts: now };
    res.json({
      ...result,
      panel_config: parseJSON(settings.influxdb_panel_config || '{}', {}),
      thresholds:   parseJSON(settings.influxdb_thresholds   || '{}', {}),
    });
  } catch (err) {
    res.json({ status: 'error', message: err.message });
  }
});

module.exports = router;
