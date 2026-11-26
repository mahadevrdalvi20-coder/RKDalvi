'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');
const { scheduleDailyBackups } = require('./src/backup');
const { db } = require('./src/db');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`R. K. DALVI app running on ${config.baseUrl} (port ${config.port}, ${config.env})`);
  const admins = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (!admins) console.log(`No admin yet — open ${config.baseUrl}/admin/setup to create the owner account.`);
});
if (config.env !== 'test') scheduleDailyBackups();

// Clean up expired sessions hourly
setInterval(() => {
  const cutoff = Date.now() - config.sessionMaxDays * 86400000;
  db.prepare('DELETE FROM sessions WHERE created_at < ? OR last_seen < ?').run(cutoff, Date.now() - config.sessionIdleMinutes * 60000);
  db.prepare('DELETE FROM password_resets WHERE expires < ?').run(Date.now());
  db.prepare('DELETE FROM otps WHERE expires < ?').run(Date.now());
}, 3600 * 1000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      try { db.close(); } catch { /* ignore */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
