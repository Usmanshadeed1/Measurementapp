// js/emailtpl.js
// The wording used when emailing a customer their design or quote.
//
// Three templates -- design, quote, both -- kept in the database rather than
// in this file, so the words can be changed without a deploy. They are the
// starting point for an email, not the final text: the send box stays
// editable, and an edit there never changes the saved template.
//
// {{name}} and {{address}} are filled in when the box opens.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var KEY = 'email_templates';

  // What the app falls back to before anyone has saved their own, and what
  // "Reset to the default" puts back.
  var DEFAULTS = {
    design: {
      subject: 'Your design — {{address}}',
      body: 'Hi {{name}},\n\n' +
        'Please find the drawings for {{address}} below.\n\n' +
        'Any questions, or anything you would like changed? Happy to talk it ' +
        'through whenever suits you.\n\n' +
        'Eddie\nMaximus Construction NJ',
    },
    quote: {
      subject: 'Your quote — {{address}}',
      body: 'Hi {{name}},\n\n' +
        'Please find the quote for {{address}} below.\n\n' +
        'Let me know if you would like to go ahead, or if there is anything in ' +
        'it you would like me to explain.\n\n' +
        'Eddie\nMaximus Construction NJ',
    },
    both: {
      subject: 'Your design and quote — {{address}}',
      body: 'Hi {{name}},\n\n' +
        'Please find the drawings and the quote for {{address}} below.\n\n' +
        'Any questions, or anything you would like changed? Happy to talk it ' +
        'through whenever suits you.\n\n' +
        'Eddie\nMaximus Construction NJ',
    },
  };

  var LABELS = { design: 'The design', quote: 'The quote', both: 'Both' };
  var ORDER = ['design', 'quote', 'both'];

  var current = null;    // what is saved, or the defaults
  var loading = null;    // the in-flight read, so several callers share one

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function copyDefaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

  // ---- Reading -------------------------------------------------------------

  function load() {
    if (current) return Promise.resolve(current);
    if (loading) return loading;

    loading = db('GET', '/app_settings?key=eq.' + KEY + '&select=value')
      .then(function (rows) {
        var raw = rows && rows[0] && rows[0].value;
        current = raw ? merge(JSON.parse(raw)) : copyDefaults();
        loading = null;
        return current;
      })
      // A template that cannot be read must not stop an email being sent, so
      // the defaults stand in.
      .catch(function () {
        current = copyDefaults();
        loading = null;
        return current;
      });
    return loading;
  }

  // Saved templates fill in over the defaults, so a template added later is
  // not missing for someone whose saved copy predates it.
  function merge(saved) {
    var out = copyDefaults();
    ORDER.forEach(function (k) {
      if (!saved || !saved[k]) return;
      if (saved[k].subject) out[k].subject = saved[k].subject;
      if (saved[k].body) out[k].body = saved[k].body;
    });
    return out;
  }

  // The template for one kind, with the customer's details filled in.
  function forKind(kind, vars) {
    var t = (current || DEFAULTS)[kind] || DEFAULTS.design;
    return { subject: fill(t.subject, vars), body: fill(t.body, vars) };
  }

  // An empty address would leave "Your design — " trailing, so the separator
  // goes with it.
  function fill(text, vars) {
    var v = vars || {};
    var out = String(text || '')
      .replace(/\{\{\s*name\s*\}\}/g, v.name || 'there')
      .replace(/\{\{\s*address\s*\}\}/g, v.address || '');
    if (!v.address) out = out.replace(/\s*[—-]\s*$/gm, '').replace(/ for \s*$/gm, '');
    return out.replace(/[ \t]+$/gm, '');
  }

  // ---- Writing -------------------------------------------------------------

  function save(next) {
    var value = JSON.stringify(next);
    // The row exists after the first save and not before it, so which of the
    // two calls to make is decided by looking.
    return db('GET', '/app_settings?key=eq.' + KEY + '&select=key')
      .then(function (rows) {
        if (rows && rows.length) {
          return db('PATCH', '/app_settings?key=eq.' + KEY, { value: value });
        }
        return db('POST', '/app_settings', { key: KEY, value: value });
      })
      .then(function () {
        current = merge(next);
        return current;
      });
  }

  // ---- The editor ----------------------------------------------------------

  var draft = null;   // what is on screen, saved only when the button is used

  function render(msg) {
    var el = document.getElementById('mm-et-body');
    if (!el) return;

    el.innerHTML =
      ORDER.map(function (k) {
        var t = draft[k];
        return '<div class="mm-et">' +
          '<div class="mm-et-head">' + U.esc(LABELS[k]) + '</div>' +
          '<div class="mm-field-group">' +
            '<label class="mm-label" for="mm-et-sub-' + k + '">Subject</label>' +
            '<input class="mm-input" id="mm-et-sub-' + k + '" data-sub="' + k + '" ' +
              'value="' + U.esc(t.subject) + '">' +
          '</div>' +
          '<div class="mm-field-group">' +
            '<label class="mm-label" for="mm-et-body-' + k + '">Message</label>' +
            '<textarea class="mm-input mm-et-msg" id="mm-et-body-' + k + '" ' +
              'data-body="' + k + '" rows="9">' + U.esc(t.body) + '</textarea>' +
          '</div>' +
        '</div>';
      }).join('') +

      '<p class="mm-et-hint"><strong>{{name}}</strong> becomes the customer\'s ' +
        'first name and <strong>{{address}}</strong> becomes the property ' +
        'address when the email is written.</p>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-et-reset">' +
          'Reset to the defaults</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-et-save">Save templates</button>' +
      '</div>' +
      '<p class="mm-task-error" id="mm-et-msg" role="alert">' + U.esc(msg || '') + '</p>';

    bind(el);
  }

  function bind(el) {
    el.querySelectorAll('[data-sub]').forEach(function (i) {
      i.addEventListener('input', function () { draft[i.getAttribute('data-sub')].subject = i.value; });
    });
    el.querySelectorAll('[data-body]').forEach(function (i) {
      i.addEventListener('input', function () { draft[i.getAttribute('data-body')].body = i.value; });
    });

    var reset = el.querySelector('#mm-et-reset');
    if (reset) reset.addEventListener('click', function () {
      draft = copyDefaults();
      render('Reset. Press Save templates to keep it.');
    });

    var saveBtn = el.querySelector('#mm-et-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var empty = ORDER.some(function (k) {
        return !String(draft[k].subject || '').trim() || !String(draft[k].body || '').trim();
      });
      if (empty) {
        document.getElementById('mm-et-msg').textContent =
          'Every template needs a subject and a message.';
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      save(draft)
        .then(function () {
          saveBtn.disabled = false;
          U.fbk(saveBtn, 'Save templates');
        })
        .catch(function (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save templates';
          document.getElementById('mm-et-msg').textContent = 'Could not save: ' + e.message;
        });
    });
  }

  function show() {
    var el = document.getElementById('mm-et-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading...</div>';
    return load().then(function (t) {
      // A copy, so an abandoned edit does not become what the next email uses.
      draft = JSON.parse(JSON.stringify(t));
      render();
    });
  }

  window.MM.emailtpl = {
    load: load,
    show: show,
    forKind: forKind,
    all: function () { return current || copyDefaults(); },
    save: save,
    defaults: copyDefaults,
    LABELS: LABELS,
    ORDER: ORDER,
  };
})();
