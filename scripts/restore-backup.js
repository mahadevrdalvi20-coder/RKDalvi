'use strict';
// Restore a JSON database backup (from Vercel Blob "private/backups/" or DATA_DIR/backups).
// Usage: node scripts/restore-backup.js <file-or-url>   (overwrites all data in the target database!)
const fs = require('fs');
const { restoreDatabase } = require('../src/backup');

(async () => {
  const src = process.argv[2];
  if (!src) throw new Error('Pass a backup file path or URL');
  const text = /^https?:/.test(src) ? await (await fetch(src)).text() : fs.readFileSync(src, 'utf8');
  await restoreDatabase(JSON.parse(text));
  console.log('Restore complete.');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
