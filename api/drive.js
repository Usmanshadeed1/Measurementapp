// api/drive.js
//
// Google Drive, server side.
//
// Why none of this is done in the browser: connecting to Drive produces a
// refresh token, which is a permanent key to the owner's Drive. It must never
// reach the browser, so the whole exchange happens here and the token is
// written straight to the database using the service key -- which also never
// leaves this file.
//
// Routes (vercel.json sends /api/drive/* here):
//
//   GET  /api/drive/status      is Drive connected, and as whom
//   GET  /api/drive/connect     redirects to Google's consent screen
//   GET  /api/drive/callback    where Google sends the person back
//   POST /api/drive/disconnect  forget the stored token
//   GET  /api/drive/folders     folders inside the parent, to pick from
//   POST /api/drive/job-folder  make a job's folder tree, return its link
//   POST /api/drive/upload      copy one photo or video into a job folder
//
// Environment variables, all set in Vercel:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   the OAuth client
//   GOOGLE_DRIVE_PARENT_ID                   the folder job folders live in
//   SUPABASE_SERVICE_KEY                     writes the token, server only

const SUPABASE_URL = 'https://ozmpcygzbooddrbplxcz.supabase.co';

// drive.file alone would only see folders this app created, and picking a
// folder made by hand months ago is exactly what the existing jobs need. So
// readonly is added for *looking*, and drive.file remains what grants the
// right to create and write. Nothing here deletes or edits anything: the app
// can read the folder list, and add to folders, and that is all.
const SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

const TOKEN_KEY = 'google_drive_token';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// The tree made inside every new job folder. Photos and Videos are what the
// app files uploads into; the Kitchen 1 branch is the client's own working
// area, created empty and never touched again.
const SUBFOLDERS = [
  { name: 'Photos' },
  { name: 'Videos' },
  { name: 'Kitchen 1', children: ['FP and EL', 'Renderings', 'Invoices'] },
];

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const action = readAction(req);

  try {
    if (action === 'status') return await status(req, res);
    if (action === 'connect') return connect(req, res);
    if (action === 'callback') return await callback(req, res);
    if (action === 'disconnect') return await disconnect(req, res);
    if (action === 'folders') return await folders(req, res);
    if (action === 'job-folder') return await jobFolder(req, res);
    if (action === 'upload') return await upload(req, res);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Bad request body.')); }
    });
    req.on('error', reject);
  });
}

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

// ---- Talking to Google ---------------------------------------------------

// A fresh access token for this request. They last an hour; rather than cache
// one and reason about expiry, each request trades the refresh token for a
// new one. That is a single extra call and removes a whole class of bug.
async function accessToken() {
  const stored = await readToken();
  if (!stored || !stored.refresh_token) {
    throw new Error('Google Drive is not connected.');
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: stored.refresh_token,
    grant_type: 'refresh_token',
  });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await r.json();

  if (!r.ok || !data.access_token) {
    // A revoked or expired grant lands here. Saying so plainly beats a
    // generic failure, because the fix is specific: connect again.
    throw new Error('The Google Drive connection has expired. Reconnect it in Settings.');
  }
  return data.access_token;
}

async function gapi(token, path, options) {
  const r = await fetch('https://www.googleapis.com' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...((options || {}).headers || {}) },
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!r.ok) {
    throw new Error((data.error && data.error.message) || 'Google Drive said: ' + text);
  }
  return data;
}

