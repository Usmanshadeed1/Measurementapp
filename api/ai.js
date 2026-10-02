// api/ai.js
// Suggesting the contents of a material list.
//
// The ONLY thing this is used for. It is given a few words describing a kind
// of job -- "kitchen remodel with island" -- and returns a list of materials
// to start from. A person then edits that list and saves it themselves.
//
// What is sent to the AI provider is exactly that description and nothing
// else. No contact, no job, no opportunity, no measurement, no address, no
// price, no supplier. There is no code path from the customer data to here:
// the browser sends a sentence someone typed into a box, and a list of item
// names comes back.
//
// The API KEY never reaches the browser. It is stored in app_settings and
// read here with the service key, the same way the Drive token is -- see
// api/drive.js. The settings page can save a key and ask whether one exists;
// it can never read one back.
//
// Three providers, because the free tiers move and a key someone already has
// is worth more than a preference of ours. The MODEL NAME is typed by the
// admin rather than listed here: model names change every few months and a
// hardcoded one turns into a bug report.

const SUPABASE_URL = 'https://ozmpcygzbooddrbplxcz.supabase.co';
const SETTING_KEY = 'ai_config';

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    url: (model, key) =>
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (model, prompt) => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    }),
    text: (d) => {
      const c = d && d.candidates && d.candidates[0];
      const p = c && c.content && c.content.parts && c.content.parts[0];
      return (p && p.text) || '';
    },
  },

  groq: {
    label: 'Groq',
    url: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: (key) => ({
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    }),
    body: (model, prompt) => ({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
    }),
    text: (d) => {
      const c = d && d.choices && d.choices[0];
      return (c && c.message && c.message.content) || '';
    },
  },

  openrouter: {
    label: 'OpenRouter',
    url: () => 'https://openrouter.ai/api/v1/chat/completions',
    headers: (key) => ({
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    }),
    body: (model, prompt) => ({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
    }),
    text: (d) => {
      const c = d && d.choices && d.choices[0];
      return (c && c.message && c.message.content) || '';
    },
  },
};

// ---- Visualising a room --------------------------------------------------
//
// One photo of a real kitchen, plus photographs of the doors this business
// actually sells, and a picture of that same kitchen with those doors in it.
//
// The reference photos are the whole point. Without them a model invents a
// cabinet, and a customer shown a door nobody can order is worse off than a
// customer shown nothing -- which is exactly what the client said when the
// idea came up.
//
// GEMINI ONLY. Image editing from reference photographs is not something the
// other providers here do, so this refuses rather than pretending.
//
// The images arrive as data URLs from the browser, which already holds them;
// the server fetches nothing of its own.

const IMAGE_MODEL_DEFAULT = 'gemini-3-pro-image';

const IMAGE_PROMPT_DEFAULT = [
  'This is a photograph of a real room in a customer\'s home.',
  '',
  'Replace ONLY the cabinet doors and drawer fronts with the doors shown in',
  'the reference photographs: {style}.',
  '',
  'Match the reference doors exactly — the same profile, panel, colour and',
  'finish. Do not substitute a similar style.',
  '',
  'Everything else in the photograph must stay exactly as it is:',
  '- the room layout and the position of every cabinet',
  '- the windows, floor, walls and ceiling',
  '- the countertops, sink, tap and backsplash',
  '- the appliances',
  '- the camera angle, perspective and lighting',
  '',
  'Do not move, add or remove anything else. The result must look like a',
  'photograph of the same room, not a new design.',
].join('\n');

function buildImagePrompt(custom, styleName, styleNotes, extra) {
  let body = String(custom || '').trim() || IMAGE_PROMPT_DEFAULT;

  let style = styleName || 'the reference doors';
  if (styleNotes) style += ' (' + styleNotes + ')';

  if (body.indexOf('{style}') > -1) body = body.split('{style}').join(style);
  else body += '\n\nThe doors to fit: ' + style;

  // Whatever was typed for this one job, last, so it reads as the latest
  // instruction rather than being buried in the standing wording.
  const note = String(extra || '').trim();
  if (note) body += '\n\nAlso: ' + note;

  return body;
}

