'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const db        = require('./database/db');
const metricsRouter          = require('./routes/metrics');
const { router: borgRouter } = require('./routes/borg');

// Run seed if database is empty
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (catCount === 0) {
  require('./database/seed');
}

const AUTHELIA_URL = process.env.AUTHELIA_URL || 'http://192.168.1.156:9091';
const PROXY_IP     = process.env.NPMPLUS_IP   || '192.168.1.164';

// ── Auth session cache ─────────────────────────────────────────────────────
const authCache     = new Map();
const AUTH_CACHE_TTL = 60 * 1000;

function getCacheKey(req) {
  const cookies      = req.headers.cookie || '';
  const sessionMatch = cookies.match(/authelia_session=([^;]+)/);
  return sessionMatch ? sessionMatch[1] : null;
}

function getCachedAuth(req) {
  const key   = getCacheKey(req);
  if (!key) return null;
  const entry = authCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { authCache.delete(key); return null; }
  return entry.authed;
}

function setCachedAuth(req, authed) {
  const key = getCacheKey(req);
  if (!key) return;
  authCache.set(key, { authed, expires: Date.now() + AUTH_CACHE_TTL });
  if (authCache.size > 100) authCache.delete(authCache.keys().next().value);
}

const VIDEOS_DIR = path.join(__dirname, 'videos');
const FONTS_DIR  = path.join(__dirname, 'fonts');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true });

// ── Video slot → base filename mapping ────────────────────────────────────
const VIDEO_SLOTS = {
  background: 'hero-background',
  welcome:    'hero-welcome',
  idle:       'hero-idle-loop',
  transition: 'hero-transition',
  browse:     'hero-browse-idle',
};

// ── Magic byte validators ─────────────────────────────────────────────────
function isValidVideoBuffer(buf, ext) {
  if (!buf || buf.length < 8) return false;
  if (ext === '.webm') {
    return buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
  }
  if (ext === '.mp4') {
    // 'ftyp' box at offset 4
    return buf.slice(4, 8).toString('ascii') === 'ftyp';
  }
  return false;
}

function isValidFontBuffer(buffer, ext) {
  if (buffer.length < 4) return false;
  const bytes = buffer.slice(0, 4);
  if (ext === '.woff2') {
    return bytes[0] === 0x77 && bytes[1] === 0x4F && bytes[2] === 0x46 && bytes[3] === 0x32;
  }
  if (ext === '.woff') {
    return bytes[0] === 0x77 && bytes[1] === 0x4F && bytes[2] === 0x46 && bytes[3] === 0x46;
  }
  if (ext === '.ttf') {
    return (bytes[0] === 0x00 && bytes[1] === 0x01) ||
           (bytes[0] === 0x74 && bytes[1] === 0x72);
  }
  return false;
}

function isValidFaviconBuffer(buffer, ext) {
  if (buffer.length < 4) return false;
  const bytes = buffer.slice(0, 4);
  if (ext === '.ico') {
    return bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
  }
  if (ext === '.png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  }
  if (ext === '.svg') {
    return bytes[0] === 0x3C || bytes[0] === 0xEF;
  }
  return false;
}

// ── Multer configurations ─────────────────────────────────────────────────
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.mp4', '.webm'].includes(ext)) return cb(new Error('Only .mp4 and .webm are allowed'));
    cb(null, true);
  },
});

const fontUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.woff2', '.woff', '.ttf'].includes(ext)) return cb(new Error('Only .woff2, .woff, .ttf are allowed'));
    cb(null, true);
  },
});

const faviconUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 1 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.ico', '.png', '.svg'].includes(ext)) return cb(new Error('Only .ico, .png, .svg are allowed'));
    cb(null, true);
  },
});

// Wraps multer middleware as a promise
function runMulter(mw, req, res) {
  return new Promise((resolve, reject) => mw(req, res, err => err ? reject(err) : resolve()));
}

// ── Helper: find current video file for a slot ────────────────────────────
function findVideoFile(slot) {
  const base = VIDEO_SLOTS[slot];
  if (!base) return null;
  for (const ext of ['.mp4', '.webm']) {
    const fp = path.join(VIDEOS_DIR, base + ext);
    if (fs.existsSync(fp)) return { path: fp, filename: base + ext, ext };
  }
  return null;
}

