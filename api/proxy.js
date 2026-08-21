// api/proxy.js
//
// Vercel version of the GHL proxy. Same job as netlify/functions/ghl-proxy.js:
// the browser calls /api/<ghl path> on this domain, and the real Private
// Integration Token is attached here, server-side, so it never ships to the
// browser.
//
// Both proxies are kept in the repo so the project can be hosted on either
// platform. A rewrite in vercel.json sends every /api/* path here, so one
// function covers the whole GHL surface.
//
// Set GHL_API_KEY in Vercel: Project Settings -> Environment Variables.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export const config = {
  api: {
    // GHL media uploads are multipart. Parsing the body here would corrupt
    // them, so the raw bytes are forwarded untouched.
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: GHL_API_KEY is not set.' });
    return;
  }

  // The rewrite in vercel.json points every /api/* request at this one file,
  // which means req.url has already been rewritten to "/api/proxy" and the
  // real path is gone. Vercel preserves the original in x-forwarded-uri /
  // x-vercel-original-path, so read the path from there and only fall back
  // to req.url when running somewhere without a rewrite.
  let original = req.headers['x-forwarded-uri'] ||
                 req.headers['x-vercel-original-path'] ||
                 req.url || '/';
  let forwardPath = String(original);
  if (forwardPath.startsWith('/api')) forwardPath = forwardPath.slice(4);
  if (!forwardPath.startsWith('/')) forwardPath = '/' + forwardPath;
  // Guard against the rewrite target leaking through as a literal path.
  if (forwardPath === '/proxy' || forwardPath.startsWith('/proxy?')) {
    res.status(400).json({ error: 'Proxy could not read the original request path.' });
    return;
  }

  const headers = {
    Authorization: 'Bearer ' + apiKey,
    Version: GHL_VERSION,
  };

  const contentType = req.headers['content-type'] || '';
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  if (hasBody && contentType) headers['Content-Type'] = contentType;

  try {
    const body = hasBody ? await readRawBody(req) : undefined;

    const ghlRes = await fetch(GHL_API + forwardPath, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
    });

    const text = await ghlRes.text();
    res.status(ghlRes.status);
    res.setHeader('Content-Type', ghlRes.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: 'Upstream request to GHL failed: ' + err.message });
  }
}

// Collects the raw request body as a Buffer, so JSON and multipart uploads
// are both forwarded byte-for-byte.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
