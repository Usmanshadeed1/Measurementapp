// js/cabinetdoors.js
// Cabinet door styles on a job.
//
// A remodel rarely uses one door throughout: the kitchen might be Shaker in
// white, the island a navy slab, the pantry natural oak. Each of those has to
// be ordered correctly, so the job needs a list rather than a single value —
// which is why "Location" is part of it.
//
// Stored one style per line in a multi-line field on the opportunity, so the
// list is visible in GoHighLevel as well as here:
//
//   Kitchen|Shaker|White
//   Island|Slab|Navy Blue
//
// Location is free text. Cabinets are often chosen before the rooms are
// measured, and "Island" is not a room anyway.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var FIELD_ID = 'lqurScDnzsk4sWIJX6CL';   // Opportunity -> Cabinet Doors
  var SEP = '|';

  var currentJob = null;
  var doors = [];
  var editing = null;    // index being edited, or null
  var adding = false;
  var saving = false;

  // ---- Reading and writing -------------------------------------------------

  function parse(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var p = raw.split(SEP);
      out.push({
        location: (p[0] || '').trim(),
        style: (p[1] || '').trim(),
        finish: (p[2] || '').trim(),
      });
    });
    return out;
  }

  function serialise(rows) {
    return rows.map(function (d) {
      return [d.location, d.style, d.finish].join(SEP);
    }).join('\n');
  }

  function save(logText) {
    saving = true;
    render();
    return api.setOpportunityField(currentJob.id, FIELD_ID, serialise(doors))
      .then(function () {
        saving = false;
        adding = false; editing = null;
        if (logText) {
          window.MM.activity.log('note', logText, {
            jobId: currentJob.id, jobName: jobLabel(currentJob),
          });
        }
        render();
      })
      .catch(function (e) {
        saving = false;
        render();
        showError('Could not save: ' + e.message);
      });
  }

  function showError(msg) {
    var el = document.getElementById('mm-cd-error');
    if (el) el.textContent = msg || '';
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  function describe(d) {
    return [d.location, d.style, d.finish].filter(Boolean).join(' · ');
  }

  // ---- Loading -------------------------------------------------------------

  function showForJob(job) {
    currentJob = job;
    doors = [];
    adding = false; editing = null;

    var el = document.getElementById('mm-job-cabinetdoors');
    if (!el) return Promise.resolve();
    el.innerHTML = head(0) + '<div class="mm-empty">Loading...</div>';

    return api.getOpportunity(job.id)
      .then(function (opp) {
        doors = parse(opp ? api.oppField(opp, FIELD_ID) : '');
        render();
      })
      .catch(function (e) {
        el.innerHTML = head(0) + '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function head(n) {
    return '<div class="mm-steps-head">' +
      '<span class="mm-steps-title">Cabinet Doors</span>' +
      (n
        ? '<span class="mm-steps-badge mm-steps-badge-done">' + n +
          (n === 1 ? ' style' : ' styles') + '</span>'
        : '<span class="mm-steps-badge mm-steps-badge-todo">None yet</span>') +
    '</div>';
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-job-cabinetdoors');
    if (!el) return;

    var admin = auth.isAdmin();

    el.innerHTML =
      head(doors.length) +
      (admin && !adding && editing === null
        ? '<div class="mm-cd-actions">' +
            '<button class="mm-btn-sm mm-btn-primary" id="mm-cd-add">+ Add Door Style</button>' +
          '</div>'
        : '') +
      (adding ? form(null) : '') +
      (doors.length
        ? '<div class="mm-cd-list">' +
            doors.map(function (d, i) {
              return editing === i ? form(i) : row(d, i, admin);
            }).join('') +
          '</div>'
        : (adding ? '' : '<p class="mm-task-empty">No door styles recorded yet.</p>')) +
      '<p class="mm-task-error" id="mm-cd-error" role="alert"></p>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function row(d, i, admin) {
    return '<div class="mm-cd">' +
      '<div class="mm-cd-main">' +
        '<div class="mm-cd-where">' + U.esc(d.location || 'Not stated') + '</div>' +
        '<div class="mm-cd-what">' +
          (d.style ? '<span class="mm-cd-style">' + U.esc(d.style) + '</span>' : '') +
          (d.finish ? '<span class="mm-cd-finish">' + U.esc(d.finish) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (admin
        ? '<div class="mm-cd-side">' +
            '<button type="button" class="mm-cd-icon" data-edit="' + i + '" ' +
              'aria-label="Edit this door style">&#9998;</button>' +
            '<button type="button" class="mm-cd-icon mm-cd-del" data-del="' + i + '" ' +
              'aria-label="Remove this door style">&times;</button>' +
          '</div>'
        : '') +
    '</div>';
  }

  function form(i) {
    var d = i === null ? { location: '', style: '', finish: '' } : doors[i];
    return '<div class="mm-cd-form">' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-cd-loc">Location</label>' +
        '<input class="mm-input" id="mm-cd-loc" placeholder="e.g. Kitchen, Island, Pantry" ' +
          'value="' + U.esc(d.location) + '">' +
      '</div>' +
      '<div class="mm-cd-row">' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-cd-style">Door style</label>' +
          '<input class="mm-input" id="mm-cd-style" placeholder="e.g. Shaker" ' +
            'value="' + U.esc(d.style) + '">' +
        '</div>' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-cd-finish">Finish</label>' +
          '<input class="mm-input" id="mm-cd-finish" placeholder="e.g. White" ' +
            'value="' + U.esc(d.finish) + '">' +
        '</div>' +
      '</div>' +
      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-cd-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-cd-save"' +
          (saving ? ' disabled' : '') + '>' +
          (saving ? 'Saving...' : (i === null ? 'Add style' : 'Save changes')) + '</button>' +
      '</div>' +
    '</div>';
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var add = el.querySelector('#mm-cd-add');
    if (add) add.addEventListener('click', function () {
      adding = true; editing = null; render();
      var f = document.getElementById('mm-cd-loc');
      if (f) f.focus();
    });

    var cancel = el.querySelector('#mm-cd-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null; render();
    });

    var saveBtn = el.querySelector('#mm-cd-save');
    if (saveBtn) saveBtn.addEventListener('click', saveOne);

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editing = +b.getAttribute('data-edit'); adding = false; render();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-del');
        var gone = doors[i];
        if (!gone) return;
        doors.splice(i, 1);
        save('Removed cabinet door style ' + describe(gone));
      });
    });
  }

  function clean(v) {
    // A pipe or newline would break the one-line-per-style format.
    return String(v || '').replace(/[|\r\n]/g, ' ').trim();
  }

  function saveOne() {
    var idx = editing;
    var d = {
      location: clean(document.getElementById('mm-cd-loc').value),
      style: clean(document.getElementById('mm-cd-style').value),
      finish: clean(document.getElementById('mm-cd-finish').value),
    };
    if (!d.location && !d.style && !d.finish) {
      showError('Fill in at least one of the three.');
      document.getElementById('mm-cd-loc').focus();
      return;
    }
    showError('');
    if (idx === null) {
      doors.push(d);
      save('Added cabinet door style ' + describe(d));
    } else {
      doors[idx] = d;
      save('Updated cabinet door style ' + describe(d));
    }
  }

  window.MM.cabinetdoors = { showForJob: showForJob };
})();
