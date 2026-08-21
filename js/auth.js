// js/auth.js
// Who is using the app. Everything else on the page stays hidden until this
// resolves to a signed-in staff member.
//
// Supabase handles the passwords and sessions; this file only deals with the
// screens around it and the staff profile that carries the person's role.
// Talking to Supabase over plain fetch keeps the app dependency-free, the
// same as the rest of the codebase.
window.MM = window.MM || {};

(function () {
  var URL_BASE = 'https://ozmpcygzbooddrbplxcz.supabase.co';
  var ANON_KEY = 'sb_publishable_7hd1GNU7XM-tRw5UtAX1bA_Shj5WDch';

  var session = null;   // { access_token, refresh_token, user }
  var profile = null;   // row from public.staff
  var onReady = null;

  // ---- Storage ------------------------------------------------------------
  // The session lives in localStorage so a refresh does not log people out.
  // A field crew on a phone should not have to sign in every time.
  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem('mm_session', JSON.stringify(s));
      else localStorage.removeItem('mm_session');
    } catch (e) { /* private mode */ }
  }
  function loadSession() {
    try {
      var raw = localStorage.getItem('mm_session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ---- Supabase calls -----------------------------------------------------

  function authFetch(path, body) {
    return fetch(URL_BASE + '/auth/v1' + path, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(readJson);
  }

  // Reads rows as the signed-in user, so the database's own row-level rules
  // decide what comes back rather than the browser being trusted.
  function dbFetch(method, path, body) {
    var headers = {
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + (session ? session.access_token : ANON_KEY),
      'Content-Type': 'application/json',
    };
    if (method === 'POST' || method === 'PATCH') headers.Prefer = 'return=representation';
    return fetch(URL_BASE + '/rest/v1' + path, {
      method: method, headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(readJson).catch(function (e) {
      // fetch() rejects with a bare "Failed to fetch" for anything network
      // level — offline, blocked, CORS — which tells the user nothing.
      if (e instanceof TypeError) {
        throw new Error('Could not reach the database. Check your connection and try again.');
      }
      throw e;
    });
  }

  function readJson(r) {
    return r.text().then(function (t) {
      var data;
      try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { raw: t }; }
      if (!r.ok) {
        throw new Error(data.msg || data.message || data.error_description ||
                        data.error || 'Request failed (' + r.status + ')');
      }
      return data;
    });
  }

  // ---- Sign in / up / out -------------------------------------------------

  function signIn(email, password) {
    return authFetch('/token?grant_type=password', { email: email, password: password })
      .then(function (s) {
        saveSession(s);
        return loadProfile();
      });
  }

  function signUp(name, email, password, code) {
    // The team code is checked against the database, not hard-coded here, so
    // it can be changed without a deploy — and so it is never sitting in the
    // browser bundle for anyone to read.
    return dbFetch('GET', '/app_settings?key=eq.signup_code&select=value')
      .then(function (rows) {
        var expected = rows && rows[0] && rows[0].value;
        if (!expected) throw new Error('Signup is not available right now.');
        if (String(code).trim().toUpperCase() !== String(expected).toUpperCase()) {
          throw new Error('That team code is not right. Ask your manager for it.');
        }
        return authFetch('/signup', { email: email, password: password });
      })
      .then(function (s) {
        // With email confirmation off, signup returns a usable session.
        if (s.access_token) saveSession(s);
        else return signIn(email, password);
      })
      .then(function () {
        return dbFetch('POST', '/staff', {
          id: session.user.id, name: name, email: email, role: 'worker',
        });
      })
      .then(function () { return loadProfile(); });
  }

  function signOut() {
    saveSession(null);
    profile = null;
    location.reload();
  }

  // ---- Profile ------------------------------------------------------------

  function loadProfile() {
    if (!session || !session.user) return Promise.resolve(null);
    return dbFetch('GET', '/staff?id=eq.' + session.user.id + '&select=*')
      .then(function (rows) {
        profile = (rows && rows[0]) || null;
        return profile;
      });
  }

  // A session that has expired should send the person back to the login
  // screen rather than leaving them on a page that silently fails.
  function refreshIfNeeded() {
    if (!session || !session.refresh_token) return Promise.resolve(null);
    return loadProfile().catch(function () {
      return authFetch('/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(function (s) { saveSession(s); return loadProfile(); })
        .catch(function () { saveSession(null); return null; });
    });
  }

  // ---- Screens ------------------------------------------------------------

  function show(view) {
    document.getElementById('mm-auth').style.display = 'flex';
    document.getElementById('mm-app').style.display = 'none';
    document.querySelectorAll('.mm-auth-panel').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-panel') === view);
    });
    setError('');
  }
  function showApp() {
    document.getElementById('mm-auth').style.display = 'none';
    document.getElementById('mm-app').style.display = '';
    var el = document.getElementById('mm-whoami');
    if (el && profile) {
      el.innerHTML = '<span class="mm-whoami-name">' + esc(profile.name) + '</span>' +
        '<span class="mm-whoami-role">' + esc(profile.role) + '</span>';
    }
  }
  function setError(msg) {
    var el = document.getElementById('mm-auth-error');
    if (el) el.textContent = msg || '';
  }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function busy(btn, on, label) {
    btn.disabled = on;
    btn.textContent = on ? 'Please wait...' : label;
  }

  function init(ready) {
    onReady = ready;
    session = loadSession();

    document.querySelectorAll('[data-goto]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        show(a.getAttribute('data-goto'));
      });
    });

    var inBtn = document.getElementById('mm-signin-btn');
    inBtn.addEventListener('click', function () {
      var email = document.getElementById('mm-in-email').value.trim();
      var pass = document.getElementById('mm-in-pass').value;
      if (!email || !pass) { setError('Enter your email and password.'); return; }
      setError('');
      busy(inBtn, true, 'Sign in');
      signIn(email, pass)
        .then(function (p) {
          if (!p) throw new Error('Your account is not set up yet. Ask your manager.');
          showApp();
          if (onReady) onReady(p);
        })
        .catch(function (e) {
          busy(inBtn, false, 'Sign in');
          setError(friendly(e.message));
        });
    });

    var upBtn = document.getElementById('mm-signup-btn');
    upBtn.addEventListener('click', function () {
      var name = document.getElementById('mm-up-name').value.trim();
      var email = document.getElementById('mm-up-email').value.trim();
      var pass = document.getElementById('mm-up-pass').value;
      var code = document.getElementById('mm-up-code').value.trim();
      if (!name || !email || !pass || !code) { setError('Fill in every box.'); return; }
      if (pass.length < 6) { setError('Use a password of at least 6 characters.'); return; }
      setError('');
      busy(upBtn, true, 'Create my account');
      signUp(name, email, pass, code)
        .then(function (p) {
          showApp();
          if (onReady) onReady(p);
        })
        .catch(function (e) {
          busy(upBtn, false, 'Create my account');
          setError(friendly(e.message));
        });
    });

    // Enter submits whichever panel is open.
    document.getElementById('mm-auth').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var panel = document.querySelector('.mm-auth-panel.active');
      if (!panel) return;
      var btn = panel.querySelector('.mm-btn-primary');
      if (btn && !btn.disabled) btn.click();
    });

    var outBtn = document.getElementById('mm-signout');
    if (outBtn) outBtn.addEventListener('click', signOut);

    // Resume an existing session, otherwise show the login screen.
    if (session) {
      refreshIfNeeded().then(function (p) {
        if (p) { showApp(); if (onReady) onReady(p); }
        else show('signin');
      });
    } else {
      show('signin');
    }
  }

  // Supabase error strings are written for developers; these are the ones a
  // person will actually hit.
  function friendly(msg) {
    var m = String(msg || '');
    if (m.indexOf('Invalid login') > -1) return 'Wrong email or password.';
    if (m.indexOf('already registered') > -1) return 'That email already has an account — sign in instead.';
    if (m.indexOf('Email not confirmed') > -1) return 'This account still needs email confirmation turning off in Supabase.';
    if (m.indexOf('duplicate key') > -1) return 'That account already exists — sign in instead.';
    return m;
  }

  window.MM.auth = {
    init: init,
    signOut: signOut,
    dbFetch: dbFetch,
    user: function () { return profile; },
    isAdmin: function () { return !!profile && profile.role === 'admin'; },
  };
})();
