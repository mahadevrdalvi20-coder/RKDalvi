'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');
const { randomToken } = require('./util');

sharp.cache(false);
sharp.concurrency(2);

const FULL_MAX = 2560; // full-screen view, keeps photos sharp on any phone / laptop
const MEDIUM_MAX = 1280; // project page gallery
const THUMB_MAX = 560; // grids and cards

function newBase(dir = config.mediaDir) {
  const d = new Date();
  const sub = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return `${sub}/${randomToken(9)}`;
}

function abs(rel, dir = config.mediaDir) {
  return path.join(dir, rel);
}

function escXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

// Build a watermark overlay sized for an image of width w / height h.
async function watermarkOverlay(w, h, settings) {
  const logoRel = settings && settings.logo;
  if (logoRel && fs.existsSync(abs(logoRel))) {
    const lw = Math.round(Math.min(w, h) * 0.22);
    const logo = await sharp(abs(logoRel)).resize({ width: lw, withoutEnlargement: false }).ensureAlpha().toBuffer();
    // 55% opacity
    const faded = await sharp(logo)
      .composite([{ input: Buffer.from([255, 255, 255, 140]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
      .png()
      .toBuffer();
    return { input: faded, gravity: 'southeast', blend: 'over', top: undefined, left: undefined };
  }
  const text = escXml((settings && settings.name) || 'R. K. DALVI');
  const fs_ = Math.max(16, Math.round(Math.min(w, h) * 0.04));
  const pad = Math.round(fs_ * 0.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <style>.t{font-family:'DejaVu Sans','Liberation Sans',Arial,sans-serif;font-weight:700;font-size:${fs_}px;letter-spacing:${Math.round(fs_ * 0.12)}px}</style>
    <text x="${w - pad}" y="${h - pad}" text-anchor="end" class="t" fill="#000" fill-opacity="0.35" transform="translate(1.5,1.5)">${text}</text>
    <text x="${w - pad}" y="${h - pad}" text-anchor="end" class="t" fill="#fff" fill-opacity="0.75">${text}</text>
  </svg>`;
  return { input: Buffer.from(svg), top: 0, left: 0 };
}

/**
 * Process an uploaded project photo: auto-rotate, strip metadata, create full / medium / thumb.
 * Returns relative paths (under mediaDir).
 */
async function processProjectPhoto(input, { watermark = false, settings = {} } = {}) {
  const base = newBase();
  const img = sharp(input, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('Unsupported image');
  // After .rotate() orientation is applied; swap dims for EXIF orientations 5-8
  let w = meta.width;
  let h = meta.height;
  if (meta.orientation && meta.orientation >= 5) [w, h] = [h, w];

  const fullBuf = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .toBuffer({ resolveWithObject: true });
  const fw = fullBuf.info.width;
  const fh = fullBuf.info.height;

  let fullPipeline = sharp(fullBuf.data);
  if (watermark) fullPipeline = fullPipeline.composite([await watermarkOverlay(fw, fh, settings)]);
  const fullRel = `${base}-full.jpg`;
  const fullOut = await fullPipeline.jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  fs.writeFileSync(abs(fullRel), fullOut);

  // medium and thumb derived from the (watermarked) full image
  const mediumRel = `${base}-md.webp`;
  await sharp(fullOut).resize({ width: MEDIUM_MAX, height: MEDIUM_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(abs(mediumRel));
  const thumbRel = `${base}-sm.webp`;
  await sharp(fullOut).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toFile(abs(thumbRel));

  return { file: fullRel, medium: mediumRel, thumb: thumbRel, width: fw, height: fh, bytes: fullOut.length };
}

// Generic site image (logo, team, testimonial, client logo, workshop photo)
async function processSiteImage(input, { maxWidth = 1600, keepAlpha = false, thumb = false } = {}) {
  const base = newBase();
  const ext = keepAlpha ? 'png' : 'jpg';
  const rel = `${base}.${ext}`;
  let p = sharp(input, { failOn: 'none' }).rotate().resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true });
  p = keepAlpha ? p.png({ compressionLevel: 9 }) : p.flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true });
  await p.toFile(abs(rel));
  let thumbRel = null;
  if (thumb) {
    thumbRel = `${base}-sm.webp`;
    await sharp(abs(rel)).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toFile(abs(thumbRel));
  }
  return { file: rel, thumb: thumbRel };
}

const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp' };

function saveVideo(tmpPath, mime) {
  const base = newBase();
  const rel = `${base}.${VIDEO_EXT[mime] || 'mp4'}`;
  fs.renameSync(tmpPath, abs(rel));
  return { file: rel, bytes: fs.statSync(abs(rel)).size };
}

async function saveVideoPoster(input) {
  const base = newBase();
  const rel = `${base}-poster.webp`;
  await sharp(input, { failOn: 'none' }).resize({ width: MEDIUM_MAX, height: MEDIUM_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toFile(abs(rel));
  return rel;
}

function removeFiles(...rels) {
  for (const r of rels) {
    if (!r) continue;
    const p = abs(r);
    if (!p.startsWith(config.mediaDir)) continue;
    fs.rm(p, { force: true }, () => {});
  }
}

module.exports = { processProjectPhoto, processSiteImage, saveVideo, saveVideoPoster, removeFiles, abs, newBase, VIDEO_EXT };
