'use strict';
// Plain-HTML pages used when the app cannot start or reach its database, so problems are
// visible in the browser instead of Vercel's generic "FUNCTION_INVOCATION_FAILED" screen.
// Shows only yes/no for settings — never secret values.

function settingsStatus() {
  const e = process.env;
  return [
    ['Database (Turso) connected', Boolean(e.TURSO_DATABASE_URL || e.LIBSQL_URL), 'Vercel → Storage → create/connect a Turso database'],
    ['Database token present', Boolean(e.TURSO_AUTH_TOKEN || e.LIBSQL_AUTH_TOKEN), 'Added automatically when Turso is connected'],
    ['File storage (Vercel Blob) connected', Boolean(e.BLOB_READ_WRITE_TOKEN), 'Vercel → Storage → create/connect a Blob store'],
    ['CRON_SECRET set', Boolean(e.CRON_SECRET), 'Settings → Environment Variables (any long random text)'],
    ['Email (SMTP) set', Boolean(e.SMTP_HOST), 'Optional — for enquiry emails and password reset'],
  ];
}

function esc(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}

function setupPage(title, err) {
  const rows = settingsStatus()
    .map(([k, ok, hint]) => `<tr><td>${ok ? '✅' : '❌'}</td><td>${esc(k)}</td><td>${ok ? '' : esc(hint)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f7f1e8;color:#2a211b;margin:0;padding:24px}main{max-width:720px;margin:auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 8px 24px rgba(0,0,0,.08)}
h1{color:#4a2e1b;font-size:1.5rem}table{border-collapse:collapse;width:100%}td{padding:8px;border-bottom:1px solid #eee;vertical-align:top}code{background:#f3ece2;padding:2px 6px;border-radius:6px;word-break:break-word}</style></head>
<body><main><h1>${esc(title)}</h1>
<p>The website is installed, but it could not start properly. Check the settings below in your Vercel project, then <strong>Redeploy</strong>.</p>
<table>${rows}</table>
${err ? `<p><strong>Technical message:</strong> <code>${esc(String(err.message || err).slice(0, 400))}</code></p>` : ''}
<p style="color:#84776c;font-size:.9rem">Node ${esc(process.version)} · this page is shown only while the site has a setup problem.</p></main></body></html>`;
}

module.exports = { settingsStatus, setupPage };
