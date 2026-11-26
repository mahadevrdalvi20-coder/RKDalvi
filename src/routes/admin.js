'use strict';
const fs = require('fs');
const os = require('os');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db, getSettings, setSetting } = require('../db');
const auth = require('../auth');
const repo = require('../repo');
const util = require('../util');
const mediaLib = require('../media');
const storage = require('../storage');
const notify = require('../notify');
const { SERVICE_ICONS } = require('../icons');

const { ah } = util;
const router = express.Router();

const STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'site_visit', label: 'Site Visit' },
  { key: 'quotation_sent', label: 'Quotation Sent' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];
const statusLabel = (k) => (STATUSES.find((s) => s.key === k) || { label: k }).label;
const wantsJson = (req) => (req.headers.accept || '').includes('application/json');

router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.locals.STATUSES = STATUSES;
  res.locals.statusLabel = statusLabel;
  // one-shot flash message via cookie
  const m = /(?:^|;\s*)rkd_flash=([^;]+)/.exec(req.headers.cookie || '');
  res.locals.flash = null;
  if (m) {
    try {
      res.locals.flash = JSON.parse(decodeURIComponent(m[1]));
    } catch {
      /* ignore */
    }
    res.clearCookie('rkd_flash', { path: '/admin' });
  }
  res.flash = (type, text) => res.cookie('rkd_flash', JSON.stringify({ type, text }), { path: '/admin', httpOnly: true, sameSite: 'lax', maxAge: 60000 });
  next();
});

const adminCount = () => db.one('SELECT COUNT(*) FROM admins');
const limited = (key, max, mins) => auth.rateLimit(key, max, mins * 60 * 1000);

function safeNext(n) {
  n = String(n || '');
  return n.startsWith('/admin') && !n.startsWith('//') ? n : '/admin';
}

// ======================= Public (not logged in) =======================

// First run: create the owner account when no admin exists yet.
router.get(
  '/setup',
  ah(async (req, res) => {
    if ((await adminCount()) > 0) return res.redirect('/admin/login');
    res.render('admin/setup', { title: 'Create owner account', error: null, values: {} });
  })
);

router.post(
  '/setup',
  ah(async (req, res) => {
    if ((await adminCount()) > 0) return res.redirect('/admin/login');
    const { name = '', email = '', mobile = '', password = '' } = req.body;
    const values = { name, email, mobile };
    let error = null;
    if (name.trim().length < 2) error = 'Please enter your name.';
    else if (!util.isValidEmail(email)) error = 'Please enter a valid email address.';
    else if (mobile && !util.isValidMobile(mobile)) error = 'Please enter a valid 10-digit mobile number.';
    else error = auth.validatePassword(password);
    if (error) return res.status(422).render('admin/setup', { title: 'Create owner account', error, values });
    const info = await db.run(
      "INSERT INTO admins (name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, 'owner')",
      name.trim(), email.trim().toLowerCase(), mobile ? util.normalizeMobile(mobile) : null, auth.hashPassword(password)
    );
    await auth.createSession(req, res, info.lastInsertRowid);
    res.flash('success', 'Welcome! Your owner account is ready. Start by adding your business details.');
    res.redirect('/admin/settings');
  })
);

router.get(
  '/login',
  ah(async (req, res) => {
    if (req.admin) return res.redirect(safeNext(req.query.next));
    if ((await adminCount()) === 0) return res.redirect('/admin/setup');
    res.render('admin/login', {
      title: 'Admin login',
      error: null,
      info: req.query.expired ? 'You were logged out after a period of inactivity. Please log in again.' : req.query.reset ? 'Password changed. Please log in.' : null,
      next: safeNext(req.query.next),
      mode: req.query.mode === 'otp' ? 'otp' : 'password',
      otpSent: false,
      values: {},
    });
  })
);

router.post(
  '/login',
  ah(async (req, res) => {
    const { email = '', password = '' } = req.body;
    const next = safeNext(req.body.next);
    const render = (error) =>
      res.status(401).render('admin/login', { title: 'Admin login', error, info: null, next, mode: 'password', otpSent: false, values: { email } });
    if (!(await limited(`pw:${req.ip}`, 10, 15))) return render('Too many attempts. Please wait 15 minutes and try again.');
    const a = await db.get('SELECT * FROM admins WHERE email = ? COLLATE NOCASE', String(email).trim());
    if (!a || !a.active || !auth.verifyPassword(password, a.password_hash)) return render('Incorrect email or password.');
    await auth.createSession(req, res, a.id);
    res.redirect(next);
  })
);

router.post(
  '/otp/send',
  ah(async (req, res) => {
    const mobile = util.normalizeMobile(req.body.mobile);
    const next = safeNext(req.body.next);
    const base = { title: 'Admin login', info: null, next, mode: 'otp', values: { mobile } };
    if (!config.otpEnabled) return res.status(400).render('admin/login', { ...base, error: 'OTP login is not set up yet. Please use email and password.', otpSent: false });
    if (!util.isValidMobile(mobile)) return res.status(422).render('admin/login', { ...base, error: 'Please enter a valid 10-digit mobile number.', otpSent: false });
    if (!(await limited(`otp:${req.ip}`, 5, 60)) || !(await limited(`otpm:${mobile}`, 5, 60)))
      return res.status(429).render('admin/login', { ...base, error: 'Too many OTP requests. Please try again later.', otpSent: false });
    const a = await db.get('SELECT * FROM admins WHERE mobile = ? AND active = 1', mobile);
    if (a) {
      const code = await auth.createOtp(mobile);
      await notify.sendSms(mobile, `${code} is your ${(await getSettings()).name} admin login code. It expires in 10 minutes.`);
    }
    // Same response whether or not the number is registered.
    res.render('admin/login', { ...base, error: null, info: 'If this number belongs to an admin, a 6-digit code has been sent by SMS.', otpSent: true });
  })
);

