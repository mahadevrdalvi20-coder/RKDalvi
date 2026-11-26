'use strict';
// Called by Vercel Cron once a day (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { daily } = require('../backup');

const router = express.Router();

router.get('/daily', async (req, res) => {
  const sent = String(req.headers.authorization || '');
  const expected = `Bearer ${config.cronSecret}`;
  const ok = config.cronSecret && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const backup = await daily();
    res.json({ ok: true, backup: config.useBlob ? 'saved to Blob' : backup });
  } catch (e) {
    console.error('[cron]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
