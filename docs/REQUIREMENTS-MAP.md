# SRS v1.0 → implementation map

✅ done · ⚙️ done, needs an account/key at deployment · ➖ outside the code (owner/Play Store)

## 2. Public side
| SRS | Status | Where |
|---|---|---|
| 2.1 Logo, name, tagline, featured slideshow, View Work / Call / WhatsApp / Quote buttons, highlights | ✅ | `views/public/home.ejs` |
| 2.2 Project grid (cover, name, category, location), category filter (admin-editable), search, newest-first sort | ✅ | `/work`, `src/repo.js` |
| 2.3 Title, category, location, year, optional client, description/materials/pieces/duration, swipe + full-screen + pinch-zoom gallery, Before/After, videos, “Enquire about a similar project” pre-filled, Share | ✅ | `views/public/project.ejs`, PhotoSwipe |
| 2.4 Services with icon/photo + description, linked to projects | ✅ | `/services`, `/services/:slug` |
| 2.5 Story, founder, workshop photos, team, major clients, GST/MSME (optional) | ✅ | `/about` |
| 2.6 Enquiry form — all 10 fields incl. 5 attachments, validation, thank-you, Call / WhatsApp with ready message / Email, address + Google Maps, hours, social links | ✅ | `/contact`, `src/routes/public.js` |
| 2.7 Testimonials with rating, admin-managed | ✅ | Settings → Testimonials |

## 3. Admin side
| SRS | Status | Where |
|---|---|---|
| 3.1 Email + password login | ✅ | `/admin/login` |
| 3.1 Mobile + OTP login | ⚙️ | needs Twilio SMS keys (`TWILIO_*`) |
| 3.1 No public sign-up, second admin add/remove, forgot password, auto-logout | ✅ (reset email ⚙️ SMTP) | `src/auth.js`, Settings → Admins |
| 3.2 Add project with all fields + show/hide client switch, multi-photo / camera upload, cover, drag reorder, captions, Before/After, videos ≤ 50 MB, compression + full-quality view, watermark, draft/publish/hide, featured, delete with confirmation, progress bar + retry | ✅ | `views/admin/project-edit.ejs`, `public/js/admin-project.js`, `src/media.js` |
| 3.3 Categories, services, About, contact, hours, social, highlights, testimonials, client logos | ✅ | Settings |
| 3.4 Enquiry list, tap to call/WhatsApp, statuses, private notes, CSV export | ✅ | `/admin/enquiries` |
| 3.4 Instant notification | ✅ push · ⚙️ email (SMTP) | `src/notify.js` |
| 3.5 Dashboard: projects, photos, enquiries this month, most viewed, visits / app opens | ✅ | `/admin` (Play downloads come from Play Console) |

## 4–6. Screens, data, non-functional
| SRS | Status | Notes |
|---|---|---|
| Screens 1–14 | ✅ | Splash = Android TWA splash screen |
| §5 data model | ✅ | `src/db.js` (all listed fields) |
| Speed: thumbnails first, full photos on tap | ✅ | 560 px / 1280 px WebP + 2560 px JPEG; lazy loading; service-worker caching |
| Security: HTTPS, admin-only writes, private enquiries, spam protection | ✅ | CSP/HSTS, CSRF, bcrypt, rate limits, honeypot + timing check; covered by tests |
| Ease of use: large buttons, < 2 min upload | ✅ | 48 px+ touch targets; client-side resize; test uploads 20 photos |
| Language: English now, more later | ✅ | text kept in templates, ready for translation |
| Device support: Android 8+, all modern browsers, phone/tablet/laptop | ✅ | responsive, TWA min SDK 21 |
| Daily backup | ✅ DB automatic · ⚙️ off-site copy (see DEPLOY.md) | `src/backup.js` |
| Privacy policy page | ✅ | `/privacy` |
| SEO | ✅ | sitemap, robots, meta/OG, JSON-LD, clean URLs |

## 8. Phases
Phase 1 and Phase 2 are fully implemented. From Phase 3: videos, Excel export and multiple
admins are done; iOS is available as a home-screen web app (App Store wrapper later);
Marathi/Hindi/Konkani and 3D/360° views are not yet built.

## 10. Acceptance checklist
| Item | Verified by |
|---|---|
| Log in, create project, upload 20+ photos, publish < 2 min | `test/app.test.js` + browser run (6 photos published in ~2.5 s locally) |
| Published project visible within seconds | test |
| Filter by category, full-screen photos | test + browser |
| Enquiry sends instant alert and appears in admin | test (email alert) |
| Call / WhatsApp open correctly on Android | `tel:` and `wa.me` links (verify on a real phone) |
| Visitors cannot reach admin or enquiry data | test |
| Live on Google Play | ➖ follow `docs/ANDROID.md` |
