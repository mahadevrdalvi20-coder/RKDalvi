# Publishing the Android app on Google Play

The Android app is the website packaged as a **Trusted Web Activity (TWA)** — the same
technology used by many large brands' Play Store apps. It opens full-screen with no browser
bar, has its own icon and splash screen, supports push notifications, and always shows the
latest projects without app updates. Works on Android 8.0+ (SRS §6).

Prerequisites: the website is live on HTTPS at your domain, and a Google Play Developer
account (one-time US$25 fee).

## 1. Build the app bundle (on any computer with Node.js and Java 17)

```bash
npm install -g @bubblewrap/cli
```

```bash
cd android && bubblewrap init --manifest https://rkdalvi.com/manifest.webmanifest
```

Bubblewrap reads the web manifest and asks a few questions — use the values in
`android/twa-manifest.json` (package `com.rkdalvi.app`, theme colour `#4a2e1b`).
It also creates the signing key `android.keystore`. **Back up this file and its password
safely — you need it for every future update.**

```bash
bubblewrap build
```

This produces `app-release-bundle.aab` (upload to Play) and `app-release-signed.apk`
(install on a phone to test).

## 2. Connect the app to the website (removes the browser bar)

Get the SHA-256 fingerprint(s):

```bash
bubblewrap fingerprint list
```

If you use **Play App Signing** (default), also copy the *App signing key certificate*
SHA-256 from Play Console → Setup → App integrity.

Set them on the server, comma-separated, and restart:

```
ANDROID_PACKAGE=com.rkdalvi.app
ANDROID_SHA256_FINGERPRINTS=AA:BB:...,CC:DD:...
```

Check `https://rkdalvi.com/.well-known/assetlinks.json` shows them.

## 3. Play Console listing

- App name: **R. K. DALVI** · Category: *House & Home* (or *Business*)
- Short description: *Hotel furniture, interiors & décor — see our completed projects and get a quote.*
- Screenshots: take them on a phone from the app (Home, Our Work, a project, Get a Quote).
- Icon: `public/img/icon-512.png`; feature graphic 1024×500 (any project photo with the logo).
- **Privacy policy URL:** `https://rkdalvi.com/privacy` (required).
- Data safety form: the app collects *name, phone number, email (optional), and files the
  user chooses* only when the enquiry form is submitted, for "App functionality / customer
  support"; data is encrypted in transit; not shared with third parties; users can request deletion.
- Content rating questionnaire: no objectionable content.
- Upload the `.aab` to *Internal testing* first, install from the test link, then promote to *Production*.

## Updating the app

Content (projects, photos, services, contact details) **never needs an app update** — it
comes from the website. Rebuild only to change the icon, name or colours: increase
`appVersionCode` in `twa-manifest.json`, run `bubblewrap update && bubblewrap build`, upload.

## iOS (phase 2)

Today iPhone users can open the website in Safari → Share → *Add to Home Screen*, which
installs it like an app. For an App Store listing, the same site can be wrapped with
Capacitor or PWABuilder's iOS package (Apple Developer account, US$99/year).
