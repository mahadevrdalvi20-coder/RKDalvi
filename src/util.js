'use strict';
const crypto = require('crypto');

function slugify(str) {
  return (
    String(str || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}

async function uniqueSlug(db, table, base, excludeId) {
  let slug = slugify(base);
  let i = 1;
  while (await db.get(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`, slug, excludeId || 0)) {
    i += 1;
    slug = `${slugify(base)}-${i}`;
  }
  return slug;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Indian mobile numbers: accept "+91 98765 43210", "09876543210", "9876543210" -> "9876543210"
function normalizeMobile(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

function isValidMobile(input) {
  return /^[6-9]\d{9}$/.test(normalizeMobile(input));
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));
}

// digits only, with country code, for wa.me links
function waNumber(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d;
}

function telHref(input) {
  const d = String(input || '').replace(/[^\d+]/g, '');
  return `tel:${d}`;
}

function waLink(number, text) {
  return `https://wa.me/${waNumber(number)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

function mapsLink(settings) {
  const q = settings.map_query || settings.address || settings.name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// SQLite datetime('now') strings are UTC "YYYY-MM-DD HH:MM:SS"
function parseDbDate(s) {
  if (!s) return null;
  return new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
}

function fmtDate(s, opts) {
  const d = s instanceof Date ? s : parseDbDate(s);
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata', ...opts });
}

function fmtDateTime(s) {
  const d = s instanceof Date ? s : parseDbDate(s);
  if (!d || isNaN(d)) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function timeAgo(s) {
  const d = parseDbDate(s);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} days ago`;
  return fmtDate(s);
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function splitList(s) {
  return String(s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Simple in-memory fixed-window rate limiter (single-process use only; see auth.rateLimit).
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return function check(key) {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.count += 1;
    return h.count <= max;
  };
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Protect against CSV/formula injection when opened in Excel
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = {
  slugify,
  uniqueSlug,
  randomToken,
  sha256,
  normalizeMobile,
  isValidMobile,
  isValidEmail,
  waNumber,
  waLink,
  telHref,
  mapsLink,
  today,
  parseDbDate,
  fmtDate,
  fmtDateTime,
  timeAgo,
  truncate,
  splitList,
  rateLimiter,
  csvCell,
};

// Wrap an async Express handler so errors reach the error middleware.
module.exports.ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
