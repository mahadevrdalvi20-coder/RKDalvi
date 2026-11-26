'use strict';
// Vercel serverless entry: every request is routed here (see vercel.json).
const { createApp } = require('../src/app');

module.exports = createApp();
