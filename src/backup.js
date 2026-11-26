'use strict';
// Daily maintenance: remove expired sessions/tokens and save a JSON backup of the
// whole database (to Vercel Blob in production, DATA_DIR/backups locally).
// On Vercel this runs from Vercel Cron (see vercel.json); on a normal server, from server.js.
const config = require('./config');
const { db, ready } = require('./db');
const storage = require('./storage');

const TABLES = [
  'settings', 'admins', 'categories', 'services', 'projects', 'project_services', 'media', 'enquiries', 'enquiry_files', 'enquiry_notes',
  'testimonials', 'clients', 'team', 'site_photos', 'visits', 'push_subscriptions',
];

async function cleanup() {
  const now = Date.now();
  await db.batch([
    ['DELETE FROM sessions WHERE created_at < ? OR last_seen < ?', now - config.sessionMaxDays * 86400000, now - config.sessionIdleMinutes * 60000],
    ['DELETE FROM password_resets WHERE expires < ?', now],
    ['DELETE FROM otps WHERE expires < ?', now],
    ['DELETE FROM rate_limits WHERE expires < ?', now],
  ]);
}

async function backupDatabase() {
  await ready;
  const dump = { app: 'rkdalvi', version: 1, created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) dump.tables[t] = await db.all(`SELECT * FROM ${t}`);
  const name = `db-${dump.created_at.slice(0, 10)}.json`;
  const ref = await storage.saveBackup(name, Buffer.from(JSON.stringify(dump)));
  await storage.pruneBackups(config.backupKeep);
  return ref;
}

// Restore a JSON backup into an EMPTY database (used by scripts/restore-backup.js).
async function restoreDatabase(dump) {
  await ready;
  for (const t of TABLES) {
    const rows = dump.tables[t] || [];
    const stmts = [[`DELETE FROM ${t}`]];
    for (const r of rows) {
      const cols = Object.keys(r);
      stmts.push([`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => r[c])]);
    }
    await db.batch(stmts);
  }
}

async function daily() {
  await cleanup();
  return backupDatabase();
}

function scheduleDailyTasks() {
  let lastDay = '';
  const run = async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day === lastDay) return;
    try {
      const existing = await storage.listBackups();
      if (!existing.some((b) => b.name.includes(`db-${day}`))) console.log('[backup] saved:', await backupDatabase());
      await cleanup();
      lastDay = day;
    } catch (e) {
      console.error('[daily] failed:', e.message);
    }
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = { cleanup, backupDatabase, restoreDatabase, daily, scheduleDailyTasks };

if (require.main === module) {
  backupDatabase()
    .then((ref) => {
      console.log('Backup written:', ref);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
