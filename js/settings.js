// js/settings.js
// Admin settings.
//
// One page for the connections and switches an admin owns. Right now that is
// the Google Drive link, but the shape is built for more: each setting is a
// card with its own explanation, because whoever reads this is not the person
// who wrote the code.
//
// Nothing secret passes through here. Connecting happens on the server --
// /api/drive/* -- and the token it produces never reaches the browser. This
// page only asks whether a connection exists and offers to start or end one.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var state = null;      // the last answer from /api/drive/status
  var busy = false;
  var popup = null;

  function api(path, method) {
    return fetch('/api/drive/' + path, { method: method || 'GET' })
      .then(function (r) {
        return r.text().then(function (t) {
          var data;
          try { data = t ? JSON.parse(t) : {}; } catch (e) { data = {}; }
          if (!r.ok) throw new Error(data.error || 'Request failed.');
          return data;
        });
      });
  }

  // ---- Rendering -----------------------------------------------------------

  function render(msg, isError) {
    var el = document.getElementById('mm-set-body');
    if (!el) return;

    var s = state || {};
    var on = !!s.connected;

    var body;
    if (!s.configured) {
      // The keys live in Vercel, so this is a deployment problem rather than
      // anything an admin can fix on this page.
      body =
        '<div class="mm-set-state">Not set up yet.</div>' +
        '<p class="mm-set-hint">The Google keys have not been added to the ' +
        'server, so there is nothing to connect to yet.</p>';
    } else {
      body =
        '<div class="mm-set-state' + (on ? ' is-on' : '') + '">' +
          (on
            ? 'Connected' + (s.email ? ' as ' + U.esc(s.email) : '') + '.'
            : 'Not connected.') +
        '</div>' +
        '<div class="mm-btn-row">' +
          (on
            ? '<button class="mm-btn-sm mm-btn-secondary" id="mm-set-drive-off"' +
              (busy ? ' disabled' : '') + '>Disconnect</button>'
            : '') +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-set-drive-on"' +
            (busy ? ' disabled' : '') + '>' +
            (busy ? 'Working...' : (on ? 'Reconnect' : 'Connect Google Drive')) +
          '</button>' +
        '</div>' +
        (on
          ? ''
          : '<p class="mm-set-hint">This has to be done by the person who owns ' +
            'the Drive folders. A Google sign-in opens in a new tab; once it ' +
            'is approved the app stays connected and nobody needs to sign in ' +
            'again.</p>');
    }

    el.innerHTML =
      '<div class="mm-set">' +
        '<div class="mm-set-head">Google Drive</div>' +
        '<p class="mm-set-note">' +
          'Photos and videos added in the Measure tab are copied to Google ' +
          'Drive. They are always saved in GoHighLevel as well &mdash; Drive ' +
          'is an extra copy, so nothing is lost if it is not connected.' +
        '</p>' +
        body +
        '<p class="mm-task-error' + (isError ? '' : ' mm-set-ok') + '" ' +
          'id="mm-set-msg" role="alert">' + U.esc(msg || '') + '</p>' +
      '</div>' +
      aiCard() +
      imgCard();

    bind(el);
    bindAi(el);
    bindImg(el);
  }

  // ---- Visualising a room --------------------------------------------------
  //
  // Its own key, separate from the suggestions above. Visualising needs
  // Google Gemini specifically, while the suggestions run on any provider --
  // sharing one setting meant choosing a platform for one broke the other.

  var img = null;        // the last answer from /api/ai?action=image-status
  var imgBusy = false;
  var imgMsg = '';
  var imgErr = false;
  var imgPrompt = null;  // null = show what is saved

  function imgCard() {
    var s = img || {};
    var on = !!s.configured;
    var provs = s.providers || [{ id: 'gemini', label: 'Google Gemini (direct)' }];
    var here = provs.find(function (p) {
      return p.id === (s.provider || 'gemini');
    }) || provs[0];

    return '<div class="mm-set">' +
      '<div class="mm-set-head">Visualising a room</div>' +
      '<p class="mm-set-note">' +
        'The <strong>Visualise</strong> tab on a job: a photo of the ' +
        'customer&rsquo;s kitchen, shown with the doors you sell. Needs a ' +
        'Google Gemini key &mdash; this is separate from the suggestions ' +
        'above, so the two never affect each other.' +
      '</p>' +

      '<div class="mm-set-state' + (on ? ' is-on' : '') + '">' +
        (on
          ? 'Set up' + (s.model ? ' &mdash; ' + U.esc(s.model) : '') + '.'
          : 'Not set up. The Visualise tab says so until it is.') +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">Provider</span>' +
        '<select class="mm-select" id="mm-img-prov">' +
          provs.map(function (p) {
            return '<option value="' + U.esc(p.id) + '"' +
              (p.id === (s.provider || 'gemini') ? ' selected' : '') + '>' +
              U.esc(p.label) + '</option>';
          }).join('') +
        '</select>' +
        (here && here.note
          ? '<p class="mm-set-hint">' + U.esc(here.note) + '</p>' : '') +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">Model name</span>' +
        '<input class="mm-input" id="mm-img-model" ' +
          'placeholder="' + U.esc((here && here.defaultModel) || '') + '" ' +
          'value="' + U.esc(s.model || '') + '">' +
        '<p class="mm-set-hint">Leave blank to use ' +
          '<code>' + U.esc((here && here.defaultModel) || '') + '</code>. ' +
          'A Pro model keeps the room closest to the photo; the Flash ones ' +
          'are cheaper and take more liberties.</p>' +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">API key</span>' +
        '<input class="mm-input" id="mm-img-key" type="password" ' +
          'autocomplete="off" placeholder="' +
          (on ? 'Saved — leave blank to keep it' : 'Paste the Gemini key') + '">' +
        '<p class="mm-set-hint">Kept on the server and never shown again. ' +
          'It must belong to the provider chosen above. For Google, use a ' +
          'key of its own rather than the one the address lookup uses ' +
          '&mdash; that one is readable in the page.</p>' +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">What to ask for</span>' +
        '<textarea class="mm-input mm-ai-prompt" id="mm-img-prompt" rows="12">' +
          U.esc(imgPrompt !== null ? imgPrompt
                                   : (s.prompt || s.defaultPrompt || '')) +
        '</textarea>' +
        '<p class="mm-set-hint">' +
          '<code>{style}</code> is where the chosen door style goes. The rest ' +
          'is yours to change &mdash; what to keep untouched, how literally to ' +
          'follow the reference photos.</p>' +
      '</div>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-img-reset"' +
          (imgBusy ? ' disabled' : '') + '>Reset wording</button>' +
        (on
          ? '<button class="mm-btn-sm mm-btn-secondary" id="mm-img-clear"' +
            (imgBusy ? ' disabled' : '') + '>Remove</button>'
          : '') +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-img-save"' +
          (imgBusy ? ' disabled' : '') + '>' +
          (imgBusy ? 'Working...' : 'Save') + '</button>' +
      '</div>' +

      '<p class="mm-task-error' + (imgErr ? '' : ' mm-set-ok') + '" ' +
        'id="mm-img-msg" role="alert">' + U.esc(imgMsg || '') + '</p>' +
    '</div>';
  }

  function imgSay(m, bad) { imgMsg = m || ''; imgErr = !!bad; render(''); }

  function bindImg(el) {
    var pbox = el.querySelector('#mm-img-prompt');
    if (pbox) pbox.addEventListener('input', function () {
      imgPrompt = this.value;
    });

    var prov = el.querySelector('#mm-img-prov');
    if (prov) prov.addEventListener('change', function () {
      img = img || {};
      img.provider = this.value;
      // The model name belongs to the provider that was chosen, so a stale
      // one is cleared rather than sent to somewhere that never had it.
      img.model = '';
      imgSay('');
    });

    var save = el.querySelector('#mm-img-save');
    if (save) save.addEventListener('click', function () {
      var provider = el.querySelector('#mm-img-prov').value;
      var model = (el.querySelector('#mm-img-model').value || '').trim();
      var key = (el.querySelector('#mm-img-key').value || '').trim();
      var prompt = el.querySelector('#mm-img-prompt').value || '';
      // Blank means "whatever that provider's default is", which is what the
      // placeholder says -- so it is filled in here rather than refused.
      if (!model) {
        var p = (img && img.providers || []).find(function (x) {
          return x.id === provider;
        });
        model = (p && p.defaultModel) || '';
      }
      if (!model) { imgSay('Enter a model name.', true); return; }

      // Saving the built-in wording unchanged stores nothing, so a later
      // improvement to the default is picked up rather than frozen here.
      var def = (img && img.defaultPrompt) || '';
      if (prompt.trim() === def.trim()) prompt = '';

      imgBusy = true; imgSay('');
      aiFetch('image-save', { provider: provider, model: model,
                              key: key, prompt: prompt })
        .then(function () { imgPrompt = null; return imgRefresh('Saved.'); })
        .catch(function (e) {
          imgBusy = false;
          imgSay('Could not save: ' + e.message, true);
        });
    });

    var reset = el.querySelector('#mm-img-reset');
    if (reset) reset.addEventListener('click', function () {
      imgPrompt = (img && img.defaultPrompt) || '';
      imgSay('Wording reset. Press Save to keep it.');
    });

    var clear = el.querySelector('#mm-img-clear');
    if (clear) clear.addEventListener('click', function () {
      if (!window.confirm('Remove the visualising key? The Visualise tab ' +
                          'stops working until a new one is saved.')) return;
      imgBusy = true; imgSay('');
      aiFetch('image-clear', {})
        .then(function () { return imgRefresh('Removed.'); })
        .catch(function (e) {
          imgBusy = false;
          imgSay('Could not remove it: ' + e.message, true);
        });
    });
  }

  function imgRefresh(msg) {
    return aiFetch('image-status')
      .then(function (d) { img = d; imgBusy = false; imgSay(msg || ''); })
      .catch(function () { imgBusy = false; imgSay(msg || ''); });
  }

  // ---- The AI key ----------------------------------------------------------
  //
  // Used in exactly one place: suggesting what goes on a material list. The
  // key is written to the server and never read back -- this page can say
  // whether one exists and replace it, and that is all.
  //
  // The model NAME is typed rather than chosen from a list. Model names
  // change every few months, and a list baked into the app would be wrong by
  // the time anyone needed it.

  var ai = null;        // the last answer from /api/ai?action=status
  // What is in the wording box right now. Held here because any message
  // redraws the card, and a redraw would otherwise throw away an edit
  // half-typed.
  var aiPrompt = null;  // null = show what is saved
  var aiBusy = false;
  var aiMsg = '';
  var aiErr = false;

  function aiFetch(action, body) {
    return fetch('/api/ai?action=' + action, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var d;
        try { d = t ? JSON.parse(t) : {}; } catch (e) { d = {}; }
        if (!r.ok) throw new Error(d.error || 'Request failed.');
        return d;
      });
    });
  }

  function aiCard() {
    var s = ai || {};
    var on = !!s.configured;
    var provs = s.providers || [
      { id: 'gemini', label: 'Google Gemini' },
      { id: 'groq', label: 'Groq' },
      { id: 'openrouter', label: 'OpenRouter' },
    ];

    return '<div class="mm-set">' +
      '<div class="mm-set-head">AI suggestions</div>' +
      '<p class="mm-set-note">' +
        'Used in one place: the <strong>Suggest items</strong> button when ' +
        'building a material list. It is sent a few words such as ' +
        '&ldquo;kitchen remodel with island&rdquo; and sends back a list to ' +
        'edit. No job, customer or measurement is ever sent to it.' +
      '</p>' +

      '<div class="mm-set-state' + (on ? ' is-on' : '') + '">' +
        (on
          ? 'Set up' + (s.model ? ' &mdash; ' + U.esc(s.model) : '') + '.'
          : 'Not set up. The Suggest button stays hidden until it is.') +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">Platform</span>' +
        '<select class="mm-select" id="mm-ai-prov">' +
          provs.map(function (p) {
            return '<option value="' + U.esc(p.id) + '"' +
              (p.id === s.provider ? ' selected' : '') + '>' +
              U.esc(p.label) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">Model name</span>' +
        '<input class="mm-input" id="mm-ai-model" ' +
          'placeholder="e.g. gemini-2.5-flash" ' +
          'value="' + U.esc(s.model || '') + '">' +
        '<p class="mm-set-hint">Copy the model name from the platform you ' +
          'chose. Any model it offers will do &mdash; this is a simple job.</p>' +
      '</div>' +

      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">API key</span>' +
        '<input class="mm-input" id="mm-ai-key" type="password" ' +
          'autocomplete="off" placeholder="' +
          (on ? 'Saved — leave blank to keep it' : 'Paste the key') + '">' +
        '<p class="mm-set-hint">Kept on the server and never shown again. ' +
          'Leave it blank to change the model without pasting it back.</p>' +
      '</div>' +

      // The wording, editable. Shown filled in with whatever is in use, so
      // it can be read before it is changed rather than edited blind.
      '<div class="mm-mt-f" style="margin-bottom:10px">' +
        '<span class="mm-mt-flab">What to ask the AI</span>' +
        '<textarea class="mm-input mm-ai-prompt" id="mm-ai-prompt" rows="10">' +
          U.esc(aiPrompt !== null ? aiPrompt
                                  : (s.prompt || s.defaultPrompt || '')) +
        '</textarea>' +
        '<p class="mm-set-hint">' +
          '<code>{job}</code> is where the words typed on the Material Lists ' +
          'page are put. Say anything useful about how you work &mdash; the ' +
          'area, the brands you fit, what should never be suggested.' +
        '</p>' +
        // Stated rather than hidden: someone editing the wording should know
        // why the answer always comes back as a list.
        (s.formatRules
          ? '<details class="mm-ai-fixed"><summary>Always added at the end' +
              '</summary><pre>' + U.esc(s.formatRules) + '</pre>' +
              '<p class="mm-set-hint">This part is fixed. It is what makes ' +
                'the answer readable by the app rather than a paragraph of ' +
                'text.</p></details>'
          : '') +
      '</div>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-ai-reset"' +
          (aiBusy ? ' disabled' : '') + '>Reset wording</button>' +
        (on
          ? '<button class="mm-btn-sm mm-btn-secondary" id="mm-ai-clear"' +
            (aiBusy ? ' disabled' : '') + '>Remove</button>'
          : '') +
        (on
          ? '<button class="mm-btn-sm mm-btn-secondary" id="mm-ai-test"' +
            (aiBusy ? ' disabled' : '') + '>Test</button>'
          : '') +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-ai-save"' +
          (aiBusy ? ' disabled' : '') + '>' +
          (aiBusy ? 'Working...' : 'Save') + '</button>' +
      '</div>' +

      '<p class="mm-task-error' + (aiErr ? '' : ' mm-set-ok') + '" ' +
        'id="mm-ai-msg" role="alert">' + U.esc(aiMsg || '') + '</p>' +
    '</div>';
  }

  function aiSay(m, bad) { aiMsg = m || ''; aiErr = !!bad; render(''); }

  function bindAi(el) {
    var save = el.querySelector('#mm-ai-save');
    if (save) save.addEventListener('click', function () {
      var provider = el.querySelector('#mm-ai-prov').value;
      var model = (el.querySelector('#mm-ai-model').value || '').trim();
      var key = (el.querySelector('#mm-ai-key').value || '').trim();
      var prompt = el.querySelector('#mm-ai-prompt').value || '';
      if (!model) { aiSay('Enter a model name.', true); return; }

      // Saving the built-in wording unchanged stores nothing, so a later
      // improvement to the default is picked up rather than frozen here.
      var def = (ai && ai.defaultPrompt) || '';
      if (prompt.trim() === def.trim()) prompt = '';

      aiBusy = true; aiSay('');
      aiFetch('save', { provider: provider, model: model, key: key,
                        prompt: prompt })
        .then(function () { aiPrompt = null; return aiRefresh('Saved.'); })
        .catch(function (e) {
          aiBusy = false;
          aiSay('Could not save: ' + e.message, true);
        });
    });

    var test = el.querySelector('#mm-ai-test');
    if (test) test.addEventListener('click', function () {
      aiBusy = true; aiSay('Asking the AI...');
      aiFetch('test', { what: 'test' })
        .then(function (d) {
          aiBusy = false;
          aiSay('Working — it suggested ' + (d.items || []).length + ' items.');
        })
        .catch(function (e) {
          aiBusy = false;
          aiSay('It did not answer: ' + e.message, true);
        });
    });

    var reset = el.querySelector('#mm-ai-reset');
    if (reset) reset.addEventListener('click', function () {
      aiPrompt = (ai && ai.defaultPrompt) || '';
      aiSay('Wording reset. Press Save to keep it.');
    });

    var pbox = el.querySelector('#mm-ai-prompt');
    if (pbox) pbox.addEventListener('input', function () {
      aiPrompt = this.value;
    });

    var clear = el.querySelector('#mm-ai-clear');
    if (clear) clear.addEventListener('click', function () {
      if (!window.confirm('Remove the AI key? The Suggest button will ' +
                          'disappear until a new one is saved.')) return;
      aiBusy = true; aiSay('');
      aiFetch('clear', {})
        .then(function () { return aiRefresh('Removed.'); })
        .catch(function (e) {
          aiBusy = false;
          aiSay('Could not remove it: ' + e.message, true);
        });
    });
  }

  function aiRefresh(msg) {
    return aiFetch('status')
      .then(function (d) {
        ai = d; aiBusy = false; aiSay(msg || '');
      })
      .catch(function () { aiBusy = false; aiSay(msg || ''); });
  }

  function bind(el) {
    var onBtn = el.querySelector('#mm-set-drive-on');
    if (onBtn) onBtn.addEventListener('click', startConnect);

    var offBtn = el.querySelector('#mm-set-drive-off');
    if (offBtn) offBtn.addEventListener('click', function () {
      busy = true;
      render('');
      api('disconnect', 'POST')
        .then(function () { return refresh('Disconnected.'); })
        .catch(function (e) {
          busy = false;
          render('Could not disconnect: ' + e.message, true);
        });
    });
  }

  // ---- Connecting ----------------------------------------------------------

  // Google's consent screen opens in its own window. The callback page posts
  // back when it is finished, so the status refreshes without anyone having
  // to reload anything.
  function startConnect() {
    busy = true;
    render('');

    popup = window.open('/api/drive/connect', 'mm-drive-connect',
      'width=520,height=680');

    if (!popup) {
      busy = false;
      render('The sign-in window was blocked. Allow pop-ups for this site ' +
        'and try again.', true);
      return;
    }

    // A window that is simply closed sends nothing, so the state is checked
    // again either way rather than leaving the button stuck on "Working...".
    var timer = setInterval(function () {
      if (popup && popup.closed) {
        clearInterval(timer);
        setTimeout(function () { refresh(); }, 300);
      }
    }, 600);
  }

  function onMessage(ev) {
    var d = ev && ev.data;
    if (!d || !d.mmDrive) return;
    if (popup && !popup.closed) { try { popup.close(); } catch (e) { } }
    refresh(d.mmDrive === 'connected' ? 'Connected.' : '', d.mmDrive !== 'connected');
  }

  // ---- Loading -------------------------------------------------------------

  function refresh(msg, isError) {
    return api('status')
      .then(function (s) {
        state = s;
        busy = false;
        render(msg, isError);
        return s;
      })
      .catch(function (e) {
        busy = false;
        state = state || {};
        render('Could not check the connection: ' + e.message, true);
      });
  }

  function show() {
    var el = document.getElementById('mm-set-body');
    if (!el) return Promise.resolve();
    if (!auth.isAdmin()) {
      el.innerHTML = '<div class="mm-empty">Admins only.</div>';
      return Promise.resolve();
    }
    el.innerHTML = '<div class="mm-loading">' +
      '<span class="mm-spinner" aria-hidden="true"></span>' +
      '<span>Checking the connection&hellip;</span></div>';
    // Both cards are drawn together, so both states are read before the
    // first render rather than the page redrawing under the reader.
    aiMsg = ''; aiErr = false; aiPrompt = null;
    imgMsg = ''; imgErr = false; imgPrompt = null;
    // All three cards are drawn together, so every state is read before the
    // first render rather than the page rearranging under the reader.
    return Promise.all([
      aiFetch('status').then(function (d) { ai = d; })
        .catch(function () { ai = null; }),
      aiFetch('image-status').then(function (d) { img = d; })
        .catch(function () { img = null; }),
    ]).then(function () { return refresh(); });
  }

  window.addEventListener('message', onMessage);

  window.MM.settings = { show: show };
})();
