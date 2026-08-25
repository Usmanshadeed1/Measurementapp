// js/ghltasks.js
// Tasks stored on the opportunity itself, in GoHighLevel.
//
// This is a SEPARATE, parallel system to the Supabase task list. Nothing here
// reads or writes Supabase, and nothing in tasks.js is touched. Both panels
// show on the job screen at once so the two can be compared on real work
// before anything is decided.
//
// Why a text field rather than a custom object: GoHighLevel caps an account at
// ten custom objects and the measurement tool uses all ten. A single LARGE_TEXT
// field on the opportunity holds the whole list instead, which needs no object
// slot and works today.
//
// The storage format is one task per line, pipe-separated:
//
//   Install cabinets|2026-08-24|2026-08-26|Eddie|doing|Check hinges
//     -Order handles|done
//     -Fit doors|todo
//
// Sub-items are indented lines beginning with a dash. Dates are written
// year-first so they sort correctly as plain text.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var FIELD_ID = 'u4EdyXWEL0p7tqecPTbW';        // Opportunity -> Task List
  var SEP = '|';

  var currentJob = null;
  var tasks = [];
  var staff = [];
  var editing = null;      // index being edited, or null
  var adding = false;
  var saving = false;

  var STATUS = [
    { v: 'todo',  label: 'To do' },
    { v: 'doing', label: 'In progress' },
    { v: 'done',  label: 'Done' },
  ];

  function statusLabel(v) {
    var s = STATUS.find(function (x) { return x.v === v; });
    return s ? s.label : 'To do';
  }

  // ---- Reading and writing the field --------------------------------------

  // A line the app cannot understand is kept as a plain title rather than
  // dropped: someone editing the field by hand in GoHighLevel should never
  // silently lose a task.
  function parse(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;

      var isSub = /^\s+-/.test(raw) || /^-/.test(raw.trim()) && out.length;
      if (isSub && out.length) {
        var sp = raw.trim().replace(/^-/, '').split(SEP);
        out[out.length - 1].items.push({
          title: (sp[0] || '').trim(),
          done: (sp[1] || '').trim() === 'done',
        });
        return;
      }

      var p = raw.split(SEP);
      out.push({
        title: (p[0] || '').trim(),
        start: (p[1] || '').trim(),
        end: (p[2] || '').trim(),
        who: (p[3] || '').trim(),
        status: (p[4] || 'todo').trim(),
        notes: (p[5] || '').trim(),
        items: [],
      });
    });
    return out;
  }

  function serialise(rows) {
    return rows.map(function (t) {
      var line = [t.title, t.start, t.end, t.who, t.status, t.notes].join(SEP);
      (t.items || []).forEach(function (it) {
        line += '\n  -' + it.title + SEP + (it.done ? 'done' : 'todo');
      });
      return line;
    }).join('\n');
  }

  function save() {
    saving = true;
    render();
    return api.setOpportunityField(currentJob.id, FIELD_ID, serialise(tasks))
      .then(function () {
        saving = false;
        editing = null; adding = false;
        render();
      })
      .catch(function (e) {
        saving = false;
        render();
        showError('Could not save: ' + e.message);
      });
  }

  function showError(msg) {
    var el = document.getElementById('mm-gt-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Loading -------------------------------------------------------------

  function showForJob(job) {
    currentJob = job;
    tasks = [];
    editing = null; adding = false;

    var el = document.getElementById('mm-job-ghltasks');
    if (!el) return Promise.resolve();
    el.innerHTML = head(0) + '<div class="mm-empty">Loading...</div>';

    return Promise.all([
      api.getOpportunity(job.id).catch(function () { return null; }),
      window.MM.tasks.loadStaff().catch(function () { return []; }),
    ]).then(function (res) {
      var opp = res[0];
      staff = (res[1] || []).filter(function (s) { return s.role !== 'admin'; });
      tasks = parse(opp ? api.oppField(opp, FIELD_ID) : '');
      render();
    }).catch(function (e) {
      el.innerHTML = head(0) + '<div class="mm-empty">' + U.esc(e.message) + '</div>';
    });
  }

  function head(n) {
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    return '<div class="mm-steps-head">' +
      '<span class="mm-steps-title">Task List <span class="mm-gt-tag">GoHighLevel</span></span>' +
      (n
        ? '<span class="mm-steps-badge ' +
          (done === n ? 'mm-steps-badge-done' : 'mm-steps-badge-todo') + '">' +
          done + ' of ' + n + ' done</span>'
        : '<span class="mm-steps-badge mm-steps-badge-todo">None yet</span>') +
    '</div>';
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-job-ghltasks');
    if (!el) return;

    el.innerHTML =
      head(tasks.length) +
      '<p class="mm-crew-note">These tasks are stored on the opportunity in ' +
      'GoHighLevel, so they are visible there as well as here.</p>' +
      (adding || editing !== null ? '' :
        '<div class="mm-gt-actions">' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-gt-add">+ Add Task</button>' +
        '</div>') +
      (adding ? form(null) : '') +
      (tasks.length
        ? '<div class="mm-gt-list">' +
            tasks.map(function (t, i) {
              return editing === i ? form(i) : taskRow(t, i);
            }).join('') +
          '</div>'
        : (adding ? '' : '<p class="mm-task-empty">No tasks yet.</p>')) +
      '<p class="mm-task-error" id="mm-gt-error" role="alert"></p>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function fmtDate(v) {
    if (!v) return '';
    var p = String(v).split('-');
    if (p.length !== 3) return v;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? v
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function isLate(t) {
    if (t.status === 'done' || !t.end) return false;
    var p = t.end.split('-');
    if (p.length !== 3) return false;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    return d < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function dateRange(t) {
    if (t.start && t.end && t.start !== t.end) {
      return fmtDate(t.start) + ' – ' + fmtDate(t.end);
    }
    return fmtDate(t.end || t.start);
  }

  function taskRow(t, i) {
    var done = t.status === 'done';
    var late = isLate(t);
    var when = dateRange(t);
    var doneItems = (t.items || []).filter(function (x) { return x.done; }).length;

    return '<div class="mm-gt' + (done ? ' is-done' : '') + (late ? ' is-late' : '') + '">' +
      '<button type="button" class="mm-gt-check" data-toggle="' + i + '" ' +
        'aria-label="' + (done ? 'Mark not done' : 'Mark done') + '">' +
        (done ? '&#10003;' : '') + '</button>' +

      '<div class="mm-gt-main">' +
        '<div class="mm-gt-title">' + U.esc(t.title || 'Untitled task') + '</div>' +
        '<div class="mm-gt-meta">' +
          (when ? '<span class="mm-gt-when' + (late ? ' is-late' : '') + '">' +
            U.esc(when) + (late ? ' · overdue' : '') + '</span>' : '') +
          (t.who ? '<span class="mm-gt-who">' + U.esc(t.who) + '</span>' : '') +
          '<span class="mm-gt-status mm-gt-status-' + U.esc(t.status || 'todo') + '">' +
            U.esc(statusLabel(t.status)) + '</span>' +
        '</div>' +
        (t.notes ? '<div class="mm-gt-notes">' + U.esc(t.notes) + '</div>' : '') +
        ((t.items || []).length
          ? '<div class="mm-gt-items">' +
              '<div class="mm-gt-itemhead">' + doneItems + ' of ' + t.items.length + '</div>' +
              t.items.map(function (it, j) {
                return '<button type="button" class="mm-gt-item' +
                    (it.done ? ' is-done' : '') + '" data-item="' + i + '.' + j + '">' +
                  '<span class="mm-gt-tick">' + (it.done ? '&#10003;' : '') + '</span>' +
                  U.esc(it.title) + '</button>';
              }).join('') +
            '</div>'
          : '') +
      '</div>' +

      '<div class="mm-gt-side">' +
        '<button type="button" class="mm-gt-icon" data-edit="' + i + '" ' +
          'aria-label="Edit task">&#9998;</button>' +
        '<button type="button" class="mm-gt-icon mm-gt-del" data-del="' + i + '" ' +
          'aria-label="Delete task">&times;</button>' +
      '</div>' +
    '</div>';
  }

  // ---- The form ------------------------------------------------------------

  function form(i) {
    var t = i === null
      ? { title: '', start: '', end: '', who: '', status: 'todo', notes: '', items: [] }
      : tasks[i];

    return '<div class="mm-gt-form">' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-gt-title">Task</label>' +
        '<input class="mm-input" id="mm-gt-title" placeholder="e.g. Install cabinets" ' +
          'value="' + U.esc(t.title) + '">' +
      '</div>' +

      '<div class="mm-gt-row">' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-gt-start">Start</label>' +
          '<input class="mm-input" type="date" id="mm-gt-start" value="' + U.esc(t.start) + '">' +
        '</div>' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-gt-end">Finish</label>' +
          '<input class="mm-input" type="date" id="mm-gt-end" value="' + U.esc(t.end) + '">' +
        '</div>' +
      '</div>' +

      '<div class="mm-gt-row">' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-gt-who">Assigned to</label>' +
          '<select class="mm-select" id="mm-gt-who">' +
            '<option value="">Nobody yet</option>' +
            staff.map(function (s) {
              return '<option value="' + U.esc(s.name) + '"' +
                (s.name === t.who ? ' selected' : '') + '>' + U.esc(s.name) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-gt-status">Status</label>' +
          '<select class="mm-select" id="mm-gt-status">' +
            STATUS.map(function (s) {
              return '<option value="' + s.v + '"' +
                (s.v === (t.status || 'todo') ? ' selected' : '') + '>' + s.label + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-gt-notes">Notes <span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-gt-notes" placeholder="Anything worth remembering" ' +
          'value="' + U.esc(t.notes) + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-gt-items">Checklist <span class="mm-opt">(one per line)</span></label>' +
        '<textarea class="mm-input" id="mm-gt-items" rows="3" ' +
          'placeholder="Order handles&#10;Fit doors">' +
          U.esc((t.items || []).map(function (x) { return x.title; }).join('\n')) +
        '</textarea>' +
      '</div>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-gt-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-gt-save"' +
          (saving ? ' disabled' : '') + '>' +
          (saving ? 'Saving...' : (i === null ? 'Add task' : 'Save changes')) + '</button>' +
      '</div>' +
    '</div>';
  }

  function readForm(existing) {
    var itemText = document.getElementById('mm-gt-items').value || '';
    var oldItems = (existing && existing.items) || [];

    return {
      title: (document.getElementById('mm-gt-title').value || '').trim(),
      start: document.getElementById('mm-gt-start').value || '',
      end: document.getElementById('mm-gt-end').value || '',
      who: document.getElementById('mm-gt-who').value || '',
      status: document.getElementById('mm-gt-status').value || 'todo',
      notes: (document.getElementById('mm-gt-notes').value || '').trim(),
      // Ticks survive an edit: a checklist item keeps its state if its text
      // is unchanged.
      items: itemText.split(/\r?\n/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
        .map(function (title) {
          var prev = oldItems.find(function (o) { return o.title === title; });
          return { title: title, done: !!(prev && prev.done) };
        }),
    };
  }

  // ---- Interaction ---------------------------------------------------------

  function bind(el) {
    var add = el.querySelector('#mm-gt-add');
    if (add) add.addEventListener('click', function () {
      adding = true; editing = null; render();
      var f = document.getElementById('mm-gt-title');
      if (f) f.focus();
    });

    var cancel = el.querySelector('#mm-gt-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null; render();
    });

    var saveBtn = el.querySelector('#mm-gt-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var idx = editing;
      var row = readForm(idx === null ? null : tasks[idx]);
      if (!row.title) {
        showError('Give the task a name.');
        document.getElementById('mm-gt-title').focus();
        return;
      }
      // A pipe or a newline in free text would break the line format.
      row.title = row.title.replace(/[|\r\n]/g, ' ');
      row.notes = row.notes.replace(/[|\r\n]/g, ' ');
      row.items.forEach(function (it) { it.title = it.title.replace(/[|\r\n]/g, ' '); });

      if (idx === null) tasks.push(row); else tasks[idx] = row;
      save();
    });

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editing = +b.getAttribute('data-edit'); adding = false; render();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-del');
        tasks.splice(i, 1);
        save();
      });
    });

    el.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = tasks[+b.getAttribute('data-toggle')];
        t.status = t.status === 'done' ? 'todo' : 'done';
        save();
      });
    });

    el.querySelectorAll('[data-item]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-item').split('.');
        var it = tasks[+p[0]].items[+p[1]];
        it.done = !it.done;
        save();
      });
    });
  }

  window.MM.ghltasks = { showForJob: showForJob };
})();
