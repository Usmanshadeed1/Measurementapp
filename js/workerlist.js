// js/workerlist.js
// The worker list: everyone who can be assigned a task.
//
// Two kinds of person end up here, and telling them apart is the whole point
// of the page:
//
//   Has login   a row in `staff`, tied to a real account. They sign in, see
//               their own tasks, and tick them off.
//   Name only   a row in `workers`. A painter hired for a day, a
//               subcontractor. They can be assigned work so the record is
//               right, but they cannot sign in and will not see it.
//
// The two are kept in separate tables because a `staff` row is bound to a
// Supabase auth account. Inventing rows there without accounts would break
// signing in, so the name-only people live apart and are merged for display.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var loginStaff = [];   // from `staff` — real accounts
  var plainNames = [];   // from `workers` — names only
  var editing = null;    // worker being edited, or null
  var adding = false;

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-workers-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading...</div>';

    return Promise.all([
      db('GET', '/staff?select=id,name,email,role&active=eq.true&order=name'),
      db('GET', '/workers?select=*&active=eq.true&order=name')
        // The table may not exist yet on an older database; an empty list is
        // better than an error page that hides the people who do have logins.
        .catch(function () { return []; }),
    ]).then(function (res) {
      loginStaff = res[0] || [];
      plainNames = res[1] || [];
      render();
    }).catch(function (e) {
      el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
    });
  }

  // The list the rest of the app assigns from: both kinds, names only,
  // sorted together so the dropdown reads as one list of people.
  function assignableNames() {
    // Admins are included: the person running a small remodelling business
    // does the work as well as managing it, and could not otherwise assign
    // anything to themselves.
    var out = loginStaff.map(function (s) { return { name: s.name, hasLogin: true }; });
    plainNames.forEach(function (w) { out.push({ name: w.name, hasLogin: false }); });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-workers-body');
    if (!el) return;

    var withLogin = loginStaff;

    el.innerHTML =
      (adding || editing ? formBox() : '') +
      section('Has login', withLogin.length,
        'These people signed up and can open the app. They see the tasks ' +
        'assigned to them and tick them off.',
        withLogin.length
          ? withLogin.map(loginRow).join('')
          : '<p class="mm-task-empty">Nobody has signed up yet.</p>') +
      section('Name only', plainNames.length,
        'Names for assigning work to. They cannot sign in, so they will not ' +
        'see the task in the app.',
        plainNames.length
          ? plainNames.map(plainRow).join('')
          : '<p class="mm-task-empty">No one yet. Add a name above.</p>') +
      '<p class="mm-task-error" id="mm-wk-error" role="alert"></p>';

    bind(el);
  }

  function section(title, n, note, body) {
    return '<section class="mm-wk-section">' +
      '<div class="mm-wk-sechead">' +
        '<h3 class="mm-wk-sectitle">' + U.esc(title) + '</h3>' +
        '<span class="mm-wk-count">' + n + '</span>' +
      '</div>' +
      '<p class="mm-wk-secnote">' + U.esc(note) + '</p>' +
      '<div class="mm-wk-list">' + body + '</div>' +
    '</section>';
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  // No edit or delete here: the account is theirs, and removing the name
  // while the login exists would leave them signed in with no profile.
  function loginRow(s) {
    return '<div class="mm-wk">' +
      '<span class="mm-wk-avatar is-login">' + U.esc(initials(s.name)) + '</span>' +
      '<div class="mm-wk-main">' +
        '<div class="mm-wk-name">' + U.esc(s.name) + '</div>' +
        (s.email ? '<div class="mm-wk-sub">' + U.esc(s.email) + '</div>' : '') +
      '</div>' +
      '<span class="mm-wk-tag is-login">Has login</span>' +
    '</div>';
  }

  function plainRow(w) {
    var sub = [w.email, U.phone(w.phone)].filter(Boolean).join(' · ');
    return '<div class="mm-wk">' +
      '<span class="mm-wk-avatar">' + U.esc(initials(w.name)) + '</span>' +
      '<div class="mm-wk-main">' +
        '<div class="mm-wk-name">' + U.esc(w.name) + '</div>' +
        (sub ? '<div class="mm-wk-sub">' + U.esc(sub) + '</div>' : '') +
      '</div>' +
      '<span class="mm-wk-tag">Name only</span>' +
      '<div class="mm-wk-side">' +
        '<button type="button" class="mm-wk-icon" data-edit="' + U.esc(w.id) + '" ' +
          'aria-label="Edit ' + U.esc(w.name) + '">&#9998;</button>' +
        '<button type="button" class="mm-wk-icon mm-wk-del" data-del="' + U.esc(w.id) + '" ' +
          'aria-label="Remove ' + U.esc(w.name) + '">&times;</button>' +
      '</div>' +
    '</div>';
  }

  function formBox() {
    var w = editing || { name: '', email: '', phone: '' };
    return '<div class="mm-wk-form">' +
      '<h3 class="mm-wk-formtitle">' +
        (editing ? 'Edit worker' : 'Add a worker') + '</h3>' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-wk-name">Name</label>' +
        '<input class="mm-input" id="mm-wk-name" placeholder="e.g. Mike Torres" ' +
          'value="' + U.esc(w.name || '') + '">' +
      '</div>' +
      '<div class="mm-wk-row">' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-wk-email">Email <span class="mm-opt">(optional)</span></label>' +
          '<input class="mm-input" type="email" id="mm-wk-email" ' +
            'value="' + U.esc(w.email || '') + '">' +
        '</div>' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-wk-phone">Phone <span class="mm-opt">(optional)</span></label>' +
          '<input class="mm-input" type="tel" id="mm-wk-phone" ' +
            'value="' + U.esc(w.phone || '') + '">' +
        '</div>' +
      '</div>' +
      '<p class="mm-wk-formnote">Email and phone are stored for sending ' +
        'reminders later. Neither creates a login.</p>' +
      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-wk-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-wk-save">' +
          (editing ? 'Save changes' : 'Add worker') + '</button>' +
      '</div>' +
    '</div>';
  }

  function showError(msg) {
    var el = document.getElementById('mm-wk-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var cancel = el.querySelector('#mm-wk-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null; render();
    });

    var save = el.querySelector('#mm-wk-save');
    if (save) save.addEventListener('click', saveWorker);

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editing = plainNames.find(function (w) { return w.id === b.getAttribute('data-edit'); });
        adding = false;
        render();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { removeWorker(b.getAttribute('data-del'), b); });
    });
  }

  function saveWorker() {
    var btn = document.getElementById('mm-wk-save');
    var name = (document.getElementById('mm-wk-name').value || '').trim();
    if (!name) {
      showError('Give the worker a name.');
      document.getElementById('mm-wk-name').focus();
      return;
    }

    // A task stores its assignee as plain text, so two people sharing a name
    // could never be told apart afterwards.
    var clash = assignableNames().some(function (p) {
      return p.name.toLowerCase() === name.toLowerCase() &&
             (!editing || editing.name.toLowerCase() !== name.toLowerCase());
    });
    if (clash) {
      showError('There is already someone called ' + name + '.');
      return;
    }

    var body = {
      // A task stores its assignees as a comma-separated list, so a comma in
      // a name would silently split that person in two.
      name: name.replace(/,/g, ' '),
      email: (document.getElementById('mm-wk-email').value || '').trim() || null,
      phone: (document.getElementById('mm-wk-phone').value || '').trim() || null,
    };

    showError('');
    btn.disabled = true; btn.textContent = 'Saving...';

    var req = editing
      ? db('PATCH', '/workers?id=eq.' + encodeURIComponent(editing.id), body)
      : db('POST', '/workers', body);

    req.then(function () {
      window.MM.activity.log('staff',
        (editing ? 'Updated worker ' : 'Added worker ') + name, {});
      adding = false; editing = null;
      return load();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = editing ? 'Save changes' : 'Add worker';
      showError('Could not save: ' + e.message);
    });
  }

  // Marked inactive rather than deleted: tasks already assigned to this
  // person name them in text, and the record should still make sense.
  function removeWorker(id, btn) {
    var w = plainNames.find(function (x) { return x.id === id; });
    btn.disabled = true;
    showError('');
    db('PATCH', '/workers?id=eq.' + encodeURIComponent(id), { active: false })
      .then(function () {
        window.MM.activity.log('staff', 'Removed worker ' + (w ? w.name : ''), {});
        return load();
      })
      .catch(function (e) {
        btn.disabled = false;
        showError('Could not remove: ' + e.message);
      });
  }

  function init() {
    var add = document.getElementById('mm-workers-add');
    if (add) add.addEventListener('click', function () {
      adding = true; editing = null; render();
      var f = document.getElementById('mm-wk-name');
      if (f) f.focus();
    });
  }

  window.MM.workerlist = {
    init: init, load: load, assignableNames: assignableNames,
  };
})();
