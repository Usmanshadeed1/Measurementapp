// js/settings.js
// Admin settings.
//
// One page for the keys and switches an admin owns. Right now that is the
// Google address key, but the shape is built for more: each setting is a row
// with its own explanation, because whoever fills these in is not the person
// who wrote the code.
//
// Values live in the database rather than in a file, so changing one does not
// need a deploy.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var KEY = 'google_places_key';

  var saved = null;    // what is stored, once read
  var loading = null;  // the in-flight read, so several callers share one

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  // ---- Reading -------------------------------------------------------------

  function loadKey() {
    if (saved !== null) return Promise.resolve(saved);
    if (loading) return loading;

    loading = db('GET', '/app_settings?key=eq.' + KEY + '&select=value')
      .then(function (rows) {
        saved = (rows && rows[0] && rows[0].value) || '';
        loading = null;
        return saved;
      })
      // A key that cannot be read must not break the page that wanted it.
      // Address boxes simply stay ordinary typing boxes.
      .catch(function () {
        saved = '';
        loading = null;
        return saved;
      });
    return loading;
  }

  // ---- Writing -------------------------------------------------------------

  function saveKey(value) {
    var v = String(value || '').trim();
    // The row exists after the first save and not before it, so which of the
    // two calls to make is decided by looking.
    return db('GET', '/app_settings?key=eq.' + KEY + '&select=key')
      .then(function (rows) {
        if (rows && rows.length) {
          return db('PATCH', '/app_settings?key=eq.' + KEY, { value: v });
        }
        return db('POST', '/app_settings', { key: KEY, value: v });
      })
      .then(function () {
        saved = v;
        return v;
      });
  }

  // ---- The page ------------------------------------------------------------

  function render(msg) {
    var el = document.getElementById('mm-set-body');
    if (!el) return;

    var has = !!saved;

    el.innerHTML =
      '<div class="mm-set">' +
        '<div class="mm-set-head">Google address autocomplete</div>' +
        '<p class="mm-set-note">' +
          'With a key saved, address boxes suggest real addresses as you type ' +
          'and fill in the rest for you. Without one, they stay ordinary ' +
          'typing boxes and nothing else changes.' +
        '</p>' +

        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-set-gkey">Google API key</label>' +
          '<input class="mm-input" id="mm-set-gkey" spellcheck="false" ' +
            'autocomplete="off" placeholder="Paste the key here" ' +
            'value="' + U.esc(saved || '') + '">' +
        '</div>' +

        '<div class="mm-set-state' + (has ? ' is-on' : '') + '">' +
          (has ? 'Autocomplete is on.' : 'Autocomplete is off — no key saved.') +
        '</div>' +

        '<div class="mm-btn-row">' +
          (has
            ? '<button class="mm-btn-sm mm-btn-secondary" id="mm-set-gclear">' +
              'Remove the key</button>'
            : '') +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-set-gsave">Save key</button>' +
        '</div>' +

        '<p class="mm-set-hint">' +
          'The key is used by the browser, so anyone viewing the page can read ' +
          'it. Restrict it in Google Cloud to this website only, and to the ' +
          'Places API, so it cannot be used anywhere else.' +
        '</p>' +

        '<p class="mm-task-error" id="mm-set-msg" role="alert">' +
          U.esc(msg || '') + '</p>' +
      '</div>';

    bind(el);
  }

  function bind(el) {
    var input = el.querySelector('#mm-set-gkey');

    var saveBtn = el.querySelector('#mm-set-gsave');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var v = String(input.value || '').trim();
      if (!v) {
        el.querySelector('#mm-set-msg').textContent =
          'Paste a key first, or use Remove the key to turn autocomplete off.';
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      saveKey(v)
        .then(function () {
          // Reloading is the honest way to pick the key up: Google's script
          // can only be loaded once per page, so a saved key starts working
          // on the next load rather than this one.
          render('Saved. Reload the page to start using it.');
        })
        .catch(function (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save key';
          el.querySelector('#mm-set-msg').textContent = 'Could not save: ' + e.message;
        });
    });

    var clearBtn = el.querySelector('#mm-set-gclear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      clearBtn.disabled = true;
      clearBtn.textContent = 'Removing...';
      saveKey('')
        .then(function () {
          render('Removed. Reload the page to turn it off.');
        })
        .catch(function (e) {
          clearBtn.disabled = false;
          clearBtn.textContent = 'Remove the key';
          el.querySelector('#mm-set-msg').textContent = 'Could not remove: ' + e.message;
        });
    });
  }

  function show() {
    var el = document.getElementById('mm-set-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading...</div>';
    return loadKey().then(function () { render(); });
  }

  window.MM.settings = {
    show: show,
    loadKey: loadKey,
    googleKey: function () { return saved || ''; },
  };
})();
