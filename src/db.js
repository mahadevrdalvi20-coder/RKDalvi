'use strict';
// Database access. Uses libSQL: a local SQLite file in development, or a hosted
// Turso database in production (set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, which
// the Vercel Turso integration does automatically). All calls are async.
const fs = require('fs');
const config = require('./config');

const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
// Hosted database: pure-JS HTTP client (no native module needed on serverless). Local file: native client.
const { createClient } = remoteUrl ? require('@libsql/client/web') : require('@libsql/client');
if (!remoteUrl) fs.mkdirSync(config.dataDir, { recursive: true });
if (config.isVercel && !remoteUrl) {
  console.error('[db] TURSO_DATABASE_URL is not set — data will NOT be saved permanently on Vercel.');
}
const client = createClient({
  url: remoteUrl || `file:${config.dbFile}`,
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined,
});

const plain = (r) => r.rows.map((row) => {
  const o = {};
  r.columns.forEach((c, i) => { o[c] = row[i]; });
  return o;
});
const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));

const db = {
  client,
  async all(sql, ...args) {
    await ready;
    return plain(await client.execute({ sql, args: norm(args) }));
  },
  async get(sql, ...args) {
    return (await db.all(sql, ...args))[0];
  },
  async one(sql, ...args) {
    // first column of first row (for COUNT(*) etc.)
    const r = await db.get(sql, ...args);
    return r ? Object.values(r)[0] : undefined;
  },
  async run(sql, ...args) {
    await ready;
    const r = await client.execute({ sql, args: norm(args) });
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null };
  },
  // Atomic group of writes: [[sql, ...args], ...]
  async batch(stmts) {
    await ready;
    const list = stmts.filter(Boolean).map(([sql, ...args]) => ({ sql, args: norm(args) }));
    if (!list.length) return [];
    return client.batch(list, 'write');
  },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE,
  mobile TEXT UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'admin', -- owner | admin
  active INTEGER NOT NULL DEFAULT 1,
  notify_email INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS otps (
  mobile TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT 'sofa',
  image TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  location TEXT DEFAULT '',
  year INTEGER,
  client_name TEXT DEFAULT '',
  show_client INTEGER NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  materials TEXT DEFAULT '',
  pieces TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  cover_media_id INTEGER,
  featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published | hidden
  view_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, created_at);
CREATE TABLE IF NOT EXISTS project_services (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, service_id)
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'photo', -- photo | video
  file TEXT NOT NULL,      -- full size (photos) / video file
  medium TEXT,             -- ~1200px webp
  thumb TEXT,              -- ~480px webp (also used as video poster)
  width INTEGER, height INTEGER,
  caption TEXT DEFAULT '',
  tag TEXT NOT NULL DEFAULT 'normal', -- normal | before | after
  sort_order INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id, sort_order);
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT DEFAULT '',
  client_type TEXT NOT NULL,
  service TEXT NOT NULL,
  city TEXT NOT NULL,
  budget TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  message TEXT DEFAULT '',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enq_created ON enquiries(created_at);
