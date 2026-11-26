'use strict';
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db, getSettings, setSetting } = require('../db');
const repo = require('../repo');
const util = require('../util');
const notify = require('../notify');
const storage = require('../storage');
const auth = require('../auth');

const { ah } = util;
const router = express.Router();

// ---------- helpers ----------
async function appSecret() {
  const s = await getSettings();
  if (s.app_secret) return s.app_secret;
  const v = util.randomToken(32);
  await setSetting('app_secret', v);
  return v;
}

async function formStamp() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', await appSecret()).update(ts).digest('base64url').slice(0, 16);
  return `${ts}.${sig}`;
}

async function checkStamp(stamp) {
  const [ts, sig] = String(stamp || '').split('.');
  if (!ts || !sig) return false;
  const good = crypto.createHmac('sha256', await appSecret()).update(ts).digest('base64url').slice(0, 16);
  if (good !== sig) return false;
  const age = Date.now() - Number(ts);
  return age > 2500 && age < 24 * 3600 * 1000; // humans need a few seconds to fill the form
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|lighthouse|headless/i;

// On serverless hosts, work after the response may be frozen — so wait (briefly) for alerts.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
}

// ---------- pages ----------
router.get(
  '/',
  ah(async (req, res) => {
    const [featured, recent, services, categories, testimonials, clients] = await Promise.all([
      repo.listProjects({ featured: true, limit: 8 }),
      repo.listProjects({ limit: 6 }),
      repo.services(),
      repo.categories(),
      repo.testimonials(),
      repo.clients(),
    ]);
    const heroSlides = (featured.length ? featured : recent).filter((p) => p.cover_medium).slice(0, 6);
    res.render('public/home', {
      title: '',
      heroSlides,
      recent,
      services: services.slice(0, 8),
      categories,
      testimonials: testimonials.slice(0, 6),
      clients,
      ogImage: heroSlides[0] ? storage.url(heroSlides[0].cover_medium) : '',
    });
  })
);

router.get(
  '/work',
  ah(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const category = String(req.query.category || '');
    const service = String(req.query.service || '');
    const sort = ['newest', 'oldest', 'popular'].includes(req.query.sort) ? req.query.sort : 'newest';
    const [projects, categories, services] = await Promise.all([repo.listProjects({ q, category, service, sort }), repo.categories(), repo.services()]);
    const activeCat = categories.find((c) => c.slug === category);
    const activeService = service ? services.find((s) => s.slug === service) : null;
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
  })
);

router.get(
  '/work/:slug',
  ah(async (req, res, next) => {
    const p = await repo.getProject('slug', req.params.slug);
    if (!p || (p.status !== 'published' && !req.admin)) return next();
    if (!req.admin && !BOT.test(req.headers['user-agent'] || '')) {
      await db.run('UPDATE projects SET view_count = view_count + 1 WHERE id = ?', p.id);
    }
    const [media, services, relatedAll] = await Promise.all([
      repo.projectMedia(p.id),
      repo.projectServices(p.id),
      repo.listProjects({ category: p.category_slug, limit: 4 }),
    ]);
    const photos = media.filter((m) => m.kind === 'photo');
    const gallery = photos.filter((m) => m.tag === 'normal');
    res.render('public/project', {
      title: p.title,
      description: util.truncate(`${p.title}${p.location ? ', ' + p.location : ''}. ${p.description}`, 160),
      ogImage: p.cover_medium ? storage.url(p.cover_medium) : '',
      p,
      photos,
      gallery: gallery.length ? gallery : photos,
      before: photos.filter((m) => m.tag === 'before'),
      after: photos.filter((m) => m.tag === 'after'),
      videos: media.filter((m) => m.kind === 'video'),
      services,
      materials: util.splitList(p.materials),
      related: relatedAll.filter((r) => r.id !== p.id).slice(0, 3),
      isPreview: p.status !== 'published',
    });
  })
);

router.get(
  '/services',
  ah(async (req, res) => {
    res.render('public/services', {
      title: 'Services',
      description: `Hotel furniture, restaurant seating, modular kitchens, wardrobes, false ceilings, wall panelling and turnkey interiors by ${res.locals.s.name}.`,
      services: await repo.services(),
    });
  })
);

router.get(
  '/services/:slug',
  ah(async (req, res, next) => {
    const all = await repo.services();
    const svc = all.find((s) => s.slug === req.params.slug);
    if (!svc) return next();
    res.render('public/service', {
      title: svc.name,
      description: util.truncate(svc.description, 160),
      svc,
      projects: await repo.listProjects({ service: svc.slug, limit: 24 }),
      others: all.filter((s) => s.id !== svc.id),
    });
  })
);

