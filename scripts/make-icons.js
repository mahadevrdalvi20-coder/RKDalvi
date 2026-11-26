'use strict';
// Generates the app icons in public/img from a simple "RK" monogram.
// Run: node scripts/make-icons.js   (replace with the real logo later if desired)
const path = require('path');
const sharp = require('sharp');
const out = path.join(__dirname, '..', 'public', 'img');

function svg(size, { pad = 0, round = true } = {}) {
  const r = round ? size * 0.22 : 0;
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c3a21"/><stop offset="1" stop-color="#2b1a0f"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <rect x="${pad + inner * 0.1}" y="${pad + inner * 0.1}" width="${inner * 0.8}" height="${inner * 0.8}" rx="${inner * 0.12}" fill="none" stroke="#b8874b" stroke-width="${inner * 0.018}" opacity=".8"/>
  <text x="50%" y="${pad + inner * 0.63}" text-anchor="middle" font-family="DejaVu Serif, Georgia, serif" font-weight="700" font-size="${inner * 0.4}" fill="#e8cfa6" letter-spacing="${inner * 0.01}">RK</text>
  <text x="50%" y="${pad + inner * 0.79}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${inner * 0.085}" fill="#b8874b" letter-spacing="${inner * 0.03}">DALVI</text>
</svg>`;
}

(async () => {
  await sharp(Buffer.from(svg(512))).png().toFile(path.join(out, 'icon-512.png'));
  await sharp(Buffer.from(svg(192))).png().toFile(path.join(out, 'icon-192.png'));
  await sharp(Buffer.from(svg(512, { pad: 70, round: false }))).png().toFile(path.join(out, 'icon-maskable-512.png'));
  await sharp(Buffer.from(svg(64))).png().toFile(path.join(out, 'favicon.png'));
  // monochrome badge for Android notification bar
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><text x="50%" y="64" text-anchor="middle" font-family="DejaVu Serif" font-weight="700" font-size="46" fill="#fff">RK</text></svg>`;
  await sharp(Buffer.from(badge)).png().toFile(path.join(out, 'badge-96.png'));
  console.log('Icons written to', out);
})();
