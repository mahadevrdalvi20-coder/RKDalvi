'use strict';
// Runs the photo pipeline in "Vercel Blob" mode against an in-memory stand-in for @vercel/blob,
// to check that Blob URLs are stored, rendered and deleted correctly.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkd-blob-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_fake_token';

const store = new Map();
const fake = {
  async put(pathname, data, opts) {
    assert.equal(opts.access, 'public');
    const suffix = opts.addRandomSuffix ? '-' + Math.random().toString(36).slice(2, 8) : '';
    const url = `https://fakestore.public.blob.vercel-storage.com/${pathname.replace(/(\.\w+)$/, suffix + '$1')}`;
    store.set(url, Buffer.from(data));
    return { url, pathname };
  },
  async del(urls) {
    for (const u of [].concat(urls)) store.delete(u);
  },
  async list({ prefix }) {
    return { blobs: [...store.keys()].filter((u) => new URL(u).pathname.slice(1).startsWith(prefix)).map((u) => ({ url: u, pathname: new URL(u).pathname.slice(1), size: store.get(u).length })) };
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@vercel/blob') return fake;
  return origLoad.call(this, req, ...rest);
};
const realFetch = global.fetch;
global.fetch = async (u, ...rest) => (store.has(String(u)) ? new Response(store.get(String(u))) : realFetch(u, ...rest));

const sharp = require('sharp');
const media = require('../src/media');
const storage = require('../src/storage');
const { daily } = require('../src/backup');
const { close } = require('../src/db');

after(async () => {
  await close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('photos are stored in Blob and served by absolute URL', async () => {
  const img = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#704a2c' } }).jpeg().toBuffer();
  const r = await media.processProjectPhoto(img, { watermark: true, settings: { name: 'R. K. DALVI' } });
  for (const ref of [r.file, r.medium, r.thumb]) {
    assert.match(ref, /^https:\/\/fakestore\.public\.blob\.vercel-storage\.com\/media\/\d{4}\/\d{2}\//);
    assert.equal(storage.url(ref), ref);
    assert.ok(store.has(ref));
  }
  assert.equal(fs.existsSync(path.join(dataDir, 'media')), false, 'nothing written to local disk');
  await media.removeFiles(r.file, r.medium, r.thumb);
  assert.equal(store.has(r.file), false);
});

test('private files use unguessable paths and can be read back', async () => {
  const ref = await storage.savePrivate('plan.pdf', Buffer.from('%PDF test'), 'application/pdf');
  assert.match(ref, /\/private\/[\w-]{20,}\//);
  assert.equal((await storage.read(ref)).toString(), '%PDF test');
});

test('only our own Blob media URLs are accepted for videos', () => {
  assert.equal(storage.isOwnBlobUrl('https://abc.public.blob.vercel-storage.com/media/2026/11/video-x.mp4'), true);
  assert.equal(storage.isOwnBlobUrl('https://evil.example.com/media/x.mp4'), false);
  assert.equal(storage.isOwnBlobUrl('https://abc.public.blob.vercel-storage.com/private/x.mp4'), false);
});

test('daily backup goes to Blob', async () => {
  await daily();
  assert.ok([...store.keys()].some((u) => /\/private\/backups\/db-\d{4}-\d{2}-\d{2}/.test(u)));
});
