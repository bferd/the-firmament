const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/firmament.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    colour TEXT NOT NULL DEFAULT '#00e5ff',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🔗',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    accent_colour TEXT NOT NULL DEFAULT '#00e5ff',
    sort_order INTEGER NOT NULL DEFAULT 0,
    requires_auth INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations
try { db.exec("ALTER TABLE services ADD COLUMN description          TEXT    NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE services ADD COLUMN disable_when_offline INTEGER NOT NULL DEFAULT 0");  } catch (_) {}
try { db.exec("ALTER TABLE services ADD COLUMN host_name            TEXT    NOT NULL DEFAULT ''"); } catch (_) {}

// Populate descriptions for seeded services — skip if all descriptions already set
const _needsDescSeeding = db.prepare("SELECT COUNT(*) as count FROM services WHERE description = '' OR description IS NULL").get();
if (_needsDescSeeding.count > 0) {
const _descUp = db.prepare("UPDATE services SET description=? WHERE name=? AND description=''");
for (const [name, desc] of [
  ['Plex',            'Personal media server for movies and TV'],
  ['Plex 2',          'Secondary Plex media server'],
  ['Audiobookshelf',  'Audiobook and podcast library'],
  ['Grimmory',        'Book library and reading tracker'],
  ['MeTube',          'YouTube video downloader'],
  ['Tautulli',        'Plex statistics and monitoring'],
  ['AriaNg',          'Download manager web interface'],
  ['RDT Client',      'Real-Debrid torrent client'],
  ['Home Assistant',  'Smart home automation hub'],
  ['Music Assistant', 'Multi-room music streaming'],
  ['Proxmox',         'Hypervisor and VM management'],
  ['NPMplus',         'Reverse proxy manager'],
  ['Uptime Kuma',     'Service uptime monitoring'],
  ['Grafana',         'Metrics and analytics dashboard'],
  ['Web Server',      'Primary web server'],
  ['UT2K4 Admin',     'Unreal Tournament 2004 server admin'],
  ['Vaultwarden',     'Self-hosted password manager'],
  ['Guacamole',       'Browser-based remote desktop gateway'],
  ['Nextcloud',       'Self-hosted cloud storage and office'],
  ['File Browser',    'Web-based file manager'],
  ['LinkStack',       'Personal link in bio page'],
  ['Linkwarden',      'Bookmark and link manager'],
  ['Neko',            'Virtual browser and screen sharing'],
]) {
  _descUp.run(desc, name);
}
} // end _needsDescSeeding guard

// Insert defaults only if settings table is empty
const settingsCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
if (settingsCount === 0) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('title', 'The Firmament');
  insertSetting.run('tagline', 'Guardian of the Threshold');
}

// InfluxDB / metrics defaults (INSERT OR IGNORE — never overwrite existing values)
const _ig = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const _defaultNodeMappings = JSON.stringify([
  { host: 'proxmox',                display: 'Tropus'  },
  { host: 'proxmox2',               display: 'Stratos' },
  { host: 'proxmox3',               display: 'Mesos'   },
  { host: 'proxmox4',               display: 'Therm'   },
  { host: 'proxmox-backup-server',  display: 'Exos'    },
]);
const _defaultThresholds = JSON.stringify({
  proxmox:               { cpu: 85, ram: 90, disk: 90 },
  proxmox2:              { cpu: 85, ram: 90, disk: 90 },
  proxmox3:              { cpu: 85, ram: 90, disk: 90 },
  proxmox4:              { cpu: 85, ram: 90, disk: 90 },
  'proxmox-backup-server': { cpu: 85, ram: 90, disk: 90 },
});
const _defaultStatusConfig = JSON.stringify({
  watch_nodes:    ['proxmox', 'proxmox2', 'proxmox3', 'proxmox4', 'proxmox-backup-server'],
  watch_metrics:  ['cpu', 'ram', 'disk'],
  alert_on_offline: true,
});
const _defaultPanelConfig = JSON.stringify({
  show_nodes:   ['proxmox', 'proxmox2', 'proxmox3', 'proxmox4', 'proxmox-backup-server'],
  show_metrics: ['cpu', 'ram', 'disk', 'uptime'],
});
for (const [k, v] of [
  ['influxdb_url',              'http://localhost:8086'],
  ['influxdb_token',            ''],
  ['influxdb_org',              'proxmox'],
  ['influxdb_bucket',           'proxmox'],
  ['influxdb_refresh_interval', '30'],
  ['influxdb_node_mappings',    _defaultNodeMappings],
  ['influxdb_thresholds',       _defaultThresholds],
  ['influxdb_overrides',        '[]'],
  ['influxdb_status_config',    _defaultStatusConfig],
  ['influxdb_panel_config',     _defaultPanelConfig],
  ['card_width_desktop',        '300'],
  ['card_width_mobile',         '1'],
  ['borg_url',                  'http://localhost:8082'],
  ['borg_token',                ''],
  ['borg_enabled',              'true'],
  ['borg_refresh_interval',     '60'],
  ['borg_repository_names',     '{}'],

  // Theme & appearance
  ['theme_preset',             'firmament'],
  ['theme_accent_primary',     '#00e5ff'],
  ['theme_accent_secondary',   '#8b5cf6'],
  ['theme_bg_primary',         '#04080f'],
  ['theme_bg_secondary',       '#060d18'],
  ['theme_text_primary',       '#c9d6e3'],
  ['theme_text_dim',           '#5a7a99'],
  ['theme_card_opacity',       '0.85'],
  ['theme_scanlines',          'false'],
  ['theme_scanline_intensity', '0.012'],
  ['theme_corner_brackets',    'true'],
  ['theme_font_heading',       'Orbitron'],
  ['theme_font_body',          'Rajdhani'],
  ['theme_font_mono',          'Share Tech Mono'],
  ['theme_custom_css',         ''],

  // Character
  ['character_enabled',       'true'],
  ['character_name',          'ENGEL'],
  ['character_tagline',       'GUARDIAN OF THE FIRMAMENT'],
  ['character_panel_width',   '300'],
  ['character_blend_mode',    'screen'],
  ['character_show_metrics',  'true'],
  ['character_show_status',   'true'],
  ['character_panel_side',    'right'],
  ['character_mobile_panel',  'hidden'],

  // Hero & Layout
  ['hero_title',                 'THE FIRMAMENT'],
  ['hero_subtitle',              'SCHROTH.CA HOMELAB'],
  ['hero_show_scroll_indicator', 'true'],
  ['layout_card_style',          'glass'],
  ['layout_show_descriptions',   'true'],
  ['layout_show_urls',           'true'],
  ['layout_desktop_columns',     'auto'],

  // Footer
  ['footer_text',       'PERSONAL NON-COMMERCIAL USE ONLY'],
  ['footer_show_link',  'true'],
  ['footer_link_url',   'https://linkstack.schroth.ca/@brad'],
  ['footer_link_label', 'Brad Schroth'],

  // Announcement
  ['announcement_enabled',     'false'],
  ['announcement_text',        ''],
  ['announcement_dismissible', 'true'],
  ['announcement_colour',      '#fbbf24'],

  // Welcome modal
  ['welcome_modal_enabled',          'false'],
  ['welcome_modal_title',            'WELCOME TO THE FIRMAMENT'],
  ['welcome_modal_body',             'This is a personal homelab portal. Services are for family and friends only.'],
  ['welcome_modal_button',           'ENTER'],
  ['welcome_modal_once_per_session', 'true'],

  // Media behaviour
  ['show_no_videos_message', 'true'],
  ['auth_recheck_interval',  '300000'],
]) { _ig.run(k, v); }

module.exports = db;