function getVideosList() {
  return Object.keys(VIDEO_SLOTS).map(slot => {
    const info = findVideoFile(slot);
    if (info) {
      const stat = fs.statSync(info.path);
      return { slot, filename: info.filename, size: stat.size, lastModified: stat.mtime.toISOString() };
    }
    return { slot, filename: null, size: 0, lastModified: null };
  });
}

/**
 * sanitiseCSS — strips the most dangerous CSS injection vectors from user-supplied CSS.
 *
 * KNOWN LIMITATIONS (accepted risk for homelab):
 * - Does not prevent CSS data exfiltration via background: url(external) on page elements
 * - Does not prevent pointer-events overlay attacks
 * - Does not prevent CSS variable overrides
 *
 * This field is admin-only. Only the site owner can write custom CSS.
 * Public visitors cannot. Risk is accepted for personal homelab use.
 */
function sanitiseCSS(css) {
  if (typeof css !== 'string') return '';
  return css
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript\s*:/gi, 'javascript_blocked:')
    .replace(/@import\b/gi, '/* @import blocked */')
    .slice(0, 50000);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());

// ── Security headers ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag',           'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'SAMEORIGIN');
  res.setHeader('X-XSS-Protection',       '1; mode=block');
  res.setHeader('Referrer-Policy',        'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "font-src 'self' https://fonts.gstatic.com",
    "media-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/api',             apiLimiter);
app.use('/api/auth-status', authLimiter);
app.use('/api/admin',       adminLimiter);

// ── Static files ───────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

// Restrict /videos to video file extensions only
// no-cache so browsers always revalidate — prevents stale 404s after upload
app.use('/videos', (req, res, next) => {
  if (!/\.(mp4|webm)$/i.test(req.path)) return res.status(404).send('Not found');
  res.setHeader('Cache-Control', 'no-cache');
  next();
}, express.static(VIDEOS_DIR, { cacheControl: false }));

// Custom fonts — restrict to font file extensions only
app.use('/fonts', (req, res, next) => {
  if (!/\.(woff2|woff|ttf)$/i.test(req.path)) return res.status(404).send('Not found');
  next();
}, express.static(FONTS_DIR));

// ── Authelia session verification ──────────────────────────────────────────
async function verifyAuthelia(req) {
  try {
    const response = await fetch(`${AUTHELIA_URL}/api/verify`, {
      method: 'GET',
      headers: {
        'Cookie':             req.headers.cookie || '',
        'X-Original-URL':    'https://schroth.ca/',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host':  'schroth.ca',
        'X-Forwarded-Uri':   '/',
        'X-Forwarded-For':   req.ip || req.connection.remoteAddress,
      },
    });
    if (response.ok) {
      return { authenticated: true, username: response.headers.get('Remote-User') || 'authenticated' };
    }
    return { authenticated: false, username: null };
  } catch (_) {
    return { authenticated: false, username: null };
  }
}

async function requireAuth(req, res, next) {
  // Only trust Remote-User header if request comes directly from the reverse proxy
  const clientIp    = req.ip || req.connection.remoteAddress;
  const isFromProxy = clientIp === PROXY_IP || clientIp === `::ffff:${PROXY_IP}`;

  if (isFromProxy && req.headers['remote-user']) {
    return next();
  }

  // Check cache before hitting Authelia
  const cached = getCachedAuth(req);
  if (cached === true)  return next();
  if (cached === false) return res.status(401).json({ error: 'Unauthorised' });

  // Cache miss — verify with Authelia
  try {
    const auth = await verifyAuthelia(req);
    setCachedAuth(req, auth.authenticated);
    if (auth.authenticated) return next();
    return res.status(401).json({ error: 'Unauthorised' });
  } catch (err) {
    console.error('[AUTH] Error:', err.message);
    return res.status(401).json({ error: 'Unauthorised' });
  }
}

// ── Input sanitisation ─────────────────────────────────────────────────────
function sanitise(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').slice(0, maxLen).trim();
}

function sanitiseUrl(str) {
  if (typeof str !== 'string') return '';
  const t = str.trim();
  if (t === '') return '';
  if (/^https?:\/\//i.test(t) || t.startsWith('/')) return t.slice(0, 2048);
  return '';
}

function sanitiseColour(str) {
  if (typeof str !== 'string') return '#00e5ff';
  return /^#[0-9a-fA-F]{3,6}$/.test(str.trim()) ? str.trim() : '#00e5ff';
}

function sanitiseInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

const VALUE_MAX_LENGTH = {
  theme_custom_css:   100000,
  welcome_modal_body: 10000,
  announcement_text:  5000,
  influxdb_url:       2048,
  borg_url:           2048,
  footer_link_url:    2048,
  _default:           2048,
};

function capSettingValue(key, value) {
  const max = VALUE_MAX_LENGTH[key] || VALUE_MAX_LENGTH['_default'];
  const str = String(value);
  if (str.length > max) {
    console.warn(`[SETTINGS] Value for ${key} truncated from ${str.length} to ${max}`);
    return str.slice(0, max);
  }
  return str;
}

// ── Public API ─────────────────────────────────────────────────────────────

app.get('/api/auth-status', async (req, res) => {
  const auth = await verifyAuthelia(req);
  res.json(auth);
});

app.post('/api/logout', async (req, res) => {
  try {
    const response = await fetch(`${AUTHELIA_URL}/api/sign-out`, {
      method: 'POST', redirect: 'manual',
      headers: {
        'Cookie':           req.headers.cookie || '',
        'Content-Type':     'application/json',
        'X-Forwarded-Host': 'auth.schroth.ca',
      },
      body: JSON.stringify({ targetURL: 'https://schroth.ca/' }),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    res.json({ ok: true });
  } catch (_) {
    res.json({ ok: true });
  }
});

app.get('/api/layout', (req, res) => {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('card_width_desktop', 'card_width_mobile')"
  ).all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    card_width_desktop: parseInt(s.card_width_desktop) || 200,
    card_width_mobile:  parseInt(s.card_width_mobile)  || 1,
  });
});

// Public theme endpoint
const THEME_KEYS = [
  'theme_preset', 'theme_accent_primary', 'theme_accent_secondary',
  'theme_bg_primary', 'theme_bg_secondary', 'theme_text_primary',
  'theme_text_dim', 'theme_card_opacity', 'theme_scanlines',
  'theme_scanline_intensity', 'theme_corner_brackets',
  'theme_font_heading', 'theme_font_body', 'theme_font_mono',
  'theme_custom_css', 'theme_font_heading_custom', 'theme_font_body_custom',
  'character_enabled', 'character_name', 'character_tagline',
  'character_panel_width', 'character_blend_mode',
  'character_show_metrics', 'character_show_status', 'character_panel_side',
  'character_mobile_panel',
  'hero_title', 'hero_subtitle', 'hero_show_scroll_indicator',
  'layout_card_style', 'layout_show_descriptions', 'layout_show_urls',
  'layout_desktop_columns',
  'footer_text', 'footer_show_link', 'footer_link_url', 'footer_link_label',
  'announcement_enabled', 'announcement_text', 'announcement_dismissible',
  'announcement_colour',
  'welcome_modal_enabled', 'welcome_modal_title', 'welcome_modal_body',
  'welcome_modal_button', 'welcome_modal_once_per_session',
  'favicon_file', 'title',
  'show_no_videos_message',
  'auth_recheck_interval',
];

app.get('/api/theme', (req, res) => {
  const placeholders = THEME_KEYS.map(() => '?').join(',');
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).all(...THEME_KEYS);
  const theme = Object.fromEntries(THEME_KEYS.map(k => [k, null]));
  rows.forEach(r => { theme[r.key] = r.value; });
  res.json(theme);
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all());
});

