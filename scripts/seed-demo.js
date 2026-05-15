'use strict';

const path = require('path');

if (process.env.DEMO_MODE !== 'true') {
  console.error('Refusing to run: DEMO_MODE is not set to true. This script is destructive — only run it on the demo instance.');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/firmament.db');

const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

console.log('Seeding demo data into:', DB_PATH);

// ── Clear existing services and categories ─────────────────────────────────
db.prepare('DELETE FROM services').run();
db.prepare('DELETE FROM categories').run();

// ── Categories ─────────────────────────────────────────────────────────────
const insertCat = db.prepare('INSERT INTO categories (name, colour, sort_order) VALUES (?, ?, ?)');
const catDefs = [
  { name: 'Media',          colour: '#e040fb', sort_order: 1 },
  { name: 'Infrastructure', colour: '#00e5ff', sort_order: 2 },
  { name: 'Cloud',          colour: '#3b82f6', sort_order: 3 },
  { name: 'Security',       colour: '#ef4444', sort_order: 4 },
  { name: 'Utilities',      colour: '#22c55e', sort_order: 5 },
];
const catIds = {};
for (const cat of catDefs) {
  catIds[cat.name] = insertCat.run(cat.name, cat.colour, cat.sort_order).lastInsertRowid;
}

// ── Services ───────────────────────────────────────────────────────────────
const insertSvc = db.prepare(`
  INSERT INTO services (name, url, icon, category_id, accent_colour, sort_order, requires_auth, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const svcDefs = [
  // Media (5)
  { name: 'Jellyfin',       url: 'https://media.example.local',      icon: '🎬', cat: 'Media',          accent: '#e040fb', sort: 1, auth: 0, desc: 'Self-hosted media server for movies and TV shows' },
  { name: 'Plex',           url: 'https://plex.example.local',       icon: '🍿', cat: 'Media',          accent: '#fbbf24', sort: 2, auth: 1, desc: 'Personal media streaming for the family' },
  { name: 'Navidrome',      url: 'https://music.example.local',      icon: '🎵', cat: 'Media',          accent: '#34d399', sort: 3, auth: 0, desc: 'Self-hosted music streaming, Subsonic-compatible' },
  { name: 'Calibre-Web',    url: 'https://books.example.local',      icon: '📚', cat: 'Media',          accent: '#fb923c', sort: 4, auth: 1, desc: 'eBook library management and reader' },
  { name: 'Immich',         url: 'https://photos.example.local',     icon: '📷', cat: 'Media',          accent: '#818cf8', sort: 5, auth: 1, desc: 'Self-hosted photo and video backup' },
  // Infrastructure (4)
  { name: 'Proxmox',        url: 'https://pve.example.local:8006',   icon: '🖥️', cat: 'Infrastructure', accent: '#00e5ff', sort: 1, auth: 1, desc: 'Proxmox Virtual Environment hypervisor' },
  { name: 'TrueNAS',        url: 'https://nas.example.local',        icon: '💾', cat: 'Infrastructure', accent: '#38bdf8', sort: 2, auth: 1, desc: 'Network-attached storage management' },
  { name: 'Portainer',      url: 'https://portainer.example.local',  icon: '🐳', cat: 'Infrastructure', accent: '#54a0ff', sort: 3, auth: 1, desc: 'Docker container management' },
  { name: 'Uptime Kuma',    url: 'https://status.example.local',     icon: '📊', cat: 'Infrastructure', accent: '#22c55e', sort: 4, auth: 0, desc: 'Self-hosted uptime and status monitoring' },
  // Cloud (4)
  { name: 'Nextcloud',      url: 'https://cloud.example.local',      icon: '☁️', cat: 'Cloud',          accent: '#3b82f6', sort: 1, auth: 1, desc: 'Private cloud storage and collaboration suite' },
  { name: 'Vaultwarden',    url: 'https://vault.example.local',      icon: '🔐', cat: 'Cloud',          accent: '#a78bfa', sort: 2, auth: 0, desc: 'Self-hosted Bitwarden-compatible password manager' },
  { name: 'Gitea',          url: 'https://git.example.local',        icon: '🐙', cat: 'Cloud',          accent: '#84cc16', sort: 3, auth: 0, desc: 'Self-hosted Git service and code hosting' },
  { name: 'Miniflux',       url: 'https://rss.example.local',        icon: '📰', cat: 'Cloud',          accent: '#fb7185', sort: 4, auth: 1, desc: 'Minimalist RSS and Atom news feed reader' },
  // Security (2)
  { name: 'Authelia',       url: 'https://auth.example.local',       icon: '🔒', cat: 'Security',       accent: '#ef4444', sort: 1, auth: 0, desc: 'Single sign-on and two-factor authentication gateway' },
  { name: 'AdGuard Home',   url: 'https://adguard.example.local',    icon: '🛡️', cat: 'Security',       accent: '#fb923c', sort: 2, auth: 1, desc: 'Network-wide DNS ad and tracker blocking' },
  // Utilities (3)
  { name: 'Home Assistant', url: 'https://ha.example.local',         icon: '🏠', cat: 'Utilities',      accent: '#22c55e', sort: 1, auth: 0, desc: 'Home automation and smart home control' },
  { name: 'Grafana',        url: 'https://grafana.example.local',    icon: '📈', cat: 'Utilities',      accent: '#f59e0b', sort: 2, auth: 0, desc: 'Metrics, logs, and observability dashboards' },
  { name: 'Paperless-ngx',  url: 'https://paperless.example.local',  icon: '📄', cat: 'Utilities',      accent: '#64748b', sort: 3, auth: 1, desc: 'Document management with OCR indexing' },
];

for (const s of svcDefs) {
  insertSvc.run(s.name, s.url, s.icon, catIds[s.cat], s.accent, s.sort, s.auth, s.desc);
}

// ── Settings: node mappings ────────────────────────────────────────────────
const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

upsert.run('influxdb_node_mappings', JSON.stringify([
  { host: 'tropus',  display: 'Tropus'  },
  { host: 'stratos', display: 'Stratos' },
  { host: 'mesos',   display: 'Mesos'   },
  { host: 'therm',   display: 'Therm'   },
]));

// ── Settings: demo metrics data ────────────────────────────────────────────
upsert.run('demo_metrics_data', JSON.stringify({
  status: 'nominal',
  nodes: [
    { host: 'tropus',  display_name: 'Tropus',  object: 'node', cpu: 23.4, ram: 61.2, disk: 34.8, uptime: '12d 4h',  loadavg: 0.87, offline: false },
    { host: 'stratos', display_name: 'Stratos', object: 'node', cpu:  8.1, ram: 44.7, disk: 52.1, uptime: '28d 7h',  loadavg: 0.31, offline: false },
    { host: 'mesos',   display_name: 'Mesos',   object: 'node', cpu: 41.6, ram: 78.3, disk: 67.4, uptime: '5d 11h',  loadavg: 2.14, offline: false },
    { host: 'therm',   display_name: 'Therm',   object: 'node', cpu: 15.9, ram: 55.8, disk: 45.2, uptime: '19d 2h',  loadavg: 0.62, offline: false },
  ],
  containers: [
    { host: 'jellyfin',      display_name: 'JELLYFIN',      object: 'lxc',  cpu:  4.2, ram: 38.1, disk: 22.4, uptime: '12d 4h', loadavg: null, offline: false },
    { host: 'nextcloud',     display_name: 'NEXTCLOUD',     object: 'lxc',  cpu:  1.8, ram: 55.6, disk: 71.3, uptime: '28d 7h', loadavg: null, offline: false },
    { host: 'gitea',         display_name: 'GITEA',         object: 'lxc',  cpu:  0.4, ram: 28.9, disk: 15.7, uptime: '28d 7h', loadavg: null, offline: false },
    { host: 'homeassistant', display_name: 'HOMEASSISTANT', object: 'qemu', cpu:  6.1, ram: 42.3, disk: 38.2, uptime: '5d 11h', loadavg: null, offline: false },
    { host: 'vaultwarden',   display_name: 'VAULTWARDEN',   object: 'lxc',  cpu:  0.1, ram: 18.4, disk:  8.9, uptime: '19d 2h', loadavg: null, offline: false },
    { host: 'adguard',       display_name: 'ADGUARD',       object: 'lxc',  cpu:  0.8, ram: 23.7, disk: 12.1, uptime: '19d 2h', loadavg: null, offline: false },
    { host: 'paperless',     display_name: 'PAPERLESS',     object: 'lxc',  cpu:  0.2, ram: 31.5, disk: 44.7, uptime: '5d 11h', loadavg: null, offline: false },
    { host: 'grafana',       display_name: 'GRAFANA',       object: 'lxc',  cpu:  0.6, ram: 19.8, disk: 11.2, uptime: '12d 4h', loadavg: null, offline: false },
  ],
  storages: [
    { name: 'local-lvm',      node: 'tropus',  used_bytes: 214748364800,  total_bytes: 499122659328,  disk: 43.0, shared: false },
    { name: 'local-lvm',      node: 'stratos', used_bytes: 107374182400,  total_bytes: 499122659328,  disk: 21.5, shared: false },
    { name: 'local-lvm',      node: 'mesos',   used_bytes: 322122547200,  total_bytes: 499122659328,  disk: 64.5, shared: false },
    { name: 'hdd-1tb',        node: null,      used_bytes: 687194767360,  total_bytes: 1099511627776, disk: 62.5, shared: true  },
    { name: 'proxmox-backup', node: null,      used_bytes: 858993459200,  total_bytes: 2199023255552, disk: 39.1, shared: true  },
  ],
  backup_status: 'healthy',
}));

// ── Settings: demo Borg backup data ────────────────────────────────────────
const now        = Math.floor(Date.now() / 1000);
const h6ago      = now - 6  * 3600;
const h12ago     = now - 12 * 3600;
const d2ago      = now - 2  * 86400;
const d5ago      = now - 5  * 86400;
const d7ago      = now - 7  * 86400;

upsert.run('demo_borg_data', JSON.stringify({
  connected: true,
  status:    'healthy',
  repositories: [
    {
      name:          'main',
      display_name:  'Main Backup',
      size_bytes:    858993459200,
      size_display:  '800.0 GB',
      archive_count: 47,
      path:          '/mnt/borg/main',
      last_backup: {
        timestamp:                 h6ago,
        time_ago:                  '6h ago',
        success:                   true,
        duration_seconds:          342,
        duration_display:          '5m 42s',
        original_size_bytes:       21474836480,
        original_size_display:     '20.0 GB',
        deduplicated_size_bytes:   1073741824,
        deduplicated_size_display: '1.0 GB',
        dedup_ratio:               '20.0x',
      },
      last_check:   { timestamp: d2ago, time_ago: '2d ago' },
      last_compact: { timestamp: d7ago, time_ago: '7d ago' },
      jobs: { backup_total: 47, backup_failed: 0, backup_orphaned: 0, restore_total: 2, check_total: 8,  prune_total: 46, compact_total: 3 },
      status: 'healthy',
    },
    {
      name:          'offsite',
      display_name:  'Offsite Backup',
      size_bytes:    429496729600,
      size_display:  '400.0 GB',
      archive_count: 12,
      path:          '/mnt/borg/offsite',
      last_backup: {
        timestamp:                 h12ago,
        time_ago:                  '12h ago',
        success:                   true,
        duration_seconds:          891,
        duration_display:          '14m 51s',
        original_size_bytes:       53687091200,
        original_size_display:     '50.0 GB',
        deduplicated_size_bytes:   2147483648,
        deduplicated_size_display: '2.0 GB',
        dedup_ratio:               '25.0x',
      },
      last_check:   { timestamp: d5ago, time_ago: '5d ago' },
      last_compact: null,
      jobs: { backup_total: 12, backup_failed: 0, backup_orphaned: 0, restore_total: 0, check_total: 3, prune_total: 11, compact_total: 0 },
      status: 'healthy',
    },
  ],
  system: {
    repositories_total:     2,
    scheduled_jobs_total:   4,
    scheduled_jobs_enabled: 4,
    active_jobs:            0,
  },
}));

console.log('Done.');
console.log(`  ${catDefs.length} categories: ${catDefs.map(c => c.name).join(', ')}`);
console.log(`  ${svcDefs.length} services across all categories`);
console.log('  4 node mappings: Tropus, Stratos, Mesos, Therm');
console.log('  demo_metrics_data: 4 nodes, 8 containers, 5 storages');
console.log('  demo_borg_data: 2 repos (main + offsite), both healthy');