// "data:image/jpeg;base64,xxxx" as Gemini wants it. Anything that is not a
// data URL is refused rather than guessed at: the server does not fetch
// URLs on someone else's say-so.
function inlinePart(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  if (m[1].indexOf('image/') !== 0) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

// ---- The database --------------------------------------------------------

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

async function readConfig() {
  const rows = await db('GET', '/app_settings?key=eq.' + SETTING_KEY + '&select=value');
  if (!rows || !rows.length || !rows[0].value) return null;
  try { return JSON.parse(rows[0].value); } catch (e) { return null; }
}

async function writeConfig(value) {
  const text = value ? JSON.stringify(value) : '';
  const rows = await db('GET', '/app_settings?key=eq.' + SETTING_KEY + '&select=key');
  if (rows && rows.length) {
    return db('PATCH', '/app_settings?key=eq.' + SETTING_KEY, { value: text });
  }
  return db('POST', '/app_settings', { key: SETTING_KEY, value: text });
}

// ---- The prompt ----------------------------------------------------------
//
// Written here rather than in the browser so it cannot be replaced by
// whatever is sent up. The only thing the caller controls is the short
// description, and it is capped -- this asks for a materials list, and
// nothing that arrives can turn it into something else.

// The wording is editable from the settings page, because whoever runs the
// business knows their trade better than this file does -- what counts as a
// material, what is normally ordered together, what should never be
// suggested. {job} is where the description someone typed is put.
//
// The FORMAT rules are appended afterwards and are not editable. They are
// not trade knowledge, they are the contract this endpoint's parser depends
// on: an edit that dropped them would return prose, and the feature would
// fail with an error nobody could act on.
const DEFAULT_PROMPT = [
  'You are helping a building contractor write a checklist of materials.',
  '',
  'The job: {job}',
  '',
  'List the materials typically needed for that work.',
  '- Give a sensible typical quantity. The contractor will adjust it.',
  '- Between 15 and 40 entries.',
  '- Name real, orderable materials. No labour, no tools, no services.',
  '- No prices and no supplier names.',
].join('\n');

const FORMAT_RULES = [
  '',
  'Reply with ONLY a JSON array. No explanation, no markdown fence.',
  'Each entry: {"item": string, "qty": number, "unit": string}',
  'unit must be one of: each, box, sheet, ft, sq ft, yd, gal, lb, roll,',
  'bag, tube, set',
].join('\n');

function buildPrompt(what, custom) {
  let body = String(custom || '').trim() || DEFAULT_PROMPT;

  // A wording that forgets to say where the job goes would ask about
  // nothing at all, so it is appended rather than dropped.
  if (body.indexOf('{job}') > -1) {
    body = body.split('{job}').join(what);
  } else {
    body += '\n\nThe job: ' + what;
  }

  return body + '\n' + FORMAT_RULES;
}

// The model is asked for bare JSON, but models wrap things in code fences
// often enough that not handling it would be a bug waiting to happen.
function parseItems(text) {
  let s = String(text || '').trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  s = s.slice(start, end + 1);

  let raw;
  try { raw = JSON.parse(s); } catch (e) { return []; }
  if (!Array.isArray(raw)) return [];

  const UNITS = ['each', 'box', 'sheet', 'ft', 'sq ft', 'yd', 'gal', 'lb',
                 'roll', 'bag', 'tube', 'set'];

  return raw.map((r) => {
    const item = String((r && r.item) || '').replace(/[|\r\n]+/g, ' ').trim();
    if (!item) return null;
    const n = parseFloat(r && r.qty);
    const unit = String((r && r.unit) || '').trim().toLowerCase();
    return {
      item: item.slice(0, 120),
      qty: isFinite(n) && n > 0 ? String(n) : '',
      unit: UNITS.indexOf(unit) > -1 ? unit : 'each',
    };
  }).filter(Boolean).slice(0, 60);
}

// ---- The handler ---------------------------------------------------------

// The body arrives as a stream: this runs behind a rewrite, so req.body is
// not filled in for us. Same helper as api/drive.js, for the same reason.
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

function readAction(req) {
  const original = req.headers['x-forwarded-uri'] ||
                   req.headers['x-vercel-original-path'] ||
                   req.url || '';
  const q = String(original).split('?')[1] || '';
  const hit = q.split('&').map((p) => p.split('='))
    .find((p) => decodeURIComponent(p[0] || '') === 'action');
  return hit ? decodeURIComponent(hit[1] || '').toLowerCase() : '';
}

export default async function handler(req, res) {
  const action = readAction(req);

  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    // Whether a key is set, and which provider and model. The KEY ITSELF is
    // never returned -- only whether there is one.
    if (req.method === 'GET' && action === 'status') {
      const cfg = await readConfig();
      return res.status(200).json({
        configured: !!(cfg && cfg.key),
        provider: (cfg && cfg.provider) || '',
        model: (cfg && cfg.model) || '',
        prompt: (cfg && cfg.prompt) || '',
        defaultPrompt: DEFAULT_PROMPT,
        formatRules: FORMAT_RULES.trim(),
        imageModel: (cfg && cfg.imageModel) || '',
        imagePrompt: (cfg && cfg.imagePrompt) || '',
        defaultImageModel: IMAGE_MODEL_DEFAULT,
        defaultImagePrompt: IMAGE_PROMPT_DEFAULT,
        providers: Object.keys(PROVIDERS).map((k) => ({
          id: k, label: PROVIDERS[k].label,
        })),
      });
    }

    if (req.method === 'POST' && action === 'save') {
      const b = body;
      const provider = String(b.provider || '').toLowerCase();
      const model = String(b.model || '').trim();
      const key = String(b.key || '').trim();

      if (!PROVIDERS[provider]) return res.status(400).json({ error: 'Pick a platform.' });
      if (!model) return res.status(400).json({ error: 'Enter a model name.' });

      // Read once, for everything that falls back to what is stored.
      const cur = await readConfig();

      // An empty key on save means "keep the one already stored", so the
      // model can be changed without pasting the key again.
      const finalKey = key || (cur && cur.key) || '';
      if (!finalKey) return res.status(400).json({ error: 'Enter an API key.' });

      // Blank means "use the built-in wording", which is also how the
      // reset button works: it clears the box and saves.
      const prompt = String(b.prompt || '').trim().slice(0, 4000);
      // An absent picture field keeps what is already stored rather than
      // clearing it: the settings page sends the whole lot, but a future
      // caller might not.
      const imageModel = b.imageModel !== undefined
        ? String(b.imageModel || '').trim().slice(0, 120)
        : ((cur && cur.imageModel) || '');
      const imagePrompt = b.imagePrompt !== undefined
        ? String(b.imagePrompt || '').trim().slice(0, 4000)
        : ((cur && cur.imagePrompt) || '');

      await writeConfig({ provider, model, key: finalKey, prompt,
                          imageModel, imagePrompt });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && action === 'clear') {
      await writeConfig(null);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && (action === 'suggest' || action === 'test')) {
      const cfg = await readConfig();
      if (!cfg || !cfg.key) {
        return res.status(400).json({ error: 'No AI key has been set up yet.' });
      }
      const p = PROVIDERS[cfg.provider];
      if (!p) return res.status(400).json({ error: 'That platform is not supported.' });

      // The description, capped. This is the ONLY caller-supplied text that
      // reaches the provider.
      const what = String(body.what || '').trim().slice(0, 300);
      if (action === 'suggest' && !what) {
        return res.status(400).json({ error: 'Say what the job is.' });
      }

      const prompt = buildPrompt(
        action === 'test' ? 'a small bathroom remodel' : what,
        cfg.prompt);

      const r = await fetch(p.url(cfg.model, cfg.key), {
        method: 'POST',
        headers: p.headers(cfg.key),
        body: JSON.stringify(p.body(cfg.model, prompt)),
      });

      const text = await r.text();
      if (!r.ok) {
        // The provider's own words help -- a wrong model name and a wrong
        // key read very differently -- but the key must never come back in
        // an error, so the message is trimmed.
        let msg = text.slice(0, 300);
        try {
          const d = JSON.parse(text);
          msg = (d.error && (d.error.message || d.error)) || msg;
        } catch (e) { /* keep the raw text */ }
        return res.status(400).json({ error: String(msg).slice(0, 300) });
      }

      let data;
      try { data = JSON.parse(text); } catch (e) {
        return res.status(502).json({ error: 'The AI sent something unreadable.' });
      }

      const items = parseItems(p.text(data));
      if (!items.length) {
        return res.status(502).json({
          error: 'The AI did not return a usable list. Try a different model.',
        });
      }

      return res.status(200).json({ items });
    }

    if (req.method === 'POST' && action === 'visualise') {
      const cfg = await readConfig();
      if (!cfg || !cfg.key) {
        return res.status(400).json({ error: 'No AI key has been set up yet.' });
      }
      if (cfg.provider !== 'gemini') {
        return res.status(400).json({
          error: 'Visualising needs a Google Gemini key. The platform in ' +
                 'Settings is set to ' + cfg.provider + '.',
        });
      }

      const room = inlinePart(body.room);
      if (!room) return res.status(400).json({ error: 'No room photo was sent.' });

      const refs = (Array.isArray(body.refs) ? body.refs : [])
        .map(inlinePart).filter(Boolean);
      if (!refs.length) {
        return res.status(400).json({
          error: 'That door style has no usable photos.',
        });
      }

      const prompt = buildImagePrompt(
        cfg.imagePrompt,
        String(body.style || '').slice(0, 120),
        String(body.notes || '').slice(0, 300),
        String(body.extra || '').slice(0, 500)
      );

      // The room first, then the doors: the order matches what the prompt
      // says about "this photograph" and "the reference photographs".
      const parts = [{ text: prompt }, room].concat(refs);
      const model = cfg.imageModel || IMAGE_MODEL_DEFAULT;

      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(model) + ':generateContent?key=' +
          encodeURIComponent(cfg.key),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        }
      );

      const text = await r.text();
      if (!r.ok) {
        let msg = text.slice(0, 300);
        try {
          const d = JSON.parse(text);
          msg = (d.error && (d.error.message || d.error)) || msg;
        } catch (e) { /* keep the raw text */ }
        return res.status(400).json({ error: String(msg).slice(0, 300) });
      }

      let data;
      try { data = JSON.parse(text); } catch (e) {
        return res.status(502).json({ error: 'The AI sent something unreadable.' });
      }

      // The picture comes back beside any words the model felt like adding,
      // so the parts are searched rather than assumed to be in an order.
      const out = [];
      let said = '';
      const cand = (data.candidates || [])[0];
      ((cand && cand.content && cand.content.parts) || []).forEach((p) => {
        const d = p.inline_data || p.inlineData;
        if (d && d.data) {
          out.push('data:' + (d.mime_type || d.mimeType || 'image/png') +
                   ';base64,' + d.data);
        } else if (p.text) {
          said += p.text;
        }
      });

      if (!out.length) {
        // A refusal explains itself in the text part, and that explanation
        // is far more use than "no image returned".
        return res.status(502).json({
          error: said.trim().slice(0, 300) ||
                 'The AI returned no picture. Try a different photo.',
        });
      }

      return res.status(200).json({ images: out, note: said.trim().slice(0, 500) });
    }

    return res.status(404).json({ error: 'Unknown request.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
