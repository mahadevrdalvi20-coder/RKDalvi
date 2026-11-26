'use strict';
// Create (or reset the password of) an admin from the command line.
// Works against the local database, or Turso when TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are set.
// Usage: npm run create-admin -- --email you@example.com --name "R K Dalvi" --password "secret123" [--mobile 9876543210] [--owner]
const { db, ready } = require('../src/db');
const auth = require('../src/auth');
const util = require('../src/util');

const args = process.argv.slice(2);
const get = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};

(async () => {
  await ready;
  const email = (get('email') || '').trim().toLowerCase();
  const name = get('name') || 'Admin';
  const password = get('password') || '';
  const mobile = get('mobile') ? util.normalizeMobile(get('mobile')) : null;
  const owner = args.includes('--owner') || (await db.one('SELECT COUNT(*) FROM admins')) === 0;
  if (!util.isValidEmail(email)) throw new Error('Please pass --email');
  const err = auth.validatePassword(password);
  if (err) throw new Error(err);
  const existing = await db.get('SELECT * FROM admins WHERE email = ?', email);
  if (existing) {
    await db.run('UPDATE admins SET password_hash = ?, active = 1 WHERE id = ?', auth.hashPassword(password), existing.id);
    console.log(`Password reset for ${email}`);
  } else {
    await db.run('INSERT INTO admins (name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, ?)', name, email, mobile, auth.hashPassword(password), owner ? 'owner' : 'admin');
    console.log(`Created ${owner ? 'owner' : 'admin'} ${email}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