app.get('/api/services', async (req, res) => {
  const { authenticated } = await verifyAuthelia(req);
  const rows = authenticated
    ? db.prepare(
        `SELECT s.*, c.name as category_name, c.colour as category_colour
         FROM services s LEFT JOIN categories c ON s.category_id = c.id
         ORDER BY c.sort_order, s.sort_order, s.id`
      ).all()
    : db.prepare(
        `SELECT s.*, c.name as category_name, c.colour as category_colour
         FROM services s LEFT JOIN categories c ON s.category_id = c.id
         WHERE s.requires_auth = 0
         ORDER BY c.sort_order, s.sort_order, s.id`
      ).all();
  res.json(rows);
});

// ── Admin API — all routes require auth ────────────────────────────────────
app.use('/api/admin', requireAuth);

// Settings
app.get('/api/admin/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

app.put('/api/admin/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const update = db.transaction((pairs) => {
    for (const [key, value] of Object.entries(pairs)) {
      const k = sanitise(key, 64);
      upsert.run(k, capSettingValue(k, value));
    }
  });
  update(req.body);
  res.json({ ok: true });
});

// Categories
app.get('/api/admin/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all());
});

app.post('/api/admin/categories', (req, res) => {
  const name   = sanitise(req.body.name);
  const colour = sanitiseColour(req.body.colour);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM categories').get().m;
  const result = db.prepare(
    'INSERT INTO categories (name, colour, sort_order) VALUES (?, ?, ?)'
  ).run(name, colour, sanitiseInt(req.body.sort_order, maxOrder + 1));
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/admin/categories/:id', (req, res) => {
  const id     = sanitiseInt(req.params.id);
  const name   = sanitise(req.body.name);
  const colour = sanitiseColour(req.body.colour);
  db.prepare(
    'UPDATE categories SET name=?, colour=?, sort_order=? WHERE id=?'
  ).run(name, colour, sanitiseInt(req.body.sort_order), id);
  res.json({ ok: true });
});