router.post(
  '/otp/verify',
  ah(async (req, res) => {
    const mobile = util.normalizeMobile(req.body.mobile);
    const next = safeNext(req.body.next);
    if (!(await limited(`otpv:${req.ip}`, 10, 15)) || !(await auth.verifyOtp(mobile, req.body.code))) {
      return res.status(401).render('admin/login', { title: 'Admin login', error: 'The code is incorrect or has expired.', info: null, next, mode: 'otp', otpSent: true, values: { mobile } });
    }
    const a = await db.get('SELECT * FROM admins WHERE mobile = ? AND active = 1', mobile);
    if (!a) return res.redirect('/admin/login?mode=otp');
    await auth.createSession(req, res, a.id);
    res.redirect(next);
  })
);

router.get('/forgot', (req, res) => res.render('admin/forgot', { title: 'Forgot password', sent: false, error: null }));

router.post(
  '/forgot',
  ah(async (req, res) => {
    const email = String(req.body.email || '').trim();
    if (!(await limited(`fp:${req.ip}`, 10, 15))) return res.status(429).render('admin/forgot', { title: 'Forgot password', sent: false, error: 'Too many requests. Please try later.' });
    const a = await db.get('SELECT * FROM admins WHERE email = ? COLLATE NOCASE AND active = 1', email);
    if (a) {
      const token = await auth.createResetToken(a.id);
      const link = `${config.baseUrl}/admin/reset/${token}`;
      await notify.sendMail({
        to: a.email,
        subject: `Reset your ${(await getSettings()).name} admin password`,
        text: `Hello ${a.name},\n\nUse this link to set a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
      });
    }
    res.render('admin/forgot', { title: 'Forgot password', sent: true, error: null });
  })
);

router.get(
  '/reset/:token',
  ah(async (req, res) => {
    const ok = Boolean(await auth.findResetToken(req.params.token));
    res.render('admin/reset', { title: 'Set new password', ok, error: null, token: req.params.token });
  })
);

router.post(
  '/reset/:token',
  ah(async (req, res) => {
    const { password = '', confirm = '' } = req.body;
    let error = auth.validatePassword(password);
    if (!error && password !== confirm) error = 'The two passwords do not match.';
    if (error) return res.status(422).render('admin/reset', { title: 'Set new password', ok: true, error, token: req.params.token });
    if (!(await auth.consumeResetToken(req.params.token, password))) return res.render('admin/reset', { title: 'Set new password', ok: false, error: null, token: '' });
    res.redirect('/admin/login?reset=1');
  })
);

// ======================= Logged-in area =======================
router.use(auth.requireAdmin, auth.csrfProtect);

router.post(
  '/logout',
  ah(async (req, res) => {
    await auth.destroySession(req, res);
    res.redirect('/admin/login');
  })
);

// ---------- Dashboard ----------
router.get(
  '/',
  ah(async (req, res) => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const ms = monthStart.toISOString().slice(0, 10);
    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const [published, drafts, photos, videos, enqMonth, enqNew, won, views, rows, topProjects, recentEnquiries, statusCounts, pushKey] = await Promise.all([
      db.one("SELECT COUNT(*) FROM projects WHERE status = 'published'"),
      db.one("SELECT COUNT(*) FROM projects WHERE status != 'published'"),
      db.one("SELECT COUNT(*) FROM media WHERE kind = 'photo'"),
      db.one("SELECT COUNT(*) FROM media WHERE kind = 'video'"),
      db.one('SELECT COUNT(*) FROM enquiries WHERE created_at >= ?', ms),
      db.one("SELECT COUNT(*) FROM enquiries WHERE status = 'new'"),
      db.one("SELECT COUNT(*) FROM enquiries WHERE status = 'won'"),
      db.one('SELECT COALESCE(SUM(view_count),0) FROM projects'),
      db.all('SELECT day, kind, count FROM visits WHERE day >= ?', since),
      repo.listProjects({ status: 'published', sort: 'popular', limit: 5 }),
      db.all('SELECT * FROM enquiries ORDER BY created_at DESC, id DESC LIMIT 5'),
      db.all('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status'),
      notify.pushPublicKey(),
    ]);
    const stats = { published, drafts, photos, videos, enqMonth, enqNew, won, views };
    const days = [];
    for (let i = 29; i >= 0; i--) days.push({ day: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), web: 0, app: 0 });
    for (const r of rows) {
      const d = days.find((x) => x.day === r.day);
      if (d) d[r.kind] = r.count;
    }
    stats.visits30 = days.reduce((a, d) => a + d.web + d.app, 0);
    stats.appOpens30 = days.reduce((a, d) => a + d.app, 0);
    res.render('admin/dashboard', {
      title: 'Dashboard',
      stats,
      days,
      topProjects,
      recentEnquiries,
      byStatus: STATUSES.map((s) => ({ ...s, n: (statusCounts.find((c) => c.status === s.key) || { n: 0 }).n })),
      pushKey,
      mailConfigured: notify.mailConfigured(),
    });
  })
);

// ---------- Projects ----------
router.get(
  '/projects',
  ah(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = ['published', 'draft', 'hidden'].includes(req.query.status) ? req.query.status : 'all';
    const [projects, counts] = await Promise.all([
      repo.listProjects({ status, q, sort: 'updated', limit: 1000 }),
      db.all('SELECT status, COUNT(*) AS n FROM projects GROUP BY status'),
    ]);
    const c = (k) => (counts.find((x) => x.status === k) || { n: 0 }).n;
    res.render('admin/projects', {
      title: 'Projects',
      projects,
      q,
      status,
      counts: { all: counts.reduce((a, x) => a + x.n, 0), published: c('published'), draft: c('draft'), hidden: c('hidden') },
    });
  })
);

router.post(
  '/projects/new',
  ah(async (req, res) => {
    const title = String(req.body.title || '').trim() || 'New project';
    const slug = await util.uniqueSlug(db, 'projects', title);
    const cat = req.body.category_id ? Number(req.body.category_id) : null;
    const info = await db.run('INSERT INTO projects (title, slug, category_id, year) VALUES (?, ?, ?, ?)', title, slug, cat, new Date().getFullYear());
    res.redirect(`/admin/projects/${info.lastInsertRowid}`);
  })
);

const loadProject = ah(async (req, res, next) => {
  const p = await repo.getProject('id', Number(req.params.id));
  if (!p) {
    if (wantsJson(req)) return res.status(404).json({ error: 'Project not found' });
    return res.status(404).render('admin/error', { title: 'Not found', message: 'Project not found.' });
  }
  req.project = p;
  next();
});

const photoCount = (id) => db.one("SELECT COUNT(*) FROM media WHERE project_id = ? AND kind = 'photo'", id);

router.get(
  '/projects/:id',
  loadProject,
  ah(async (req, res) => {
    const p = req.project;
    const [items, categories, services, selected, settings] = await Promise.all([
      repo.projectMedia(p.id),
      repo.categories(),
      repo.services(),
      repo.projectServices(p.id),
      getSettings(),
    ]);
    res.render('admin/project-edit', {
      title: p.title,
      p,
      items,
      categories,
      services,
      selectedServices: selected.map((s) => s.id),
      watermarkDefault: settings.watermark_default === '1',
      maxVideoMB: config.maxVideoMB,
      directVideo: config.useBlob,
    });
  })
);

router.post(
  '/projects/:id',
  loadProject,
  ah(async (req, res) => {
    const p = req.project;
    const b = req.body;
    const action = b.action || 'save';
    const title = String(b.title || '').trim().slice(0, 140) || p.title;
    const year = parseInt(b.year, 10);
    let status = p.status;
    if (action === 'publish') status = 'published';
    else if (action === 'draft') status = 'draft';
    else if (action === 'hide') status = 'hidden';

    let blocked = false;
    if (status === 'published' && (await photoCount(p.id)) === 0) {
      status = p.status === 'published' ? 'published' : 'draft';
      if (p.status !== 'published') {
        blocked = true;
        res.flash('error', 'Add at least one photo before publishing. Details were saved as a draft.');
      }
    }
    // Keep links stable once published; drafts follow their title.
    const slug = p.published_at ? p.slug : await util.uniqueSlug(db, 'projects', title, p.id);
    const svcIds = [].concat(b.services || []).map(Number).filter(Boolean);

    await db.batch([
      [
        `UPDATE projects SET title=?, slug=?, category_id=?, location=?, year=?, client_name=?, show_client=?, description=?, materials=?,
         pieces=?, duration=?, tags=?, featured=?, status=?, published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN datetime('now') ELSE published_at END,
         updated_at=datetime('now') WHERE id=?`,
        title,
        slug,
        b.category_id ? Number(b.category_id) : null,
        String(b.location || '').trim().slice(0, 120),
        Number.isFinite(year) && year > 1950 && year < 2100 ? year : null,
        String(b.client_name || '').trim().slice(0, 120),
        b.show_client ? 1 : 0,
        String(b.description || '').trim().slice(0, 6000),
        String(b.materials || '').trim().slice(0, 500),
        String(b.pieces || '').trim().slice(0, 200),
        String(b.duration || '').trim().slice(0, 100),
        String(b.tags || '').trim().slice(0, 300),
        b.featured ? 1 : 0,
        status,
        status,
        p.id,
      ],
      ['DELETE FROM project_services WHERE project_id = ?', p.id],
      ...svcIds.map((sid) => ['INSERT OR IGNORE INTO project_services (project_id, service_id) VALUES (?, ?)', p.id, sid]),
    ]);

    if (!blocked) {
      const msg = { publish: 'Project published — it is now live on the website and app.', draft: 'Saved as draft.', hide: 'Project hidden from visitors.' }[action] || 'Changes saved.';
      res.flash('success', msg);
    }
    res.redirect(`/admin/projects/${p.id}`);
  })
);

router.post(
  '/projects/:id/quick',
  loadProject,
  ah(async (req, res) => {
    const p = req.project;
    const what = req.body.what;
    if (what === 'feature') await db.run('UPDATE projects SET featured = 1 - featured WHERE id = ?', p.id);
    else if (what === 'hide') await db.run("UPDATE projects SET status = 'hidden', updated_at = datetime('now') WHERE id = ?", p.id);
    else if (what === 'unhide' || what === 'publish') {
      if (!(await photoCount(p.id))) res.flash('error', 'Add at least one photo before publishing.');
      else await db.run("UPDATE projects SET status = 'published', published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?", p.id);
    }
    res.redirect(safeNext(req.body.back) || '/admin/projects');
  })
);

router.post(
  '/projects/:id/delete',
  loadProject,
  ah(async (req, res) => {
    const id = req.project.id;
    const files = (await repo.projectMedia(id)).flatMap((m) => [m.file, m.medium, m.thumb]);
    await db.batch([
      ['DELETE FROM media WHERE project_id = ?', id],
      ['DELETE FROM project_services WHERE project_id = ?', id],
      ['UPDATE enquiries SET project_id = NULL WHERE project_id = ?', id],
      ['DELETE FROM projects WHERE id = ?', id],
    ]);
    await mediaLib.removeFiles(...files);
    res.flash('success', `"${req.project.title}" was deleted.`);
    res.redirect('/admin/projects');
  })
);

// ---------- Media API (JSON, used by the upload screen) ----------
const mediaUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: Math.max(config.maxVideoMB, config.maxImageMB) * 1024 * 1024, files: 2 },
});

const withUrls = (m) => ({ ...m, thumbUrl: storage.url(m.thumb), fileUrl: storage.url(m.file) });

async function nextOrder(projectId) {
  return db.one('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media WHERE project_id = ?', projectId);
}

router.post(
  '/api/projects/:id/media',
  loadProject,
  mediaUpload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'poster', maxCount: 1 },
  ]),
  ah(async (req, res) => {
    const f = req.files && req.files.file && req.files.file[0];
    const poster = req.files && req.files.poster && req.files.poster[0];
    try {
      if (!f) return res.status(400).json({ error: 'No file received.' });
      const order = await nextOrder(req.project.id);
      let id;
      if (f.mimetype.startsWith('video/')) {
        if (!mediaLib.VIDEO_EXT[f.mimetype]) return res.status(415).json({ error: 'Please upload MP4, WebM or MOV videos.' });
        if (f.size > config.maxVideoMB * 1024 * 1024) return res.status(413).json({ error: `Videos must be under ${config.maxVideoMB} MB.` });
        const v = await mediaLib.saveVideo(await fs.promises.readFile(f.path), f.mimetype);
        const thumb = poster ? await mediaLib.saveVideoPoster(poster.path).catch(() => null) : null;
        id = (await db.run("INSERT INTO media (project_id, kind, file, thumb, medium, sort_order, bytes) VALUES (?, 'video', ?, ?, ?, ?, ?)", req.project.id, v.file, thumb, thumb, order, v.bytes)).lastInsertRowid;
      } else if (f.mimetype.startsWith('image/')) {
        if (f.size > config.maxImageMB * 1024 * 1024) return res.status(413).json({ error: `Photos must be under ${config.maxImageMB} MB.` });
        let r;
        try {
          r = await mediaLib.processProjectPhoto(f.path, { watermark: req.query.watermark === '1', settings: await getSettings() });
        } catch (e) {
          return res.status(415).json({ error: 'This photo format is not supported. Please use JPG or PNG.' });
        }
        id = (
          await db.run(
            "INSERT INTO media (project_id, kind, file, medium, thumb, width, height, sort_order, bytes) VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?)",
            req.project.id, r.file, r.medium, r.thumb, r.width, r.height, order, r.bytes
          )
        ).lastInsertRowid;
      } else {
        return res.status(415).json({ error: 'Only photos and videos can be uploaded here.' });
      }
      await db.run("UPDATE projects SET updated_at = datetime('now') WHERE id = ?", req.project.id);
      res.json({ ok: true, media: withUrls(await db.get('SELECT * FROM media WHERE id = ?', id)) });
    } finally {
      [f, poster].forEach((x) => x && fs.rm(x.path, { force: true }, () => {}));
    }
  })
);

// Large videos go straight from the phone to Vercel Blob (bypasses the 4.5 MB request limit).
// 1) the browser asks this route for a short-lived upload token …
router.post(
  '/api/blob-upload',
  ah(async (req, res) => {
    if (!config.useBlob) return res.status(400).json({ error: 'Direct upload is not configured.' });
    const { handleUpload } = require('@vercel/blob/client');
    const result = await handleUpload({
      body: req.body,
      request: req,
      token: config.blobToken,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^media\/\d{4}\/\d{2}\/[\w-]+\.(mp4|webm|mov|3gp)$/i.test(pathname)) throw new Error('Invalid file name');
        return {
          allowedContentTypes: Object.keys(mediaLib.VIDEO_EXT),
          maximumSizeInBytes: config.maxVideoMB * 1024 * 1024,
          addRandomSuffix: true,
          cacheControlMaxAge: 31536000,
        };
      },
    });
    res.json(result);
  })
);

// … 2) after the upload finishes, it registers the video (with its poster frame) here.
router.post(
  '/api/projects/:id/video',
  loadProject,
  mediaUpload.single('poster'),
  ah(async (req, res) => {
    try {
      const url = String(req.body.url || '');
      if (!storage.isOwnBlobUrl(url)) return res.status(400).json({ error: 'Invalid video address.' });
      const thumb = req.file ? await mediaLib.saveVideoPoster(req.file.path).catch(() => null) : null;
      const order = await nextOrder(req.project.id);
      const id = (
        await db.run("INSERT INTO media (project_id, kind, file, thumb, medium, sort_order, bytes) VALUES (?, 'video', ?, ?, ?, ?, ?)", req.project.id, url, thumb, thumb, order, Number(req.body.size) || 0)
      ).lastInsertRowid;
      await db.run("UPDATE projects SET updated_at = datetime('now') WHERE id = ?", req.project.id);
      res.json({ ok: true, media: withUrls(await db.get('SELECT * FROM media WHERE id = ?', id)) });
    } finally {
      if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    }
  })
);

const loadMedia = ah(async (req, res, next) => {
  const m = await db.get('SELECT * FROM media WHERE id = ?', Number(req.params.mid));
  if (!m) return res.status(404).json({ error: 'Not found' });
  req.media = m;
  next();
});

router.post(
  '/api/media/:mid',
  loadMedia,
  ah(async (req, res) => {
    const caption = req.body.caption !== undefined ? String(req.body.caption).slice(0, 200) : req.media.caption;
    const tag = ['normal', 'before', 'after'].includes(req.body.tag) ? req.body.tag : req.media.tag;
    await db.run('UPDATE media SET caption = ?, tag = ? WHERE id = ?', caption, tag, req.media.id);
    res.json({ ok: true });
  })
);

router.post(
  '/api/media/:mid/delete',
  loadMedia,
  ah(async (req, res) => {
    const m = req.media;
    await db.batch([
      ['DELETE FROM media WHERE id = ?', m.id],
      ['UPDATE projects SET cover_media_id = NULL WHERE cover_media_id = ?', m.id],
    ]);
    await mediaLib.removeFiles(m.file, m.medium, m.thumb);
    res.json({ ok: true });
  })
);

router.post(
  '/api/media/:mid/cover',
  loadMedia,
  ah(async (req, res) => {
    if (req.media.kind !== 'photo') return res.status(400).json({ error: 'Only a photo can be the cover.' });
    await db.run("UPDATE projects SET cover_media_id = ?, updated_at = datetime('now') WHERE id = ?", req.media.id, req.media.project_id);
    res.json({ ok: true });
  })
);

router.post(
  '/api/projects/:id/reorder',
  loadProject,
  ah(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).slice(0, 2000);
    await db.batch(ids.map((id, i) => ['UPDATE media SET sort_order = ? WHERE id = ? AND project_id = ?', i, id, req.project.id]));
    res.json({ ok: true });
  })
);

// ---------- Push notifications ----------
router.post(
  '/api/push/subscribe',
  ah(async (req, res) => {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'Invalid subscription' });
    await db.run(
      'INSERT INTO push_subscriptions (endpoint, admin_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET admin_id = excluded.admin_id, p256dh = excluded.p256dh, auth = excluded.auth',
      String(sub.endpoint), req.admin.id, String(sub.keys.p256dh), String(sub.keys.auth)
    );
    res.json({ ok: true });
  })
);

router.post(
  '/api/push/unsubscribe',
  ah(async (req, res) => {
    if (req.body && req.body.endpoint) await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', String(req.body.endpoint));
    res.json({ ok: true });
  })
);

router.post(
  '/api/push/test',
  ah(async (req, res) => {
    const n = await notify.sendPushToAdmins({ title: 'Notifications are working', body: 'You will be alerted here when a new enquiry arrives.', url: '/admin/enquiries' });
    res.json({ ok: true, sent: n });
  })
);

// ---------- Enquiries ----------
function enquiryFilter(req) {
  const status = STATUSES.some((s) => s.key === req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (status) {
    where.push('e.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(e.name LIKE ? OR e.mobile LIKE ? OR e.city LIKE ? OR e.service LIKE ? OR e.email LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  return { status, q, where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get(
  '/enquiries',
  ah(async (req, res) => {
    const f = enquiryFilter(req);
    const [rows, statusCounts] = await Promise.all([
      db.all(
        `SELECT e.*, (SELECT COUNT(*) FROM enquiry_files ef WHERE ef.enquiry_id = e.id) AS file_count
         FROM enquiries e ${f.where} ORDER BY e.created_at DESC, e.id DESC LIMIT 1000`,
        ...f.params
      ),
      db.all('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status'),
    ]);
    const counts = { all: statusCounts.reduce((a, x) => a + x.n, 0) };
    for (const s of STATUSES) counts[s.key] = (statusCounts.find((c) => c.status === s.key) || { n: 0 }).n;
    res.render('admin/enquiries', { title: 'Enquiries', rows, status: f.status, q: f.q, counts });
  })
);

router.get(
  '/enquiries.csv',
  ah(async (req, res) => {
    const f = enquiryFilter(req);
    const rows = await db.all(
      `SELECT e.*, p.title AS project_title,
        (SELECT GROUP_CONCAT(n.body, ' | ') FROM enquiry_notes n WHERE n.enquiry_id = e.id) AS notes
       FROM enquiries e LEFT JOIN projects p ON p.id = e.project_id ${f.where} ORDER BY e.created_at DESC`,
      ...f.params
    );
    const head = ['ID', 'Date received', 'Name', 'Mobile', 'Email', 'Client type', 'Service', 'City', 'Budget', 'Expected start', 'Message', 'Similar project', 'Status', 'Notes'];
    const lines = [head.join(',')];
    for (const e of rows) {
      lines.push(
        [e.id, util.fmtDateTime(e.created_at), e.name, e.mobile, e.email, e.client_type, e.service, e.city, e.budget, e.start_date, e.message, e.project_title, statusLabel(e.status), e.notes]
          .map(util.csvCell)
          .join(',')
      );
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="enquiries-${util.today()}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  })
);

const loadEnquiry = ah(async (req, res, next) => {
  const e = await db.get(
    'SELECT e.*, p.title AS project_title, p.slug AS project_slug FROM enquiries e LEFT JOIN projects p ON p.id = e.project_id WHERE e.id = ?',
    Number(req.params.id)
  );
  if (!e) return res.status(404).render('admin/error', { title: 'Not found', message: 'Enquiry not found.' });
  req.enquiry = e;
  next();
});

router.get(
  '/enquiries/:id',
  loadEnquiry,
  ah(async (req, res) => {
    const e = req.enquiry;
    const [files, notes, prev, next] = await Promise.all([
      db.all('SELECT * FROM enquiry_files WHERE enquiry_id = ?', e.id),
      db.all('SELECT n.*, a.name AS admin_name FROM enquiry_notes n LEFT JOIN admins a ON a.id = n.admin_id WHERE n.enquiry_id = ? ORDER BY n.created_at DESC, n.id DESC', e.id),
      db.get('SELECT id FROM enquiries WHERE id > ? ORDER BY id ASC LIMIT 1', e.id),
      db.get('SELECT id FROM enquiries WHERE id < ? ORDER BY id DESC LIMIT 1', e.id),
    ]);
    res.render('admin/enquiry', { title: `Enquiry from ${e.name}`, e, files, notes, prev, next });
  })
);

router.post(
  '/enquiries/:id/status',
  loadEnquiry,
  ah(async (req, res) => {
    const st = STATUSES.find((s) => s.key === req.body.status);
    if (st && st.key !== req.enquiry.status) {
      await db.batch([
        ["UPDATE enquiries SET status = ?, updated_at = datetime('now') WHERE id = ?", st.key, req.enquiry.id],
        ['INSERT INTO enquiry_notes (enquiry_id, admin_id, body) VALUES (?, ?, ?)', req.enquiry.id, req.admin.id, `Status changed: ${statusLabel(req.enquiry.status)} → ${st.label}`],
      ]);
    }
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/admin/enquiries/${req.enquiry.id}`);
  })
);

router.post(
  '/enquiries/:id/notes',
  loadEnquiry,
  ah(async (req, res) => {
    const body = String(req.body.body || '').trim().slice(0, 4000);
    if (body) await db.run('INSERT INTO enquiry_notes (enquiry_id, admin_id, body) VALUES (?, ?, ?)', req.enquiry.id, req.admin.id, body);
    res.redirect(`/admin/enquiries/${req.enquiry.id}#notes`);
  })
);

router.post(
  '/enquiries/:id/delete',
  loadEnquiry,
  ah(async (req, res) => {
    const id = req.enquiry.id;
    const files = await db.all('SELECT file FROM enquiry_files WHERE enquiry_id = ?', id);
    await db.batch([
      ['DELETE FROM enquiry_files WHERE enquiry_id = ?', id],
      ['DELETE FROM enquiry_notes WHERE enquiry_id = ?', id],
      ['DELETE FROM enquiries WHERE id = ?', id],
    ]);
    await storage.remove(files.map((f) => f.file));
    res.flash('success', 'Enquiry deleted.');
    res.redirect('/admin/enquiries');
  })
);

router.get(
  '/enquiries/:id/files/:fid',
  loadEnquiry,
  ah(async (req, res) => {
    const f = await db.get('SELECT * FROM enquiry_files WHERE id = ? AND enquiry_id = ?', Number(req.params.fid), req.enquiry.id);
    const data = f && (await storage.read(f.file));
    if (!data) return res.status(404).send('Not found');
    res.set('Content-Type', f.mime || 'application/octet-stream');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.original_name || 'file')}"`);
    res.send(data);
  })
);

