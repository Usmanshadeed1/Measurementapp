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
// Visualising keeps its OWN row. It needs Gemini specifically, while the
// suggestions can run on any provider -- sharing one setting meant choosing
// a platform for one broke the other.
const IMAGE_KEY = 'ai_image_config';

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

// Written as an EDIT, not as a description of a kitchen. The first wording
// read like a brief, and the models answered it like one: they produced a
// nice kitchen that was not the customer's, put cabinets over windows, and
// refaced some doors while leaving others alone.
//
// Three things fixed that, and they are worth keeping in this order:
// the job is retouching one photograph; EVERY door changes, not some; and
// anything that is not a cabinet door is untouchable.
const IMAGE_PROMPT_DEFAULT = [
  '{rooms}',
  '',
  'TASK: retouch this photograph. Return the SAME photograph with one',
  'change made to it. This is not a new design, not a render, and not a',
  'different kitchen. Think of it as swapping the cabinet fronts in a photo',
  'editor, pixel for pixel, leaving the rest of the image untouched.',
  '',
  'THE ONE CHANGE: every cabinet door and drawer front in the photograph is',
  'refaced with the doors shown in the reference photographs: {style}.',
  '',
  'Match those reference doors exactly — the same panel profile, the same',
  'edge, the same colour, the same finish, the same sheen. Do not invent a',
  'similar door. Do not use a stock cabinet. Copy what is in the reference',
  'photographs.',
  '',
  'EVERY cabinet, without exception — wall cabinets, base cabinets, the tall',
  'pantry, the island, above the fridge, above the cooker. Leaving one door',
  'in the old style ruins the picture, so check the whole image before you',
  'finish.',
  '',
  'NEVER ADD A CABINET. If a part of the wall has no cabinet — a window, an',
  'open wall, a doorway, a gap — it still has no cabinet afterwards. Do not',
  'fill windows. Do not extend runs of units. Do not tidy the layout.',
  '',
  'These must come through completely unchanged, pixel for pixel:',
  '- the position, size and number of every cabinet',
  '- every window, and whatever is visible through it',
  '- the floor, the walls, the ceiling and any mouldings',
  '- the countertops, sink, tap, backsplash and tiling',
  '- every appliance, including handles and controls',
  '- the camera angle, the perspective, the lens distortion',
  '- the lighting, the shadows and the time of day',
  '- anything sitting on the counters',
  '',
  'Keep the photograph\'s own character: the same grain, the same slightly',
  'uneven light, the same reflections. A result that looks like a brochure',
  'is wrong. It should look like someone refaced these cabinets and took',
  'the photograph again from the same spot.',
  '',
  'If a cabinet is partly hidden or at an awkward angle, reface the part',
  'that is visible and leave the rest of the image alone. Never redraw a',
  'region to make it easier.',
].join('\n');

