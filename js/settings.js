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
      '</div>';

    bind(el);
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
    return refresh();
  }

  window.addEventListener('message', onMessage);

  window.MM.settings = { show: show };
})();
