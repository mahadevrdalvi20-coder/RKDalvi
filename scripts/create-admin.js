'use strict';
// Create (or reset the password of) an admin from the command line.
// Usage: npm run create-admin -- --email you@example.com --name "R K Dalvi" --password "secret123" [--mobile 9876543210] [--owner]
const { db } = require('../src/db');
const auth = require('../src/auth');
const util = require('../src/util');

const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const email = (get('email') || '').trim().toLowerCase();
const name = get('name') || 'Admin';
const password = get('password') || '';
const mobile = get('mobile') ? util.normalizeMobile(get('mobile')) : null;
const owner = args.includes('--owner') || db.prepare('SELECT COUNT(*) AS n FROM admins').get().n === 0;

if (!util.isValidEmail(email)) { console.error('Please pass --email'); process.exit(1); }
const err = auth.validatePassword(password);
if (err) { console.error(err); process.exit(1); }
const existing = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE admins SET password_hash = ?, active = 1 WHERE id = ?').run(auth.hashPassword(password), existing.id);
  console.log(`Password reset for ${email}`);
} else {
  db.prepare('INSERT INTO admins (name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(name, email, mobile, auth.hashPassword(password), owner ? 'owner' : 'admin');
  console.log(`Created ${owner ? 'owner' : 'admin'} ${email}`);
}
