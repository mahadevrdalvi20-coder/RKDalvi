'use strict';
// Vercel serverless entry: every request is routed here (see vercel.json).
const { setupPage } = require('../src/diagnostics');

// Never let a stray promise rejection kill the function; log it instead.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

let handler;
try {
  handler = require('../src/app').createApp();
} catch (e) {
  console.error('[startup] failed:', e);
  handler = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(setupPage('Website could not start', e));
  };
}

module.exports = handler;
