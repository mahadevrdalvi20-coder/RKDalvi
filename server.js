'use strict';
// Entry point for a normal server (VPS / Docker / local). On Vercel, api/index.js is used
// (if Vercel's Express auto-detection picks this file instead, it still works: we only export the app).
const config = require('./src/config');
const { createApp } = require('./src/app');

const app = createApp();
module.exports = app;

if (!process.env.VERCEL) {
  const { scheduleDailyTasks } = require('./src/backup');
  const { db, ready, close } = require('./src/db');
  const server = app.listen(config.port, async () => {
    console.log(`R. K. DALVI app running on ${config.baseUrl} (port ${config.port}, ${config.env})`);
    await ready;
    if (!(await db.one('SELECT COUNT(*) FROM admins'))) console.log(`No admin yet — open ${config.baseUrl}/admin/setup to create the owner account.`);
  });
  if (config.env !== 'test') scheduleDailyTasks();
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close(() => close().then(() => process.exit(0)));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
