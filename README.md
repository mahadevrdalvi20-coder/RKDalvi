# R. K. DALVI — Portfolio App, Website & Admin Panel

Digital portfolio for **R. K. DALVI** (Furniture • Hotel Contracts • Interior Décor).
The owner uploads photos of completed projects from a phone; hotel owners, builders,
architects and homeowners browse the work and contact the business by Call, WhatsApp
or the Get-a-Quote form.

**One codebase gives you all three platforms:**

| Platform | How |
|---|---|
| Website | This Node.js app, served on your domain (e.g. `rkdalvi.com`) |
| Android app | Same site packaged as a Trusted Web Activity for Google Play — see [docs/ANDROID.md](docs/ANDROID.md). Also installable straight from Chrome ("Add to Home screen") |
| iOS (phase 2) | Installable from Safari today ("Add to Home Screen"); App Store wrapper can be added later |

Every photo, project and setting the owner changes appears in the website and the app
at the same moment — there is only one source of content.

## Features

**Visitors (no login)** — Home with featured-project slideshow, highlights and quick
buttons (View Our Work / Call / WhatsApp / Get a Quote) · Portfolio grid with category
filter, search and sort · Project page with swipe/zoom full-screen gallery, before/after
slider, video walk-throughs, materials, “Enquire about a similar project” and Share ·
Services (each linked to its projects) · About Us (story, founder, workshop photos,
team, clients, testimonials, registrations) · Contact form with all SRS fields, up to 5
attachments, Google Maps, hours and social links · Privacy policy · sticky Call /
WhatsApp / Quote bar on phones · works offline for already-viewed pages.

**Owner / admin (hidden, secure login)** — First-run owner setup · email + password or
mobile + OTP login · forgot password · auto-logout after inactivity · add / disable /
remove extra admins · add projects and upload many photos at once (or with the camera),
compressed on the phone before upload, progress bar and automatic retry when the network
drops · drag to reorder, cover photo, captions, Before / After tags · videos up to 50 MB ·
optional watermark · Draft / Publish / Hide · Featured on Home · categories, services,
testimonials, clients, team, About Us, business info, highlights · enquiry list with
statuses (New → Contacted → Site Visit → Quotation Sent → Won / Lost), private notes,
one-tap Call / WhatsApp, attachments, Excel (CSV) export · instant alerts by phone push
notification and email · dashboard with counts, visits, app opens and most-viewed projects.

**Built-in quality** — HTTPS-ready security headers & CSP, CSRF protection, hashed
passwords, rate-limited login and enquiry form, honeypot + timing spam protection,
enquiry data and attachments visible only to admins, SEO (sitemap, meta/OpenGraph tags,
LocalBusiness structured data), images served as WebP thumbnails with full-quality
images on tap, automatic daily database backup.

See [docs/REQUIREMENTS-MAP.md](docs/REQUIREMENTS-MAP.md) for a line-by-line mapping to the SRS.

## Quick start (on a computer)

Requires **Node.js 22.13+**. Locally the database is a file in `data/` and photos are saved in
`data/media/` — no accounts needed.

```bash
npm install
```

```bash
npm run seed:demo   # optional: sample projects so you can see the design
```

```bash
npm start
```

Open http://localhost:3000 for the website and http://localhost:3000/admin to create the
owner account (first visit only). Delete the sample projects from the admin before going live.

Run the automated tests (they cover the Phase-1 acceptance checklist):

```bash
npm test
```

## Going live

- **Vercel** (recommended for this repo): see [docs/VERCEL.md](docs/VERCEL.md) — uses Turso for the
  database and Vercel Blob for photos.
- **Own server / Docker**: see [docs/DEPLOY.md](docs/DEPLOY.md) — everything is stored on the server's disk.

Then follow
[docs/ANDROID.md](docs/ANDROID.md) to publish the Play Store app, and give the owner
[docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md).

## Project layout

```
server.js               start-up for own server (cleanup + daily backups)
api/index.js            Vercel serverless entry (vercel.json routes everything here)
src/app.js              Express app, security headers, static files, visit stats
src/routes/public.js    website pages, enquiry form, sitemap, manifest
src/routes/admin.js     admin panel, upload API, enquiries, settings
src/db.js               libSQL / Turso database, schema + default content
src/storage.js          file storage: Vercel Blob or local disk
src/backup.js           daily cleanup + JSON backups (Vercel Cron or server timer)
src/media.js            photo compression, thumbnails, watermark, videos
src/notify.js           email, push notifications, SMS (OTP)
src/auth.js             sessions, CSRF, password reset, OTP
views/                  EJS templates (public/ and admin/)
public/                 CSS, JS, icons, service worker
scripts/                create-admin, seed-demo, make-icons
android/                Google Play (TWA) configuration
test/                   automated tests
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run create-admin -- --email a@b.com --name "Name" --password "pass1234"` | Create an admin or reset a forgotten password from the server |
| `npm run backup` | Save a JSON backup of the database now (also runs automatically every day) |
| `npm run restore -- <file or URL>` | Restore a JSON backup (overwrites the database) |
| `npm run build:client` | Rebuild the browser upload helper and copy vendor files into `public/` |
| `npm run icons` | Regenerate app icons |
