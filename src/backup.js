'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const { db } = require('./db');

// Consistent snapshot of the database (safe while the app is running).
function backupDatabase() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(config.backupDir, `db-${stamp}.sqlite`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune('db-', config.backupKeep);
  return file;
}

// Full archive: database snapshot + all photos/videos + enquiry attachments.
function backupFull() {
  const dbFile = backupDatabase();
  const stamp = path.basename(dbFile).replace(/^db-|\.sqlite$/g, '');
  const out = path.join(config.backupDir, `full-${stamp}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', config.dataDir, 'media', 'private', '-C', config.backupDir, path.basename(dbFile)], { stdio: 'inherit' });
  prune('full-', Math.max(2, Math.ceil(config.backupKeep / 7)));
  return out;
}

function prune(prefix, keep) {
  const files = fs.readdirSync(config.backupDir).filter((f) => f.startsWith(prefix)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(config.backupDir, f), { force: true });
}

// Automatic daily DB backup (checks hourly; runs once per day).
function scheduleDailyBackups() {
  const run = () => {
    try {
      fs.mkdirSync(config.backupDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const exists = fs.readdirSync(config.backupDir).some((f) => f.startsWith(`db-${today}`));
      if (!exists) console.log('[backup] database snapshot:', backupDatabase());
    } catch (e) {
      console.error('[backup] failed:', e.message);
    }
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = { backupDatabase, backupFull, scheduleDailyBackups };

if (require.main === module) {
  const full = process.argv.includes('--full');
  console.log('Backup written:', full ? backupFull() : backupDatabase());
}
