// netlify/functions/ghl-proxy.js
//
// Server-side proxy to GHL's API. The browser never sees the GHL
// Private Integration Token — it lives only in this function's
// environment (Netlify Site settings -> Environment variables -> GHL_API_KEY).
//
// The frontend calls:   /.netlify/functions/ghl-proxy/<ghl path>
// This forwards to:     https://services.leadconnectorhq.com/<ghl path>
// with the real Authorization header attached here.

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

exports.handler = async function (event) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: 'Server misconfigured: GHL_API_KEY is not set.' });
  }

  // Everything after /.netlify/functions/ghl-proxy/ is the GHL path+query.
  const prefix = '/.netlify/functions/ghl-proxy';
  let forwardPath = event.path.startsWith(prefix) ? event.path.slice(prefix.length) : event.path;
  if (!forwardPath.startsWith('/')) forwardPath = '/' + forwardPath;

  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const url = GHL_API + forwardPath + qs;

  const headers = {
    Authorization: 'Bearer ' + apiKey,
    Version: GHL_VERSION,
  };

  const isMultipart = (event.headers['content-type'] || event.headers['Content-Type'] || '').indexOf('multipart/form-data') === 0;

  let fetchOptions = { method: event.httpMethod, headers };

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    if (isMultipart) {
      // File uploads (photos/videos) — forward the raw multipart body as-is.
      headers['Content-Type'] = event.headers['content-type'] || event.headers['Content-Type'];
      fetchOptions.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    } else if (event.body) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = event.body;
    }
  }

  try {
    const ghlRes = await fetch(url, fetchOptions);
    const text = await ghlRes.text();
    return {
      statusCode: ghlRes.status,
      headers: { 'Content-Type': ghlRes.headers.get('content-type') || 'application/json' },
      body: text,
    };
  } catch (err) {
    return jsonResponse(502, { error: 'Upstream request to GHL failed: ' + err.message });
  }
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