function buildImagePrompt(custom, styleName, styleNotes, extra, roomCount, colour) {
  let body = String(custom || '').trim() || IMAGE_PROMPT_DEFAULT;

  // How many photographs of the room were sent, said in words, so the model
  // knows which of the images are the room and which are the doors. Several
  // angles of one kitchen give it more to keep unchanged.
  var n = roomCount || 1;
  var rooms = n > 1
    ? 'IMAGES 1 to ' + n + ' are photographs of ONE real room in a ' +
      'customer\'s home, taken from different angles. Your result must be ' +
      'IMAGE 1, edited. The others are only there to show you more of the ' +
      'same room; never mix them together into one picture.' +
      '\n\nEVERY IMAGE AFTER THAT is a close-up of the cabinet door to fit. ' +
      'Those are product photographs, not rooms. Nothing in them — no ' +
      'background, no surroundings — appears in your result. Only the door ' +
      'itself is copied.'
    : 'IMAGE 1 is a photograph of a real room in a customer\'s home. Your ' +
      'result is that photograph, edited.' +
      '\n\nEVERY IMAGE AFTER IT is a close-up of the cabinet door to fit. ' +
      'Those are product photographs, not rooms. Nothing in them — no ' +
      'background, no surroundings — appears in your result. Only the door ' +
      'itself is copied.';
  body = body.split('{rooms}').join(rooms);

  let style = styleName || 'the reference doors';
  if (styleNotes) style += ' (' + styleNotes + ')';

  // The reference photographs now show the door IN THE CHOSEN FINISH --
  // shape and colour together, because each colour carries its own
  // photographs. So the name is given as confirmation rather than as a
  // correction: it used to say "paint them X instead of the colour you can
  // see", which was right when the samples were all white and wrong now.
  const paint = String(colour || '').trim();
  if (paint) {
    style += ' in ' + paint +
      '. The reference photographs show this exact finish -- copy both the ' +
      'shape and the colour from them. Do not lighten, darken or correct ' +
      'the colour, and do not substitute a similar one';
  }

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

// ---- Who draws the picture -----------------------------------------------
//
// Two routes to the same family of models. Google direct needs a prepaid
// balance; the resellers sell the same thing by the image and hand out trial
// credit, which is the difference between testing an idea this afternoon and
// not testing it at all.
//
// They do not agree on anything else. Google takes the pictures as data in
// the request and answers immediately. Kie takes public URLs, answers with a
// job number, and the picture is collected afterwards. Both shapes live
// here so the rest of the app only ever asks for "a visualisation".

const IMAGE_PROVIDERS = {
  gemini: {
    label: 'Google Gemini (direct)',
    defaultModel: 'gemini-3-pro-image',
    needsUrls: false,
    note: 'Billed by Google. Needs a prepaid balance on the account.',
    models: [
      {
        id: 'gemini-3-pro-image',
        label: 'Gemini 3 Pro Image',
        price: 'about $0.13',
        note: 'The most faithful to the original photo.',
      },
      {
        id: 'gemini-2.5-flash-image',
        label: 'Gemini 2.5 Flash Image',
        price: 'about $0.04',
        note: 'Cheaper, and takes more liberties with the room.',
      },
    ],
  },
  kie: {
    label: 'Kie.ai',
    // The Pro model, not the cheap one: the cheap one refaced some doors
    // and not others, and put cabinets where the windows were.
    //
    // Note the naming is not consistent on their side -- this one has no
    // "google/" in front of it while google/nano-banana-edit does. Every id
    // below was read from their own documentation rather than guessed from
    // the pattern of another, which is how the first two were got wrong.
    defaultModel: 'gpt-image-2-5-sunburst-image-to-image',
    needsUrls: true,
    note: 'Resells the same models by the image, and gives trial credit.',
    // Two, both tried. Every id here was read from the provider's own page
    // rather than guessed from the pattern of another one, which is how the
    // earlier ones were got wrong.
    //
    // The ones left out: Qwen Image Edit takes a SINGLE picture, so it never
    // sees the door photographs at all; the cheap Nano Banana Edit refaced
    // some doors and not others and put cabinets over windows.
    models: [
      {
        id: 'gpt-image-2-5-sunburst-image-to-image',
        label: 'GPT Image 2.5 Sunburst',
        price: '6 credits (about $0.03)',
        note: 'From OpenAI. Takes 16 pictures and a long instruction, and ' +
              'is built for changing one thing and leaving the rest of the ' +
              'photograph alone.',
      },
      {
        id: 'nano-banana-pro',
        label: 'Nano Banana Pro (Gemini 3 Pro)',
        price: '9 credits (about $0.09)',
        note: 'The best from Google. The most faithful to the original ' +
              'photograph, and three times the price.',
      },
    ],
  },
};

// Google: the pictures travel as data, and the answer comes straight back.
async function drawWithGemini(cfg, prompt, images) {
  const parts = [{ text: prompt }].concat(
    images.map(inlinePart).filter(Boolean)
  );

  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(cfg.model || IMAGE_PROVIDERS.gemini.defaultModel) +
      ':generateContent?key=' + encodeURIComponent(cfg.key),
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
  if (!r.ok) throw new Error(readError(text));

  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error('The AI sent something unreadable.');
  }

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

  return { images: out, note: said.trim() };
}