router.get(
  '/about',
  ah(async (req, res) => {
    const [team, workshop, clients, testimonials, projectCount] = await Promise.all([
      repo.team(),
      repo.sitePhotos('workshop'),
      repo.clients(),
      repo.testimonials(),
      db.one("SELECT COUNT(*) FROM projects WHERE status = 'published'"),
    ]);
    res.render('public/about', {
      title: 'About Us',
      description: util.truncate(res.locals.s.about_story, 160),
      team,
      workshop,
      clients,
      testimonials,
      projectCount,
    });
  })
);

async function contactLocals(req, extra = {}) {
  const project = req.query.project ? await repo.getProject('slug', String(req.query.project)) : null;
  const services = await repo.services();
  const preService = req.query.service ? services.find((s) => s.slug === req.query.service) : null;
  let presetService = preService ? preService.name : '';
  if (project && !presetService) {
    const ps = await repo.projectServices(project.id);
    if (ps[0]) presetService = ps[0].name;
  }
  return {
    title: 'Contact & Get a Quote',
    description: `Get a free quote from ${(await getSettings()).name} for hotel, restaurant, office or home furniture and interiors.`,
    services,
    project: project && project.status === 'published' ? project : null,
    values: { service: presetService, message: project ? `I am interested in a project similar to "${project.title}".` : '' },
    errors: {},
    stamp: await formStamp(),
    maxBodyMB: config.maxBodyMB,
    ...extra,
  };
}

router.get('/contact', ah(async (req, res) => res.render('public/contact', await contactLocals(req))));

// Enquiry attachments: up to 5 images / PDFs. Photos are compressed in the browser first.
const enquiryUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 30 },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|png|webp|heic|heif|gif)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(null, ok);
  },
});

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
  ah(async (req, res) => {
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
      if (b.website || !(await checkStamp(b.stamp))) return res.redirect(303, '/thank-you');

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
        req.query.project = v.project;
        return res.status(422).render('public/contact', await contactLocals(req, { values: v, errors }));
      }
      if (!(await auth.rateLimit(`enq:${req.ip}`, 8, 60 * 60 * 1000))) {
        return res
          .status(429)
          .render('public/contact', await contactLocals(req, { values: v, errors: { form: 'Too many enquiries from this connection. Please call or WhatsApp us instead.' } }));
      }

      const project = v.project ? await repo.getProject('slug', v.project) : null;
      const mobile = util.normalizeMobile(v.mobile);
      const info = await db.run(
        `INSERT INTO enquiries (name, mobile, email, client_type, service, city, budget, start_date, message, project_id, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.name, mobile, v.email, v.client_type, v.service, v.city, v.budget, v.start_date, v.message, project ? project.id : null, req.ip || ''
      );
      const id = info.lastInsertRowid;
      for (const f of files) {
        const ref = await storage.savePrivate(f.originalname || 'file', await fs.promises.readFile(f.path), f.mimetype);
        await db.run('INSERT INTO enquiry_files (enquiry_id, file, original_name, mime, bytes) VALUES (?, ?, ?, ?, ?)', id, ref, String(f.originalname || 'file').slice(0, 120), f.mimetype, f.size);
      }

      await withTimeout(
        notify.notifyNewEnquiry({ id, ...v, mobile, project_title: project && project.title }).catch((e) => console.error('[notify]', e)),
        8000
      );
      res.redirect(303, `/thank-you?n=${encodeURIComponent(v.name.split(' ')[0])}`);
    } finally {
      cleanup();
    }
  })
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

router.get(
  '/sitemap.xml',
  ah(async (req, res) => {
    const urls = ['/', '/work', '/services', '/about', '/contact'];
    const [cats, svcs, projects] = await Promise.all([repo.categories(), repo.services(), repo.listProjects({ limit: 5000 })]);
    for (const c of cats) urls.push(`/work?category=${c.slug}`);
    for (const sv of svcs) urls.push(`/services/${sv.slug}`);
    const esc = (x) => x.replace(/&/g, '&amp;');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => `<url><loc>${esc(config.baseUrl + u)}</loc></url>`),
      ...projects.map((p) => `<url><loc>${esc(`${config.baseUrl}/work/${p.slug}`)}</loc><lastmod>${String(p.updated_at).slice(0, 10)}</lastmod></url>`),
      '</urlset>',
    ].join('\n');
    res.type('application/xml').send(xml);
  })
);

router.get('/manifest.webmanifest', (req, res) => {
  const s = res.locals.s;
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
