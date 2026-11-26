'use strict';
// Copies third-party browser files from node_modules into public/ so they are deployed
// with the app (Vercel only ships files the server references). Run after upgrading packages.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'public', p);
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

for (const f of ['photoswipe.css', 'photoswipe.esm.min.js', 'photoswipe-lightbox.esm.min.js']) copy(nm(`photoswipe/dist/${f}`), out(`vendor/photoswipe/${f}`));
copy(nm('sortablejs/Sortable.min.js'), out('vendor/sortable/Sortable.min.js'));
for (const w of [400, 500, 600, 700]) copy(nm(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`), out(`fonts/inter/inter-latin-${w}-normal.woff2`));
for (const w of [600, 700]) copy(nm(`@fontsource/playfair-display/files/playfair-display-latin-${w}-normal.woff2`), out(`fonts/playfair/playfair-display-latin-${w}-normal.woff2`));
console.log('Vendor files copied to public/');
