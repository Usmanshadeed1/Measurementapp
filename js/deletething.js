// js/deletething.js
// Deleting a job, or a customer and everything attached to them.
//
// This is the only irreversible thing the app can do. GoHighLevel has no
// recycle bin and no restore: what goes, goes. So the box here is deliberately
// slower than every other delete in the app -- a wall or a photo is a plain
// confirm(), because remaking one costs a minute, while a customer's message
// history cannot be remade at all.
//
// Three things stand between a mis-tap and a lost customer:
//   - admin only, so a worker on a phone cannot reach it
//   - the box says exactly what is about to be destroyed, counted, not implied
//   - the name has to be typed before the button will work
//
// The name is shown in a box that can be copied from, because someone who
// means it should not be stopped by a spelling they cannot see.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var pending = null;   // { name, lines, run, onDone }
  var busy = false;

  // ---- The box -------------------------------------------------------------

  function open(opts) {
    pending = opts;
    busy = false;

    var el = document.getElementById('mm-del-body');
    if (!el) return;

    el.innerHTML =
      '<p class="mm-del-lead">' + U.esc(opts.lead) + '</p>' +

      (opts.lines && opts.lines.length
        ? '<ul class="mm-del-list">' +
            opts.lines.map(function (l) {
              return '<li>' + U.esc(l) + '</li>';
            }).join('') +
          '</ul>'
        : '') +

      '<p class="mm-del-warn">This cannot be undone. Nothing here can be ' +
        'recovered afterwards, in this app or in GoHighLevel.</p>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-del-type">' +
          'Type the name below to confirm</label>' +
        // Selectable rather than a placeholder: someone who means to do this
        // should be able to copy the name rather than guess at its spelling.
        '<div class="mm-del-name" id="mm-del-name">' + U.esc(opts.name) + '</div>' +
        '<input class="mm-input" id="mm-del-type" autocomplete="off" ' +
          'spellcheck="false" placeholder="Type the name exactly">' +
      '</div>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-del-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-danger" id="mm-del-go" disabled>' +
          U.esc(opts.action) + '</button>' +
      '</div>' +
      '<p class="mm-task-error" id="mm-del-error" role="alert"></p>';

    document.getElementById('mm-del-title').textContent = opts.title;
    document.getElementById('mm-modal-delete').classList.add('open');

    bind();
    var box = document.getElementById('mm-del-type');
    if (box) box.focus();
  }

  function close() {
    var m = document.getElementById('mm-modal-delete');
    if (m) m.classList.remove('open');
    pending = null;
    busy = false;
  }

  function bind() {
    var typed = document.getElementById('mm-del-type');
    var go = document.getElementById('mm-del-go');

    // Case and outside spaces are forgiven; the name itself is not. Someone
    // who types a different customer's name has not confirmed this one.
    function matches() {
      if (!pending) return false;
      return typed.value.trim().toLowerCase() === pending.name.trim().toLowerCase();
    }

    typed.addEventListener('input', function () {
      go.disabled = !matches();
    });

    typed.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && matches() && !busy) run();
    });

    go.addEventListener('click', function () { if (!busy) run(); });

    var cancel = document.getElementById('mm-del-cancel');
    if (cancel) cancel.addEventListener('click', close);
  }

  function run() {
    if (!pending || busy) return;
    busy = true;

    var go = document.getElementById('mm-del-go');
    var err = document.getElementById('mm-del-error');
    go.disabled = true;
    go.textContent = 'Deleting...';
    err.textContent = '';

    var task = pending;

    task.run()
      .then(function () {
        close();
        if (task.onDone) task.onDone();
      })
      .catch(function (e) {
        busy = false;
        go.disabled = false;
        go.textContent = task.action;
        err.textContent = 'Could not delete: ' + e.message;
      });
  }

  // ---- Deleting a job ------------------------------------------------------

  function confirmJob(job, onDone) {
    if (!auth.isAdmin() || !job || !job.id) return;

    var name = U.titleCase(job.name) || 'this job';

    open({
      title: 'Delete this job',
      lead: 'The job and everything measured on it will be removed from ' +
            'GoHighLevel.',
      lines: [
        'Its rooms, walls and measurements',
        'Its photos and videos',
        'Its dates, notes and job progress',
      ],
      name: name,
      action: 'Delete job',
      run: function () { return api.deleteOpportunity(job.id); },
      onDone: onDone,
    });
  }

  // ---- Deleting a customer -------------------------------------------------
  //
  // The jobs are counted before the box opens, so the warning says "3 jobs"
  // rather than leaving someone to wonder how many they are about to lose.

  function confirmContact(contact, onDone) {
    if (!auth.isAdmin() || !contact || !contact.id) return;

    var name = U.titleCase(
      contact.contactName ||
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
      contact.name
    ) || 'this customer';

    api.opportunitiesForContact(contact.id)
      // A count that cannot be fetched must not block the delete, but the box
      // should not claim zero jobs either -- so it says nothing about them.
      .catch(function () { return null; })
      .then(function (jobs) {
        var lines = [];

        if (jobs === null) {
          lines.push('Every job belonging to them (the number could not be checked)');
        } else if (jobs.length) {
          lines.push(jobs.length + (jobs.length === 1 ? ' job' : ' jobs') +
            ', with all their measurements and photos');
          jobs.slice(0, 5).forEach(function (o) {
            lines.push('— ' + (U.titleCase(o.name) || 'Untitled job'));
          });
          if (jobs.length > 5) {
            lines.push('— and ' + (jobs.length - 5) + ' more');
          }
        }

        lines.push('Every text message and email sent to them');
        lines.push('Their notes, tasks and appointments');

        open({
          title: 'Delete this customer',
          lead: 'This removes the customer from GoHighLevel completely, ' +
                'along with everything belonging to them:',
          lines: lines,
          name: name,
          action: 'Delete customer',
          run: function () { return api.deleteContact(contact.id); },
          onDone: onDone,
        });
      });
  }

  function init() {
    var overlay = document.getElementById('mm-modal-delete');
    if (overlay) overlay.addEventListener('click', function (e) {
      // Only a click on the backdrop itself, and never mid-delete.
      if (e.target === overlay && !busy) close();
    });
  }

  window.MM.deletething = {
    init: init,
    confirmJob: confirmJob,
    confirmContact: confirmContact,
  };
})();
