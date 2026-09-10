// api/drive.js
//
// The Google Drive connection, server side.
//
// Why this is not done in the browser: connecting to Drive produces a refresh
// token, which is a permanent key to the owner's Drive. It must never reach
// the browser, so the whole exchange happens here and the token is written
// straight to the database using the service key -- which also never leaves
// this file.
//
// Routes (vercel.json sends /api/drive/* here):
//
//   GET /api/drive/status     is Drive connected, and as whom
//   GET /api/drive/connect    redirects to Google's consent screen
//   GET /api/drive/callback   where Google sends the person back
//   POST /api/drive/disconnect  forget the stored token
//
// Environment variables, all set in Vercel:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   the OAuth client
//   GOOGLE_DRIVE_PARENT_ID                   the folder job folders live in
//   SUPABASE_SERVICE_KEY                     writes the token, server only

const SUPABASE_URL = 'https://ozmpcygzbooddrbplxcz.supabase.co';

// Only what the feature actually does: create folders and add files. Not
// drive.readonly and not full drive access -- this scope cannot see, change
// or delete anything the app did not create itself, so an existing folder
// picked by hand is safe from it.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Where the token is kept. One row, same table as the other app settings.
const TOKEN_KEY = 'google_drive_token';

export default async function handler(req, res) {
  const action = readAction(req);

  try {
    if (action === 'status') return await status(req, res);
    if (action === 'connect') return connect(req, res);
    if (action === 'callback') return await callback(req, res);
    if (action === 'disconnect') return await disconnect(req, res);
    res.status(404).json({ error: 'Unknown Drive route: ' + action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// The rewrite rewrites req.url, so the real path comes from the headers
// Vercel preserves -- the same approach proxy.js uses.
function readAction(req) {
  const original = req.headers['x-forwarded-uri'] ||
                   req.headers['x-vercel-original-path'] ||
                   req.url || '';
  const path = String(original).split('?')[0];
  const parts = path.split('/').filter(Boolean);   // ['api','drive','connect']
  return parts[2] || '';
}

function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + host;
}

function redirectUri(req) { return origin(req) + '/api/drive/callback'; }

// ---- Talking to the database --------------------------------------------
//
// The service key bypasses row level security, which is the point: the token
// row is written and read here and is not reachable from the browser at all.

function db(method, path, body) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('Server misconfigured: SUPABASE_SERVICE_KEY is not set.');
  return fetch(SUPABASE_URL + '/rest/v1' + path, {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error('Database said: ' + text);
    return text ? JSON.parse(text) : null;
  });
}

async function readToken() {
  const rows = await db('GET', '/app_settings?key=eq.' + TOKEN_KEY + '&select=value');
  if (!rows || !rows.length || !rows[0].value) return null;
  try { return JSON.parse(rows[0].value); } catch (e) { return null; }
}

async function writeToken(value) {
  const text = value ? JSON.stringify(value) : '';
  const rows = await db('GET', '/app_settings?key=eq.' + TOKEN_KEY + '&select=key');
  if (rows && rows.length) {
    return db('PATCH', '/app_settings?key=eq.' + TOKEN_KEY, { value: text });
  }
  return db('POST', '/app_settings', { key: TOKEN_KEY, value: text });
}

// ---- The routes ----------------------------------------------------------

// What the Settings page asks on load. Deliberately says nothing secret:
// whether a connection exists, and which account made it.
async function status(req, res) {
  const stored = await readToken();
  res.status(200).json({
    connected: !!(stored && stored.refresh_token),
    email: (stored && stored.email) || '',
    parentSet: !!process.env.GOOGLE_DRIVE_PARENT_ID,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
}

function connect(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('Server misconfigured: GOOGLE_CLIENT_ID is not set.');
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPE,
    // offline plus consent is what produces a refresh token, and asking for
    // consent every time means reconnecting actually replaces the old token
    // rather than silently returning nothing.
    access_type: 'offline',
    prompt: 'consent',
  });

  res.writeHead(302, {
    Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
  });
  res.end();
}

async function callback(req, res) {
  const url = new URL(req.url, origin(req));
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) return done(res, false, 'Google said: ' + error);
  if (!code) return done(res, false, 'Google did not send an authorisation code.');

  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const token = await tokenRes.json();

  if (!tokenRes.ok || !token.refresh_token) {
    // No refresh token usually means Google reused an earlier grant. Asking
    // for consent every time is what prevents that, but say so plainly if it
    // happens rather than storing something that expires in an hour.
    return done(res, false, token.error_description || token.error ||
      'Google did not return a refresh token. Try disconnecting in your ' +
      'Google account and connecting again.');
  }

  // Whose Drive this is. Shown on the Settings page so it is obvious the
  // right account was used.
  let email = '';
  try {
    const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + token.access_token },
    });
    if (who.ok) email = (await who.json()).email || '';
  } catch (e) { /* the address is a nicety, not a requirement */ }

  await writeToken({
    refresh_token: token.refresh_token,
    email,
    connected_at: new Date().toISOString(),
  });

  done(res, true, 'Connected' + (email ? ' as ' + email : '') + '.');
}

async function disconnect(req, res) {
  await writeToken(null);
  res.status(200).json({ ok: true });
}

// Google sends the person back to a browser tab, so the reply is a page
// rather than JSON. It closes itself when it was opened as a popup.
function done(res, ok, message) {
  const safe = String(message).replace(/[<>&]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(ok ? 200 : 400).send(
    '<!doctype html><meta charset="utf-8">' +
    '<title>Google Drive</title>' +
    '<body style="font-family:system-ui,sans-serif;background:#0f1720;color:#e7edf5;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    '<div style="text-align:center;max-width:420px;padding:24px">' +
    '<h1 style="font-size:1.2em;margin:0 0 10px">' +
    (ok ? 'Google Drive connected' : 'Could not connect') + '</h1>' +
    '<p style="color:#9fb0c4;line-height:1.5;margin:0 0 18px">' + safe + '</p>' +
    '<p style="color:#9fb0c4;font-size:0.9em">You can close this tab and go ' +
    'back to the app.</p></div>' +
    '<script>try{if(window.opener){window.opener.postMessage(' +
    JSON.stringify({ mmDrive: ok ? 'connected' : 'failed' }) +
    ',"*");setTimeout(function(){window.close()},1200)}}catch(e){}</script>'
  );
}