// Drive has no "create if missing", so a folder is looked for first. Names
// are escaped because a customer called O'Brien would otherwise break the
// query -- and would then get a second folder made on every upload.
async function findFolder(token, name, parentId) {
  const q = [
    "mimeType='" + FOLDER_MIME + "'",
    "name='" + String(name).replace(/'/g, "\\'") + "'",
    "'" + parentId + "' in parents",
    'trashed=false',
  ].join(' and ');
  const data = await gapi(token,
    '/drive/v3/files?q=' + encodeURIComponent(q) +
    '&fields=files(id,name)&pageSize=1&supportsAllDrives=true');
  return (data.files && data.files[0]) || null;
}

async function makeFolder(token, name, parentId) {
  return gapi(token, '/drive/v3/files?fields=id,name&supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
}

async function folderNamed(token, name, parentId) {
  return (await findFolder(token, name, parentId)) ||
         (await makeFolder(token, name, parentId));
}

function parentId() {
  const id = process.env.GOOGLE_DRIVE_PARENT_ID;
  if (!id) throw new Error('Server misconfigured: GOOGLE_DRIVE_PARENT_ID is not set.');
  return id;
}

function folderLink(id) { return 'https://drive.google.com/drive/folders/' + id; }

// A Drive folder link, whatever form it was pasted or stored in.
function idFromLink(link) {
  const m = String(link || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
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

// Folders inside the parent, for picking one by hand on an existing job.
// Only that one folder is listed -- the readonly scope allows more, but there
// is no reason to show the rest of somebody's Drive.
async function folders(req, res) {
  const token = await accessToken();
  const q = [
    "mimeType='" + FOLDER_MIME + "'",
    "'" + parentId() + "' in parents",
    'trashed=false',
  ].join(' and ');

  const data = await gapi(token,
    '/drive/v3/files?q=' + encodeURIComponent(q) +
    '&fields=files(id,name)&pageSize=1000&orderBy=name&supportsAllDrives=true');

  res.status(200).json({
    folders: (data.files || []).map((f) => ({
      id: f.id, name: f.name, link: folderLink(f.id),
    })),
  });
}

// Makes (or finds) a job's folder and everything inside it. Returns the link,
// which the app stores on the opportunity exactly as a pasted one.
async function jobFolder(req, res) {
  const body = await readBody(req);
  const wanted = String(body.name || '').trim();
  if (!wanted) throw new Error('A folder name is needed.');

  const token = await accessToken();
  const root = parentId();

  // Two jobs for one customer would both want "Shadeed Usman", and the second
  // must not pour its photos into the first one's folder. So an unused name
  // is found: "Shadeed Usman 2", then 3, and so on.
  let name = wanted;
  if (body.unique) {
    let n = 1;
    while (await findFolder(token, name, root)) {
      n += 1;
      name = wanted + ' ' + n;
      if (n > 50) throw new Error('Too many folders already named ' + wanted + '.');
    }
  }

  const folder = await folderNamed(token, name, root);

  // Each subfolder is found-or-made, so running this twice is harmless.
  for (const sub of SUBFOLDERS) {
    const made = await folderNamed(token, sub.name, folder.id);
    for (const child of (sub.children || [])) {
      await folderNamed(token, child, made.id);
    }
  }

  res.status(200).json({ id: folder.id, name, link: folderLink(folder.id) });
}

// Copies one already-uploaded file into a job's Photos or Videos folder.
//
// The file is fetched from the URL GoHighLevel already gave it rather than
// being uploaded twice from the phone: the photo is safely in GHL before this
// runs, and this is only the extra copy.
async function upload(req, res) {
  const body = await readBody(req);
  const fileUrl = String(body.fileUrl || '');
  const folderId = idFromLink(body.folderLink || '');
  const name = String(body.name || 'file').replace(/[\\/]/g, '-');
  const isVideo = !!body.isVideo;

  if (!fileUrl) throw new Error('No file to copy.');
  if (!folderId) throw new Error('This job has no Drive folder linked.');

  const token = await accessToken();

  // Photos and Videos live beside each other in the job folder.
  const bucket = await folderNamed(token, isVideo ? 'Videos' : 'Photos', folderId);

  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error('Could not read the uploaded file.');
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  const type = fileRes.headers.get('content-type') || 'application/octet-stream';

  // Multipart upload, written out rather than pulled from a library: the
  // project has no dependencies and this is the only place that needs it.
  const boundary = 'mm' + Date.now();
  const meta = JSON.stringify({ name, parents: [bucket.id] });
  const payload = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n'),
    Buffer.from('--' + boundary + '\r\nContent-Type: ' + type + '\r\n\r\n'),
    bytes,
    Buffer.from('\r\n--' + boundary + '--'),
  ]);

  const made = await gapi(token,
    '/upload/drive/v3/files?uploadType=multipart&fields=id,name&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/related; boundary=' + boundary,
        'Content-Length': String(payload.length),
      },
      body: payload,
    });

  res.status(200).json({ id: made.id, name: made.name });
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
