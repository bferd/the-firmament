'use strict';

const path = require('path');

// Safety guard 1: require DEMO_MODE=true
if (process.env.DEMO_MODE !== 'true') {
  console.error('Refusing to run: DEMO_MODE is not set to true. This script is destructive — only run it on the demo instance.');
  process.exit(1);
}

// Safety guard 2: DB path must reference the demo instance
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/firmament.db');
if (!DB_PATH.includes('the-firmament')) {
  console.error('Refusing to run: database path does not look like the demo instance.');
  process.exit(1);
}

// TODO: seed demo data
