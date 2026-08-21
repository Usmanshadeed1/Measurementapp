// api/[...path].js
//
// Vercel version of the GHL proxy. Same job as netlify/functions/ghl-proxy.js:
// the browser calls /api/<ghl path> on this domain, and the real Private
// Integration Token is attached here, server-side, so it never ships to the
// browser.
//
// Both proxies are kept in the repo so the project can be hosted on either
// platform without a rewrite. Vercel routes /api/* to this file by filename
// convention, so no redirect rule is needed for the proxy itself.
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

  // req.url arrives as "/api/opportunities/search?foo=bar" — strip the /api
  // prefix to get the GHL path, keeping any query string intact.
  let forwardPath = req.url || '/';
  if (forwardPath.startsWith('/api')) forwardPath = forwardPath.slice(4);
  if (!forwardPath.startsWith('/')) forwardPath = '/' + forwardPath;

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
