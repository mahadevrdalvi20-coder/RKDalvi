'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db, getSettings, setSetting } = require('../db');
const repo = require('../repo');
const util = require('../util');
const notify = require('../notify');

const router = express.Router();

// ---------- helpers ----------
function appSecret() {
  const s = getSettings();
  if (s.app_secret) return s.app_secret;
  const v = util.randomToken(32);
  setSetting('app_secret', v);
  return v;
}

function formStamp() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', appSecret()).update(ts).digest('base64url').slice(0, 16);
  return `${ts}.${sig}`;
}

function checkStamp(stamp) {
  const [ts, sig] = String(stamp || '').split('.');
  if (!ts || !sig) return false;
  const good = crypto.createHmac('sha256', appSecret()).update(ts).digest('base64url').slice(0, 16);
  if (good !== sig) return false;
  const age = Date.now() - Number(ts);
  return age > 2500 && age < 24 * 3600 * 1000; // humans need a few seconds to fill the form
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|lighthouse|headless/i;

// ---------- pages ----------
router.get('/', (req, res) => {
  const featured = repo.listProjects({ featured: true, limit: 8 });
  const recent = repo.listProjects({ limit: 6 });
  const heroSlides = (featured.length ? featured : recent).filter((p) => p.cover_medium).slice(0, 6);
  res.render('public/home', {
    title: '',
    heroSlides,
    recent,
    services: repo.services().slice(0, 8),
    categories: repo.categories(),
    testimonials: repo.testimonials().slice(0, 6),
    clients: repo.clients(),
    ogImage: heroSlides[0] ? `/media/${heroSlides[0].cover_medium}` : '',
  });
});

router.get('/work', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const category = String(req.query.category || '');
  const service = String(req.query.service || '');
  const sort = ['newest', 'oldest', 'popular'].includes(req.query.sort) ? req.query.sort : 'newest';
  const projects = repo.listProjects({ q, category, service, sort });
  const categories = repo.categories();
  const activeCat = categories.find((c) => c.slug === category);
  const activeService = service ? repo.services().find((s) => s.slug === service) : null;
  res.render('public/work', {
    title: activeCat ? `${activeCat.name} Projects` : 'Our Work',
    description: `Completed furniture and interior projects by ${res.locals.s.name}${activeCat ? ` — ${activeCat.name}` : ''}.`,
    projects,
    categories,
    q,
    category,
    sort,
    activeService,
  });
});

router.get('/work/:slug', (req, res, next) => {
  const p = repo.getProject('slug', req.params.slug);
  if (!p || (p.status !== 'published' && !req.admin)) return next();
  if (!req.admin && !BOT.test(req.headers['user-agent'] || '')) {
    db.prepare('UPDATE projects SET view_count = view_count + 1 WHERE id = ?').run(p.id);
  }
  const media = repo.projectMedia(p.id);
  const photos = media.filter((m) => m.kind === 'photo');
  const videos = media.filter((m) => m.kind === 'video');
  const before = photos.filter((m) => m.tag === 'before');
  const after = photos.filter((m) => m.tag === 'after');
  const gallery = photos.filter((m) => m.tag === 'normal');
  const related = repo
    .listProjects({ category: p.category_slug, limit: 4 })
    .filter((r) => r.id !== p.id)
    .slice(0, 3);
  res.render('public/project', {
    title: p.title,
    description: util.truncate(`${p.title}${p.location ? ', ' + p.location : ''}. ${p.description}`, 160),
    ogImage: p.cover_medium ? `/media/${p.cover_medium}` : '',
    p,
    photos,
    gallery: gallery.length ? gallery : photos,
    before,
    after,
    videos,
    services: repo.projectServices(p.id),
    materials: util.splitList(p.materials),
    related,
    isPreview: p.status !== 'published',
  });
});

router.get('/services', (req, res) => {
  res.render('public/services', {
    title: 'Services',
    description: `Hotel furniture, restaurant seating, modular kitchens, wardrobes, false ceilings, wall panelling and turnkey interiors by ${res.locals.s.name}.`,
    services: repo.services(),
  });
});

