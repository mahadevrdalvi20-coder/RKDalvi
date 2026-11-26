'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkd-test-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const sharp = require('sharp');
const { createApp } = require('../src/app');
const { db, ready } = require('../src/db');
const notify = require('../src/notify');

let server, base;
before(async () => {
  await ready;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await require('../src/db').close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// minimal cookie-jar client
function client() {
  const jar = {};
  async function req(p, opts = {}) {
    const headers = { Accept: 'text/html', ...(opts.headers || {}) };
    const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) headers.Cookie = c;
    const r = await fetch(base + p, { redirect: 'manual', ...opts, headers });
    for (const sc of r.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/.test(sc)) delete jar[k]; else jar[k] = v;
    }
    r.text_ = await r.text();
    return r;
  }
  const form = (p, data) => req(p, { method: 'POST', body: new URLSearchParams(data), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return { req, form, jar };
}
const csrfOf = (html) => (/name="_csrf" value="([^"]+)"/.exec(html) || /data-csrf="([^"]+)"/.exec(html))[1];
const stampOf = (html) => /name="stamp" value="([^"]+)"/.exec(html)[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const owner = client();
let csrf, projectId, projectSlug;

test('public pages load without login', async () => {
  const v = client();
  for (const p of ['/', '/work', '/services', '/about', '/contact', '/privacy', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest']) {
    const r = await v.req(p);
    assert.equal(r.status, 200, p);
  }
});

test('admin is not reachable for visitors', async () => {
  const v = client();
  for (const p of ['/admin', '/admin/projects', '/admin/enquiries', '/admin/enquiries.csv', '/admin/settings']) {
    const r = await v.req(p);
    assert.equal(r.status, 302, p);
    assert.match(r.headers.get('location'), /^\/admin\/(setup|login)/);
  }
  const api = await v.req('/admin/api/projects/1/media', { method: 'POST', headers: { Accept: 'application/json' } });
  assert.equal(api.status, 401);
});

test('first-run setup creates the owner and logs in', async () => {
  const r = await owner.form('/admin/setup', { name: 'R K Dalvi', email: 'owner@example.com', password: 'secret-pass-1' });
  assert.equal(r.status, 302);
  const dash = await owner.req('/admin');
  assert.equal(dash.status, 200);
  assert.match(dash.text_, /Namaste, R/);
  csrf = csrfOf(dash.text_);
  // setup cannot run twice
  const again = await client().form('/admin/setup', { name: 'X', email: 'x@example.com', password: 'secret-pass-2' });
  assert.equal(again.headers.get('location'), '/admin/login');
});

test('login: wrong password rejected, right password accepted', async () => {
  const c = client();
  const bad = await c.form('/admin/login', { email: 'owner@example.com', password: 'nope-nope' });
  assert.equal(bad.status, 401);
  const ok = await c.form('/admin/login', { email: 'OWNER@example.com', password: 'secret-pass-1' });
  assert.equal(ok.status, 302);
  assert.equal((await c.req('/admin')).status, 200);
});

test('state-changing admin requests require the CSRF token', async () => {
  const r = await owner.form('/admin/projects/new', { title: 'No token' });
  assert.equal(r.status, 403);
});

test('owner creates a project, uploads 20 photos and publishes it', async () => {
  const r = await owner.form('/admin/projects/new', { _csrf: csrf });
  assert.equal(r.status, 302);
  projectId = Number(r.headers.get('location').split('/').pop());

  // publishing without photos is blocked
  await owner.form(`/admin/projects/${projectId}`, { _csrf: csrf, title: 'Ocean View Hotel', action: 'publish' });
  assert.equal((await db.get('SELECT status FROM projects WHERE id = ?', projectId)).status, 'draft');

  const t0 = Date.now();
  const img = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#8a5a3a' } }).jpeg().toBuffer();
  await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const fd = new FormData();
      fd.append('file', new Blob([img], { type: 'image/jpeg' }), `p${i}.jpg`);
      const up = await owner.req(`/admin/api/projects/${projectId}/media?watermark=${i % 2}`, { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrf, Accept: 'application/json' } });
      assert.equal(up.status, 200, up.text_);
    })
  );
  const cat = (await db.get("SELECT id FROM categories WHERE slug = 'hotels-resorts'")).id;
  const pub = await owner.form(`/admin/projects/${projectId}`, {
    _csrf: csrf, title: 'Ocean View Hotel', category_id: cat, location: 'Calangute, Goa', year: '2025', client_name: 'Secret Client', description: 'Rooms and lobby', materials: 'Teak, Veneer', action: 'publish',
  });
  assert.equal(pub.status, 302);
  const p = (await db.get('SELECT * FROM projects WHERE id = ?', projectId));
  assert.equal(p.status, 'published');
  projectSlug = p.slug;
  const editor = await owner.req(`/admin/projects/${projectId}`);
  assert.equal(editor.status, 200);
  assert.equal((editor.text_.match(/class="mi /g) || []).length, 21); // 20 items + template
  const photos = (await db.all("SELECT * FROM media WHERE project_id = ? AND kind = 'photo'", projectId));
  assert.equal(photos.length, 20);
  assert.ok(Date.now() - t0 < 120000, 'upload + publish under 2 minutes');
  // full image is resized to <= 2560 and thumbnails exist
  const meta = await sharp(path.join(dataDir, 'media', photos[0].file)).metadata();
  assert.ok(meta.width <= 2560);
  assert.ok(fs.existsSync(path.join(dataDir, 'media', photos[0].thumb)));
});

test('published project appears in portfolio, filterable, client name hidden by default', async () => {
  const v = client();
  const work = await v.req('/work?category=hotels-resorts');
  assert.match(work.text_, /Ocean View Hotel/);
  const other = await v.req('/work?category=offices');
  assert.doesNotMatch(other.text_, /Ocean View Hotel/);
  const search = await v.req('/work?q=Calangute');
  assert.match(search.text_, /Ocean View Hotel/);
  const detail = await v.req(`/work/${projectSlug}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text_, /data-pswp-width/);
  assert.doesNotMatch(detail.text_, /Secret Client/);
  assert.match(detail.text_, /\/contact\?project=/);
});

test('draft / hidden projects are not visible to visitors', async () => {
  await owner.form(`/admin/projects/${projectId}/quick`, { _csrf: csrf, what: 'hide' });
  const v = client();
  assert.equal((await v.req(`/work/${projectSlug}`)).status, 404);
  assert.doesNotMatch((await v.req('/work')).text_, /Ocean View Hotel/);
  await owner.form(`/admin/projects/${projectId}/quick`, { _csrf: csrf, what: 'unhide' });
  assert.equal((await v.req(`/work/${projectSlug}`)).status, 200);
});

test('enquiry form validates, stores, alerts and shows in admin only', async () => {
  const v = client();
  const page = await v.req(`/contact?project=${projectSlug}`);
  const stamp = stampOf(page.text_);
  await sleep(2700); // humans take a few seconds; faster posts are treated as bots
  const bad = await v.form('/contact', { stamp, name: 'A', mobile: '123' });
  assert.equal(bad.status, 422);
  assert.match(bad.text_, /valid 10-digit mobile/);

  const before = notify.outbox.length;
  const fd = new FormData();
  for (const [k, val] of Object.entries({ stamp, project: projectSlug, name: 'Priya Naik', mobile: '+91 98200 12345', email: 'priya@example.com', client_type: 'Hotel', service: 'Hotel Room Furniture', city: 'Margao', budget: '₹15 – 50 Lakh', start_date: '2027-01', message: 'Need 20 rooms' })) fd.append(k, val);
  fd.append('attachments', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'plan.pdf');
  const ok = await v.req('/contact', { method: 'POST', body: fd });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('location'), /^\/thank-you/);
  const e = (await db.get('SELECT * FROM enquiries ORDER BY id DESC'));
  assert.equal(e.mobile, '9820012345');
  assert.equal(e.project_id, projectId);
  await sleep(100);
  assert.ok(notify.outbox.length > before, 'owner alert sent');
  assert.match(notify.outbox.at(-1).subject, /Priya Naik/);

  // visitors cannot see enquiry data or files
  assert.equal((await v.req(`/admin/enquiries/${e.id}`)).status, 302);
  assert.equal((await v.req(`/admin/enquiries/${e.id}/files/1`)).status, 302);

  const list = await owner.req('/admin/enquiries');
  assert.match(list.text_, /Priya Naik/);
  assert.match(list.text_, /tel:\+919820012345/);
  assert.match(list.text_, /wa\.me\/919820012345/);

  await owner.form(`/admin/enquiries/${e.id}/status`, { _csrf: csrf, status: 'site_visit' });
  await owner.form(`/admin/enquiries/${e.id}/notes`, { _csrf: csrf, body: 'Visit on Monday' });
  assert.equal((await db.get('SELECT status FROM enquiries WHERE id = ?', e.id)).status, 'site_visit');
  const csv = await owner.req('/admin/enquiries.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text_, /Priya Naik/);
  assert.match(csv.text_, /Visit on Monday/);
});

test('honeypot spam is silently dropped', async () => {
  const v = client();
  const page = await v.req('/contact');
  const n = (await db.get('SELECT COUNT(*) AS n FROM enquiries')).n;
  await sleep(2700);
  const r = await v.form('/contact', { stamp: stampOf(page.text_), website: 'http://spam', name: 'Bot', mobile: '9876543210', client_type: 'Other', service: 'x', city: 'y' });
  assert.equal(r.status, 303);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM enquiries')).n, n);
});

test('second admin can be added and removed by the owner', async () => {
  await owner.form('/admin/settings/admins', { _csrf: csrf, name: 'Manager', email: 'mgr@example.com', password: 'manager-pass' });
  const m = client();
  assert.equal((await m.form('/admin/login', { email: 'mgr@example.com', password: 'manager-pass' })).status, 302);
  assert.equal((await m.req('/admin')).status, 200);
  const id = (await db.get("SELECT id FROM admins WHERE email = 'mgr@example.com'")).id;
  await owner.form(`/admin/settings/admins/${id}`, { _csrf: csrf, action: 'remove' });
  assert.equal((await m.req('/admin')).status, 302, 'removed admin is logged out');
});

test('forgot password flow resets the password', async () => {
  const c = client();
  await c.form('/admin/forgot', { email: 'owner@example.com' });
  const link = /\/admin\/reset\/[\w-]+/.exec(notify.outbox.at(-1).text)[0];
  const r = await c.form(link, { password: 'brand-new-pass', confirm: 'brand-new-pass' });
  assert.equal(r.headers.get('location'), '/admin/login?reset=1');
  assert.equal((await c.form('/admin/login', { email: 'owner@example.com', password: 'brand-new-pass' })).status, 302);
  assert.equal((await c.req(link)).text_.includes('invalid or has expired'), true, 'link is single-use');
});

test('deleting a project removes its photos from disk', async () => {
  const c = client();
  await c.form('/admin/login', { email: 'owner@example.com', password: 'brand-new-pass' });
  const tok = csrfOf((await c.req('/admin')).text_);
  const files = (await db.all('SELECT file FROM media WHERE project_id = ?', projectId));
  await c.form(`/admin/projects/${projectId}/delete`, { _csrf: tok });
  await sleep(200);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM projects WHERE id = ?', projectId)).n, 0);
  assert.equal(fs.existsSync(path.join(dataDir, 'media', files[0].file)), false);
});

test('daily cron job requires the secret and writes a backup', async () => {
  const c = client();
  const denied = await c.req('/api/cron/daily', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(denied.status, 401);
  const config = require('../src/config');
  config.cronSecret = 'test-secret';
  const ok = await c.req('/api/cron/daily', { headers: { Authorization: 'Bearer test-secret' } });
  assert.equal(ok.status, 200, ok.text_);
  const files = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.ok(files.some((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)));
  const dump = JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', files[0]), 'utf8'));
  assert.ok(dump.tables.enquiries.length >= 1);
});

test('Vercel entry exports the app', () => {
  const handler = require('../api/index');
  assert.equal(typeof handler, 'function');
});
