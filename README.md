# Measurement App

Field-tech tool for capturing job-site measurements in GoHighLevel:
Jobs → Rooms → Walls / Islands / Lighting → Openings / Appliances /
Electrical / Plumbing, plus photo & video capture.

Same functionality as the original single-file build, reorganized into
plain HTML/CSS/JS files, with the GHL API key moved server-side.

## Structure

```
index.html                    Markup only
css/styles.css                Accessible dark theme (large type, high contrast)
js/api.js                     GHL API calls — routed through our own /api proxy
js/utils.js                   Shared helpers, accordion widget, dirty-state tracking
js/media.js                   Photo/video thumbnails, upload, cross-view sync
js/entities.js                Plumbing / Electrical / Appliance / Opening accordions
js/walls.js                   Wall / Island accordions (contain the above)
js/lighting.js                Lighting fixture accordion
js/app.js                     Screens, navigation, Jobs/Rooms, boot
netlify/functions/ghl-proxy.js  Serverless proxy — holds the GHL token server-side
netlify.toml                  Netlify build/redirect config
```

## Why a proxy function

The original build called `services.leadconnectorhq.com` directly from the
browser with the GHL Private Integration Token hardcoded in the JS — meaning
the key was visible to anyone who viewed page source. This build instead
calls `/api/*` (this site's own domain), which Netlify rewrites to the
`ghl-proxy` function. The function attaches the real token server-side, so
it's never shipped to the browser.

## Deploying on Netlify

1. Push this repo to GitHub (already connected: `Usmanshadeed1/Measurementapp`).
2. In Netlify: **Add new site → Import an existing project → GitHub** → select this repo.
   Build settings are read from `netlify.toml` automatically (no build command needed — static files + functions).
3. In **Site settings → Environment variables**, add:
   - `GHL_API_KEY` = your GHL Private Integration Token (`pit-...`)
4. Deploy. Netlify will build the function and serve `index.html` from the repo root.

## ⚠️ Rotate the old key

The key that was hardcoded in the original `index.html` (`pit-69110a9b-...`)
should be treated as compromised — anyone who ever viewed that page's source
had access to it. Generate a fresh Private Integration Token in GHL and use
that for `GHL_API_KEY` above; do not reuse the old one.

## Local development

This is static HTML/CSS/JS with a Netlify Function backend. To run it
locally with the function working, use the Netlify CLI:

```
npm install -g netlify-cli
netlify dev
```

This serves `index.html` and proxies `/api/*` to the local function, using
a `GHL_API_KEY` you set in a local `.env` file (already gitignored).
