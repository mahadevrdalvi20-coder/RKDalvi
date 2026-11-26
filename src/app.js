'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const { getSettings } = require('./db');
const auth = require('./auth');
const util = require('./util');
const repo = require('./repo');
const icons = require('./icons');

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.disable('x-powered-by');
  if (config.isProd) app.set('view cache', true);

  const gaHosts = config.gaMeasurementId ? ['https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://*.google-analytics.com'] : [];
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...gaHosts],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', ...gaHosts],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", ...gaHosts],
          frameSrc: ['https://www.google.com', 'https://maps.google.com'],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProd,
    })
  );
  app.use(compression());

  // ---- static files ----
  const year = 365 * 24 * 3600 * 1000;
  app.use('/assets', express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use('/media', express.static(config.mediaDir, { maxAge: year, immutable: true, index: false, dotfiles: 'deny' }));
  app.use('/vendor/photoswipe', express.static(path.join(config.root, 'node_modules/photoswipe/dist'), { maxAge: '30d' }));
  app.use('/vendor/sortable', express.static(path.join(config.root, 'node_modules/sortablejs'), { maxAge: '30d' }));
  app.use('/fonts/inter', express.static(path.join(config.root, 'node_modules/@fontsource/inter/files'), { maxAge: year, immutable: true }));
  app.use('/fonts/playfair', express.static(path.join(config.root, 'node_modules/@fontsource/playfair-display/files'), { maxAge: year, immutable: true }));
  // service worker must be served from the root scope
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/');
    res.sendFile(path.join(config.root, 'public/js/sw.js'));
  });

  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(auth.loadSession);

  // ---- template locals ----
  app.use((req, res, next) => {
    const settings = getSettings();
    res.locals.s = settings;
    res.locals.config = config;
    res.locals.u = util;
    res.locals.icon = icons.icon;
    res.locals.admin = req.admin || null;
    res.locals.csrf = req.csrfToken || '';
    res.locals.path = req.path;
    res.locals.baseUrl = config.baseUrl;
    res.locals.canonical = config.baseUrl + req.path;
    res.locals.waLink = (text) => util.waLink(settings.whatsapp || settings.phone, text || settings.whatsapp_message);
    res.locals.telLink = util.telHref(settings.phone);
    res.locals.mapsLink = util.mapsLink(settings);
    res.locals.media = (rel) => (rel ? `/media/${rel}` : '');
    res.locals.title = '';
    res.locals.description = '';
    res.locals.ogImage = '';
    next();
  });

  // ---- visitor statistics (no personal data stored: just daily counters) ----
  const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|lighthouse|headless/i;
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.admin || req.path.startsWith('/admin') || BOT.test(req.headers['user-agent'] || '')) return next();
    const accept = req.headers.accept || '';
    if (!accept.includes('text/html')) return next();
    const cookies = req.headers.cookie || '';
    const isApp = req.query.source === 'app' || cookies.includes('rkd_app=1');
    if (req.query.source === 'app') res.cookie('rkd_app', '1', { maxAge: year, sameSite: 'lax', path: '/' });
    if (!cookies.includes('rkd_visit=1')) {
      res.cookie('rkd_visit', '1', { maxAge: 30 * 60 * 1000, sameSite: 'lax', path: '/', httpOnly: true });
      try {
        repo.recordVisit(isApp ? 'app' : 'web');
      } catch {
        /* stats are best effort */
      }
    }
    next();
  });

  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/public'));

  // ---- errors ----
  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/admin')) return res.render('admin/error', { title: 'Not found', message: 'This page does not exist.' });
    res.render('public/404', { title: 'Page not found' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File is too large.' });
    }
    if (err.type === 'entity.too.large') return res.status(413).send('Request too large');
    console.error(err);
    res.status(500);
    if ((req.headers.accept || '').includes('application/json')) return res.json({ error: 'Something went wrong. Please try again.' });
    try {
      res.render(req.path.startsWith('/admin') ? 'admin/error' : 'public/404', {
        title: 'Something went wrong',
        message: 'Something went wrong. Please try again.',
        serverError: true,
      });
    } catch {
      res.send('Something went wrong.');
    }
  });

  return app;
}

module.exports = { createApp };