// ---------- Settings: business info & about ----------
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const BUSINESS_FIELDS = [
  'name', 'tagline', 'intro', 'phone', 'whatsapp', 'email', 'address', 'map_query', 'hours', 'instagram', 'facebook', 'google_business', 'youtube',
  'whatsapp_message', 'seo_city', 'seo_description',
];
const ABOUT_FIELDS = ['about_story', 'owner_name', 'owner_title', 'owner_bio', 'registrations'];

router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Business settings', tab: 'business' });
});

router.post(
  '/settings/business',
  imageUpload.single('logo'),
  ah(async (req, res) => {
    const b = req.body;
    const writes = [];
    const set = (k, v) => writes.push(['INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v]);
    for (const k of BUSINESS_FIELDS) if (b[k] !== undefined) set(k, String(b[k]).trim().slice(0, 2000));
    set('watermark_default', b.watermark_default ? '1' : '0');
    const hl = [];
    for (let i = 0; i < 6; i++) {
      const value = String(b[`hl_value_${i}`] || '').trim().slice(0, 20);
      const label = String(b[`hl_label_${i}`] || '').trim().slice(0, 60);
      if (value && label) hl.push({ value, label });
    }
    set('highlights', JSON.stringify(hl));
    const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15);
    if (lines(b.budget_ranges).length) set('budget_ranges', JSON.stringify(lines(b.budget_ranges)));
    if (lines(b.client_types).length) set('client_types', JSON.stringify(lines(b.client_types)));
    const old = res.locals.s.logo;
    if (b.remove_logo) {
      set('logo', '');
      await mediaLib.removeFiles(old);
    } else if (req.file) {
      const r = await mediaLib.processSiteImage(req.file.buffer, { maxWidth: 800, keepAlpha: true });
      set('logo', r.file);
      await mediaLib.removeFiles(old);
    }
    await db.batch(writes);
    res.flash('success', 'Business details saved.');
    res.redirect('/admin/settings');
  })
);

router.get(
  '/settings/about',
  ah(async (req, res) => {
    res.render('admin/settings-about', { title: 'About Us page', tab: 'about', workshop: await repo.sitePhotos('workshop') });
  })
);

router.post(
  '/settings/about',
  imageUpload.fields([
    { name: 'owner_photo', maxCount: 1 },
    { name: 'workshop', maxCount: 20 },
  ]),
  ah(async (req, res) => {
    const b = req.body;
    for (const k of ABOUT_FIELDS) if (b[k] !== undefined) await setSetting(k, String(b[k]).trim().slice(0, 6000));
    await setSetting('show_registrations', b.show_registrations ? '1' : '0');
    const files = req.files || {};
    const old = res.locals.s.owner_photo;
    if (b.remove_owner_photo) {
      await setSetting('owner_photo', '');
      await mediaLib.removeFiles(old);
    } else if (files.owner_photo && files.owner_photo[0]) {
      const r = await mediaLib.processSiteImage(files.owner_photo[0].buffer, { maxWidth: 900 });
      await setSetting('owner_photo', r.file);
      await mediaLib.removeFiles(old);
    }
    if (files.workshop) {
      let order = await db.one("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM site_photos WHERE grp = 'workshop'");
      for (const f of files.workshop) {
        const r = await mediaLib.processSiteImage(f.buffer, { maxWidth: 2000, thumb: true });
        await db.run("INSERT INTO site_photos (grp, file, thumb, sort_order) VALUES ('workshop', ?, ?, ?)", r.file, r.thumb, order++);
      }
    }
    res.flash('success', 'About Us page saved.');
    res.redirect('/admin/settings/about');
  })
);

router.post(
  '/settings/about/photo/:pid/delete',
  ah(async (req, res) => {
    const ph = await db.get('SELECT * FROM site_photos WHERE id = ?', Number(req.params.pid));
    if (ph) {
      await db.run('DELETE FROM site_photos WHERE id = ?', ph.id);
      await mediaLib.removeFiles(ph.file, ph.thumb);
    }
    res.redirect('/admin/settings/about');
  })
);

// ---------- Settings: simple collections (categories, services, testimonials, clients, team) ----------
const COLLECTIONS = {
  categories: {
    table: 'categories',
    title: 'Project categories',
    singular: 'category',
    help: 'Categories are the filters visitors use on the Our Work page.',
    slug: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'Short description (optional)', type: 'textarea' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
    deleteWarning: 'Projects in this category will become "uncategorised". Continue?',
  },
  services: {
    table: 'services',
    title: 'Services',
    singular: 'service',
    help: 'Services appear on the Services page, the Home page and in the enquiry form. Tick services on each project to link them.',
    slug: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'icon', label: 'Icon', type: 'icon', options: SERVICE_ICONS },
      { name: 'image', label: 'Photo (optional)', type: 'image' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  testimonials: {
    table: 'testimonials',
    title: 'Testimonials',
    singular: 'testimonial',
    help: 'Only add reviews with the client’s permission.',
    fields: [
      { name: 'client_name', label: 'Client name', type: 'text', required: true },
      { name: 'business', label: 'Business / hotel name', type: 'text' },
      { name: 'text', label: 'Review', type: 'textarea', required: true },
      { name: 'rating', label: 'Rating', type: 'select', options: ['5', '4', '3', '2', '1'] },
      { name: 'photo', label: 'Photo (optional)', type: 'image' },
      { name: 'visible', label: 'Show on website', type: 'checkbox', default: 1 },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  clients: {
    table: 'clients',
    title: 'Major clients',
    singular: 'client',
    help: 'Client names / logos are shown on Home and About pages — only with permission.',
    fields: [
      { name: 'name', label: 'Client name', type: 'text', required: true },
      { name: 'logo', label: 'Logo (optional, PNG with transparent background is best)', type: 'image', keepAlpha: true },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  team: {
    table: 'team',
    title: 'Team members',
    singular: 'team member',
    help: 'Shown on the About Us page.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'role', label: 'Role', type: 'text' },
      { name: 'photo', label: 'Photo', type: 'image' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
};

function collection(req, res, next) {
  const c = COLLECTIONS[req.params.coll];
  if (!c) return res.status(404).render('admin/error', { title: 'Not found', message: 'Not found.' });
  req.coll = c;
  next();
}

async function collectionValues(c, req, existing) {
  const vals = {};
  for (const f of c.fields) {
    const raw = req.body[f.name];
    if (f.type === 'image') {
      const file = (req.files || []).find((x) => x.fieldname === f.name);
      if (req.body[`remove_${f.name}`]) {
        vals[f.name] = null;
        if (existing) await mediaLib.removeFiles(existing[f.name]);
      } else if (file) {
        const r = await mediaLib.processSiteImage(file.buffer, { maxWidth: f.keepAlpha ? 600 : 1400, keepAlpha: Boolean(f.keepAlpha) });
        vals[f.name] = r.file;
        if (existing) await mediaLib.removeFiles(existing[f.name]);
      }
    } else if (f.type === 'checkbox') vals[f.name] = raw ? 1 : 0;
    else if (f.type === 'number') vals[f.name] = parseInt(raw, 10) || 0;
    else if (f.type === 'select') vals[f.name] = f.options.includes(String(raw)) ? (f.name === 'rating' ? Number(raw) : String(raw)) : existing ? existing[f.name] : f.options[0];
    else if (f.type === 'icon') vals[f.name] = f.options.includes(String(raw)) ? String(raw) : 'sofa';
    else vals[f.name] = String(raw || '').trim().slice(0, f.type === 'textarea' ? 3000 : 200);
  }
  return vals;
}

const COLL = ':coll(categories|services|testimonials|clients|team)';

router.get(
  `/settings/${COLL}`,
  collection,
  ah(async (req, res) => {
    const c = req.coll;
    res.render('admin/collection', { title: c.title, tab: req.params.coll, c, key: req.params.coll, rows: await db.all(`SELECT * FROM ${c.table} ORDER BY sort_order, id`) });
  })
);

router.post(
  `/settings/${COLL}`,
  collection,
  imageUpload.any(),
  ah(async (req, res) => {
    const c = req.coll;
    const vals = await collectionValues(c, req, null);
    const missing = c.fields.find((f) => f.required && !vals[f.name]);
    if (missing) {
      res.flash('error', `${missing.label} is required.`);
      return res.redirect(`/admin/settings/${req.params.coll}`);
    }
    if (c.slug) vals.slug = await util.uniqueSlug(db, c.table, vals.name);
    if (!req.body.sort_order) vals.sort_order = await db.one(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ${c.table}`);
    const cols = Object.keys(vals);
    await db.run(`INSERT INTO ${c.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((k) => vals[k]));
    res.flash('success', `New ${c.singular} added.`);
    res.redirect(`/admin/settings/${req.params.coll}`);
  })
);

router.post(
  `/settings/${COLL}/:rid`,
  collection,
  imageUpload.any(),
  ah(async (req, res) => {
    const c = req.coll;
    const row = await db.get(`SELECT * FROM ${c.table} WHERE id = ?`, Number(req.params.rid));
    if (!row) return res.redirect(`/admin/settings/${req.params.coll}`);
    if (req.body._delete) {
      const extra =
        c.table === 'categories'
          ? [['UPDATE projects SET category_id = NULL WHERE category_id = ?', row.id]]
          : c.table === 'services'
            ? [['DELETE FROM project_services WHERE service_id = ?', row.id]]
            : [];
      await db.batch([...extra, [`DELETE FROM ${c.table} WHERE id = ?`, row.id]]);
      for (const f of c.fields) if (f.type === 'image') await mediaLib.removeFiles(row[f.name]);
      res.flash('success', `The ${c.singular} was deleted.`);
      return res.redirect(`/admin/settings/${req.params.coll}`);
    }
    const vals = await collectionValues(c, req, row);
    const missing = c.fields.find((f) => f.required && !vals[f.name]);
    if (missing) {
      res.flash('error', `${missing.label} is required.`);
      return res.redirect(`/admin/settings/${req.params.coll}`);
    }
    const cols = Object.keys(vals);
    await db.run(`UPDATE ${c.table} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => vals[k]), row.id);
    res.flash('success', 'Saved.');
    res.redirect(`/admin/settings/${req.params.coll}#row-${row.id}`);
  })
);

// ---------- Settings: admins ----------
const listAdmins = () => db.all('SELECT id, name, email, mobile, role, active, last_login, created_at FROM admins ORDER BY id');

router.get(
  '/settings/admins',
  ah(async (req, res) => {
    res.render('admin/admins', { title: 'Admin accounts', tab: 'admins', admins: await listAdmins(), error: null, values: {} });
  })
);

router.post(
  '/settings/admins',
  auth.requireOwner,
  ah(async (req, res) => {
    const { name = '', email = '', mobile = '', password = '' } = req.body;
    let error = null;
    if (name.trim().length < 2) error = 'Please enter a name.';
    else if (!util.isValidEmail(email)) error = 'Please enter a valid email.';
    else if (mobile && !util.isValidMobile(mobile)) error = 'Please enter a valid 10-digit mobile number.';
    else error = auth.validatePassword(password);
    if (!error && (await db.get('SELECT id FROM admins WHERE email = ? COLLATE NOCASE', email.trim()))) error = 'An admin with this email already exists.';
    if (!error && mobile && (await db.get('SELECT id FROM admins WHERE mobile = ?', util.normalizeMobile(mobile)))) error = 'An admin with this mobile already exists.';
    if (error) return res.status(422).render('admin/admins', { title: 'Admin accounts', tab: 'admins', admins: await listAdmins(), error, values: { name, email, mobile } });
    await db.run(
      "INSERT INTO admins (name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
      name.trim(), email.trim().toLowerCase(), mobile ? util.normalizeMobile(mobile) : null, auth.hashPassword(password)
    );
    res.flash('success', `${name.trim()} can now log in. Share the email and password with them privately.`);
    res.redirect('/admin/settings/admins');
  })
);

router.post(
  '/settings/admins/:aid',
  auth.requireOwner,
  ah(async (req, res) => {
    const a = await db.get('SELECT * FROM admins WHERE id = ?', Number(req.params.aid));
    if (!a || a.id === req.admin.id || a.role === 'owner') {
      res.flash('error', 'This account cannot be changed here.');
      return res.redirect('/admin/settings/admins');
    }
    if (req.body.action === 'remove') {
      await db.batch([
        ['DELETE FROM sessions WHERE admin_id = ?', a.id],
        ['DELETE FROM push_subscriptions WHERE admin_id = ?', a.id],
        ['DELETE FROM password_resets WHERE admin_id = ?', a.id],
        ['UPDATE enquiry_notes SET admin_id = NULL WHERE admin_id = ?', a.id],
        ['DELETE FROM admins WHERE id = ?', a.id],
      ]);
      res.flash('success', `${a.name} was removed and can no longer log in.`);
    } else if (req.body.action === 'toggle') {
      await db.batch([
        ['UPDATE admins SET active = 1 - active WHERE id = ?', a.id],
        ['DELETE FROM sessions WHERE admin_id = ?', a.id],
      ]);
      res.flash('success', a.active ? `${a.name} has been disabled.` : `${a.name} has been enabled.`);
    }
    res.redirect('/admin/settings/admins');
  })
);

// ---------- Settings: my account ----------
router.get('/settings/account', (req, res) => {
  res.render('admin/account', { title: 'My account', tab: 'account', error: null });
});

router.post(
  '/settings/account',
  ah(async (req, res) => {
    const b = req.body;
    const me = await db.get('SELECT * FROM admins WHERE id = ?', req.admin.id);
    const render = (error) => res.status(422).render('admin/account', { title: 'My account', tab: 'account', error });
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const mobile = b.mobile ? util.normalizeMobile(b.mobile) : null;
    if (name.length < 2) return render('Please enter your name.');
    if (!util.isValidEmail(email)) return render('Please enter a valid email.');
    if (mobile && !util.isValidMobile(mobile)) return render('Please enter a valid 10-digit mobile number.');
    if (await db.get('SELECT id FROM admins WHERE email = ? COLLATE NOCASE AND id != ?', email, me.id)) return render('Another admin uses this email.');
    if (mobile && (await db.get('SELECT id FROM admins WHERE mobile = ? AND id != ?', mobile, me.id))) return render('Another admin uses this mobile number.');
    if (b.new_password) {
      if (!auth.verifyPassword(b.current_password, me.password_hash)) return render('Your current password is not correct.');
      const err = auth.validatePassword(b.new_password);
      if (err) return render(err);
      await db.run('UPDATE admins SET password_hash = ? WHERE id = ?', auth.hashPassword(b.new_password), me.id);
    }
    await db.run('UPDATE admins SET name = ?, email = ?, mobile = ?, notify_email = ? WHERE id = ?', name, email, mobile, b.notify_email ? 1 : 0, me.id);
    res.flash('success', 'Your account was updated.');
    res.redirect('/admin/settings/account');
  })
);

router.post(
  '/settings/account/logout-all',
  ah(async (req, res) => {
    await db.run('DELETE FROM sessions WHERE admin_id = ?', req.admin.id);
    res.redirect('/admin/login');
  })
);

module.exports = router;
