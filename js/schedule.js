// js/schedule.js
// The Schedule — everything with a date, on one calendar.
//
// Two kinds of thing land here, and they are deliberately drawn as different
// species rather than two colours of the same chip:
//
//   Measurement visits  a moment. One day, from the job's appointment date.
//   Job tasks           a stretch. A bar spanning start date to end date.
//
// That distinction is the whole point of the screen: you are looking for a
// clash between someone's visit and the work they are already committed to,
// and a bar tells you about the days in between in a way a dot cannot.
//
// Tasks only exist once a job reaches Material Ordering, which is a rule set
// elsewhere and deliberately left alone. Early-stage jobs therefore show only
// their measurement visit, and that is the honest picture.
//
// Who sees what follows the rest of the app: an admin sees everyone, a worker
// sees only the jobs they are on.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;
  var TASKS = window.MM.tasks, ACCESS = window.MM.jobaccess;

  var view = 'week';
  var cursor = startOfDay(new Date());   // the date the view is centred on
  var tasks = [], appts = [], staff = [], jobs = [];
  var loaded = false;
  var onOpenJob = null;

  var filters = { worker: '', job: '', status: 'open', appts: true };

  // ---- Dates ---------------------------------------------------------------
  // All day maths runs on local midnight. Task dates are plain YYYY-MM-DD
  // strings with no timezone, so parsing them as UTC would shift a task onto
  // the wrong day for anyone west of Greenwich.

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parseDay(s) {
    if (!s) return null;
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function key(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function sameDay(a, b) { return a && b && key(a) === key(b); }
  function startOfWeek(d) { return addDays(d, -d.getDay()); }        // Sunday
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function today() { return startOfDay(new Date()); }

  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-sc-body');
    el.innerHTML = '<div class="mm-empty">Loading the schedule...</div>';

    return Promise.all([
      TASKS.loadAllTasksForSchedule(),
      TASKS.loadStaff().catch(function () { return []; }),
      api.fetchAllOpportunities().catch(function () { return []; }),
      ACCESS.loadMine(),
    ])
      .then(function (res) {
        var allTasks = res[0] || [];
        staff = (res[1] || []).filter(function (s) { return s.role !== 'admin'; });

        var ops = (res[2] || []).filter(function (o) {
          return o.pipelineId === api.SALES_PIPELINE_ID;
        });
        // A worker only ever sees their own jobs, exactly as elsewhere.
        jobs = ACCESS.mineOnly(ops);

        var allowed = {};
        jobs.forEach(function (o) { allowed[o.id] = true; });
        tasks = allTasks.filter(function (t) { return !t.job_id || allowed[t.job_id]; });

        appts = jobs.map(toAppointment).filter(Boolean);

        loaded = true;
        fillFilters();
        render();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  // The measurement visit, read off the job's appointment date.
  function toAppointment(o) {
    var raw = api.oppField(o, api.DATE_FIELD_IDS.appointment);
    var d = parseDay(raw);
    if (!d) return null;
    return {
      kind: 'appt',
      id: 'appt-' + o.id,
      jobId: o.id,
      title: 'Measurement visit',
      job: jobLabel(o),
      date: d,
      done: !!api.oppField(o, api.DATE_FIELD_IDS.measured),
    };
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  // ---- Filtering -----------------------------------------------------------

  function fillFilters() {
    var w = document.getElementById('mm-sc-worker');
    if (w && w.options.length <= 1) {
      staff.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        w.appendChild(o);
      });
    }
    var j = document.getElementById('mm-sc-job');
    if (j) {
      var chosen = j.value;
      j.innerHTML = '<option value="">All jobs</option>';
      jobs.slice()
        .sort(function (a, b) { return jobLabel(a).localeCompare(jobLabel(b)); })
        .forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o.id; opt.textContent = jobLabel(o);
          j.appendChild(opt);
        });
      j.value = chosen;
    }
    // A worker has no one to filter by but themselves.
    var wrap = document.getElementById('mm-sc-worker');
    if (wrap) wrap.style.display = auth.isAdmin() ? '' : 'none';
  }

  function taskAssignees(t) {
    return (t.task_assignees || []).map(function (a) { return a.staff_id; });
  }

  function passes(item) {
    if (filters.job && item.jobId !== filters.job) return false;

    if (item.kind === 'appt') {
      if (!filters.appts) return false;
      // A visit belongs to whoever is on the job, not to one assignee.
      if (filters.worker) return false;
      if (filters.status === 'done') return item.done;
      if (filters.status === 'open') return !item.done;
      if (filters.status === 'late') {
        return !item.done && item.date < today();
      }
      return true;
    }

    if (filters.worker && taskAssignees(item.raw).indexOf(filters.worker) < 0) return false;
    if (filters.status === 'done') return !!item.done;
    if (filters.status === 'open') return !item.done;
    if (filters.status === 'late') return !item.done && item.end < today();
    return true;
  }

  // Tasks become spans; a task with only one date is a single day.
  function toSpan(t) {
    var s = parseDay(t.start_date), e = parseDay(t.end_date);
    if (!s && !e) return null;
    if (!s) s = e;
    if (!e) e = s;
    if (e < s) { var tmp = s; s = e; e = tmp; }
    return {
      kind: 'task', id: 't-' + t.id, raw: t,
      jobId: t.job_id, title: t.title || 'Task',
      job: t.job_name || '', start: s, end: e,
      done: !!t.done_at,
    };
  }

  function spans() { return tasks.map(toSpan).filter(Boolean).filter(passes); }
  function visits() { return appts.filter(passes); }

  // Everything happening on one day.
  function itemsOn(d) {
    var out = visits().filter(function (a) { return sameDay(a.date, d); });
    spans().forEach(function (s) {
      if (d >= s.start && d <= s.end) out.push(s);
    });
    return out;
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    if (!loaded) return;
    document.querySelectorAll('.mm-sched-view').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-view') === view);
      b.setAttribute('aria-selected', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
    document.getElementById('mm-sc-title').textContent = title();
    renderLegend();

    var el = document.getElementById('mm-sc-body');
    if (view === 'day') el.innerHTML = dayView();
    else if (view === 'week') el.innerHTML = weekView();
    else if (view === 'month') el.innerHTML = monthView();
    else el.innerHTML = listView();

    bind(el);
  }

  function title() {
    if (view === 'day') {
      return cursor.toLocaleDateString(undefined,
        { weekday: 'long', month: 'long', day: 'numeric' });
    }
    if (view === 'week') {
      var s = startOfWeek(cursor), e = addDays(s, 6);
      var sameMonth = s.getMonth() === e.getMonth();
      return MONTHS[s.getMonth()].slice(0, 3) + ' ' + s.getDate() + ' – ' +
        (sameMonth ? '' : MONTHS[e.getMonth()].slice(0, 3) + ' ') + e.getDate() +
        ', ' + e.getFullYear();
    }
    if (view === 'month') return MONTHS[cursor.getMonth()] + ' ' + cursor.getFullYear();
    return 'Everything scheduled';
  }

  function renderLegend() {
    var el = document.getElementById('mm-sc-legend');
    if (!el) return;
    el.innerHTML =
      '<span class="mm-lg"><i class="mm-lg-appt"></i>Measurement visit</span>' +
      '<span class="mm-lg"><i class="mm-lg-task"></i>Job task</span>' +
      '<span class="mm-lg"><i class="mm-lg-late"></i>Overdue</span>';
  }

  function chipClass(item) {
    if (item.kind === 'appt') {
      return 'mm-ev mm-ev-appt' + (item.done ? ' is-done' :
        (item.date < today() ? ' is-late' : ''));
    }
    return 'mm-ev mm-ev-task' + (item.done ? ' is-done' :
      (item.end < today() ? ' is-late' : ''));
  }

  function chip(item, showJob) {
    var when = item.kind === 'appt' ? 'Visit' : '';
    return '<button type="button" class="' + chipClass(item) + '" ' +
        'data-job="' + U.esc(item.jobId || '') + '">' +
      '<span class="mm-ev-title">' + U.esc(item.title) + '</span>' +
      (showJob && item.job ? '<span class="mm-ev-job">' + U.esc(item.job) + '</span>' : '') +
      (when ? '<span class="mm-ev-when">' + when + '</span>' : '') +
    '</button>';
  }

  // ---- Day -----------------------------------------------------------------

  function dayView() {
    var rows = itemsOn(cursor);
    if (!rows.length) return emptyDay();
    return '<div class="mm-sc-day">' +
      rows.map(function (i) { return chip(i, true); }).join('') +
      '</div>';
  }

  function emptyDay() {
    return '<div class="mm-sc-empty">' +
      '<p class="mm-sc-empty-title">Nothing scheduled</p>' +
      '<p class="mm-sc-empty-sub">Tasks appear once a job reaches Material Ordering. ' +
      'Measurement visits show as soon as a date is set.</p></div>';
  }

  // ---- Week ----------------------------------------------------------------

  function weekView() {
    var s = startOfWeek(cursor), t = today();
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(s, i));

    return '<div class="mm-sc-week">' + days.map(function (d) {
      var rows = itemsOn(d);
      var isToday = sameDay(d, t);
      return '<section class="mm-sc-col' + (isToday ? ' is-today' : '') + '">' +
        '<header class="mm-sc-colhead">' +
          '<span class="mm-sc-dow">' + DAY_SHORT[d.getDay()] + '</span>' +
          '<span class="mm-sc-dnum">' + d.getDate() + '</span>' +
          (rows.length ? '<span class="mm-sc-cnt">' + rows.length + '</span>' : '') +
        '</header>' +
        '<div class="mm-sc-colbody">' +
          (rows.length
            ? rows.map(function (i) { return chip(i, true); }).join('')
            : '<span class="mm-sc-none">&mdash;</span>') +
        '</div>' +
      '</section>';
    }).join('') + '</div>';
  }

  // ---- Month ---------------------------------------------------------------
  //
  // Desktop shows the chips themselves. A phone shows a dot per day and the
  // chosen day's list underneath: a month grid with readable chips does not
  // fit a phone, and shrinking them to fit makes them unreadable instead.

  function monthView() {
    var first = startOfMonth(cursor);
    var gridStart = startOfWeek(first);
    var t = today();
    var cells = '';

    for (var i = 0; i < 42; i++) {
      var d = addDays(gridStart, i);
      var rows = itemsOn(d);
      var out = d.getMonth() !== cursor.getMonth();
      var late = rows.some(function (x) {
        return !x.done && (x.kind === 'appt' ? x.date : x.end) < t;
      });

      cells +=
        '<button type="button" class="mm-sc-cell' +
            (out ? ' is-out' : '') + (sameDay(d, t) ? ' is-today' : '') +
            (sameDay(d, cursor) ? ' is-sel' : '') + '" data-day="' + key(d) + '">' +
          '<span class="mm-sc-cellnum">' + d.getDate() + '</span>' +
          (rows.length
            ? '<span class="mm-sc-dots">' +
                rows.slice(0, 4).map(function (x) {
                  return '<i class="mm-sc-dot mm-sc-dot-' +
                    (x.kind === 'appt' ? 'appt' : 'task') +
                    (x.done ? ' is-done' : '') + '"></i>';
                }).join('') +
                (rows.length > 4 ? '<span class="mm-sc-more">+' + (rows.length - 4) + '</span>' : '') +
              '</span>' +
              '<span class="mm-sc-cellevents">' +
                rows.slice(0, 3).map(function (x) { return chip(x, false); }).join('') +
                (rows.length > 3
                  ? '<span class="mm-sc-more">+' + (rows.length - 3) + ' more</span>' : '') +
              '</span>'
            : '') +
        '</button>';
    }

    var sel = itemsOn(cursor);
    return '<div class="mm-sc-month">' +
        '<div class="mm-sc-dowrow">' +
          DAY_SHORT.map(function (n) { return '<span>' + n + '</span>'; }).join('') +
        '</div>' +
        '<div class="mm-sc-grid">' + cells + '</div>' +
      '</div>' +
      '<div class="mm-sc-daypanel">' +
        '<h3 class="mm-sc-dayhead">' +
          cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
        '</h3>' +
        (sel.length
          ? sel.map(function (i) { return chip(i, true); }).join('')
          : '<p class="mm-sc-none-lg">Nothing scheduled.</p>') +
      '</div>';
  }

  // ---- List ----------------------------------------------------------------

  function listView() {
    var all = visits().map(function (a) { return { d: a.date, item: a }; })
      .concat(spans().map(function (s) { return { d: s.start, item: s }; }));

    if (!all.length) return emptyDay();
    all.sort(function (a, b) { return a.d - b.d; });

    var out = '', lastKey = '';
    all.forEach(function (r) {
      var k = key(r.d);
      if (k !== lastKey) {
        lastKey = k;
        var rel = relative(r.d);
        out += '<div class="mm-sc-lhead">' +
          '<span class="mm-sc-ldate">' +
            r.d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
          '</span>' +
          (rel ? '<span class="mm-sc-lrel">' + rel + '</span>' : '') +
        '</div>';
      }
      out += chip(r.item, true);
    });
    return '<div class="mm-sc-list">' + out + '</div>';
  }

  function relative(d) {
    var diff = Math.round((d - today()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff < 0) return Math.abs(diff) + ' days ago';
    return 'In ' + diff + ' days';
  }

  // ---- Interaction ---------------------------------------------------------

  function bind(el) {
    el.querySelectorAll('[data-job]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = b.getAttribute('data-job');
        var o = jobs.find(function (j) { return j.id === id; });
        if (o && onOpenJob) onOpenJob(o);
      });
    });
    el.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = parseDay(b.getAttribute('data-day'));
        if (!d) return;
        cursor = d;
        render();
      });
    });
  }

  function step(dir) {
    if (view === 'day') cursor = addDays(cursor, dir);
    else if (view === 'week') cursor = addDays(cursor, dir * 7);
    else if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
    render();
  }

  function init(openJobFn) {
    onOpenJob = openJobFn;

    document.getElementById('mm-sc-prev').addEventListener('click', function () { step(-1); });
    document.getElementById('mm-sc-next').addEventListener('click', function () { step(1); });
    document.getElementById('mm-sc-today').addEventListener('click', function () {
      cursor = today(); render();
    });

    document.querySelectorAll('.mm-sched-view').forEach(function (b) {
      b.addEventListener('click', function () {
        view = b.getAttribute('data-view');
        render();
      });
    });

    document.getElementById('mm-sc-worker').addEventListener('change', function () {
      filters.worker = this.value; render();
    });
    document.getElementById('mm-sc-job').addEventListener('change', function () {
      filters.job = this.value; render();
    });
    document.getElementById('mm-sc-status').addEventListener('change', function () {
      filters.status = this.value; render();
    });
    document.getElementById('mm-sc-appts').addEventListener('change', function () {
      filters.appts = this.checked; render();
    });
    document.getElementById('mm-sc-clear').addEventListener('click', function () {
      filters = { worker: '', job: '', status: 'open', appts: true };
      document.getElementById('mm-sc-worker').value = '';
      document.getElementById('mm-sc-job').value = '';
      document.getElementById('mm-sc-status').value = 'open';
      document.getElementById('mm-sc-appts').checked = true;
      cursor = today();
      render();
    });

    // Arrow keys move through the calendar, as they do in a desktop calendar.
    document.getElementById('screen-schedule').addEventListener('keydown', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') { step(-1); }
      else if (e.key === 'ArrowRight') { step(1); }
      else return;
      e.preventDefault();
    });
  }

  window.MM.schedule = { init: init, load: load };
})();
