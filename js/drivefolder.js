// js/drivefolder.js
// A link to the job's Google Drive folder.
//
// Everything that is not a photo or a measurement — quotes from suppliers,
// signed paperwork, the customer's own inspiration pictures — tends to live in
// Drive already. This keeps the folder one tap from the job rather than
// somewhere in a bookmark list.
//
// The link is stored in a single-line custom field on the opportunity, so it
// is visible in GoHighLevel too. Creating the folder is still done in Drive:
// GoHighLevel has no Drive action in its workflows and exposes no Drive access
// through its API, so there is nothing to automate against from here.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var FIELD_ID = 'kCABMlFG0RfzmOAM7vYN';   // Opportunity -> Drive Folder

  var currentJob = null;
  var link = '';
  var editing = false;
  var saving = false;

  // Only http(s) is followed. A link pasted from elsewhere could otherwise
  // carry a javascript: URL, which would run when tapped.
  function safeLink(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function showError(msg) {
    var el = document.getElementById('mm-dr-error');
    if (el) el.textContent = msg || '';
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  // ---- Loading -------------------------------------------------------------

  function showForJob(job) {
    currentJob = job;
    link = '';
    editing = false;

    var el = document.getElementById('mm-job-drive');
    if (!el) return Promise.resolve();
    el.innerHTML = head() + '<div class="mm-empty">Loading...</div>';

    return api.getOpportunity(job.id)
      .then(function (opp) {
        link = opp ? String(api.oppField(opp, FIELD_ID) || '').trim() : '';
        render();
      })
      .catch(function (e) {
        el.innerHTML = head() + '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function head() {
    return '<div class="mm-steps-head">' +
      '<span class="mm-steps-title">Drive Folder</span>' +
      (link
        ? '<span class="mm-steps-badge mm-steps-badge-done">Linked</span>'
        : '<span class="mm-steps-badge mm-steps-badge-todo">Not set</span>') +
    '</div>';
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-job-drive');
    if (!el) return;

    var url = safeLink(link);

    el.innerHTML =
      head() +
      (editing
        ? form()
        : (url
            ? '<div class="mm-dr-row">' +
                '<a class="mm-dr-open" href="' + U.esc(url) + '" ' +
                  'target="_blank" rel="noopener">' +
                  '<span aria-hidden="true">&#128193;</span> Open Drive folder</a>' +
                (auth.isAdmin()
                  ? '<button type="button" class="mm-dr-edit" id="mm-dr-change">Change</button>'
                  : '') +
              '</div>' +
              '<p class="mm-dr-url">' + U.esc(url) + '</p>'
            : (link
                // Something is stored but it is not a usable web address.
                ? '<p class="mm-task-empty">The saved link does not look like a ' +
                  'web address.</p>' +
                  (auth.isAdmin()
                    ? '<div class="mm-dr-row"><button type="button" ' +
                      'class="mm-btn-sm mm-btn-primary" id="mm-dr-add">Fix the link</button></div>'
                    : '')
                : '<p class="mm-task-empty">No folder linked yet.</p>' +
                  (auth.isAdmin()
                    ? '<div class="mm-dr-row"><button type="button" ' +
                      'class="mm-btn-sm mm-btn-primary" id="mm-dr-add">Add folder link</button></div>'
                    : '')))) +
      '<p class="mm-task-error" id="mm-dr-error" role="alert"></p>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function form() {
    return '<div class="mm-dr-form">' +
      pickerHtml() +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-dr-input">Folder link</label>' +
        '<input class="mm-input" id="mm-dr-input" type="url" ' +
          'placeholder="https://drive.google.com/drive/folders/..." ' +
          'value="' + U.esc(link) + '">' +
        '<p class="mm-dr-hint">Open the folder in Google Drive, copy the address ' +
          'from the browser, and paste it here.</p>' +
      '</div>' +
      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-dr-cancel">Cancel</button>' +
        (link
          ? '<button class="mm-btn-sm mm-btn-secondary" id="mm-dr-clear">Remove</button>'
          : '') +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-dr-save"' +
          (saving ? ' disabled' : '') + '>' +
          (saving ? 'Saving...' : 'Save link') + '</button>' +
      '</div>' +
    '</div>';
  }

  // ---- Choosing from the folders already in Drive ---------------------------
  //
  // A job made before this app existed already has a folder, sitting in the
  // client's parent folder. Picking it from a list beats copying an address
  // out of the browser -- but the list needs Drive connected, so the paste
  // box stays underneath as the way that always works.

  var picker = { state: 'idle', list: [] };   // idle | loading | ready | failed

  function pickerHtml() {
    if (picker.state === 'loading') {
      return '<div class="mm-field-group"><div class="mm-loading">' +
        '<span class="mm-spinner" aria-hidden="true"></span>' +
        '<span>Reading your Drive folders&hellip;</span></div></div>';
    }

    if (picker.state === 'ready') {
      if (!picker.list.length) {
        return '<div class="mm-field-group">' +
          '<p class="mm-dr-hint">No folders found in the Drive folder this app ' +
          'was pointed at. Paste a link instead.</p></div>';
      }
      return '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-dr-pick">Choose a folder</label>' +
        '<select class="mm-select" id="mm-dr-pick">' +
          '<option value="">Pick a folder...</option>' +
          picker.list.map(function (f) {
            return '<option value="' + U.esc(f.link) + '">' + U.esc(f.name) + '</option>';
          }).join('') +
        '</select>' +
        '<p class="mm-dr-hint">Choosing one fills in the link below. Nothing in ' +
          'the folder is changed.</p>' +
      '</div>';
    }

    if (picker.state === 'failed') return '';   // the paste box covers it

    return '<div class="mm-field-group">' +
      '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
        'id="mm-dr-browse">Choose from my Drive</button></div>';
  }

  function loadFolders() {
    if (!window.MM.drive) { picker.state = 'failed'; render(); return; }
    picker.state = 'loading';
    render();
    window.MM.drive.listFolders()
      .then(function (list) {
        picker.list = list || [];
        picker.state = 'ready';
        render();
      })
      .catch(function (e) {
        picker.state = 'failed';
        render();
        showError(e.message + ' You can still paste the link.');
      });
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var browse = el.querySelector('#mm-dr-browse');
    if (browse) browse.addEventListener('click', loadFolders);

    var pick = el.querySelector('#mm-dr-pick');
    if (pick) pick.addEventListener('change', function () {
      var input = document.getElementById('mm-dr-input');
      if (input && pick.value) input.value = pick.value;
    });

    var add = el.querySelector('#mm-dr-add') || el.querySelector('#mm-dr-change');
    if (add) add.addEventListener('click', function () {
      editing = true; render();
      var f = document.getElementById('mm-dr-input');
      if (f) f.focus();
    });

    var cancel = el.querySelector('#mm-dr-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      editing = false; render();
    });

    var save = el.querySelector('#mm-dr-save');
    if (save) save.addEventListener('click', function () {
      var v = (document.getElementById('mm-dr-input').value || '').trim();
      if (v && !safeLink(v)) {
        showError('That does not look like a web address. It should start with https://');
        return;
      }
      write(v, v ? 'Linked the Drive folder' : 'Removed the Drive folder link');
    });

    var clear = el.querySelector('#mm-dr-clear');
    if (clear) clear.addEventListener('click', function () {
      write('', 'Removed the Drive folder link');
    });
  }

  function write(value, logText) {
    saving = true;
    showError('');
    render();
    api.setOpportunityField(currentJob.id, FIELD_ID, value)
      .then(function () {
        link = value;
        saving = false;
        editing = false;
        window.MM.activity.log('note', logText, {
          jobId: currentJob.id, jobName: jobLabel(currentJob),
        });
        render();
      })
      .catch(function (e) {
        saving = false;
        render();
        showError('Could not save: ' + e.message);
      });
  }

  window.MM.drivefolder = { showForJob: showForJob };
})();