app.delete('/api/admin/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(sanitiseInt(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/categories/reorder', (req, res) => {
  const update = db.prepare('UPDATE categories SET sort_order=? WHERE id=?');
  const batch  = db.transaction((items) => {
    for (const item of items) update.run(sanitiseInt(item.sort_order), sanitiseInt(item.id));
  });
  batch(req.body);
  res.json({ ok: true });
});

// Services
app.get('/api/admin/services', (req, res) => {
  const rows = db.prepare(
    `SELECT s.*, c.name as category_name, c.colour as category_colour
     FROM services s LEFT JOIN categories c ON s.category_id = c.id
     ORDER BY c.sort_order, s.sort_order, s.id`
  ).all();
  res.json(rows);
});

app.post('/api/admin/services', (req, res) => {
  const categoryId = req.body.category_id ? sanitiseInt(req.body.category_id) : null;
  const maxOrder   = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM services WHERE category_id=?').get(categoryId).m;
  const result = db.prepare(
    `INSERT INTO services (name, url, icon, category_id, accent_colour, sort_order, requires_auth, description, disable_when_offline, host_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sanitise(req.body.name),
    sanitiseUrl(req.body.url),
    sanitise(req.body.icon || '🔗', 32),
    categoryId,
    sanitiseColour(req.body.accent_colour),
    sanitiseInt(req.body.sort_order, maxOrder + 1),
    req.body.requires_auth ? 1 : 0,
    sanitise(req.body.description || '', 1000),
    req.body.disable_when_offline ? 1 : 0,
    sanitise(req.body.host_name || '')
  );
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/admin/services/:id', (req, res) => {
  const categoryId = req.body.category_id ? sanitiseInt(req.body.category_id) : null;
  db.prepare(
    `UPDATE services SET name=?, url=?, icon=?, category_id=?, accent_colour=?, sort_order=?, requires_auth=?, description=?, disable_when_offline=?, host_name=?
     WHERE id=?`
  ).run(
    sanitise(req.body.name),
    sanitiseUrl(req.body.url),
    sanitise(req.body.icon || '🔗', 32),
    categoryId,
    sanitiseColour(req.body.accent_colour),
    sanitiseInt(req.body.sort_order),
    req.body.requires_auth ? 1 : 0,
    sanitise(req.body.description || '', 1000),
    req.body.disable_when_offline ? 1 : 0,
    sanitise(req.body.host_name || ''),
    sanitiseInt(req.params.id)
  );
  res.json({ ok: true });
});

app.delete('/api/admin/services/:id', (req, res) => {
  db.prepare('DELETE FROM services WHERE id=?').run(sanitiseInt(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/services/reorder', (req, res) => {
  const update = db.prepare('UPDATE services SET sort_order=?, category_id=? WHERE id=?');
  const batch  = db.transaction((items) => {
    for (const item of items) {
      update.run(
        sanitiseInt(item.sort_order),
        item.category_id ? sanitiseInt(item.category_id) : null,
        sanitiseInt(item.id)
      );
    }
  });
  batch(req.body);
  res.json({ ok: true });
});

// ── Video management ──────────────────────────────────────────────────────
app.get('/api/admin/videos', (req, res) => {
  res.json(getVideosList());
});

app.post('/api/admin/upload/video', async (req, res) => {
  try {
    await runMulter(videoUpload.any(), req, res);
  } catch (err) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(code).json({ error: err.message });
  }

  const file = req.files?.[0];
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const slot = file.fieldname;
  if (!VIDEO_SLOTS[slot]) return res.status(400).json({ error: `Unknown slot: ${slot}` });

  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.mp4', '.webm'].includes(ext)) return res.status(400).json({ error: 'Invalid extension' });

  if (!isValidVideoBuffer(file.buffer, ext)) {
    return res.status(400).json({ error: `File does not appear to be a valid ${ext.slice(1).toUpperCase()} video` });
  }

  // Remove any existing file for this slot (different extension)
  for (const oldExt of ['.mp4', '.webm']) {
    const oldPath = path.join(VIDEOS_DIR, VIDEO_SLOTS[slot] + oldExt);
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (err) {
      console.error('[DELETE] Failed:', err.message);
      // Continue — don't block upload if old file delete fails
    }
  }

  const destFilename = VIDEO_SLOTS[slot] + ext;
  const destPath     = path.join(VIDEOS_DIR, destFilename);
  try {
    fs.writeFileSync(destPath, file.buffer);
  } catch (err) {
    console.error('[UPLOAD] Write failed:', err.message);
    return res.status(500).json({ error: 'Failed to save file: ' + err.message });
  }

  res.json({ success: true, filename: destFilename, size: file.buffer.length });
});

app.delete('/api/admin/video/:slot', (req, res) => {
  const slot = req.params.slot;
  if (!VIDEO_SLOTS[slot]) return res.status(400).json({ error: 'Unknown slot' });
  const info = findVideoFile(slot);
  if (!info) return res.status(404).json({ error: 'No file found for this slot' });
  fs.unlinkSync(info.path);
  res.json({ ok: true });
});

// ── Font management ───────────────────────────────────────────────────────
app.get('/api/admin/fonts', (req, res) => {
  const slots = ['heading_font', 'body_font'];
  const result = {};
  for (const slot of slots) {
    const settingKey = `theme_font_${slot.replace('_font', '')}_custom`;
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(settingKey);
    const filename = row?.value || null;
    if (filename) {
      const fp = path.join(FONTS_DIR, filename);
      if (fs.existsSync(fp)) {
        const stat = fs.statSync(fp);
        result[slot] = { slot, filename, size: stat.size };
        continue;
      }
    }
    result[slot] = { slot, filename: null, size: 0 };
  }
  res.json(result);
});

app.post('/api/admin/upload/font', async (req, res) => {
  try {
    await runMulter(fontUpload.any(), req, res);
  } catch (err) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(code).json({ error: err.message });
  }

  const file = req.files?.[0];
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const slot = file.fieldname;
  if (!['heading_font', 'body_font'].includes(slot)) return res.status(400).json({ error: 'Unknown slot' });

  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.woff2', '.woff', '.ttf'].includes(ext)) return res.status(400).json({ error: 'Invalid extension' });

  if (!isValidFontBuffer(file.buffer, ext)) {
    return res.status(400).json({ error: 'Invalid font file format' });
  }

  const destFilename = `custom-${slot}${ext}`;
  const destPath     = path.join(FONTS_DIR, destFilename);
  try {
    fs.writeFileSync(destPath, file.buffer);
  } catch (err) {
    console.error('[UPLOAD] Write failed:', err.message);
    return res.status(500).json({ error: 'Failed to save file: ' + err.message });
  }

  const settingKey = `theme_font_${slot.replace('_font', '')}_custom`;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(settingKey, destFilename);

  res.json({ success: true, filename: destFilename, size: file.buffer.length });
});

app.delete('/api/admin/font/:slot', (req, res) => {
  const slot = req.params.slot;
  if (!['heading_font', 'body_font'].includes(slot)) return res.status(400).json({ error: 'Unknown slot' });
  const settingKey = `theme_font_${slot.replace('_font', '')}_custom`;
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(settingKey);
  if (row?.value) {
    const fp = path.join(FONTS_DIR, row.value);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare('DELETE FROM settings WHERE key=?').run(settingKey);
  }
  res.json({ ok: true });
});

// ── Favicon management ────────────────────────────────────────────────────
const FAVICON_SLOTS = {
  ico:   { filename: 'favicon.ico',                    accept: ['.ico'] },
  png96: { filename: 'favicon-96x96.png',              accept: ['.png'] },
  apple: { filename: 'apple-touch-icon.png',           accept: ['.png'] },
  pwa192:{ filename: 'web-app-manifest-192x192.png',   accept: ['.png'] },
  pwa512:{ filename: 'web-app-manifest-512x512.png',   accept: ['.png'] },
  svg:   { filename: 'favicon.svg',                    accept: ['.svg'] },
};

app.get('/api/admin/favicons', (req, res) => {
  const result = {};
  for (const [slot, cfg] of Object.entries(FAVICON_SLOTS)) {
    const fp = path.join(PUBLIC_DIR, cfg.filename);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      result[slot] = { slot, filename: cfg.filename, size: stat.size, lastModified: stat.mtime.toISOString() };
    } else {
      result[slot] = { slot, filename: null, size: 0, lastModified: null };
    }
  }
  res.json(result);
});

app.post('/api/admin/upload/favicon', async (req, res) => {
  try {
    await runMulter(faviconUpload.any(), req, res);
  } catch (err) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(code).json({ error: err.message });
  }

  const file = req.files?.[0];
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const slot = file.fieldname;
  const cfg  = FAVICON_SLOTS[slot];
  if (!cfg) return res.status(400).json({ error: `Unknown favicon slot: ${slot}` });

  const ext = path.extname(file.originalname).toLowerCase();
  if (!cfg.accept.includes(ext)) {
    return res.status(400).json({ error: `Slot "${slot}" requires ${cfg.accept.join('/')} file` });
  }

  if (!isValidFaviconBuffer(file.buffer, ext)) {
    return res.status(400).json({ error: 'Invalid favicon file format' });
  }

  const destPath = path.join(PUBLIC_DIR, cfg.filename);
  try {
    fs.writeFileSync(destPath, file.buffer);
  } catch (err) {
    console.error('[UPLOAD] Write failed:', err.message);
    return res.status(500).json({ error: 'Failed to save file: ' + err.message });
  }

  res.json({ success: true, slot, filename: cfg.filename, size: file.buffer.length });
});

app.delete('/api/admin/favicon/:slot', (req, res) => {
  const slot = req.params.slot;
  const cfg  = FAVICON_SLOTS[slot];
  if (!cfg) return res.status(400).json({ error: 'Unknown slot' });
  const fp = path.join(PUBLIC_DIR, cfg.filename);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (err) {
    console.error('[DELETE] Failed:', err.message);
    // Continue — file may already be gone
  }
  res.json({ ok: true });
});

// ── Settings export/import ────────────────────────────────────────────────
/**
 * EXPORT_EXCLUDE — settings keys NEVER included in exports or accepted on import.
 *
 * IMPORTANT: If you add a new settings key that contains a secret, token, password,
 * or internal URL, ADD IT TO THIS LIST. Failure to do so will expose secrets in
 * exported settings files.
 *
 * Current secrets: influxdb_token, borg_token
 */
const EXPORT_EXCLUDE = ['influxdb_token', 'borg_token'];

app.get('/api/admin/settings/export', (req, res) => {
  const rows     = db.prepare('SELECT key, value FROM settings').all();
  const exported = Object.fromEntries(
    rows.filter(r => !EXPORT_EXCLUDE.includes(r.key)).map(r => [r.key, r.value])
  );
  res.setHeader('Content-Disposition', 'attachment; filename="firmament-settings.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exported, null, 2));
});

app.post('/api/admin/settings/import', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid JSON structure' });
  }
  const upsert  = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const batch   = db.transaction((pairs) => {
    for (const [key, value] of pairs) upsert.run(key, value);
  });
  let imported = 0;
  let skipped  = 0;
  const pairs  = [];
  for (const [key, value] of Object.entries(data)) {
    if (EXPORT_EXCLUDE.includes(key)) { skipped++; continue; }
    if (typeof key !== 'string' || key.length > 64) { skipped++; continue; }
    const k = sanitise(key, 64);
    pairs.push([k, capSettingValue(k, value)]);
    imported++;
  }
  batch(pairs);
  res.json({ imported, skipped });
});

// ── InfluxDB discovery (admin, kept at /api/ for backward compat) ─────────
app.get('/api/influxdb-hosts', requireAuth, async (req, res) => {
  const rows     = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const token    = settings.influxdb_token || '';
  if (!token) return res.json({ hosts: [] });

  const url    = settings.influxdb_url    || 'http://localhost:8086';
  const org    = settings.influxdb_org    || 'proxmox';
  const bucket = settings.influxdb_bucket || 'proxmox';

  const safeBucket = bucket.replace(/"/g, '\\"');
  const query = `from(bucket: "${safeBucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r["_measurement"] == "system")
  |> keep(columns: ["host"])
  |> distinct(column: "host")`;

  try {
    const response = await fetch(`${url}/api/v2/query?org=${encodeURIComponent(org)}`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
      body: query,
    });
    if (!response.ok) return res.json({ hosts: [] });
    const csv   = await response.text();
    const hosts = [];
    const lines = csv.split(/\r?\n/);
    let headers = null;
    for (const line of lines) {
      if (!line.trim()) { headers = null; continue; }
      if (line.startsWith('#')) continue;
      if (!headers) { headers = line.split(',').map(h => h.trim()); continue; }
      const vals = line.split(',');
      const obj  = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      if (obj._value) hosts.push(obj._value);
    }
    res.json({ hosts: hosts.sort() });
  } catch (_) {
    res.json({ hosts: [] });
  }
});

app.get('/api/influxdb-storages', requireAuth, async (req, res) => {
  const rows     = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const token    = settings.influxdb_token || '';
  if (!token) return res.json({ storages: [] });

  const url    = settings.influxdb_url    || 'http://localhost:8086';
  const org    = settings.influxdb_org    || 'proxmox';
  const bucket = settings.influxdb_bucket || 'proxmox';

  const safeBucket = bucket.replace(/"/g, '\\"');
  const query = `from(bucket: "${safeBucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r["_measurement"] == "system" and r["object"] == "storages")
  |> keep(columns: ["host"])
  |> distinct(column: "host")`;

  try {
    const response = await fetch(`${url}/api/v2/query?org=${encodeURIComponent(org)}`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
      body: query,
    });
    if (!response.ok) return res.json({ storages: [] });
    const csv      = await response.text();
    const storages = [];
    const lines    = csv.split(/\r?\n/);
    let headers    = null;
    for (const line of lines) {
      if (!line.trim()) { headers = null; continue; }
      if (line.startsWith('#')) continue;
      if (!headers) { headers = line.split(',').map(h => h.trim()); continue; }
      const vals = line.split(',');
      const obj  = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      if (obj._value) storages.push(obj._value);
    }
    res.json({ storages: storages.sort() });
  } catch (_) {
    res.json({ storages: [] });
  }
});

// ── Metrics + Borg routes ─────────────────────────────────────────────────
app.use(metricsRouter);
app.use(borgRouter);

// ── SPA fallback for /admin ────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── robots.txt ─────────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

// ── Global error handler — must be last middleware, after all routes ───────
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err.stack || err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Firmament running on port ${PORT}`);
});
