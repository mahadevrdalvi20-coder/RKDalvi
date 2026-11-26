# Deploying R. K. DALVI on your own server

> Using Vercel? Follow [VERCEL.md](VERCEL.md) instead.

The app is a single Node.js process that stores everything (database, photos, backups)
in one folder, `DATA_DIR`. Any host works as long as that folder is on a **persistent disk**.

## What you need

- A domain, e.g. `rkdalvi.com` or `rkdalvi.in` (SRS §9).
- A host: a small VPS (DigitalOcean / Hetzner / AWS Lightsail / Hostinger VPS, 1 GB RAM, 25+ GB disk)
  **or** a managed platform with a persistent disk (Render, Railway, Fly.io).
- An email account for sending alerts (Gmail with an App Password, Zoho Mail, Brevo, Amazon SES…).

## Option A — VPS with Docker (recommended)

1. Create the server (Ubuntu 24.04), install Docker.
2. Point the domain's DNS **A record** to the server IP.
3. On the server:

```bash
git clone <this repository> rkdalvi
```

```bash
cd rkdalvi && cp .env.example .env && nano .env
```

   Set at least `BASE_URL=https://yourdomain`, and the `SMTP_*` values. Edit `rkdalvi.com`
   in `docker-compose.yml` to your domain.

```bash
docker compose up -d --build
```

4. Caddy obtains an HTTPS certificate automatically. Open `https://yourdomain/admin`
   to create the owner account.

Updating later:

```bash
git pull && docker compose up -d --build
```

## Option B — Without Docker

```bash
npm ci --omit=dev
```

```bash
NODE_ENV=production BASE_URL=https://yourdomain DATA_DIR=/var/rkdalvi PORT=3000 TRUST_PROXY=1 node server.js
```

Keep it running with `pm2` or a systemd service, and put nginx/Caddy in front for HTTPS.
Install `fonts-dejavu-core` so the photo watermark text renders.

## Option C — Render / Railway

- Create a Web Service from this repo (Docker or Node 22). Start command: `node server.js`.
- Attach a **persistent disk** mounted at `/data` and set `DATA_DIR=/data`.
- Set the environment variables from `.env.example` (`TRUST_PROXY=1`).

## Backups (SRS §6)

- A JSON backup of the database is written to `DATA_DIR/backups` every day automatically (last 14 kept).
- Photos are in `DATA_DIR/media` and must also be copied **off the server**. Simplest: a daily cron

```bash
0 3 * * * rclone copy /data remote:rkdalvi-backup
```

  (rclone can copy to Google Drive, Backblaze B2, S3…). Also turn on your VPS provider's disk snapshots.

**Restore:** `npm run restore -- /data/backups/db-YYYY-MM-DD.json` (and copy the `media` folder back).

## Email alerts

With SMTP configured, every new enquiry is emailed to all admins (they can switch it off
under *Settings → My account*) and to any addresses in `NOTIFY_EMAILS`. Password-reset
links use the same email settings.

## Push notifications

Work automatically once the site is on HTTPS: the owner opens the admin dashboard on their
phone and taps **Turn on notifications**. (Keys are generated and stored on first use.)

## Google search (SRS §6 SEO)

1. Add the site to [Google Search Console](https://search.google.com/search-console) and
   submit `https://yourdomain/sitemap.xml`.
2. Link the website in the Google Business profile.
3. In *Admin → Settings*, set the main city and the description shown in Google.

## Storage planning

Each photo is stored as ~0.5–1.5 MB full image + two small WebP versions. A few thousand
photos ≈ 5–10 GB. Videos are stored as uploaded (max 50 MB each). A 25–50 GB disk lasts a long time.
