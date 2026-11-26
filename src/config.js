'use strict';
const path = require('path');

const root = path.resolve(__dirname, '..');
const env = process.env;
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(root, 'data'));

function int(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

const config = {
  root,
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: int(env.PORT, 3000),
  // Public URL of the site, used in share links, sitemap, emails.
  baseUrl: (env.BASE_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',

  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'rkdalvi.db'),
  mediaDir: path.join(DATA_DIR, 'media'), // public: project photos, logos, etc.
  privateDir: path.join(DATA_DIR, 'private'), // enquiry attachments (admin only)
  backupDir: path.resolve(env.BACKUP_DIR || path.join(DATA_DIR, 'backups')),
  backupKeep: int(env.BACKUP_KEEP, 14),

  sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 120),
  sessionMaxDays: int(env.SESSION_MAX_DAYS, 30),

  maxVideoMB: int(env.MAX_VIDEO_MB, 50),
  maxImageMB: int(env.MAX_IMAGE_MB, 25),

  smtp: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || env.SMTP_USER || 'no-reply@localhost',
  },
  // Comma separated emails that receive new-enquiry alerts (in addition to admins who opted in).
  notifyEmails: (env.NOTIFY_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean),

  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  // SMS for mobile OTP login (Twilio). If not configured, OTP login is hidden in production
  // and codes are printed to the console in development.
  twilio: {
    sid: env.TWILIO_ACCOUNT_SID || '',
    token: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM || '',
  },

  // Android app (Trusted Web Activity) Digital Asset Links
  android: {
    packageName: env.ANDROID_PACKAGE || 'com.rkdalvi.app',
    sha256: (env.ANDROID_SHA256_FINGERPRINTS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  gaMeasurementId: env.GA_MEASUREMENT_ID || '',
};

config.smsEnabled = Boolean(config.twilio.sid && config.twilio.token && config.twilio.from);
config.otpEnabled = config.smsEnabled || !config.isProd;
config.pushEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);

module.exports = config;
