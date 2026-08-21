// js/mytasks.js
// A worker's home screen: the tasks assigned to them, and nothing else.
//
// Grouped by when they are due rather than by job, because the question a
// worker opens the app to answer is "what am I doing today", not "how is job
// 14 progressing". The job name and address ride along on each row so they
// know where to turn up.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth, TASKS = window.MM.tasks;

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
    { id: 'late',  title: 'Overdue',        hint: 'These were due before today',
      test: function (t) { var d = daysTo(t.end_date); return d !== null && d < 0; } },
    { id: 'today', title: 'Due today',      hint: 'Finish these today',
      test: function (t) { return daysTo(t.end_date) === 0; } },
    { id: 'soon',  title: 'Coming up',      hint: 'Due in the next week',
      test: function (t) { var d = daysTo(t.end_date); return d !== null && d > 0 && d <= 7; } },
    { id: 'later', title: 'Later',          hint: 'Further ahead, or no date set',
      test: function (t) { var d = daysTo(t.end_date); return d === null || d > 7; } },
  ];

  function load() {
    var el = document.getElementById('mm-my-body');
    el.innerHTML = '<div class="mm-empty">Loading your tasks...</div>';
    var me = auth.user();
    if (!me) return Promise.resolve();

    return TASKS.loadMyTasks(me.id)
      .then(function (r) {
        rows = (r || []).filter(function (t) { return !t.done_at; });
        render();
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  function render() {
    var el = document.getElementById('mm-my-body');
    var me = auth.user();

    var greet = document.getElementById('mm-my-greet');
    if (greet && me) greet.textContent = 'Hello ' + (me.name || '').split(' ')[0];

    if (!rows.length) {
      el.innerHTML = '<div class="mm-my-clear">' +
        '<div class="mm-my-clear-tick" aria-hidden="true">&#10003;</div>' +
        '<h2>Nothing to do right now</h2>' +
        '<p>When your manager gives you a task it will show up here.</p></div>';
      renderCounts(0, 0);
      return;
    }

    var late = rows.filter(BUCKETS[0].test).length;
    var today = rows.filter(BUCKETS[1].test).length;
    renderCounts(late, today);

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

  function renderCounts(late, today) {
    var el = document.getElementById('mm-my-stats');
    if (!el) return;
    function stat(label, n, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + n + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }
    el.innerHTML =
      stat('To do', rows.length, rows.length ? 'neutral' : 'good') +
      stat('Due today', today, today ? 'warn' : 'good') +
      stat('Overdue', late, late ? 'bad' : 'good');
  }

  function taskCard(t) {
    var d = daysTo(t.end_date);
    var flag = d === null ? 'No date'
      : d < 0 ? Math.abs(d) + ' day' + (Math.abs(d) === 1 ? '' : 's') + ' late'
      : d === 0 ? 'Due today'
      : d === 1 ? 'Due tomorrow'
      : 'Due ' + fmt(t.end_date);
    var cls = d !== null && d < 0 ? 'urgent' : d === 0 ? 'soon' : '';

    // The dates are spelled out as a range: a worker needs to know when they
    // can start as well as when it is due, and "Sep 12 - Sep 14" answers both
    // at a glance.
    var range = t.start_date && t.end_date
      ? fmt(t.start_date) + ' &rarr; ' + fmt(t.end_date)
      : t.end_date ? 'Due ' + fmt(t.end_date)
      : t.start_date ? 'From ' + fmt(t.start_date)
      : 'No dates set';

    return '<div class="mm-mytask">' +
      '<button type="button" class="mm-task-tick" data-tick="' + U.esc(t.id) + '" ' +
        'aria-label="Mark ' + U.esc(t.title) + ' done"></button>' +
      '<div class="mm-mytask-main">' +
        '<div class="mm-mytask-title">' + U.esc(t.title) + '</div>' +
        '<div class="mm-mytask-jobrow">' +
          '<span class="mm-mytask-joblabel">Job</span>' +
          '<span class="mm-mytask-jobname">' + U.esc(t.job_name || 'Not recorded') + '</span>' +
        '</div>' +
        (t.job_address
          ? '<div class="mm-mytask-addr">' + U.esc(t.job_address) + '</div>' : '') +
        '<div class="mm-mytask-dates">' + range + '</div>' +
        (t.notes ? '<div class="mm-mytask-notes">' + U.esc(t.notes) + '</div>' : '') +
      '</div>' +
      '<span class="mm-jflag mm-jflag-' + cls + '">' + U.esc(flag) + '</span>' +
    '</div>';
  }

  function bind(el) {
    el.querySelectorAll('[data-tick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-tick');
        var t = rows.find(function (x) { return x.id === id; });
        b.disabled = true;
        db('PATCH', '/tasks?id=eq.' + id, {
          done_at: new Date().toISOString(), done_by: (auth.user() || {}).id,
        })
          .then(function () {
            window.MM.activity.log('task_done', 'Finished "' + (t ? t.title : 'a task') + '"', {
              jobId: t && t.job_id, jobName: t && t.job_name,
            });
            return load();
          })
          .catch(function (e) {
            b.disabled = false;
            var err = document.getElementById('mm-my-error');
            if (err) err.textContent = 'Could not save: ' + e.message;
          });
      });
    });
  }

  window.MM.mytasks = { load: load };
})();