router.get('/services/:slug', (req, res, next) => {
  const svc = repo.services().find((s) => s.slug === req.params.slug);
  if (!svc) return next();
  res.render('public/service', {
    title: svc.name,
    description: util.truncate(svc.description, 160),
    svc,
    projects: repo.listProjects({ service: svc.slug, limit: 24 }),
    others: repo.services().filter((s) => s.id !== svc.id),
  });
});

router.get('/about', (req, res) => {
  res.render('public/about', {
    title: 'About Us',
    description: util.truncate(res.locals.s.about_story, 160),
    team: repo.team(),
    workshop: repo.sitePhotos('workshop'),
    clients: repo.clients(),
    testimonials: repo.testimonials(),
    projectCount: db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status = 'published'").get().n,
  });
});

function contactLocals(req, extra = {}) {
  const project = req.query.project ? repo.getProject('slug', String(req.query.project)) : null;
  const services = repo.services();
  const preService = req.query.service ? services.find((s) => s.slug === req.query.service) : null;
  let presetService = preService ? preService.name : '';
  if (project && !presetService) {
    const ps = repo.projectServices(project.id);
    if (ps[0]) presetService = ps[0].name;
  }
  return {
    title: 'Contact & Get a Quote',
    description: `Get a free quote from ${getSettings().name} for hotel, restaurant, office or home furniture and interiors.`,
    services,
    project: project && project.status === 'published' ? project : null,
    values: { service: presetService, message: project ? `I am interested in a project similar to "${project.title}".` : '' },
    errors: {},
    stamp: formStamp(),
    ...extra,
  };
}

router.get('/contact', (req, res) => res.render('public/contact', contactLocals(req)));

// Enquiry attachments: up to 5 images / PDFs, 10 MB each, stored privately.
const enquiryUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(config.privateDir, 'enquiries');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = (path.extname(file.originalname || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
      cb(null, `${Date.now()}-${util.randomToken(8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 30 },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|png|webp|heic|heif|gif)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(null, ok);
  },
});

const enquiryLimiter = util.rateLimiter({ windowMs: 60 * 60 * 1000, max: 8 });

router.post(
  '/contact',
  (req, res, next) => {
    enquiryUpload.array('attachments', 5)(req, res, (err) => {
      if (err) {
        req.uploadError =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Each file must be under 10 MB.'
            : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
              ? 'You can attach up to 5 files.'
              : 'Could not upload the files.';
        req.files = req.files || [];
        req.body = req.body || {};
      }
      next();
    });
  },
  async (req, res, next) => {
    const files = req.files || [];
    const cleanup = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    try {
      const b = req.body || {};
      const v = {
        name: String(b.name || '').trim().slice(0, 100),
        mobile: String(b.mobile || '').trim().slice(0, 20),
        email: String(b.email || '').trim().slice(0, 120),
        client_type: String(b.client_type || '').trim().slice(0, 60),
        service: String(b.service || '').trim().slice(0, 100),
        city: String(b.city || '').trim().slice(0, 80),
        budget: String(b.budget || '').trim().slice(0, 60),
        start_date: String(b.start_date || '').trim().slice(0, 20),
        message: String(b.message || '').trim().slice(0, 4000),
        project: String(b.project || '').slice(0, 120),
      };

      // spam protection: honeypot + time stamp + rate limit
      const isSpam = Boolean(b.website) || !checkStamp(b.stamp);
      const ip = req.ip || '';
      if (isSpam) {
        cleanup();
        return res.redirect(303, '/thank-you');
      }

      const errors = {};
      if (v.name.length < 2) errors.name = 'Please enter your name.';
      if (!util.isValidMobile(v.mobile)) errors.mobile = 'Please enter a valid 10-digit mobile number.';
      if (v.email && !util.isValidEmail(v.email)) errors.email = 'Please enter a valid email or leave it empty.';
      if (!v.client_type) errors.client_type = 'Please choose one.';
      if (!v.service) errors.service = 'Please choose the service you need.';
      if (v.city.length < 2) errors.city = 'Please enter the city / location of the project.';
      if (v.start_date && !/^\d{4}-\d{2}(-\d{2})?$/.test(v.start_date)) errors.start_date = 'Please choose a valid month.';
      if (req.uploadError) errors.attachments = req.uploadError;

      if (Object.keys(errors).length) {
        cleanup();
        req.query.project = v.project;
        return res.status(422).render('public/contact', contactLocals(req, { values: v, errors }));
      }
      if (!enquiryLimiter(ip)) {
        cleanup();
        return res.status(429).render('public/contact', contactLocals(req, { values: v, errors: { form: 'Too many enquiries from this connection. Please call or WhatsApp us instead.' } }));
      }

      const project = v.project ? repo.getProject('slug', v.project) : null;
      const mobile = util.normalizeMobile(v.mobile);
      const info = db
        .prepare(
          `INSERT INTO enquiries (name, mobile, email, client_type, service, city, budget, start_date, message, project_id, ip)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(v.name, mobile, v.email, v.client_type, v.service, v.city, v.budget, v.start_date, v.message, project ? project.id : null, ip);
      const id = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO enquiry_files (enquiry_id, file, original_name, mime, bytes) VALUES (?, ?, ?, ?, ?)');
      for (const f of files) ins.run(id, path.basename(f.path), String(f.originalname || 'file').slice(0, 120), f.mimetype, f.size);

      notify.notifyNewEnquiry({ id, ...v, mobile, project_title: project && project.title }).catch((e) => console.error('[notify]', e));
      res.redirect(303, `/thank-you?n=${encodeURIComponent(v.name.split(' ')[0])}`);
    } catch (e) {
      cleanup();
      next(e);
    }
  }
);

