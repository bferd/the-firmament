const db = require('./db');

const categoryCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (categoryCount > 0) {
  console.log('Database already seeded, skipping.');
  process.exit(0);
}

const insertCategory = db.prepare(
  'INSERT INTO categories (name, colour, sort_order) VALUES (?, ?, ?)'
);
const insertService = db.prepare(
  'INSERT INTO services (name, url, icon, category_id, accent_colour, sort_order, requires_auth, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

const seed = db.transaction(() => {
  const categories = [
    { name: 'MEDIA',              colour: '#a855f7', order: 1 },
    { name: 'DOWNLOADS',          colour: '#f59e0b', order: 2 },
    { name: 'SMART HOME',         colour: '#22c55e', order: 3 },
    { name: 'INFRASTRUCTURE',     colour: '#00e5ff', order: 4 },
    { name: 'SECURITY',           colour: '#ef4444', order: 5 },
    { name: 'CLOUD',              colour: '#3b82f6', order: 6 },
    { name: 'LINKS & BOOKMARKS',  colour: '#ec4899', order: 7 },
    { name: 'UTILITIES',          colour: '#f97316', order: 8 },
  ];

  const ids = {};
  for (const cat of categories) {
    const result = insertCategory.run(cat.name, cat.colour, cat.order);
    ids[cat.name] = result.lastInsertRowid;
  }

  const services = [
    // MEDIA
    ['Plex',            'https://plex.schroth.ca',             '🎬', ids['MEDIA'],             '#a855f7', 1, 0, 'Personal media server for movies and TV'],
    ['Plex 2',          'https://plex2.schroth.ca',            '🎬', ids['MEDIA'],             '#a855f7', 2, 0, 'Secondary Plex media server'],
    ['Audiobookshelf',  'https://audiobookshelf.schroth.ca',   '📚', ids['MEDIA'],             '#a855f7', 3, 0, 'Audiobook and podcast library'],
    ['Grimmory',        'https://grimmory.schroth.ca',         '📖', ids['MEDIA'],             '#a855f7', 4, 0, 'Book library and reading tracker'],
    ['MeTube',          'https://metube.schroth.ca',           '📥', ids['MEDIA'],             '#a855f7', 5, 0, 'YouTube video downloader'],
    ['Tautulli',        'https://tautulli.schroth.ca',         '📊', ids['MEDIA'],             '#a855f7', 6, 0, 'Plex statistics and monitoring'],

    // DOWNLOADS
    ['AriaNg',          'https://ariang.schroth.ca',           '⚡', ids['DOWNLOADS'],         '#f59e0b', 1, 1, 'Download manager web interface'],
    ['RDT Client',      'https://rdtclient.schroth.ca',        '🔄', ids['DOWNLOADS'],         '#f59e0b', 2, 1, 'Real-Debrid torrent client'],

    // SMART HOME
    ['Home Assistant',  'https://homeassistant.schroth.ca',    '🏠', ids['SMART HOME'],        '#22c55e', 1, 0, 'Smart home automation hub'],
    ['Music Assistant', 'https://musicassistant.schroth.ca',   '🎵', ids['SMART HOME'],        '#22c55e', 2, 0, 'Multi-room music streaming'],

    // INFRASTRUCTURE
    ['Proxmox',         'https://proxmox.schroth.ca',          '🖥️', ids['INFRASTRUCTURE'],    '#00e5ff', 1, 0, 'Hypervisor and VM management'],
    ['NPMplus',         'https://nginx.schroth.ca',            '🔀', ids['INFRASTRUCTURE'],    '#00e5ff', 2, 1, 'Reverse proxy manager'],
    ['Uptime Kuma',     'https://uptimekuma.schroth.ca',       '💓', ids['INFRASTRUCTURE'],    '#00e5ff', 3, 0, 'Service uptime monitoring'],
    ['Grafana',         'https://grafana.schroth.ca',          '📈', ids['INFRASTRUCTURE'],    '#00e5ff', 4, 0, 'Metrics and analytics dashboard'],
    ['Web Server',      'https://webserver.schroth.ca',        '🌐', ids['INFRASTRUCTURE'],    '#00e5ff', 5, 0, 'Primary web server'],
    ['UT2K4 Admin',     'https://ut2k4webadmin.schroth.ca',    '🎮', ids['INFRASTRUCTURE'],    '#00e5ff', 6, 0, 'Unreal Tournament 2004 server admin'],

    // SECURITY
    ['Vaultwarden',     'https://vaultwarden.schroth.ca',      '🔐', ids['SECURITY'],          '#ef4444', 1, 0, 'Self-hosted password manager'],
    ['Guacamole',       'https://guac.schroth.ca',             '🐊', ids['SECURITY'],          '#ef4444', 2, 0, 'Browser-based remote desktop gateway'],

    // CLOUD
    ['Nextcloud',       'https://nextcloud.schroth.ca',        '☁️', ids['CLOUD'],             '#3b82f6', 1, 0, 'Self-hosted cloud storage and office'],
    ['File Browser',    'https://filebrowser.schroth.ca',      '📁', ids['CLOUD'],             '#3b82f6', 2, 0, 'Web-based file manager'],

    // LINKS & BOOKMARKS
    ['LinkStack',       'https://linkstack.schroth.ca',        '🔗', ids['LINKS & BOOKMARKS'], '#ec4899', 1, 0, 'Personal link in bio page'],
    ['Linkwarden',      'https://linkwarden.schroth.ca',       '🔖', ids['LINKS & BOOKMARKS'], '#ec4899', 2, 0, 'Bookmark and link manager'],

    // UTILITIES
    ['Neko',            'https://neko.schroth.ca',             '🐱', ids['UTILITIES'],         '#f97316', 1, 0, 'Virtual browser and screen sharing'],
  ];

  for (const svc of services) {
    insertService.run(...svc);
  }
});

seed();
console.log('Database seeded successfully.');
