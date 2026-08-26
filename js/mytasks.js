// js/mytasks.js
// A worker's home screen: the tasks assigned to them, and nothing else.
//
// Grouped by when they are due rather than by job, because the question a
// worker opens the app to answer is "what am I doing today", not "how is job
// 14 progressing". The job name and address ride along on each row so they
// know where to turn up.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var rows = [];

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function todayStr() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function daysTo(dateStr) {
    if (!dateStr) return null;
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date(todayStr() + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }
  function fmt(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Buckets in the order a person cares about them.
  var BUCKETS = [
    { id: 'late',  title: 'Overdue',
      test: function (t) { var d = daysTo(t.end); return !(t.status === 'done') && d !== null && d < 0; } },
    { id: 'today', title: 'Due today',
      test: function (t) { return !(t.status === 'done') && daysTo(t.end) === 0; } },
    { id: 'soon',  title: 'Coming up',
      test: function (t) { var d = daysTo(t.end); return !(t.status === 'done') && d !== null && d > 0 && d <= 7; } },
    { id: 'later', title: 'Later',
      test: function (t) { var d = daysTo(t.end); return !(t.status === 'done') && (d === null || d > 7); } },
    // Finished work stays on screen: a worker who ticked the wrong task needs
    // a way back, and seeing what they got through is worth something.
    { id: 'done',  title: 'Finished', test: function (t) { return !!(t.status === 'done'); } },
  ];

  var myJobs = [];

  function load() {
    var el = document.getElementById('mm-my-body');
    el.innerHTML = '<div class="mm-empty">Loading...</div>';
    var me = auth.user();
    if (!me) return Promise.resolve();

    return Promise.all([
      window.MM.ghltasks.loadAllJobTasks(),
      window.MM.jobaccess.loadMine().then(loadJobsForWorker),
    ])
      .then(function (res) {
        // A task now records its worker as a name, so that is what is matched.
        var mine = (res[0] || []).filter(function (t) {
          return window.MM.ghltasks.isAssignedTo(t.who, me.name);
        });
        rows = mine;
        myJobs = res[1] || [];
        render();
        renderJobs();
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  // The jobs themselves come from GHL, filtered to the ones this worker is
  // allowed to open.
  function loadJobsForWorker() {
    if (!window.MM.jobaccess.count()) return Promise.resolve([]);
    return window.MM.api.fetchAllOpportunities()
      .then(function (ops) {
        return window.MM.jobaccess.mineOnly(
          ops.filter(function (o) { return o.pipelineId === window.MM.api.SALES_PIPELINE_ID; }));
      })
      .catch(function () { return []; });
  }

  function renderJobs() {
    var el = document.getElementById('mm-my-jobs');
    if (!el) return;
    if (!myJobs.length) { el.innerHTML = ''; return; }

    el.innerHTML =
      '<section class="mm-mygroup">' +
        '<div class="mm-mygroup-head">' +
          '<h3 class="mm-mygroup-title">My jobs</h3>' +
          '<span class="mm-mygroup-count">' + myJobs.length + '</span>' +
        '</div>' +
        '<p class="mm-crew-note">Open a job to take measurements or record a date.</p>' +
        myJobs.map(function (o) {
          var name = (o.contact && o.contact.name) || o.name || 'Job';
          var addr = window.MM.api.oppField(o, window.MM.api.ADDR_FIELD_ID) || '';
          return '<button type="button" class="mm-myjob" data-job="' + U.esc(o.id) + '">' +
            '<span class="mm-myjob-main">' +
              '<span class="mm-myjob-name">' + U.esc(name) + '</span>' +
              '<span class="mm-myjob-addr">' + U.esc(addr || 'No address on file') + '</span>' +
            '</span>' +
            '<span class="mm-jcard-arrow" aria-hidden="true">&#8250;</span>' +
          '</button>';
        }).join('') +
      '</section>';

    el.querySelectorAll('[data-job]').forEach(function (b) {
      b.addEventListener('click', function () {
        var o = myJobs.find(function (j) { return j.id === b.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o);
      });
    });
  }

  var onOpenJob = null;

  function render() {
    var el = document.getElementById('mm-my-body');
    var me = auth.user();

    var greet = document.getElementById('mm-my-greet');
    if (greet && me) greet.textContent = 'Hello ' + (me.name || '').split(' ')[0];

    var openRows = rows.filter(function (t) { return !(t.status === 'done'); });
    if (!openRows.length && !rows.length) {
      el.innerHTML = '<div class="mm-my-clear">' +
        '<div class="mm-my-clear-tick" aria-hidden="true">&#10003;</div>' +
        '<h2>Nothing to do right now</h2>' +
        '<p>When your manager gives you a task it will show up here.</p></div>';
      renderCounts(0, 0, 0);
      return;
    }

    var late = rows.filter(BUCKETS[0].test).length;
    var today = rows.filter(BUCKETS[1].test).length;
    renderCounts(late, today, openRows.length);

    var used = {};
    el.innerHTML = BUCKETS.map(function (b) {
      var mine = rows.filter(function (t) { return !used[t.id] && b.test(t); });
      mine.forEach(function (t) { used[t.id] = true; });
      if (!mine.length) return '';
      mine.sort(function (a, z) { return String(a.end_date || '') < String(z.end_date || '') ? -1 : 1; });
      return '<section class="mm-mygroup mm-mygroup-' + b.id + '">' +
        '<div class="mm-mygroup-head">' +
          '<h3 class="mm-mygroup-title">' + U.esc(b.title) + '</h3>' +
          '<span class="mm-mygroup-count">' + mine.length + '</span>' +
        '</div>' +
        mine.map(taskCard).join('') +
      '</section>';
    }).join('');

    bind(el);
  }

  function renderCounts(late, today, open) {
    var el = document.getElementById('mm-my-stats');
    if (!el) return;
    function stat(label, n, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + n + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }
    el.innerHTML =
      stat('To do', open, open ? 'neutral' : 'good') +
      stat('Due today', today, today ? 'warn' : 'good') +
      stat('Overdue', late, late ? 'bad' : 'good');
  }

  function checklist(t) {
    var done = t.items.filter(function (x) { return x.done; }).length;
    return '<div class="mm-mytask-items">' +
      '<div class="mm-mytask-itemhead">' + done + ' of ' + t.items.length + '</div>' +
      t.items.map(function (it, j) {
        return '<button type="button" class="mm-mytask-item' +
            (it.done ? ' is-done' : '') + '" data-sub="' + U.esc(t.id) + '.' + j + '">' +
          '<span class="mm-mytask-tick">' + (it.done ? '&#10003;' : '') + '</span>' +
          U.esc(it.title) + '</button>';
      }).join('') +
    '</div>';
  }

  function taskCard(t) {
    var d = daysTo(t.end);
    var flag = d === null ? 'No date'
      : d < 0 ? Math.abs(d) + ' day' + (Math.abs(d) === 1 ? '' : 's') + ' late'
      : d === 0 ? 'Due today'
      : d === 1 ? 'Due tomorrow'
      : 'Due ' + fmt(t.end);
    var cls = d !== null && d < 0 ? 'urgent' : d === 0 ? 'soon' : '';

    // The dates are spelled out as a range: a worker needs to know when they
    // can start as well as when it is due, and "Sep 12 - Sep 14" answers both
    // at a glance.
    var range = t.start && t.end
      ? fmt(t.start) + ' &rarr; ' + fmt(t.end)
      : t.end ? 'Due ' + fmt(t.end)
      : t.start ? 'From ' + fmt(t.start)
      : 'No dates set';

    return '<div class="mm-mytask' + ((t.status === 'done') ? ' is-done' : '') + '">' +
      '<button type="button" class="mm-task-tick" data-tick="' + U.esc(t.id) + '" ' +
        'aria-label="' + ((t.status === 'done') ? 'Reopen ' : 'Mark ') + U.esc(t.title) +
        ((t.status === 'done') ? '' : ' done') + '">' + ((t.status === 'done') ? '&#10003;' : '') + '</button>' +
      '<div class="mm-mytask-main">' +
        '<div class="mm-mytask-title">' + U.esc(t.title) + '</div>' +
        '<div class="mm-mytask-jobrow">' +
          '<span class="mm-mytask-joblabel">Job</span>' +
          '<span class="mm-mytask-jobname">' + U.esc(t.jobName || 'Not recorded') + '</span>' +
        '</div>' +
        '<div class="mm-mytask-dates">' + range + '</div>' +
        (t.notes ? '<div class="mm-mytask-notes">' + U.esc(t.notes) + '</div>' : '') +
        ((t.items || []).length ? checklist(t) : '') +
      '</div>' +
      '<span class="mm-jflag mm-jflag-' + cls + '">' + U.esc(flag) + '</span>' +
    '</div>';
  }

  function bind(el) {
    el.querySelectorAll('[data-sub]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-sub').split('.');
        var t = rows.find(function (x) { return x.id === parts[0]; });
        if (!t) return;
        var j = +parts[1];
        var id = String(t.id).split(':');
        b.disabled = true;
        var want = !t.items[j].done;
        window.MM.ghltasks.setItemOnJob(id[0], +id[1], j, want)
          .then(function () {
            window.MM.activity.log(want ? 'task_done' : 'task_undone',
              (want ? 'Ticked off "' : 'Reopened "') + t.items[j].title +
              '" in ' + t.title, { jobId: t.jobId, jobName: t.jobName });
            t.items[j].done = want;
            render();
          })
          .catch(function (e) {
            b.disabled = false;
            var err = document.getElementById('mm-my-error');
            if (err) err.textContent = 'Could not save: ' + e.message;
          });
      });
    });

    el.querySelectorAll('[data-tick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-tick');
        var t = rows.find(function (x) { return x.id === id; });
        if (!t) return;
        var undo = t.status === 'done';
        b.disabled = true;
        // The id carries the job and the task's position in that job's list,
        // which is what the writer needs to change the right line.
        var parts = String(id).split(':');
        window.MM.ghltasks.setStatusOnJob(parts[0], +parts[1], undo ? 'todo' : 'done')
          .then(function () {
            window.MM.activity.log(undo ? 'task_undone' : 'task_done',
              (undo ? 'Reopened "' : 'Finished "') + t.title + '"', {
                jobId: t.jobId, jobName: t.jobName,
              });
            // Redraw from what is already in memory. Reloading would re-read
            // every job in the account for a change we already know about.
            t.status = undo ? 'todo' : 'done';
            render();
          })
          .catch(function (e) {
            b.disabled = false;
            var err = document.getElementById('mm-my-error');
            if (err) err.textContent = 'Could not save: ' + e.message;
          });
      });
    });
  }

  window.MM.mytasks = {
    load: load,
    onOpenJob: function (fn) { onOpenJob = fn; },
  };
})();
