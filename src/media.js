'use strict';
const path = require('path');
const config = require('./config');
// Use the bundled font for watermark text on servers without system fonts (e.g. Vercel).
if (!process.env.FONTCONFIG_PATH) process.env.FONTCONFIG_PATH = path.join(config.root, 'assets', 'fonts');
const sharp = require('sharp');
const storage = require('./storage');
const { randomToken } = require('./util');

sharp.cache(false);
sharp.concurrency(2);

const FULL_MAX = 2560; // full-screen view, keeps photos sharp on any phone / laptop
const MEDIUM_MAX = 1280; // project page gallery
const THUMB_MAX = 560; // grids and cards

const newBase = () => storage.datedKey(randomToken(9));

function escXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

// Build a watermark overlay sized for an image of width w / height h.
async function watermarkOverlay(w, h, settings) {
  const logo = settings && settings.logo ? await storage.read(settings.logo) : null;
  if (logo) {
    const lw = Math.round(Math.min(w, h) * 0.22);
    const resized = await sharp(logo).resize({ width: lw }).ensureAlpha().toBuffer();
    const faded = await sharp(resized)
      .composite([{ input: Buffer.from([255, 255, 255, 140]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
      .png()
      .toBuffer();
    return { input: faded, gravity: 'southeast' };
  }
  const text = escXml((settings && settings.name) || 'R. K. DALVI');
  const fs_ = Math.max(16, Math.round(Math.min(w, h) * 0.04));
  const pad = Math.round(fs_ * 0.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <style>.t{font-family:'DejaVu Sans',sans-serif;font-weight:700;font-size:${fs_}px;letter-spacing:${Math.round(fs_ * 0.12)}px}</style>
    <text x="${w - pad}" y="${h - pad}" text-anchor="end" class="t" fill="#000" fill-opacity="0.35" transform="translate(1.5,1.5)">${text}</text>
    <text x="${w - pad}" y="${h - pad}" text-anchor="end" class="t" fill="#fff" fill-opacity="0.75">${text}</text>
  </svg>`;
  return { input: Buffer.from(svg), top: 0, left: 0 };
}

/**
 * Process an uploaded project photo: auto-rotate, strip metadata, create full / medium / thumb.
 * Returns stored references (Blob URLs or local keys).
 */
async function processProjectPhoto(input, { watermark = false, settings = {} } = {}) {
  const base = newBase();
  const full = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .toBuffer({ resolveWithObject: true });
  const { width: fw, height: fh } = full.info;
  if (!fw || !fh) throw new Error('Unsupported image');

  let p = sharp(full.data);
  if (watermark) p = p.composite([await watermarkOverlay(fw, fh, settings)]);
  const fullOut = await p.jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  const md = await sharp(fullOut).resize({ width: MEDIUM_MAX, height: MEDIUM_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const sm = await sharp(fullOut).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();

  const [file, medium, thumb] = await Promise.all([
    storage.savePublic(`${base}-full.jpg`, fullOut, 'image/jpeg'),
    storage.savePublic(`${base}-md.webp`, md, 'image/webp'),
    storage.savePublic(`${base}-sm.webp`, sm, 'image/webp'),
  ]);
  return { file, medium, thumb, width: fw, height: fh, bytes: fullOut.length };
}

// Generic site image (logo, team, testimonial, client logo, workshop photo)
async function processSiteImage(input, { maxWidth = 1600, keepAlpha = false, thumb = false } = {}) {
  const base = newBase();
  let p = sharp(input, { failOn: 'none' }).rotate().resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true });
  p = keepAlpha ? p.png({ compressionLevel: 9 }) : p.flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true });
  const out = await p.toBuffer();
  const file = await storage.savePublic(`${base}.${keepAlpha ? 'png' : 'jpg'}`, out, keepAlpha ? 'image/png' : 'image/jpeg');
  let thumbRef = null;
  if (thumb) {
    const t = await sharp(out).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
    thumbRef = await storage.savePublic(`${base}-sm.webp`, t, 'image/webp');
  }
  const meta = await sharp(out).metadata();
  return { file, thumb: thumbRef, width: meta.width, height: meta.height };
}

const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp' };

async function saveVideo(buffer, mime) {
  const file = await storage.savePublic(`${newBase()}.${VIDEO_EXT[mime] || 'mp4'}`, buffer, mime);
  return { file, bytes: buffer.length };
}

async function saveVideoPoster(input) {
  const out = await sharp(input, { failOn: 'none' }).resize({ width: MEDIUM_MAX, height: MEDIUM_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
  return storage.savePublic(`${newBase()}-poster.webp`, out, 'image/webp');
}

const removeFiles = (...refs) => storage.remove(...refs);

module.exports = { processProjectPhoto, processSiteImage, saveVideo, saveVideoPoster, removeFiles, VIDEO_EXT, newBase };
