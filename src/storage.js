'use strict';
// File storage. Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production on Vercel),
// otherwise the local disk under DATA_DIR (development / VPS).
//
// Stored references:
//   - public files: a full https:// Blob URL, or a local key like "2026/11/abc-full.jpg" (served at /media/<key>)
//   - private files (enquiry attachments, backups): a Blob URL under an unguessable path, or "private:<key>"
//     Private files are never linked publicly; admins download them through a server route.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { randomToken } = require('./util');

let blob = null;
function blobLib() {
  if (!blob) blob = require('@vercel/blob');
  return blob;
}

const isRemote = (ref) => /^https?:\/\//.test(String(ref || ''));

function datedKey(name) {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${name}`;
}

async function savePublic(key, data, contentType) {
  if (config.useBlob) {
    const r = await blobLib().put(`media/${key}`, data, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
      token: config.blobToken,
    });
    return r.url;
  }
  const p = path.join(config.mediaDir, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, data);
  return key;
}

async function savePrivate(name, data, contentType) {
  const key = `${randomToken(24)}/${String(name).replace(/[^\w.-]+/g, '_').slice(-80) || 'file'}`;
  if (config.useBlob) {
    const r = await blobLib().put(`private/${key}`, data, { access: 'public', contentType, addRandomSuffix: true, token: config.blobToken });
    return r.url;
  }
  const p = path.join(config.privateDir, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, data);
  return `private:${key}`;
}

// Read a stored file into a Buffer (used for watermark logo and private downloads).
async function read(ref) {
  if (!ref) return null;
  if (isRemote(ref)) {
    const r = await fetch(ref);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  const p = ref.startsWith('private:') ? path.join(config.privateDir, ref.slice(8)) : path.join(config.mediaDir, ref);
  const base = ref.startsWith('private:') ? config.privateDir : config.mediaDir;
  if (!path.resolve(p).startsWith(path.resolve(base))) return null;
  try {
    return await fs.promises.readFile(p);
  } catch {
    return null;
  }
}

async function remove(...refs) {
  const list = refs.flat().filter(Boolean);
  const remote = list.filter(isRemote);
  if (remote.length && config.useBlob) {
    try {
      await blobLib().del(remote, { token: config.blobToken });
    } catch (e) {
      console.error('[storage] delete failed:', e.message);
    }
  }
  for (const ref of list.filter((r) => !isRemote(r))) {
    const priv = ref.startsWith('private:');
    const base = priv ? config.privateDir : config.mediaDir;
    const p = path.resolve(base, priv ? ref.slice(8) : ref);
    if (p.startsWith(path.resolve(base))) fs.rm(p, { force: true }, () => {});
  }
}

// URL a browser can load for a public file.
function url(ref) {
  if (!ref) return '';
  return isRemote(ref) ? ref : `/media/${ref}`;
}

// Is this URL one of our own Blob store files? (validates client-side video uploads)
function isOwnBlobUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/.test(x.hostname) && x.pathname.startsWith('/media/');
  } catch {
    return false;
  }
}

// List & prune backups
async function listBackups() {
  if (config.useBlob) {
    const r = await blobLib().list({ prefix: 'private/backups/', token: config.blobToken, limit: 1000 });
    return r.blobs.map((b) => ({ ref: b.url, name: b.pathname, size: b.size, at: b.uploadedAt }));
  }
  const dir = config.backupDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => ({ ref: path.join(dir, f), name: f, size: fs.statSync(path.join(dir, f)).size }));
}

async function saveBackup(name, data) {
  if (config.useBlob) {
    const r = await blobLib().put(`private/backups/${name}`, data, { access: 'public', contentType: 'application/json', addRandomSuffix: true, token: config.blobToken });
    return r.url;
  }
  fs.mkdirSync(config.backupDir, { recursive: true });
  const p = path.join(config.backupDir, name);
  await fs.promises.writeFile(p, data);
  return p;
}

async function pruneBackups(keep) {
  const all = (await listBackups()).sort((a, b) => (a.name < b.name ? -1 : 1));
  const old = all.slice(0, Math.max(0, all.length - keep));
  if (!old.length) return;
  if (config.useBlob) await remove(old.map((b) => b.ref));
  else old.forEach((b) => fs.rmSync(b.ref, { force: true }));
}

module.exports = { savePublic, savePrivate, read, remove, url, isRemote, isOwnBlobUrl, datedKey, listBackups, saveBackup, pruneBackups };
