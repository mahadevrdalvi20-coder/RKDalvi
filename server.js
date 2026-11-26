'use strict';
// Entry point for a normal server (VPS / Docker / local). On Vercel, api/index.js is used instead.
const config = require('./src/config');
const { createApp } = require('./src/app');
const { scheduleDailyTasks } = require('./src/backup');
const { db, ready, close } = require('./src/db');

const app = createApp();
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