CREATE TABLE IF NOT EXISTS enquiry_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  original_name TEXT,
  mime TEXT,
  bytes INTEGER
);
CREATE TABLE IF NOT EXISTS enquiry_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  business TEXT DEFAULT '',
  text TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  photo TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS team (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  photo TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS site_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL DEFAULT 'workshop',
  file TEXT NOT NULL,
  thumb TEXT,
  caption TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  kind TEXT NOT NULL, -- web | app
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const DEFAULT_SETTINGS = {
  name: 'R. K. DALVI',
  tagline: 'Furniture • Hotel Contracts • Interior Décor',
  intro:
    'We design, manufacture and install furniture and complete interiors for hotels, resorts, restaurants, offices and homes — from our own workshop, on time and to specification.',
  phone: '+91 98765 43210',
  whatsapp: '919876543210',
  email: 'info@rkdalvi.com',
  address: 'Workshop & Office, Goa, India',
  map_query: '',
  hours: 'Mon – Sat: 9:30 AM – 7:00 PM\nSunday: By appointment',
  instagram: '',
  facebook: '',
  google_business: '',
  youtube: '',
  highlights: JSON.stringify([
    { value: '20+', label: 'Years of experience' },
    { value: '350+', label: 'Projects completed' },
    { value: '40+', label: 'Hotels & resorts' },
    { value: '15+', label: 'Cities served' },
  ]),
  about_story:
    'R. K. DALVI started as a small carpentry workshop and has grown into a trusted furniture and interior contractor for hospitality and residential projects. Every piece is built in our own workshop by skilled craftsmen, using quality teak, plywood, veneer and laminates, and installed by our own team.',
  owner_name: 'R. K. Dalvi',
  owner_title: 'Founder & Proprietor',
  owner_bio:
    'With decades of hands-on experience in furniture manufacturing and site execution, our founder personally oversees every project from the first measurement to the final handover.',
  owner_photo: '',
  registrations: 'GSTIN: (add in Settings)\nUdyam / MSME: (add in Settings)',
  show_registrations: '0',
  logo: '',
  watermark_default: '1',
  whatsapp_message: 'Hello R. K. DALVI, I saw your work and would like to discuss a project.',
  seo_city: 'Goa',
  seo_description:
    'R. K. DALVI — hotel furniture contractor and interior décor specialist. Custom furniture, hotel rooms, lobbies, restaurants, modular kitchens and turnkey interiors.',
  budget_ranges: JSON.stringify([
    'Under ₹5 Lakh',
    '₹5 – 15 Lakh',
    '₹15 – 50 Lakh',
    '₹50 Lakh – 1 Crore',
    'Above ₹1 Crore',
    'Not sure yet',
  ]),
  client_types: JSON.stringify(['Hotel', 'Resort', 'Restaurant / Café', 'Builder', 'Architect / Designer', 'Home', 'Office', 'Other']),
  vapid_public: '',
  vapid_private: '',
};

const DEFAULT_CATEGORIES = [
  ['Hotels & Resorts', 'hotels-resorts'],
  ['Restaurants & Cafés', 'restaurants-cafes'],
  ['Residential', 'residential'],
  ['Offices', 'offices'],
  ['Custom Furniture', 'custom-furniture'],
  ['Interior Décor', 'interior-decor'],
];

const DEFAULT_SERVICES = [
  ['Hotel Room Furniture', 'hotel-room-furniture', 'bed', 'Beds, wardrobes, side tables, desks, luggage racks and TV units built to your brand standards.'],
  ['Lobby & Reception', 'lobby-reception', 'lobby', 'Reception counters, lounge seating, wall features and statement pieces that make a first impression.'],
  ['Restaurant Seating', 'restaurant-seating', 'chair', 'Booths, banquettes, dining chairs, tables and bar counters designed for comfort and heavy daily use.'],
  ['Modular Kitchens', 'modular-kitchens', 'kitchen', 'Efficient, durable modular kitchens with quality hardware and finishes for homes and hotels.'],
  ['Wardrobes', 'wardrobes', 'wardrobe', 'Sliding and hinged wardrobes, walk-in closets and storage solutions made to measure.'],
  ['False Ceiling', 'false-ceiling', 'ceiling', 'Gypsum, POP and wooden false ceilings with integrated lighting design.'],
  ['Wall Panelling', 'wall-panelling', 'panel', 'Veneer, laminate, fluted and upholstered wall panels that add warmth and character.'],
  ['Turnkey Interiors', 'turnkey-interiors', 'key', 'Complete design-to-handover interiors: civil, electrical, furniture, décor and finishing under one contract.'],
];


async function init() {
  if (!remoteUrl) await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON').catch(() => {});
  await client.executeMultiple(SCHEMA);
  await client.batch(
    Object.entries(DEFAULT_SETTINGS).map(([k, v]) => ({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: [k, v] })),
    'write'
  );
  const cats = (await client.execute('SELECT COUNT(*) AS n FROM categories')).rows[0].n;
  if (!Number(cats)) {
    await client.batch(DEFAULT_CATEGORIES.map(([n, s], i) => ({ sql: 'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)', args: [n, s, i] })), 'write');
  }
  const svcs = (await client.execute('SELECT COUNT(*) AS n FROM services')).rows[0].n;
  if (!Number(svcs)) {
    await client.batch(
      DEFAULT_SERVICES.map(([n, s, icon, d], i) => ({ sql: 'INSERT INTO services (name, slug, icon, description, sort_order) VALUES (?, ?, ?, ?, ?)', args: [n, s, icon, d, i] })),
      'write'
    );
  }
}
const ready = init();
ready.catch((e) => console.error('[db] initialisation failed:', e.message));

function parseJson(v, d) {
  try {
    return JSON.parse(v || '');
  } catch {
    return d;
  }
}

async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  s.highlightsList = parseJson(s.highlights, []);
  s.budgetRanges = parseJson(s.budget_ranges, []);
  s.clientTypes = parseJson(s.client_types, []);
  return s;
}

function setSetting(key, value) {
  return db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

async function close() {
  try {
    client.close();
  } catch {
    /* ignore */
  }
}

module.exports = { db, ready, getSettings, setSetting, close };
