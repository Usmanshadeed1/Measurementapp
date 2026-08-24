// js/notes.js
// Customer notes on the job screen.
//
// GoHighLevel creates notes through the contact endpoint, but each note
// carries a `relations` array that ties it to a specific opportunity. So a
// customer with two jobs keeps separate notes on each — which is what the
// business needs, since a note about the kitchen is not about the bathroom.
//
// GHL cannot record who wrote a note through the API: every write uses one
// shared integration token, so `userId` comes back null. The app stamps the
// author's name into the note text instead, which is the only way to keep
// that information.
//
// Notes are deliberately NOT written to the activity history. The app can
// only see notes it creates itself — GHL offers no webhook for notes, no
// account-wide notes endpoint, and no dateUpdated field, so a note written
// in GoHighLevel could never be captured. A history holding some notes and
// silently missing others would read as complete when it is not.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var currentJob = null;
  var notes = [];

  function contactId() {
    return currentJob && (currentJob.contactId || (currentJob.contact || {}).id);
  }

  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // GHL notes can hold HTML from its own editor. Only the text is shown, so
  // pasted markup cannot break the layout or inject anything.
  function plain(note) {
    var raw = note.bodyText || note.body || '';
    if (!note.bodyText && /<[a-z][\s\S]*>/i.test(raw)) {
      var tmp = document.createElement('div');
      tmp.innerHTML = raw;
      raw = tmp.textContent || tmp.innerText || '';
    }
    return String(raw).trim();
  }

  function render() {
    var el = document.getElementById('mm-job-notes');
    if (!el) return;

    var head =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Notes</span>' +
        (notes.length
          ? '<span class="mm-steps-badge mm-steps-badge-done">' + notes.length +
            ' note' + (notes.length === 1 ? '' : 's') + '</span>'
          : '') +
      '</div>';

    el.innerHTML = head +
      '<p class="mm-crew-note">Notes for this job. They appear on the opportunity ' +
      'in GoHighLevel too.</p>' +
      (notes.length
        ? '<div class="mm-notelist">' + notes.map(noteRow).join('') + '</div>'
        : '<p class="mm-task-empty">No notes yet.</p>') +
      '<div class="mm-note-add">' +
        '<textarea class="mm-input" id="mm-note-text" rows="2" ' +
          'placeholder="Add a note about this job..."></textarea>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-note-save">Add note</button>' +
      '</div>' +
      '<p class="mm-task-error" id="mm-note-error" role="alert"></p>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function noteRow(n) {
    return '<div class="mm-note">' +
      '<div class="mm-note-body">' + U.esc(plain(n)) + '</div>' +
      '<div class="mm-note-foot">' +
        '<span class="mm-note-when">' + U.esc(fmtWhen(n.dateAdded)) + '</span>' +
        (auth.isAdmin()
          ? '<button type="button" class="mm-note-del" data-note="' + U.esc(n.id) + '" ' +
            'aria-label="Delete this note">Delete</button>' : '') +
      '</div>' +
    '</div>';
  }

  function noteError(msg) {
    var el = document.getElementById('mm-note-error');
    if (el) el.textContent = msg || '';
  }

  function bind(el) {
    var save = el.querySelector('#mm-note-save');
    if (save) save.addEventListener('click', addNote);

    el.querySelectorAll('[data-note]').forEach(function (b) {
      b.addEventListener('click', function () { removeNote(b.getAttribute('data-note'), b); });
    });
  }

  function addNote() {
    var box = document.getElementById('mm-note-text');
    var btn = document.getElementById('mm-note-save');
    var text = (box.value || '').trim();
    if (!text) { noteError('Write something first.'); box.focus(); return; }

    var cid = contactId();
    if (!cid) { noteError('This job has no customer attached.'); return; }

    noteError('');
    btn.disabled = true; btn.textContent = 'Saving...';

    // GHL cannot attribute an API-written note to a person, so the author is
    // written into the text — otherwise every note would look anonymous.
    var me = auth.user();
    var body = me ? text + '\n\n— ' + me.name : text;

    api.addNote(cid, body, currentJob.id)
      .then(function () {
        // Not logged to history on purpose — see the note at the top of
        // this file. The Notes panel is the record, and it shows every note
        // whether it was written here or in GoHighLevel.
        box.value = '';
        return load();
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Add note';
        noteError('Could not save: ' + e.message);
      });
  }

  function removeNote(noteId, btn) {
    var cid = contactId();
    if (!cid) return;
    noteError('');
    btn.disabled = true; btn.textContent = 'Deleting...';
    api.deleteNote(cid, noteId)
      .then(function () { return load(); })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Delete';
        noteError('Could not delete: ' + e.message);
      });
  }

  function load() {
    var cid = contactId();
    if (!cid) { notes = []; render(); return Promise.resolve(); }
    return api.getNotes(cid, currentJob.id)
      .then(function (rows) {
        // Newest first: the note someone needs is usually the most recent.
        notes = (rows || []).sort(function (a, b) {
          return new Date(b.dateAdded) - new Date(a.dateAdded);
        });
        render();
      })
      .catch(function (e) {
        notes = [];
        render();
        noteError(e.message);
      });
  }

  function showForJob(job) {
    currentJob = job;
    notes = [];
    var el = document.getElementById('mm-job-notes');
    if (el) {
      el.innerHTML = '<div class="mm-steps-head"><span class="mm-steps-title">Notes</span></div>' +
                     '<div class="mm-empty">Loading...</div>';
    }
    return load();
  }

  window.MM.notes = { showForJob: showForJob };
})();
