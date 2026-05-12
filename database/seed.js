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
    ['Example Service', 'https://service.example.com',  '🖥️', ids['MEDIA'],          '#a855f7', 1, 0, 'Replace with your own service'],

    // INFRASTRUCTURE
    ['Another Service', 'https://another.example.com',  '⚙️', ids['INFRASTRUCTURE'], '#00e5ff', 1, 0, 'Replace with your own service'],
  ];

  for (const svc of services) {
    insertService.run(...svc);
  }
});

seed();
console.log('Database seeded successfully.');