// Kie: the pictures must already be somewhere public, the work is queued,
// and the result is collected by asking repeatedly.
async function drawWithKie(cfg, prompt, images) {
  const urls = images.filter((u) => /^https?:\/\//i.test(u));
  if (!urls.length) {
    throw new Error('This provider needs the photos uploaded first.');
  }

  const start = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.key,
    },
    body: JSON.stringify({
      model: cfg.model || IMAGE_PROVIDERS.kie.defaultModel,
      // Two things make this awkward, and both are the provider's.
      //
      // First, the models do not agree on what the input pictures are
      // called: nano-banana-pro wants `image_input`, gpt-image wants
      // `input_urls`, and the cheaper Google one wants `image_urls`. All
      // three are sent, because a model ignores the name it does not know
      // and the alternative is failing on whichever model someone picks.
      //
      // Second, nothing optional is sent at all. output_format,
      // aspect_ratio and resolution take different values on different
      // models, and one wrong value is refused outright -- so each model is
      // left to use its own default, and a model name typed into Settings
      // keeps working.
      input: {
        prompt,
        image_urls: urls.slice(0, 10),
        image_input: urls.slice(0, 10),
        input_urls: urls.slice(0, 10),
      },
    }),
  });

  const startText = await start.text();
  if (!start.ok) throw new Error(readError(startText));

  let started;
  try { started = JSON.parse(startText); } catch (e) {
    throw new Error('The provider sent something unreadable.');
  }

  const taskId = (started.data && started.data.taskId) || started.taskId;
  if (!taskId) throw new Error(readError(startText));

  // Asked for repeatedly until the picture is ready.
  //
  // Vercel kills a function at 300 seconds, so this stops at 240 and says
  // so: being cut off mid-request gives a blank page with no explanation,
  // and the picture has usually been paid for by then either way.
  //
  // The first check comes quickly and they slow down after that. A fast
  // model is finished in a few seconds, and waiting three of them to ask is
  // three seconds of someone standing in a customer's kitchen watching a
  // button say "Working on it".
  const until = Date.now() + 240000;
  let wait = 1200;
  while (Date.now() < until) {
    await new Promise((done) => setTimeout(done, wait));
    if (wait < 4000) wait += 400;

    const look = await fetch(
      'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=' +
        encodeURIComponent(taskId),
      { headers: { Authorization: 'Bearer ' + cfg.key } }
    );
    const lookText = await look.text();
    if (!look.ok) continue;

    let info;
    try { info = JSON.parse(lookText); } catch (e) { continue; }

    const d = info.data || {};
    const state = String(d.state || d.status || '').toLowerCase();

    if (state === 'success') {
      let urlsOut = [];
      try {
        const j = typeof d.resultJson === 'string'
          ? JSON.parse(d.resultJson) : (d.resultJson || {});
        urlsOut = j.resultUrls || j.result_urls || [];
      } catch (e) { urlsOut = []; }
      if (!urlsOut.length) throw new Error('The provider returned no picture.');
      return { images: urlsOut, note: '' };
    }

    if (state === 'fail' || state === 'failed') {
      throw new Error(d.failMsg || d.failmsg || 'The provider could not draw it.');
    }
  }

  throw new Error('It is taking longer than expected. Try again in a moment.');
}