router.get('/thank-you', (req, res) => {
  res.render('public/thank-you', { title: 'Thank you', firstName: String(req.query.n || '').slice(0, 40) });
});

router.get('/privacy', (req, res) => res.render('public/privacy', { title: 'Privacy Policy' }));
router.get('/offline', (req, res) => res.render('public/offline', { title: 'Offline' }));

// ---------- SEO / PWA ----------
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/work', '/services', '/about', '/contact'];
  for (const c of repo.categories()) urls.push(`/work?category=${c.slug}`);
  for (const sv of repo.services()) urls.push(`/services/${sv.slug}`);
  const projects = repo.listProjects({ limit: 5000 });
  const esc = (x) => x.replace(/&/g, '&amp;');
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `<url><loc>${esc(config.baseUrl + u)}</loc></url>`),
    ...projects.map((p) => `<url><loc>${esc(`${config.baseUrl}/work/${p.slug}`)}</loc><lastmod>${String(p.updated_at).slice(0, 10)}</lastmod></url>`),
    '</urlset>',
  ].join('\n');
  res.type('application/xml').send(xml);
});

router.get('/manifest.webmanifest', (req, res) => {
  const s = getSettings();
  res.type('application/manifest+json').send(
    JSON.stringify({
      name: s.name,
      short_name: s.name.replace(/\s+/g, ' ').slice(0, 12),
      description: s.tagline,
      id: '/',
      start_url: '/?source=app',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f7f1e8',
      theme_color: '#4a2e1b',
      icons: [
        { src: '/assets/img/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/assets/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/assets/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Our Work', url: '/work?source=app' },
        { name: 'Get a Quote', url: '/contact?source=app' },
        { name: 'Admin', url: '/admin' },
      ],
    })
  );
});

// Digital Asset Links: lets the Android (TWA) app open the site full-screen without a browser bar.
router.get('/.well-known/assetlinks.json', (req, res) => {
  res.json(
    config.android.sha256.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: { namespace: 'android_app', package_name: config.android.packageName, sha256_cert_fingerprints: config.android.sha256 },
          },
        ]
      : []
  );
});

module.exports = router;
