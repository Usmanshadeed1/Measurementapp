// js/checklist.js
// Every checklist item across every job, on one page.
//
// A checklist item lives inside a task, and a task lives inside a job. Finding
// what is still outstanding therefore meant opening jobs one at a time. This
// screen turns that inside out: the items come first, grouped under the
// customer they belong to, and can be ticked off without leaving the page.
//
// Deliberately not part of the Schedule. That page answers "what is happening
// this week" and arranges everything by date — but a checklist item has no
// date of its own, so it has nowhere to sit on a calendar. This page answers a
// different question: "what still needs doing".
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;
  var GT = window.MM.ghltasks, ACCESS = window.MM.jobaccess;

  var tasks = [];        // every task the person may see
  var staff = [];
  var loaded = false;
  var onOpenJob = null;

  var filters = { worker: '', job: '', show: 'open', kind: 'both' };
  var openJobs = {};     // job id -> is its list expanded

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-cl-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading the checklist...</div>';

    return Promise.all([
      GT.loadAllJobTasks(),
      window.MM.workerlist.load().catch(function () { return null; }),
      ACCESS.loadMine(),
    ])
      .then(function (res) {
        var all = res[0] || [];
        staff = window.MM.workerlist.assignableNames();

        // A worker sees only their own jobs, exactly as everywhere else.
        tasks = auth.isAdmin() ? all : all.filter(function (t) {
          return ACCESS.canOpen(t.jobId);
        });

        loaded = true;
        fillFilters();
        render();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function fillFilters() {
    var w = document.getElementById('mm-cl-worker');
    if (w) {
      w.style.display = auth.isAdmin() ? '' : 'none';
      if (w.options.length <= 1) {
        staff.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.name; o.textContent = s.name;
          w.appendChild(o);
        });
      }
    }

    var j = document.getElementById('mm-cl-job');
    if (j) {
      var chosen = j.value;
      var seen = {};
      j.innerHTML = '<option value="">All jobs</option>';
      tasks.forEach(function (t) {
        if (!t.jobId || seen[t.jobId]) return;
        seen[t.jobId] = true;
        var o = document.createElement('option');
        o.value = t.jobId; o.textContent = t.jobName || 'Job';
        j.appendChild(o);
      });
      j.value = chosen;
    }
  }

  // ---- Shaping -------------------------------------------------------------

  function visibleTasks() {
    return tasks.filter(function (t) {
      if (filters.job && t.jobId !== filters.job) return false;
      if (filters.worker && !GT.isAssignedTo(t.who, filters.worker)) return false;

      var has = (t.items || []).length > 0;
      // Checklists only: a task with nothing inside it is just a heading.
      if (filters.kind === 'items') return has && itemsOf(t).length > 0;
      // Tasks only: the task itself must pass the done filter.
      if (filters.kind === 'tasks') return taskPasses(t);
      // Both: keep it if either the task or one of its items is showing.
      return taskPasses(t) || itemsOf(t).length > 0;
    });
  }

  // The done filter applied to a task rather than to a checklist item.
  function taskPasses(t) {
    if (filters.show === 'open') return t.status !== 'done';
    if (filters.show === 'done') return t.status === 'done';
    return true;
  }

  function itemsOf(t) {
    if (filters.kind === 'tasks') return [];
    return (t.items || []).filter(function (it) {
      if (filters.show === 'open') return !it.done;
      if (filters.show === 'done') return it.done;
      return true;
    });
  }

  // Grouped under the customer, because that is how the work is actually
  // organised: one visit, one property, everything outstanding there.
  function groups() {
    var byJob = {}, order = [];
    visibleTasks().forEach(function (t) {
      if (!byJob[t.jobId]) { byJob[t.jobId] = { name: t.jobName || 'Job', id: t.jobId, tasks: [] }; order.push(t.jobId); }
      byJob[t.jobId].tasks.push(t);
    });
    return order.map(function (id) { return byJob[id]; });
  }

  function countAll(done) {
    var n = 0;
    tasks.forEach(function (t) {
      if (filters.kind !== 'items') {
        if ((t.status === 'done') === done) n++;
      }
      if (filters.kind !== 'tasks') {
        (t.items || []).forEach(function (it) { if (!!it.done === done) n++; });
      }
    });
    return n;
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    if (!loaded) return;
    var el = document.getElementById('mm-cl-body');
    if (!el) return;

    renderStats();

    var gs = groups();
    if (!gs.length) {
      el.innerHTML = emptyState();
      return;
    }

    el.innerHTML = gs.map(function (g) {
      var isOpen = !!openJobs[g.id];
      return '<section class="mm-cl-job' + (isOpen ? ' is-open' : '') + '">' +
        '<div class="mm-cl-jobhead' + (isOpen ? ' is-open' : '') + '">' +
          '<button type="button" class="mm-cl-jobtoggle" data-toggle="' +
              U.esc(g.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
            '<span class="mm-cl-caret" aria-hidden="true">&#9662;</span>' +
            '<span class="mm-cl-jobname">' + U.esc(g.name) + '</span>' +
            '<span class="mm-cl-jobcount">' + countIn(g) + '</span>' +
          '</button>' +
          '<button type="button" class="mm-cl-jobopen" data-open="' + U.esc(g.id) + '" ' +
            'aria-label="Open ' + U.esc(g.name) + '">&#8250;</button>' +
        '</div>' +
        // Same order as the job's own task list: undated first, then oldest
        // to newest, so the two screens read the same way.
        (isOpen ? GT.sortTasks(g.tasks).map(taskBlock).join('') : '') +
      '</section>';
    }).join('');

    bind(el);
  }

  // The count has to describe whatever the page is showing. On "both" that
  // means tasks AND items, or a job of twenty dateless tasks reports "0 items"
  // while listing all twenty.
  function countIn(g) {
    var tasksN = g.tasks.length;
    var itemsN = 0;
    g.tasks.forEach(function (x) { itemsN += itemsOf(x).length; });

    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

    if (filters.kind === 'tasks') return plural(tasksN, 'task');
    if (filters.kind === 'items') return plural(itemsN, 'item');
    return plural(tasksN, 'task') +
      (itemsN ? ', ' + plural(itemsN, 'item') : '');
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
    var p = String(t.end).split('-');
    if (p.length !== 3) return false;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    return d < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function taskBlock(t) {
    var items = itemsOf(t);
    var when = t.end ? fmtDate(t.end) : (t.start ? fmtDate(t.start) : '');
    var late = isLate(t);

    return '<div class="mm-cl-task' + (late ? ' is-late' : '') +
        (t.status === 'done' ? ' is-taskdone' : '') + '">' +
      '<div class="mm-cl-taskhead">' +
        // The task itself is tickable here, not only its checklist items: most
        // tasks have no checklist, which left this page read-only for them.
        '<button type="button" class="mm-cl-taskbox' + (t.status === 'done' ? ' is-done' : '') +
            '" data-done="' + U.esc(t.id) + '" ' +
            'aria-pressed="' + (t.status === 'done' ? 'true' : 'false') + '" ' +
            'aria-label="' + (t.status === 'done' ? 'Reopen ' : 'Mark done: ') +
            U.esc(t.title || 'task') + '">' +
          '<span class="mm-cl-box">' + (t.status === 'done' ? '&#10003;' : '') + '</span>' +
          '<span class="mm-cl-tasktitle">' + U.esc(t.title || 'Task') + '</span>' +
        '</button>' +
        (t.who ? '<span class="mm-cl-who">' + U.esc(t.who) + '</span>' : '') +
        (when ? '<span class="mm-cl-when' + (late ? ' is-late' : '') + '">' +
          U.esc(when) + (late ? ' · overdue' : '') + '</span>' : '') +
      '</div>' +
      (!items.length
        ? '<p class="mm-cl-noitems">' +
          (t.status === 'done' ? 'Done' : 'No checklist') + '</p>'
        : '') +
      '<div class="mm-cl-items">' +
        items.map(function (it) {
          // The index is taken from the task's own list, not the filtered one,
          // or ticking an item would write to the wrong line.
          var j = t.items.indexOf(it);
          return '<button type="button" class="mm-cl-item' + (it.done ? ' is-done' : '') +
              '" data-tick="' + U.esc(t.id) + '.' + j + '" ' +
              'aria-pressed="' + (it.done ? 'true' : 'false') + '">' +
            '<span class="mm-cl-box">' + (it.done ? '&#10003;' : '') + '</span>' +
            '<span class="mm-cl-itemtext">' + U.esc(it.title) + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function emptyState() {
    var what = filters.kind === 'tasks' ? 'tasks'
      : filters.kind === 'items' ? 'checklist items' : 'tasks or checklists';
    var msg = filters.show === 'done'
      ? 'Nothing is done yet.'
      : filters.show === 'open'
        ? 'Everything is done.'
        : 'No ' + what + ' yet.';
    return '<div class="mm-cl-empty">' +
      '<p class="mm-cl-empty-title">' + U.esc(msg) + '</p>' +
      '<p class="mm-cl-empty-sub">Checklist items are added inside a task on ' +
      'the job screen.</p></div>';
  }

  function renderStats() {
    var el = document.getElementById('mm-cl-stats');
    if (!el) return;
    var open = countAll(false), done = countAll(true);
    function stat(label, n, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + n + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }
    el.innerHTML =
      stat('Not done yet', open, open ? 'warn' : 'good') +
      stat('Done', done, 'good') +
      stat('Total', open + done, 'neutral');
  }

  // ---- Interaction ---------------------------------------------------------

  function bind(el) {
    el.querySelectorAll('[data-tick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-tick').split('.');
        var t = tasks.find(function (x) { return x.id === parts[0]; });
        if (!t) return;
        var j = +parts[1];
        var it = t.items[j];
        if (!it) return;

        var want = !it.done;
        var id = String(t.id).split(':');
        b.disabled = true;

        GT.setItemOnJob(id[0], +id[1], j, want)
          .then(function () {
            window.MM.activity.log(want ? 'task_done' : 'task_undone',
              (want ? 'Ticked off "' : 'Reopened "') + it.title + '" in ' + t.title,
              { jobId: t.jobId, jobName: t.jobName });
            // Updated in place rather than reloading: a full reload would
            // re-read every job for a change already known.
            it.done = want;
            render();
          })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not save: ' + e.message);
          });
      });
    });

    el.querySelectorAll('[data-done]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = tasks.find(function (x) { return x.id === b.getAttribute('data-done'); });
        if (!t) return;

        var want = t.status === 'done' ? 'todo' : 'done';
        var id = String(t.id).split(':');
        b.disabled = true;

        // The checklist items are deliberately left alone. Whether the task is
        // finished is a judgement call; which steps were actually done is real
        // information, and ticking them all would destroy it.
        GT.setStatusOnJob(id[0], +id[1], want)
          .then(function () {
            window.MM.activity.log(want === 'done' ? 'task_done' : 'task_undone',
              (want === 'done' ? 'Marked "' : 'Reopened "') + t.title + '"',
              { jobId: t.jobId, jobName: t.jobName });
            t.status = want;
            // Finishing a task stamps its end date when it had none. Mirrored
            // here so the row does not show a stale blank until the next load.
            if (want === 'done' && !t.end) {
              var d = new Date();
              t.end = d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
            }
            render();
          })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not save: ' + e.message);
          });
      });
    });

    el.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-toggle');
        openJobs[id] = !openJobs[id];
        render();
      });
    });

    el.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-open');
        if (!onOpenJob) return;
        // The job screen needs the whole opportunity — custom fields, contact,
        // stage — so it is fetched rather than passed a stub built from a task.
        b.disabled = true;
        window.MM.api.getOpportunity(id)
          .then(function (o) { if (o) onOpenJob(o); })
          .catch(function (e) { showError('Could not open the job: ' + e.message); })
          .then(function () { b.disabled = false; });
      });
    });
  }

  function showError(msg) {
    var el = document.getElementById('mm-cl-error');
    if (el) el.textContent = msg || '';
  }

  function init(openJobFn) {
    onOpenJob = openJobFn;

    document.getElementById('mm-cl-worker').addEventListener('change', function () {
      filters.worker = this.value; render();
    });
    document.getElementById('mm-cl-job').addEventListener('change', function () {
      filters.job = this.value; render();
    });
    document.getElementById('mm-cl-kind').addEventListener('change', function () {
      filters.kind = this.value; render();
    });
    document.getElementById('mm-cl-show').addEventListener('change', function () {
      filters.show = this.value; render();
    });
    document.getElementById('mm-cl-clear').addEventListener('click', function () {
      filters = { worker: '', job: '', show: 'open', kind: 'both' };
      document.getElementById('mm-cl-kind').value = 'both';
      document.getElementById('mm-cl-worker').value = '';
      document.getElementById('mm-cl-job').value = '';
      document.getElementById('mm-cl-show').value = 'open';
      render();
    });
  }

  window.MM.checklist = { init: init, load: load };
})();