// A provider's own words help -- a wrong model and a flat balance read very
// differently -- but the key must never come back in an error.
function readError(text) {
  let msg = String(text || '').slice(0, 300);
  try {
    const d = JSON.parse(text);
    msg = (d.error && (d.error.message || d.error)) || d.msg || d.message || msg;
  } catch (e) { /* keep the raw text */ }
  return String(msg).slice(0, 300);
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

async function readImageConfig() {
  const rows = await db('GET', '/app_settings?key=eq.' + IMAGE_KEY + '&select=value');
  if (!rows || !rows.length || !rows[0].value) return null;
  try { return JSON.parse(rows[0].value); } catch (e) { return null; }
}

async function writeImageConfig(value) {
  const text = value ? JSON.stringify(value) : '';
  const rows = await db('GET', '/app_settings?key=eq.' + IMAGE_KEY + '&select=key');
  if (rows && rows.length) {
    return db('PATCH', '/app_settings?key=eq.' + IMAGE_KEY, { value: text });
  }
  return db('POST', '/app_settings', { key: IMAGE_KEY, value: text });
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

      // Read once, for everything that falls back to what is stored.
      const cur = await readConfig();

      // An empty key on save means "keep the one already stored", so the
      // model can be changed without pasting the key again.
      const finalKey = key || (cur && cur.key) || '';
      if (!finalKey) return res.status(400).json({ error: 'Enter an API key.' });

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

    // ---- Visualising: its own key, model and wording ----

    if (req.method === 'GET' && action === 'image-status') {
      const cfg = await readImageConfig();
      return res.status(200).json({
        configured: !!(cfg && cfg.key),
        provider: (cfg && cfg.provider) || 'gemini',
        model: (cfg && cfg.model) || '',
        prompt: (cfg && cfg.prompt) || '',
        defaultPrompt: IMAGE_PROMPT_DEFAULT,
        providers: Object.keys(IMAGE_PROVIDERS).map((k) => ({
          id: k,
          label: IMAGE_PROVIDERS[k].label,
          defaultModel: IMAGE_PROVIDERS[k].defaultModel,
          needsUrls: IMAGE_PROVIDERS[k].needsUrls,
          note: IMAGE_PROVIDERS[k].note,
          models: IMAGE_PROVIDERS[k].models || [],
        })),
      });
    }

    if (req.method === 'POST' && action === 'image-save') {
      const b = body;
      const provider = String(b.provider || 'gemini').toLowerCase();
      const model = String(b.model || '').trim();
      const key = String(b.key || '').trim();
      if (!IMAGE_PROVIDERS[provider]) {
        return res.status(400).json({ error: 'Pick a provider.' });
      }
      if (!model) return res.status(400).json({ error: 'Enter a model name.' });

      const cur = await readImageConfig();
      // An empty key means "keep the one already stored", so the model or
      // the wording can be changed without pasting the key again.
      const finalKey = key || (cur && cur.key) || '';
      if (!finalKey) return res.status(400).json({ error: 'Enter an API key.' });

      // Blank wording means "use the built-in", which is also how the reset
      // button works: it clears the box and saves.
      const prompt = String(b.prompt || '').trim().slice(0, 4000);

      await writeImageConfig({ provider, model, key: finalKey, prompt });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && action === 'image-clear') {
      await writeImageConfig(null);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && action === 'visualise') {
      const cfg = await readImageConfig();
      if (!cfg || !cfg.key) {
        return res.status(400).json({
          error: 'Visualising is not set up yet — see Settings.',
        });
      }

      const who = IMAGE_PROVIDERS[cfg.provider] ? cfg.provider : 'gemini';

      // Several photographs of the room are better than one: more angles
      // give the model more of the kitchen to keep unchanged.
      const rooms = (Array.isArray(body.rooms) ? body.rooms
                    : (body.room ? [body.room] : [])).filter(Boolean);
      if (!rooms.length) {
        return res.status(400).json({ error: 'No room photo was sent.' });
      }

      const refs = (Array.isArray(body.refs) ? body.refs : []).filter(Boolean);
      if (!refs.length) {
        return res.status(400).json({
          error: 'That door style has no usable photos.',
        });
      }

      const prompt = buildImagePrompt(
        cfg.prompt,
        String(body.style || '').slice(0, 120),
        String(body.notes || '').slice(0, 300),
        String(body.extra || '').slice(0, 500),
        rooms.length,
        String(body.colour || '').slice(0, 60)
      );

      // The room first, then the doors: the order matches what the prompt
      // says about "this photograph" and "the reference photographs".
      const images = rooms.concat(refs).slice(0, 10);

      try {
        const out = who === 'kie'
          ? await drawWithKie(cfg, prompt, images)
          : await drawWithGemini(cfg, prompt, images);

        if (!out.images.length) {
          // A refusal explains itself in the text, and that explanation is
          // far more use than "no image returned".
          return res.status(502).json({
            error: out.note.slice(0, 300) ||
                   'No picture came back. Try a different photo.',
          });
        }
        return res.status(200).json({
          images: out.images,
          note: (out.note || '').slice(0, 500),
        });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    return res.status(404).json({ error: 'Unknown request.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
