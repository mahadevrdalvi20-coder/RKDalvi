'use strict';
// Fills an EMPTY install with sample projects, testimonials and clients so the
// site can be previewed before real photos are uploaded. Images are generated
// placeholders. Delete the demo projects from the admin panel when going live.
const sharp = require('sharp');
const { db, ready } = require('../src/db');
const util = require('../src/util');
const { processProjectPhoto } = require('../src/media');


const PALETTES = [
  ['#6b4226', '#c89b6d', '#f3e6d3'], ['#3d2b1f', '#a47148', '#e9d8c4'], ['#4e3b31', '#b5835a', '#efe1cf'],
  ['#2f3e46', '#a3866a', '#ece4d8'], ['#5a3e2b', '#d4a373', '#faedcd'], ['#36454f', '#c2a383', '#f1e9de'],
];

// A simple "room" illustration: floor, wall, panelling, a bed/sofa block and a lamp.
function roomSvg(i, label, w = 1600, h = 1200) {
  const [dark, mid, light] = PALETTES[i % PALETTES.length];
  const variant = i % 3;
  const panels = Array.from({ length: 9 }, (_, k) => `<rect x="${80 + k * 160}" y="160" width="140" height="520" rx="6" fill="${mid}" opacity="${0.18 + (k % 2) * 0.08}"/>`).join('');
  const furniture = [
    `<rect x="380" y="560" width="840" height="230" rx="26" fill="${dark}"/><rect x="420" y="500" width="760" height="120" rx="30" fill="${light}"/><rect x="440" y="470" width="220" height="90" rx="22" fill="#fff" opacity=".85"/><rect x="940" y="470" width="220" height="90" rx="22" fill="#fff" opacity=".85"/><rect x="230" y="600" width="120" height="190" rx="10" fill="${mid}"/><rect x="1250" y="600" width="120" height="190" rx="10" fill="${mid}"/>`,
    `<rect x="300" y="600" width="1000" height="180" rx="40" fill="${mid}"/><rect x="330" y="520" width="940" height="130" rx="40" fill="${dark}"/><rect x="620" y="820" width="360" height="40" rx="20" fill="${dark}"/><circle cx="800" cy="800" r="70" fill="${light}"/>`,
    `<rect x="250" y="480" width="1100" height="60" rx="10" fill="${dark}"/><rect x="290" y="540" width="40" height="260" fill="${dark}"/><rect x="1270" y="540" width="40" height="260" fill="${dark}"/>${[0, 1, 2, 3].map((k) => `<rect x="${330 + k * 250}" y="600" width="130" height="200" rx="18" fill="${mid}"/><rect x="${330 + k * 250}" y="560" width="130" height="60" rx="18" fill="${light}"/>`).join('')}`,
  ][variant];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1600 1200">
    <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${mid}" stop-opacity=".55"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".3" r=".6"><stop offset="0" stop-color="#fff6e0" stop-opacity=".9"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></radialGradient></defs>
    <rect width="1600" height="820" fill="url(#wall)"/>${panels}
    <rect y="820" width="1600" height="380" fill="url(#floor)"/>
    ${Array.from({ length: 12 }, (_, k) => `<line x1="${k * 150}" y1="820" x2="${k * 150 - 200}" y2="1200" stroke="${dark}" stroke-opacity=".25" stroke-width="3"/>`).join('')}
    <ellipse cx="800" cy="300" rx="700" ry="320" fill="url(#glow)"/>
    <line x1="800" y1="0" x2="800" y2="120" stroke="${dark}" stroke-width="4"/><path d="M740 120h120l-30 60h-60z" fill="${light}" stroke="${dark}" stroke-width="3"/>
    ${furniture}
    <rect x="0" y="1110" width="1600" height="90" fill="#000" opacity=".25"/>
    <text x="60" y="1170" font-family="DejaVu Sans, Arial" font-size="40" fill="#fff" opacity=".9">${label}</text>
  </svg>`;
}

const DEMO = [
  ['The Seaside Resort — 32 Guest Rooms', 'hotels-resorts', 'Candolim, Goa', 2025, ['hotel-room-furniture', 'wardrobes', 'wall-panelling'], 'Teak, Marine plywood, Walnut veneer, Fabric upholstery', '32 rooms, 4 suites', '4 months',
    'Complete guest-room furniture package for a boutique beach resort: upholstered bed back panels, king beds, wardrobes with soft-close hardware, writing desks, TV units and luggage racks. All pieces were manufactured in our workshop and installed room-by-room while the hotel stayed partly operational.'],
  ['Grand Lobby & Reception', 'hotels-resorts', 'Panaji, Goa', 2024, ['lobby-reception', 'false-ceiling', 'wall-panelling'], 'Teak veneer, Brass inlay, Granite, Gypsum', 'Reception counter, lounge seating for 24', '10 weeks',
    'A warm, welcoming lobby with a 7-metre curved reception counter in teak veneer with brass inlay, fluted wall panelling, a cove-lit false ceiling and custom lounge seating.'],
  ['Coastal Café & Bar', 'restaurants-cafes', 'Anjuna, Goa', 2025, ['restaurant-seating'], 'Mango wood, Cane, Laminate, MS frame', '80 covers, 1 bar counter', '6 weeks',
    'Booth seating, cane-back dining chairs, solid-wood tables and a laminate-clad bar counter designed for heavy daily use in a humid coastal climate.'],
  ['Villa Interiors — 4 BHK', 'residential', 'Porvorim, Goa', 2024, ['modular-kitchens', 'wardrobes', 'turnkey-interiors'], 'BWR plywood, Acrylic, Veneer, Quartz', '4 bedrooms, kitchen, living', '3 months',
    'Turnkey interiors for a family villa: modular kitchen with quartz counters, floor-to-ceiling wardrobes, a TV wall, pooja unit and custom beds.'],
  ['Corporate Office Fit-out', 'offices', 'Verna, Goa', 2023, ['turnkey-interiors', 'false-ceiling'], 'Laminate, Glass, Aluminium, Acoustic panels', '60 workstations, 4 cabins', '8 weeks',
    'Workstations, manager cabins, a conference room with acoustic panelling and a reception area for a growing technology company.'],
  ['Heritage Hotel Restaurant', 'restaurants-cafes', 'Old Goa', 2023, ['restaurant-seating', 'wall-panelling'], 'Solid teak, Rattan, Leather', '120 covers', '2 months',
    'Classic Indo-Portuguese inspired dining furniture in solid teak with rattan detailing for a heritage property restaurant.'],
];

(async () => {
  await ready;
  if ((await db.one('SELECT COUNT(*) FROM projects')) > 0) {
    console.log('Projects already exist — demo data not added.');
    process.exit(0);
  }
  const cats = Object.fromEntries((await db.all('SELECT slug, id FROM categories')).map((c) => [c.slug, c.id]));
  const svcs = Object.fromEntries((await db.all('SELECT slug, id FROM services')).map((c) => [c.slug, c.id]));
  for (const [idx, d] of DEMO.entries()) {
    const [title, cat, loc, year, services, materials, pieces, duration, desc] = d;
    const info = await db.run(
      `INSERT INTO projects (title, slug, category_id, location, year, description, materials, pieces, duration, featured, status, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', datetime('now', ?), datetime('now', ?))`,
      title, await util.uniqueSlug(db, 'projects', title), cats[cat], loc, year, desc, materials, pieces, duration, idx < 4 ? 1 : 0, `-${idx} days`, `-${idx} days`
    );
    const pid = info.lastInsertRowid;
    for (const s of services) await db.run('INSERT INTO project_services (project_id, service_id) VALUES (?, ?)', pid, svcs[s]);
    const n = 5 + (idx % 3);
    for (let k = 0; k < n; k++) {
      const buf = await sharp(Buffer.from(roomSvg(idx + k, `Sample photo ${k + 1} — replace with real project photos`))).jpeg({ quality: 90 }).toBuffer();
      const r = await processProjectPhoto(buf, { watermark: k % 2 === 0, settings: { name: 'R. K. DALVI' } });
      const tag = idx === 0 && k === n - 2 ? 'before' : idx === 0 && k === n - 1 ? 'after' : 'normal';
      await db.run(
        "INSERT INTO media (project_id, kind, file, medium, thumb, width, height, sort_order, bytes, tag, caption) VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        pid, r.file, r.medium, r.thumb, r.width, r.height, k, r.bytes, tag, k === 0 ? 'Overview' : ''
      );
    }
    console.log('Added demo project:', title);
  }
  const T = 'INSERT INTO testimonials (client_name, business, text, rating, sort_order) VALUES (?, ?, ?, ?, ?)';
  await db.run(T, 'Sample Client', 'Seaside Resort (sample)', 'The furniture quality is excellent and the team finished all rooms on schedule. Highly recommended for hotel projects.', 5, 0);
  await db.run(T, 'Sample Architect', 'Design Studio (sample)', 'Very good finishing and they follow drawings exactly. Easy to coordinate with on site.', 5, 1);
  await db.run(T, 'Sample Homeowner', 'Villa owner (sample)', 'Our kitchen and wardrobes look beautiful. Good material and fair pricing.', 4, 2);
  for (const [i, n] of ['Seaside Resort', 'Heritage Hotel', 'Coastal Café', 'TechPark Offices'].entries()) await db.run('INSERT INTO clients (name, sort_order) VALUES (?, ?)', n, i);
  console.log('Demo data added. Replace with real projects from /admin.');
  process.exit(0);
})();
