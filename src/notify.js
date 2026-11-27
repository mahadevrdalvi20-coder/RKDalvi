'use strict';
const nodemailer = require('nodemailer');
// web-push v4 is ESM-only: load it with import() (Vercel's runtime cannot require() ES modules).
let webpushPromise = null;
function loadWebpush() {
  if (!webpushPromise) webpushPromise = import('web-push').then((m) => m.default || m);
  return webpushPromise;
}
const config = require('./config');
const { db, getSettings, setSetting } = require('./db');
const { waLink } = require('./util');

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

// Keep a log of outgoing mail in dev/test so flows (password reset) can be checked without SMTP.
const outbox = [];

async function sendMail({ to, subject, text, html }) {
  if (!to || (Array.isArray(to) && !to.length)) return false;
  if (!transporter) {
    outbox.push({ to, subject, text });
    if (outbox.length > 50) outbox.shift();
    if (config.env !== 'test') console.log(`[mail:not-configured] To: ${to} | ${subject}\n${text}\n`);
    return false;
  }
  try {
    await transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
    return true;
  } catch (e) {
    console.error('[mail] failed:', e.message);
    return false;
  }
}

// VAPID keys: from env, otherwise generated once and stored in settings so push works out of the box.
async function vapidKeys() {
  if (config.vapid.publicKey && config.vapid.privateKey) return config.vapid;
  const s = await getSettings();
  if (s.vapid_public && s.vapid_private) return { publicKey: s.vapid_public, privateKey: s.vapid_private, subject: config.vapid.subject };
  const webpush = await loadWebpush();
  const k = webpush.generateVAPIDKeys();
  await setSetting('vapid_public', k.publicKey);
  await setSetting('vapid_private', k.privateKey);
  return { publicKey: k.publicKey, privateKey: k.privateKey, subject: config.vapid.subject };
}

async function pushPublicKey() {
  return (await vapidKeys()).publicKey;
}

async function sendPushToAdmins(payload) {
  const subs = await db.all('SELECT ps.* FROM push_subscriptions ps JOIN admins a ON a.id = ps.admin_id WHERE a.active = 1');
  if (!subs.length) return 0;
  const k = await vapidKeys();
  const webpush = await loadWebpush();
  webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400 });
        sent += 1;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
        else console.error('[push] failed:', e.statusCode || e.message);
      }
    })
  );
  return sent;
}

async function notifyNewEnquiry(enq) {
  const s = await getSettings();
  const url = `${config.baseUrl}/admin/enquiries/${enq.id}`;
  const lines = [
    `New enquiry #${enq.id} from the website / app`,
    '',
    `Name: ${enq.name}`,
    `Mobile: ${enq.mobile}`,
    enq.email ? `Email: ${enq.email}` : null,
    `Client type: ${enq.client_type}`,
    `Service: ${enq.service}`,
    `City: ${enq.city}`,
    enq.budget ? `Budget: ${enq.budget}` : null,
    enq.start_date ? `Expected start: ${enq.start_date}` : null,
    enq.project_title ? `Interested in a project like: ${enq.project_title}` : null,
    enq.message ? `\nMessage:\n${enq.message}` : null,
    '',
    `Open in admin: ${url}`,
    `WhatsApp them: ${waLink(enq.mobile, `Hello ${enq.name}, this is ${s.name}. Thank you for your enquiry.`)}`,
  ].filter((l) => l !== null);

  const adminEmails = (await db.all('SELECT email FROM admins WHERE active = 1 AND notify_email = 1 AND email IS NOT NULL')).map((r) => r.email);
  const to = [...new Set([...config.notifyEmails, ...adminEmails])];

  await Promise.allSettled([
    sendMail({ to: to.join(', '), subject: `New enquiry: ${enq.name} — ${enq.service}, ${enq.city}`, text: lines.join('\n') }),
    sendPushToAdmins({
      title: `New enquiry from ${enq.name}`,
      body: `${enq.service} · ${enq.city} · ${enq.client_type}`,
      url: `/admin/enquiries/${enq.id}`,
      tag: `enquiry-${enq.id}`,
    }),
  ]);
}

async function sendSms(mobile, text) {
  if (!config.smsEnabled) {
    if (config.env !== 'test') console.log(`[sms:not-configured] To +91${mobile}: ${text}`);
    return !config.isProd;
  }
  const { sid, token, from } = config.twilio;
  const body = new URLSearchParams({ To: `+91${mobile}`, From: from, Body: text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) console.error('[sms] failed:', r.status, await r.text());
  return r.ok;
}

module.exports = { sendMail, sendSms, notifyNewEnquiry, sendPushToAdmins, pushPublicKey, outbox, mailConfigured: () => Boolean(transporter) };
