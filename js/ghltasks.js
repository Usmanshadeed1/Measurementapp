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

  function save(logAs, logText) {
    saving = true;
    render();
    return api.setOpportunityField(currentJob.id, FIELD_ID, serialise(tasks))
      .then(function () {
        saving = false;
        editing = null; adding = false;
        if (logAs) {
          window.MM.activity.log(logAs, logText, {
            jobId: currentJob.id, jobName: jobLabelOf(currentJob),
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
      // The worker list is the single source for who can be assigned: both
      // people with a login and the name-only ones.
      window.MM.workerlist.load().catch(function () { return null; }),
    ]).then(function (res) {
      var opp = res[0];
      staff = window.MM.workerlist.assignableNames();
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
          '<button class="mm-btn-sm mm-btn-primary" id="mm-gt-load">Load Template</button>' +
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

  // Several people can share a task, so this is a list of tick boxes rather
  // than a dropdown. Grouped by whether they can sign in: only someone with a
  // login will actually see the task in the app.
  function whoPicker(current) {
    var chosen = namesOf(current);

    function group(label, list) {
      if (!list.length) return '';
      return '<div class="mm-gt-whogroup">' +
        '<div class="mm-gt-wholabel">' + U.esc(label) + '</div>' +
        list.map(function (s) {
          var on = chosen.indexOf(s.name) > -1;
          return '<label class="mm-gt-whoitem' + (on ? ' is-on' : '') + '">' +
            '<input type="checkbox" class="mm-gt-whobox" value="' + U.esc(s.name) + '"' +
              (on ? ' checked' : '') + '>' +
            '<span>' + U.esc(s.name) + '</span>' +
          '</label>';
        }).join('') +
      '</div>';
    }

    if (!staff.length) {
      return '<p class="mm-gt-whoempty">No workers yet. Add them on the ' +
        'Workers page.</p>';
    }
    return '<div class="mm-gt-who-picker" id="mm-gt-who">' +
      group('Has login', staff.filter(function (s) { return s.hasLogin; })) +
      group('Name only', staff.filter(function (s) { return !s.hasLogin; })) +
    '</div>';
  }

  // The field holds a comma-separated list, so both shapes read the same way.
  function namesOf(v) {
    return String(v || '').split(',')
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

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

      // The tick list needs the full width; a half-row would put the names in
      // a column two words wide.
      '<div class="mm-field-group">' +
        '<span class="mm-label">Assigned to</span>' +
        whoPicker(t.who) +
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
      who: Array.prototype.slice
        .call(document.querySelectorAll('.mm-gt-whobox:checked'))
        .map(function (b) { return b.value; })
        .join(', '),
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

  // Copying a template onto this job. The tasks are COPIES: editing them here
  // never reaches the template, which is the whole point of having one.
  function openTemplates() {
    var list = document.getElementById('mm-tl-list');
    var modal = document.getElementById('mm-modal-loadtpl');
    if (!list || !modal) return;

    document.getElementById('mm-tl-error').textContent = '';
    document.getElementById('mm-tl-start').value = todayStr();

    // Whoever can be assigned, same list as the task form itself.
    var who = document.getElementById('mm-tl-who');
    who.innerHTML = '<option value="">Nobody yet</option>' +
      staff.map(function (p) {
        return '<option value="' + U.esc(p.name) + '">' + U.esc(p.name) +
          (p.hasLogin ? '' : ' (name only)') + '</option>';
      }).join('');

    syncDateBox();
    list.innerHTML = '<div class="mm-empty">Loading templates...</div>';
    modal.classList.add('open');

    window.MM.templates.load().then(function () {
      var rows = window.MM.templates.all();
      if (!rows.length) {
        list.innerHTML = '<div class="mm-empty">No templates yet. ' +
          'Build one on the Task Templates page.</div>';
        return;
      }
      list.innerHTML = rows.map(function (t) {
        var n = (t.tasks || []).length;
        return '<button type="button" class="mm-assign-opt" data-tpl="' + U.esc(t.id) + '">' +
          '<span><span class="mm-pick-name">' + U.esc(t.name) + '</span>' +
          '<span class="mm-pick-desc">' + n + (n === 1 ? ' task' : ' tasks') +
          (t.description ? ' · ' + U.esc(t.description) : '') + '</span></span></button>';
      }).join('');

      list.querySelectorAll('[data-tpl]').forEach(function (b) {
        b.addEventListener('click', function () {
          applyTemplate(b.getAttribute('data-tpl'), b);
        });
      });
    }).catch(function (e) {
      list.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
    });
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function dateMode() {
    var on = document.querySelector('input[name="mm-tl-mode"]:checked');
    return on ? on.value : 'chain';
  }

  // A start date is meaningless when no dates are wanted, so the box is
  // hidden rather than left there to be filled in and quietly ignored.
  function syncDateBox() {
    var wrap = document.getElementById('mm-tl-datewrap');
    if (wrap) wrap.hidden = dateMode() === 'none';
  }

  function applyTemplate(id, btn) {
    var tpl = window.MM.templates.all().find(function (t) { return t.id === id; });
    if (!tpl) return;

    var mode = dateMode();
    var startStr = document.getElementById('mm-tl-start').value;
    var who = document.getElementById('mm-tl-who').value || '';

    // "chain" walks a day forward per task, "same" repeats the start date,
    // and "none" leaves every date blank.
    var cursor = (mode !== 'none' && startStr)
      ? new Date(startStr + 'T00:00:00') : null;

    (tpl.tasks || []).forEach(function (t) {
      var day = '';
      if (cursor && !isNaN(cursor.getTime())) {
        day = cursor.getFullYear() + '-' +
          String(cursor.getMonth() + 1).padStart(2, '0') + '-' +
          String(cursor.getDate()).padStart(2, '0');
        if (mode === 'chain') cursor.setDate(cursor.getDate() + 1);
      }
      tasks.push({
        title: String(t.title || '').replace(/[|\r\n]/g, ' '),
        start: day, end: day,
        who: who, status: 'todo', notes: '',
        items: (t.items || []).map(function (i) {
          return { title: String(i).replace(/[|\r\n]/g, ' '), done: false };
        }),
      });
    });

    btn.disabled = true;
    document.getElementById('mm-modal-loadtpl').classList.remove('open');
    save('task_added', 'Loaded template "' + tpl.name + '"');
  }

  function bind(el) {
    var loadBtn = el.querySelector('#mm-gt-load');
    if (loadBtn) loadBtn.addEventListener('click', openTemplates);

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

    el.querySelectorAll('.mm-gt-whobox').forEach(function (b) {
      b.addEventListener('change', function () {
        b.closest('.mm-gt-whoitem').classList.toggle('is-on', b.checked);
      });
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

      if (idx === null) {
        tasks.push(row);
        save('task_added', 'Added task "' + row.title + '"');
      } else {
        tasks[idx] = row;
        save('task_edited', 'Edited task "' + row.title + '"');
      }
    });

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editing = +b.getAttribute('data-edit'); adding = false; render();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-del');
        var gone = tasks[i];
        tasks.splice(i, 1);
        save('task_removed', 'Removed task "' + (gone ? gone.title : '') + '"');
      });
    });

    el.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = tasks[+b.getAttribute('data-toggle')];
        var nowDone = t.status !== 'done';
        t.status = nowDone ? 'done' : 'todo';
        save(nowDone ? 'task_done' : 'task_undone',
             (nowDone ? 'Finished "' : 'Reopened "') + t.title + '"');
      });
    });

    el.querySelectorAll('[data-item]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-item').split('.');
        var parent = tasks[+p[0]];
        var it = parent.items[+p[1]];
        it.done = !it.done;
        save(it.done ? 'task_done' : 'task_undone',
             (it.done ? 'Ticked off "' : 'Reopened "') + it.title +
             '" in ' + parent.title);
      });
    });
  }

  // Reads every job's task list in one pass. The Schedule and a worker's own
  // list both need "all tasks everywhere", and a task now lives inside its
  // job rather than in one table, so the jobs have to be walked.
  //
  // fetchAllOpportunities already returns customFields, so this needs no extra
  // request per job.
  function loadAllJobTasks() {
    return api.fetchAllOpportunities().then(function (ops) {
      var out = [];
      (ops || []).forEach(function (o) {
        if (o.pipelineId !== api.SALES_PIPELINE_ID) return;
        var raw = api.oppField(o, FIELD_ID);
        if (!raw) return;
        parse(raw).forEach(function (t, i) {
          out.push({
            id: o.id + ':' + i,
            jobId: o.id,
            jobName: jobLabelOf(o),
            title: t.title,
            start: t.start,
            end: t.end,
            who: t.who,
            status: t.status,
            notes: t.notes,
            items: t.items,
          });
        });
      });
      return out;
    });
  }

  function jobLabelOf(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  // Flipping a task done from another screen: read the job, change that one
  // line, write the whole field back.
  function setStatusOnJob(jobId, index, status) {
    return api.getOpportunity(jobId).then(function (opp) {
      var rows = parse(api.oppField(opp, FIELD_ID));
      if (!rows[index]) throw new Error('That task is no longer there.');
      rows[index].status = status;
      return api.setOpportunityField(jobId, FIELD_ID, serialise(rows));
    });
  }

  // Ticking one checklist item from another screen.
  function setItemOnJob(jobId, taskIndex, itemIndex, done) {
    return api.getOpportunity(jobId).then(function (opp) {
      var rows = parse(api.oppField(opp, FIELD_ID));
      var t = rows[taskIndex];
      if (!t || !t.items[itemIndex]) throw new Error('That step is no longer there.');
      t.items[itemIndex].done = done;
      return api.setOpportunityField(jobId, FIELD_ID, serialise(rows));
    });
  }

  // A task can name several people, stored comma-separated. Anywhere that
  // asks "is this task mine" has to split the list rather than compare the
  // whole string, or a shared task belongs to nobody.
  function isAssignedTo(who, name) {
    if (!who || !name) return false;
    return namesOf(who).some(function (n) { return n === name; });
  }

  window.MM.ghltasks = {
    showForJob: showForJob,
    isAssignedTo: isAssignedTo,
    setItemOnJob: setItemOnJob,
    loadAllJobTasks: loadAllJobTasks,
    setStatusOnJob: setStatusOnJob,
    statusLabel: statusLabel,
  };
})();
