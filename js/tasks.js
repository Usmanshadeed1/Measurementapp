// js/tasks.js
// Project tasks — the work that happens on a job after the sale.
//
// These live in our own database rather than GoHighLevel because GHL tasks
// cannot do any of the three things this needs: attach to a job rather than a
// contact, be assigned to more than one person, or carry a start date as well
// as an end date. Task chains do not exist there at all.
//
// A task's dates default to the day after the previous task ends, so applying
// the template list produces a realistic schedule the admin then adjusts.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var staffCache = null;
  var currentJob = null;
  var currentTasks = [];
  var editing = null;     // the task open in the editor, or null for a new one

  // ---- Data ---------------------------------------------------------------

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function loadStaff() {
    if (staffCache) return Promise.resolve(staffCache);
    return db('GET', '/staff?select=id,name,role&active=eq.true&order=name')
      .then(function (rows) { staffCache = rows || []; return staffCache; });
  }

  // Tasks plus their assignees in one round trip. PostgREST can embed the
  // join table, which avoids a query per task.
  function loadTasks(jobId) {
    return db('GET', '/tasks?job_id=eq.' + encodeURIComponent(jobId) +
                     '&select=*,task_assignees(staff_id)&order=position');
  }
  function loadMyTasks(staffId) {
    return db('GET', '/tasks?select=*,task_assignees!inner(staff_id)' +
                     '&task_assignees.staff_id=eq.' + staffId +
                     '&order=end_date.asc.nullslast');
  }
  function loadAllOpenTasks() {
    return db('GET', '/tasks?done_at=is.null&select=*,task_assignees(staff_id)' +
                     '&order=end_date.asc.nullslast');
  }
  function loadTemplates() {
    return db('GET', '/task_templates?select=*&order=position');
  }

  function assigneeIds(t) {
    return (t.task_assignees || []).map(function (a) { return a.staff_id; });
  }

  // ---- Dates --------------------------------------------------------------

  function todayStr() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return todayStr();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmt(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function daysTo(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date();
    t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d - t) / 86400000);
  }

  // Where the next task should start: the day after everything else ends.
  function nextStart(tasks) {
    var latest = null;
    tasks.forEach(function (t) {
      if (t.end_date && (!latest || t.end_date > latest)) latest = t.end_date;
    });
    return latest ? addDays(latest, 1) : todayStr();
  }

  // ---- Rendering ----------------------------------------------------------

  function staffNames(ids) {
    if (!staffCache) return '';
    return ids.map(function (id) {
      var s = staffCache.find(function (x) { return x.id === id; });
      return s ? s.name : 'Unknown';
    }).join(', ');
  }

  // A task is late when its end date has passed and nobody has ticked it.
  function taskState(t) {
    if (t.done_at) return { cls: 'done', text: 'Done' };
    var d = daysTo(t.end_date);
    if (d === null) return { cls: '', text: 'No date' };
    if (d < 0) return { cls: 'urgent', text: Math.abs(d) + 'd late' };
    if (d === 0) return { cls: 'soon', text: 'Due today' };
    if (d === 1) return { cls: 'soon', text: 'Due tomorrow' };
    return { cls: '', text: fmt(t.start_date) + ' – ' + fmt(t.end_date) };
  }

  function taskRow(t, opts) {
    opts = opts || {};
    var st = taskState(t);
    var ids = assigneeIds(t);
    var who = staffNames(ids);
    var blocked = t.depends_on && !isDone(t.depends_on);

    return '<div class="mm-task' + (t.done_at ? ' is-done' : '') + (blocked ? ' is-blocked' : '') + '">' +
      '<button type="button" class="mm-task-tick" data-tick="' + U.esc(t.id) + '"' +
        (blocked ? ' disabled title="Waiting for an earlier task"' : '') +
        ' aria-label="' + (t.done_at ? 'Mark not done' : 'Mark done') + '">' +
        (t.done_at ? '&#10003;' : '') + '</button>' +
      '<div class="mm-task-main">' +
        '<div class="mm-task-title">' + U.esc(t.title) + '</div>' +
        '<div class="mm-task-meta">' +
          (opts.showJob && t.job_name ? '<span class="mm-task-job">' + U.esc(t.job_name) + '</span>' : '') +
          '<span class="mm-task-when mm-task-' + st.cls + '">' + U.esc(st.text) + '</span>' +
          (who ? '<span class="mm-task-who">' + U.esc(who) + '</span>'
               : '<span class="mm-task-who mm-task-none">Nobody assigned</span>') +
          (blocked ? '<span class="mm-task-blocked">Waiting for an earlier task</span>' : '') +
        '</div>' +
      '</div>' +
      (opts.canEdit ? '<button type="button" class="mm-task-edit" data-edit="' + U.esc(t.id) + '">Edit</button>' : '') +
    '</div>';
  }

  function isDone(taskId) {
    var t = currentTasks.find(function (x) { return x.id === taskId; });
    return !!(t && t.done_at);
  }

  // ---- Job task panel -----------------------------------------------------

  function renderJobTasks() {
    var el = document.getElementById('mm-job-tasks');
    if (!el) return;
    var admin = auth.isAdmin();
    var open = currentTasks.filter(function (t) { return !t.done_at; }).length;

    var head =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Job tasks</span>' +
        (currentTasks.length
          ? '<span class="mm-steps-badge ' + (open ? 'mm-steps-badge-todo' : 'mm-steps-badge-done') + '">' +
            (open ? open + ' still to do' : 'All done') + '</span>'
          : '') +
      '</div>';

    if (!currentTasks.length) {
      el.innerHTML = head +
        '<p class="mm-task-empty">No tasks on this job yet.</p>' +
        (admin ? '<div class="mm-task-actions">' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-task-add">Add a task</button>' +
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-task-template">Use the standard list</button>' +
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-task-edit-list">Edit the standard list</button>' +
          '</div>' : '');
    } else {
      el.innerHTML = head +
        '<div class="mm-tasklist">' +
          currentTasks.map(function (t) { return taskRow(t, { canEdit: admin }); }).join('') +
        '</div>' +
        (admin ? '<div class="mm-task-actions">' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-task-add">Add a task</button>' +
          '</div>' : '');
    }
    el.innerHTML += '<p class="mm-task-error" id="mm-task-error" role="alert"></p>';
    bindJobTasks(el);
  }

  function bindJobTasks(el) {
    el.querySelectorAll('[data-tick]').forEach(function (b) {
      b.addEventListener('click', function () { toggleDone(b.getAttribute('data-tick')); });
    });
    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = currentTasks.find(function (x) { return x.id === b.getAttribute('data-edit'); });
        if (t) openEditor(t);
      });
    });
    var add = el.querySelector('#mm-task-add');
    if (add) add.addEventListener('click', function () { openEditor(null); });
    var tpl = el.querySelector('#mm-task-template');
    if (tpl) tpl.addEventListener('click', applyTemplate);
    var edt = el.querySelector('#mm-task-edit-list');
    if (edt) edt.addEventListener('click', openTemplates);
  }

  function taskError(msg) {
    var el = document.getElementById('mm-task-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Actions ------------------------------------------------------------

  function toggleDone(taskId) {
    var t = currentTasks.find(function (x) { return x.id === taskId; });
    if (!t) return;
    var body = t.done_at
      ? { done_at: null, done_by: null }
      : { done_at: new Date().toISOString(), done_by: (auth.user() || {}).id };
    taskError('');
    db('PATCH', '/tasks?id=eq.' + taskId, body)
      .then(function () { return refreshJob(); })
      .catch(function (e) { taskError('Could not save: ' + e.message); });
  }

  // The standard list becomes a real schedule: each task starts the day after
  // the one before it ends, and depends on it, so the chain is real rather
  // than a flat list of dates.
  function applyTemplate() {
    taskError('');
    var btn = document.getElementById('mm-task-template');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

    loadTemplates()
      .then(function (tpls) {
        if (!tpls.length) throw new Error('There are no standard tasks set up yet.');
        var start = todayStr();
        var rows = tpls.map(function (tp, i) {
          var s = start;
          var e = addDays(s, Math.max(0, (tp.days || 1) - 1));
          start = addDays(e, 1);
          return {
            job_id: currentJob.id, job_name: jobLabel(currentJob), job_address: jobAddr(currentJob),
            title: tp.title, notes: tp.notes || null,
            start_date: s, end_date: e, position: i + 1,
            created_by: (auth.user() || {}).id,
          };
        });
        return db('POST', '/tasks', rows);
      })
      .then(function (created) {
        // Link each task to the one before it, now that the ids exist. Done
        // one at a time: a burst of parallel writes is what was failing here,
        // and the order matters anyway.
        var list = created || [];
        return list.slice(1).reduce(function (chain, t, i) {
          return chain.then(function () {
            return db('PATCH', '/tasks?id=eq.' + t.id, { depends_on: list[i].id });
          });
        }, Promise.resolve());
      })
      .then(refreshJob)
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Use the standard list'; }
        taskError('Could not add the tasks: ' + e.message);
      });
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return o.contact.name;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n;
  }
  function jobAddr(o) {
    var a = window.MM.api.oppField(o, window.MM.api.ADDR_FIELD_ID);
    if (a) return a;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ') : '';
  }

  // ---- Editor -------------------------------------------------------------

  function openEditor(task) {
    editing = task;
    loadStaff().then(function (staff) {
      document.getElementById('mm-taskedit-title').textContent = task ? 'Edit task' : 'New task';
      document.getElementById('mm-te-title').value = task ? task.title : '';
      document.getElementById('mm-te-notes').value = (task && task.notes) || '';

      var defaults = task ? null : nextStart(currentTasks);
      document.getElementById('mm-te-start').value = task ? (task.start_date || '') : defaults;
      document.getElementById('mm-te-end').value = task ? (task.end_date || '') : defaults;

      var ids = task ? assigneeIds(task) : [];
      document.getElementById('mm-te-staff').innerHTML = staff.length
        ? staff.map(function (s) {
            return '<label class="mm-te-person"><input type="checkbox" value="' + U.esc(s.id) + '"' +
              (ids.indexOf(s.id) > -1 ? ' checked' : '') + '> ' + U.esc(s.name) +
              (s.role === 'admin' ? ' <span class="mm-te-role">admin</span>' : '') + '</label>';
          }).join('')
        : '<p class="mm-task-empty">No staff yet. They can sign up with the team code.</p>';

      document.getElementById('mm-te-delete').style.display = task ? '' : 'none';
      document.getElementById('mm-te-error').textContent = '';
      document.getElementById('mm-modal-taskedit').classList.add('open');
      document.getElementById('mm-te-title').focus();
    });
  }

  function closeEditor() {
    document.getElementById('mm-modal-taskedit').classList.remove('open');
    editing = null;
  }

  function saveTask() {
    var title = document.getElementById('mm-te-title').value.trim();
    var notes = document.getElementById('mm-te-notes').value.trim();
    var start = document.getElementById('mm-te-start').value || null;
    var end = document.getElementById('mm-te-end').value || null;
    var err = document.getElementById('mm-te-error');

    if (!title) { err.textContent = 'Give the task a name.'; return; }
    if (start && end && end < start) { err.textContent = 'The end date cannot be before the start date.'; return; }

    var chosen = Array.prototype.slice
      .call(document.querySelectorAll('#mm-te-staff input:checked'))
      .map(function (i) { return i.value; });

    var btn = document.getElementById('mm-te-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    err.textContent = '';

    var body = { title: title, notes: notes || null, start_date: start, end_date: end };
    var save;
    if (editing) {
      save = db('PATCH', '/tasks?id=eq.' + editing.id, body).then(function () { return editing.id; });
    } else {
      body.job_id = currentJob.id;
      body.job_name = jobLabel(currentJob);
      body.job_address = jobAddr(currentJob);
      body.position = currentTasks.length + 1;
      body.created_by = (auth.user() || {}).id;
      // A new task continues the chain from the last one on the job.
      var last = currentTasks[currentTasks.length - 1];
      if (last) body.depends_on = last.id;
      save = db('POST', '/tasks', body).then(function (rows) { return rows[0].id; });
    }

    save
      .then(function (taskId) {
        // Replace the assignee list wholesale — simpler and safer than
        // working out which ones changed.
        return db('DELETE', '/task_assignees?task_id=eq.' + taskId)
          .then(function () {
            if (!chosen.length) return null;
            return db('POST', '/task_assignees',
              chosen.map(function (id) { return { task_id: taskId, staff_id: id }; }));
          });
      })
      .then(function () { closeEditor(); return refreshJob(); })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Save task';
        err.textContent = 'Could not save: ' + e.message;
      });
  }

  function deleteTask() {
    if (!editing) return;
    var btn = document.getElementById('mm-te-delete');
    btn.disabled = true; btn.textContent = 'Deleting...';
    db('DELETE', '/tasks?id=eq.' + editing.id)
      .then(function () { closeEditor(); return refreshJob(); })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Delete';
        document.getElementById('mm-te-error').textContent = 'Could not delete: ' + e.message;
      });
  }

  // ---- Standard task list (admin) -----------------------------------------
  //
  // The default tasks are rows in the database, not code, so the client can
  // shape them to how he actually builds a kitchen without a deploy. Groups
  // are free text — construction stages differ per business.

  var templates = [];

  function openTemplates() {
    document.getElementById('mm-modal-templates').classList.add('open');
    renderTemplates();
    loadTemplates().then(function (rows) {
      templates = rows || [];
      renderTemplates();
    }).catch(function (e) { tplError(e.message); });
  }
  function closeTemplates() {
    document.getElementById('mm-modal-templates').classList.remove('open');
  }
  function tplError(msg) {
    var el = document.getElementById('mm-tpl-error');
    if (el) el.textContent = msg || '';
  }

  function renderTemplates() {
    var el = document.getElementById('mm-tpl-list');
    if (!templates.length) {
      el.innerHTML = '<p class="mm-task-empty">No standard tasks yet. Add the first one below.</p>';
      return;
    }
    // Grouped so a long list reads as stages of work rather than 20 rows.
    var groups = {};
    templates.forEach(function (t) {
      var g = t.notes || 'Other';
      (groups[g] = groups[g] || []).push(t);
    });
    el.innerHTML = Object.keys(groups).map(function (g) {
      return '<div class="mm-tpl-group"><div class="mm-tpl-group-name">' + U.esc(g) + '</div>' +
        groups[g].map(function (t) {
          return '<div class="mm-tpl-row" data-tpl="' + U.esc(t.id) + '">' +
            '<input class="mm-input mm-tpl-title" value="' + U.esc(t.title) + '" aria-label="Task name">' +
            '<input class="mm-input mm-tpl-days" type="number" min="1" value="' + (t.days || 1) + '" aria-label="Days">' +
            '<button type="button" class="mm-tpl-del" data-del="' + U.esc(t.id) + '" aria-label="Remove ' + U.esc(t.title) + '">&times;</button>' +
          '</div>';
        }).join('') + '</div>';
    }).join('');

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { deleteTemplate(b.getAttribute('data-del')); });
    });
    // Save on blur rather than a Save button per row: the admin edits a few
    // cells and closes the box, and everything is already stored.
    el.querySelectorAll('.mm-tpl-row').forEach(function (row) {
      var id = row.getAttribute('data-tpl');
      row.querySelector('.mm-tpl-title').addEventListener('blur', function () {
        patchTemplate(id, { title: this.value.trim() });
      });
      row.querySelector('.mm-tpl-days').addEventListener('blur', function () {
        patchTemplate(id, { days: Math.max(1, parseInt(this.value, 10) || 1) });
      });
    });
  }

  function patchTemplate(id, body) {
    if (body.title === '') return;
    tplError('');
    db('PATCH', '/task_templates?id=eq.' + id, body).catch(function (e) {
      tplError('Could not save: ' + e.message);
    });
  }
  function deleteTemplate(id) {
    tplError('');
    db('DELETE', '/task_templates?id=eq.' + id)
      .then(function () {
        templates = templates.filter(function (t) { return t.id !== id; });
        renderTemplates();
      })
      .catch(function (e) { tplError('Could not remove: ' + e.message); });
  }
  function addTemplate() {
    var title = document.getElementById('mm-tpl-new-title').value.trim();
    var group = document.getElementById('mm-tpl-new-group').value.trim();
    var days = Math.max(1, parseInt(document.getElementById('mm-tpl-new-days').value, 10) || 1);
    if (!title) { tplError('Give the task a name.'); return; }
    tplError('');
    var pos = templates.reduce(function (m, t) { return Math.max(m, t.position || 0); }, 0) + 1;
    db('POST', '/task_templates', { title: title, notes: group || null, days: days, position: pos })
      .then(function (rows) {
        templates.push(rows[0]);
        document.getElementById('mm-tpl-new-title').value = '';
        renderTemplates();
      })
      .catch(function (e) { tplError('Could not add: ' + e.message); });
  }

  // ---- Entry points -------------------------------------------------------

  function refreshJob() {
    if (!currentJob) return Promise.resolve();
    return loadTasks(currentJob.id).then(function (rows) {
      currentTasks = rows || [];
      renderJobTasks();
    });
  }

  function showForJob(job) {
    currentJob = job;
    currentTasks = [];
    var el = document.getElementById('mm-job-tasks');
    if (el) el.innerHTML = '<div class="mm-empty">Loading tasks...</div>';
    return loadStaff().then(refreshJob).catch(function (e) {
      if (el) el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
    });
  }

  function init() {
    document.getElementById('mm-tpl-close').addEventListener('click', closeTemplates);
    document.getElementById('mm-tpl-add').addEventListener('click', addTemplate);
    document.getElementById('mm-modal-templates').addEventListener('click', function (e) {
      if (e.target === this) closeTemplates();
    });
    document.getElementById('mm-te-save').addEventListener('click', saveTask);
    document.getElementById('mm-te-cancel').addEventListener('click', closeEditor);
    document.getElementById('mm-te-delete').addEventListener('click', deleteTask);
    document.getElementById('mm-modal-taskedit').addEventListener('click', function (e) {
      if (e.target === this) closeEditor();
    });
    // Moving the start date carries the end date with it, so a task keeps its
    // length instead of silently becoming longer or negative.
    var startEl = document.getElementById('mm-te-start');
    startEl.addEventListener('change', function () {
      var endEl = document.getElementById('mm-te-end');
      if (!endEl.value || endEl.value < startEl.value) endEl.value = startEl.value;
    });
  }

  window.MM.tasks = {
    init: init, showForJob: showForJob,
    loadMyTasks: loadMyTasks, loadAllOpenTasks: loadAllOpenTasks,
    loadStaff: loadStaff, taskRow: taskRow, taskState: taskState,
    assigneeIds: assigneeIds, staffNames: staffNames,
  };
})();
