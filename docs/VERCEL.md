# Deploying on Vercel

On Vercel the app runs as a serverless function. Vercel servers do not keep files, so
the app stores its data in two Vercel storage add-ons:

| What | Where on Vercel | Env variables (added automatically) |
|---|---|---|
| Database (projects, enquiries, settings, admins) | **Turso** (hosted SQLite, from the Vercel Marketplace) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` |
| Photos, videos, enquiry attachments, daily backups | **Vercel Blob** | `BLOB_READ_WRITE_TOKEN` |

Both have free tiers that are enough to start (Turso: 5 GB; Blob: a few GB, then pay-as-you-go).

> **Plan note:** Vercel's free *Hobby* plan is for personal, non-commercial use. For a business
> website, Vercel expects the **Pro** plan (US$20/month). Check Vercel's current pricing page.

## Step by step (all in the browser, ~15 minutes)

1. **Import the project.** Go to vercel.com → *Add New… → Project* → import the GitHub repository
   `RKDalvi`. Framework preset: **Other**. Leave the build settings empty
   (`vercel.json` configures everything). Click **Deploy**. The first deploy works but shows a warning in the logs
   until steps 2–3 are done.
2. **Add the database.** In the project: *Storage → Create Database → Turso* (Marketplace).
   Pick the region closest to your customers (**Mumbai / ap-south-1**), create it, and **connect it to this project**
   for all environments.
3. **Add file storage.** *Storage → Create → Blob* → create a store (region Mumbai if offered) →
   **connect it to this project**.
4. **Environment variables** (*Settings → Environment Variables*):
   - `CRON_SECRET` — any long random text (e.g. 32 random letters/numbers). Required for the daily backup job.
   - `BASE_URL` — your final address, e.g. `https://rkdalvi.com` (after adding the domain in step 7).
   - Email alerts (recommended): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `NOTIFY_EMAILS`.
   - Optional: `TWILIO_*` (mobile OTP login), `GA_MEASUREMENT_ID`, `ANDROID_SHA256_FINGERPRINTS` (after building the Play app).
5. **Redeploy** (*Deployments → … → Redeploy*) so the new variables are used.
6. Open `https://<your-project>.vercel.app/admin` and **create the owner account immediately**
   (until you do, anyone who opens that page could create it).
7. **Custom domain:** *Settings → Domains* → add `rkdalvi.com` and follow the DNS instructions.
   Then set `BASE_URL` to it and redeploy.

Every push to the repository's production branch redeploys automatically.

## What is different from running on your own server

- **Videos** upload straight from the phone to Vercel Blob (up to 50 MB), because Vercel
  limits normal requests to 4.5 MB. Photos are compressed on the phone before upload, so they fit.
- **Enquiry attachments** from visitors are compressed in the browser; up to ~4 MB in total per enquiry.
  They are stored under long random, unlisted addresses and only shown inside the admin.
- **Daily backup**: a Vercel Cron job (03:00 IST) saves a JSON copy of the whole database to Blob
  (`private/backups/`, last 14 kept) and clears expired logins. Turso also keeps its own point-in-time backups.
  Photos live in Blob storage, which is already durable.
  To restore: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run restore -- <backup URL>`.
- **Create / reset an admin from your computer:**
  `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run create-admin -- --email you@x.com --password "newpass123"`

## Checking it works

- `https://<site>/robots.txt` loads → the app is running.
- Log in to `/admin`, add a project with a photo, publish → it appears on `/work`.
- *Vercel → Logs*: there should be no `TURSO_DATABASE_URL is not set` warning.
- *Settings → Cron Jobs*: `/api/cron/daily` is listed; you can click **Run** to test it.
