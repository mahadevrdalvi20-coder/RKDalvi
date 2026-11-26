'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('./db');
const config = require('./config');
const { randomToken, sha256 } = require('./util');

const COOKIE = 'rkd_admin';

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 11);
}

function verifyPassword(pw, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(String(pw || ''), hash);
}

function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOpts(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || req.secure,
    path: '/',
    maxAge: config.sessionMaxDays * 86400 * 1000,
  };
}

function createSession(req, res, adminId) {
  const token = randomToken(32);
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, admin_id, csrf, created_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?, ?)').run(
    sha256(token),
    adminId,
    randomToken(24),
    now,
    now,
    String(req.headers['user-agent'] || '').slice(0, 200)
  );
  db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(adminId);
  res.cookie(COOKIE, token, cookieOpts(req));
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

// Loads req.admin if a valid, non-idle session cookie exists.
function loadSession(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return next();
  const th = sha256(token);
  const s = db
    .prepare(
      `SELECT s.*, a.id AS aid, a.name, a.email, a.mobile, a.role, a.active, a.notify_email
       FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`
    )
    .get(th);
  const now = Date.now();
  if (!s) {
    res.clearCookie(COOKIE, { path: '/' });
    return next();
  }
  const idle = now - s.last_seen > config.sessionIdleMinutes * 60 * 1000;
  const tooOld = now - s.created_at > config.sessionMaxDays * 86400 * 1000;
  if (idle || tooOld || !s.active) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(th);
    res.clearCookie(COOKIE, { path: '/' });
    req.sessionExpired = true;
    return next();
  }
  if (now - s.last_seen > 30 * 1000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, th);
  req.admin = { id: s.aid, name: s.name, email: s.email, mobile: s.mobile, role: s.role, notify_email: s.notify_email };
  req.csrfToken = s.csrf;
  next();
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(401).json({ error: 'Your session has ended. Please log in again.' });
  }
  const nextUrl = encodeURIComponent(req.originalUrl);
  return res.redirect(`/admin/login?next=${nextUrl}${req.sessionExpired ? '&expired=1' : ''}`);
}

function requireOwner(req, res, next) {
  if (req.admin && req.admin.role === 'owner') return next();
  res.status(403).render('admin/error', { title: 'Not allowed', message: 'Only the owner account can do this.' });
}

// CSRF: every state-changing admin request must carry the session's token
// (form field _csrf or header X-CSRF-Token).
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.admin) return next();
  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || req.query._csrf;
  const ok =
    sent &&
    req.csrfToken &&
    sent.length === req.csrfToken.length &&
    crypto.timingSafeEqual(Buffer.from(String(sent)), Buffer.from(req.csrfToken));
  if (ok) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(403).json({ error: 'Security check failed. Please reload the page.' });
  }
  res.status(403).render('admin/error', { title: 'Security check failed', message: 'Please go back, reload the page and try again.' });
}

// ---- Password reset ----
function createResetToken(adminId) {
  const token = randomToken(32);
  db.prepare('DELETE FROM password_resets WHERE admin_id = ?').run(adminId);
  db.prepare('INSERT INTO password_resets (token_hash, admin_id, expires) VALUES (?, ?, ?)').run(sha256(token), adminId, Date.now() + 60 * 60 * 1000);
  return token;
}

function findResetToken(token) {
  const r = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token || ''));
  if (!r || r.used || r.expires < Date.now()) return null;
  return r;
}

function consumeResetToken(token, newPassword) {
  const r = findResetToken(token);
  if (!r) return false;
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), r.admin_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(r.token_hash);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(r.admin_id); // log out everywhere
  return true;
}

// ---- Mobile OTP ----
function createOtp(mobile) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare(
    'INSERT INTO otps (mobile, code_hash, expires, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(mobile) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0'
  ).run(mobile, sha256(`${mobile}:${code}`), Date.now() + 10 * 60 * 1000);
  return code;
}

function verifyOtp(mobile, code) {
  const r = db.prepare('SELECT * FROM otps WHERE mobile = ?').get(mobile);
  if (!r || r.expires < Date.now() || r.attempts >= 5) return false;
  if (r.code_hash !== sha256(`${mobile}:${String(code || '').trim()}`)) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE mobile = ?').run(mobile);
    return false;
  }
  db.prepare('DELETE FROM otps WHERE mobile = ?').run(mobile);
  return true;
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  validatePassword,
  createSession,
  destroySession,
  loadSession,
  requireAdmin,
  requireOwner,
  csrfProtect,
  createResetToken,
  findResetToken,
  consumeResetToken,
  createOtp,
  verifyOtp,
};
