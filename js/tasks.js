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
  var U = window.MM.utils, auth = window.MM.auth, api = window.MM.api;

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
  // Every task that has a date, done or not. The schedule needs the completed
  // ones too, so it can answer "what did that week actually look like".
  function loadAllTasksForSchedule() {
    var sel = '/tasks?select=*,task_assignees(staff_id)';
    return db('GET', sel + '&or=(start_date.not.is.null,end_date.not.is.null)' +
                     '&order=start_date.asc.nullslast')
      // The or() filter is the only unusual part of this query. If a database
      // ever rejects it, fetching everything and dropping the undated rows in
      // the browser gives the same answer rather than an empty calendar.
      .catch(function () {
        return db('GET', sel + '&order=start_date.asc.nullslast')
          .then(function (rows) {
            return (rows || []).filter(function (t) {
              return t.start_date || t.end_date;
            });
          });
      });
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

  // Post-sale work only. "Install cabinets" on a lead nobody has visited is
  // noise, so the panel stays shut until the job reaches Material Ordering —
  // and stays open afterwards, including once completed, because the task
  // list is the record of the build.
  var TASK_STAGES = [api.STAGE.materials, api.STAGE.completed];

  function tasksAllowed(job) {
    if (!job) return false;
    // Tasks already on the job are always shown, whatever stage it is in:
    // hiding work someone has been assigned would be worse than showing it
    // early.
    if (currentTasks.length) return true;
    return TASK_STAGES.indexOf(job.pipelineStageId) > -1;
  }

  function renderJobTasks() {
    var el = document.getElementById('mm-job-tasks');
    if (!el) return;
    var admin = auth.isAdmin();

    if (!tasksAllowed(currentJob)) {
      el.innerHTML =
        '<div class="mm-steps-head">' +
          '<span class="mm-steps-title">Job tasks</span>' +
        '</div>' +
        '<p class="mm-task-empty">Tasks appear once the job reaches Material Ordering.</p>';
      if (window.MM.wireJobPanels) window.MM.wireJobPanels();
      return;
    }
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
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-task-template">Add a task list</button>' +
          '</div>' : '');
    } else {
      // Tasks are shown under their group heading, so a twenty-task job reads
      // as stages of work rather than one long list.
      var body = '', lastGroup = null;
      currentTasks.forEach(function (t) {
        var g = t.group_name || '';
        if (g !== lastGroup) {
          if (lastGroup !== null) body += '</div>';
          body += (g ? '<div class="mm-taskgroup-name">' + U.esc(g) + '</div>' : '') +
                  '<div class="mm-tasklist">';
          lastGroup = g;
        }
        body += taskRow(t, { canEdit: admin });
      });
      if (lastGroup !== null) body += '</div>';

      el.innerHTML = head + body +
        (admin ? '<div class="mm-task-actions">' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-task-add">Add a task</button>' +
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-task-template">Add a task list</button>' +
          '</div>' : '');
    }
    el.innerHTML += '<p class="mm-task-error" id="mm-task-error" role="alert"></p>';
    bindJobTasks(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
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
    if (tpl) tpl.addEventListener('click', openListPicker);
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
      .then(function () {
        window.MM.activity.log(t.done_at ? 'task_undone' : 'task_done',
          (t.done_at ? 'Reopened' : 'Finished') + ' "' + t.title + '"',
          { jobId: currentJob.id, jobName: jobLabel(currentJob) });
        return refreshJob();
      })
      .catch(function (e) { taskError('Could not save: ' + e.message); });
  }

  // The standard list becomes a real schedule: each task starts the day after
  // the one before it ends, and depends on it, so the chain is real rather
  // than a flat list of dates.
  // Applies a named list to this job. Each task starts the day after the one
  // before ends, giving a real schedule rather than a pile of same-day tasks.
  //
  // Inserted one at a time on purpose: a bulk POST returns the created rows
  // in no guaranteed order, so chaining them by array index linked the wrong
  // tasks together. Sequential inserts mean each task knows the real id of
  // the one it waits for.
  function applyList(listId) {
    taskError('');
    return db('GET', '/task_templates?list_id=eq.' + listId + '&select=*&order=position')
      .then(function (tpls) {
        if (!tpls || !tpls.length) throw new Error('That list has no tasks in it yet.');
        var start = nextStart(currentTasks);
        var pos = currentTasks.length;
        var prevId = currentTasks.length ? currentTasks[currentTasks.length - 1].id : null;

        return tpls.reduce(function (chain, tp) {
          return chain.then(function () {
            var s = start;
            var e = addDays(s, Math.max(0, (tp.days || 1) - 1));
            start = addDays(e, 1);
            pos += 1;
            return db('POST', '/tasks', {
              job_id: currentJob.id,
              job_name: jobLabel(currentJob),
              job_address: jobAddr(currentJob),
              title: tp.title,
              group_name: tp.group_name || null,
              start_date: s, end_date: e, position: pos,
              depends_on: prevId,
              created_by: (auth.user() || {}).id,
            }).then(function (rows) { prevId = rows[0].id; });
          });
        }, Promise.resolve());
      })
      .then(function () {
        window.MM.activity.log('list_added', 'Added a task list to this job',
          { jobId: currentJob.id, jobName: jobLabel(currentJob) });
        return refreshJob();
      });
  }

  function jobLabel(o) {
    // Formatted the way GHL shows it, not the way it is stored.
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
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

      // A task always opens with a usable pair of dates. Leaving one blank
      // let the browser fill it from the other field's neighbouring day,
      // which produced an end date one day BEFORE the start and a validation
      // error the user had done nothing to cause.
      var fallback = nextStart(currentTasks);
      var sVal = (task && task.start_date) || fallback;
      var eVal = (task && task.end_date) || sVal;
      if (eVal < sVal) eVal = sVal;
      document.getElementById('mm-te-start').value = sVal;
      document.getElementById('mm-te-end').value = eVal;

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
    if (start && end && end < start) {
      err.textContent = 'The end date cannot be before the start date.';
      document.getElementById('mm-te-end').focus();
      return;
    }

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
      .then(function () {
        // Read the mode before closing: closeEditor() clears `editing`, so
        // asking afterwards always reported an edit as a new task.
        var wasEdit = !!editing;
        window.MM.activity.log(wasEdit ? 'task_edited' : 'task_added',
          (wasEdit ? 'Changed the task ' : 'Added the task ') + '"' + title + '"',
          { jobId: currentJob.id, jobName: jobLabel(currentJob) });
        closeEditor();
        // The task is already saved at this point. A failure to redraw the
        // list must not look like the save failed, so it is handled here
        // rather than falling through to the catch below — which would try
        // to re-enable a button on a modal that has just closed, leaving it
        // stuck on "Saving...".
        return refreshJob().catch(function (e) {
          taskError('Saved, but the list could not refresh: ' + e.message);
        });
      })
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

  // ---- Choosing a list ----------------------------------------------------

  function openListPicker() {
    var el = document.getElementById('mm-pick-list');
    el.innerHTML = '<div class="mm-empty">Loading...</div>';
    document.getElementById('mm-pick-error').textContent = '';
    document.getElementById('mm-modal-picklist').classList.add('open');

    db('GET', '/task_lists?select=*,task_templates(count)&order=position')
      .then(function (lists) {
        if (!lists || !lists.length) {
          el.innerHTML = '<p class="mm-task-empty">No task lists yet. Create one on the Task Lists page.</p>';
          return;
        }
        el.innerHTML = lists.map(function (l) {
          var n = (l.task_templates && l.task_templates[0] && l.task_templates[0].count) || 0;
          return '<button type="button" class="mm-assign-opt" data-list="' + U.esc(l.id) + '">' +
            '<span><span class="mm-pick-name">' + U.esc(l.name) + '</span>' +
            (l.description ? '<span class="mm-pick-desc">' + U.esc(l.description) + '</span>' : '') +
            '</span><span class="mm-pick-count">' + n + ' task' + (n === 1 ? '' : 's') + '</span></button>';
        }).join('');
        el.querySelectorAll('[data-list]').forEach(function (b) {
          b.addEventListener('click', function () {
            el.querySelectorAll('.mm-assign-opt').forEach(function (x) { x.disabled = true; });
            b.innerHTML = '<span>Adding&hellip;</span>';
            var label = b.innerHTML;
            applyList(b.getAttribute('data-list'))
              .then(closeListPicker)
              .catch(function (e) {
                // Re-enable the buttons in place. Re-opening the picker here
                // would re-render it and wipe the error message that has just
                // been set, which is how a real failure ended up looking like
                // the dialog simply refreshing itself.
                el.querySelectorAll('.mm-assign-opt').forEach(function (x) { x.disabled = false; });
                b.innerHTML = label;
                document.getElementById('mm-pick-error').textContent =
                  'Could not add the list: ' + e.message;
              });
          });
        });
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }
  function closeListPicker() {
    document.getElementById('mm-modal-picklist').classList.remove('open');
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
    document.getElementById('mm-pick-cancel').addEventListener('click', closeListPicker);
    document.getElementById('mm-modal-picklist').addEventListener('click', function (e) {
      if (e.target === this) closeListPicker();
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
    loadAllTasksForSchedule: loadAllTasksForSchedule,
    loadStaff: loadStaff, taskRow: taskRow, taskState: taskState,
    assigneeIds: assigneeIds, staffNames: staffNames,
  };
})();
