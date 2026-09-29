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

      // An empty key on save means "keep the one already stored", so the
      // model can be changed without pasting the key again.
      let finalKey = key;
      if (!finalKey) {
        const cfg = await readConfig();
        finalKey = (cfg && cfg.key) || '';
        if (!finalKey) return res.status(400).json({ error: 'Enter an API key.' });
      }

      // Blank means "use the built-in wording", which is also how the
      // reset button works: it clears the box and saves.
      const prompt = String(b.prompt || '').trim().slice(0, 4000);

      await writeConfig({ provider, model, key: finalKey, prompt });
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

    return res.status(404).json({ error: 'Unknown request.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
