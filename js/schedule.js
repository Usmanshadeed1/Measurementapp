// js/schedule.js
// The Schedule — every job task with a date, on one calendar.
//
// A task is a stretch of days, not a moment: "Install cabinets, Mon to Wed".
// So a task appears on every day it covers rather than only on its due date,
// which is what makes an overloaded week visible at a glance.
//
// Tasks exist once a job reaches Material Ordering, a rule owned elsewhere and
// deliberately left alone. Earlier-stage jobs therefore have nothing here, and
// that is the honest picture rather than a gap to paper over.
//
// Who sees what follows the rest of the app: an admin sees everyone, a worker
// sees only the jobs they are on.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;
  var TASKS = window.MM.tasks, ACCESS = window.MM.jobaccess;

  var view = 'week';
  var cursor = startOfDay(new Date());   // the day the view is centred on
  var tasks = [], staff = [], jobs = [];
  var loaded = false;
  var onOpenJob = null;

  var filters = { worker: '', job: '', status: 'open' };

  // How many chips fit before a cell needs a "+n more". Week columns are tall,
  // month cells are not.
  var WEEK_MAX = 4, MONTH_MAX = 3;

  // ---- Dates ---------------------------------------------------------------
  // Day maths runs on local midnight. Task dates are plain YYYY-MM-DD strings
  // with no timezone, so parsing them as UTC would land a task on the wrong
  // day for anyone west of Greenwich.

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
  function startOfWeek(d) { return addDays(d, -d.getDay()); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function today() { return startOfDay(new Date()); }

  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  function longDate(d) {
    return d.toLocaleDateString(undefined,
      { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-sc-body');
    el.innerHTML = '<div class="mm-empty">Loading the schedule...</div>';

    return Promise.all([
      window.MM.ghltasks.loadAllJobTasks(),
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
        jobs = ACCESS.mineOnly(ops);

        // A worker must not learn about a job through its tasks.
        var allowed = {};
        jobs.forEach(function (o) { allowed[o.id] = true; });
        tasks = auth.isAdmin()
          ? allTasks
          : allTasks.filter(function (t) { return t.jobId && allowed[t.jobId]; });

        loaded = true;
        fillFilters();
        render();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  // ---- Filters -------------------------------------------------------------

  function fillFilters() {
    var w = document.getElementById('mm-sc-worker');
    if (w) {
      // Only an admin has anyone else to filter by.
      w.style.display = auth.isAdmin() ? '' : 'none';
      if (w.options.length <= 1) {
        staff.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.name; o.textContent = s.name;
          w.appendChild(o);
        });
      }
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
  }

  // A task in GoHighLevel stores the worker as plain text, so the filter
  // compares names rather than ids.
  function passes(item) {
    if (filters.job && item.jobId !== filters.job) return false;
    if (filters.worker && item.who !== filters.worker) return false;
    if (filters.status === 'done') return !!item.done;
    if (filters.status === 'open') return !item.done;
    if (filters.status === 'late') return !item.done && item.end < today();
    return true;
  }

  // A task with only one of the two dates is treated as a single day.
  function toSpan(t) {
    var s = parseDay(t.start), e = parseDay(t.end);
    if (!s && !e) return null;
    if (!s) s = e;
    if (!e) e = s;
    if (e < s) { var tmp = s; s = e; e = tmp; }
    return {
      id: t.id, raw: t,
      jobId: t.jobId, title: t.title || 'Task',
      job: t.jobName || '',
      who: t.who || '',
      start: s, end: e, done: t.status === 'done',
    };
  }

  function spans() { return tasks.map(toSpan).filter(Boolean).filter(passes); }

  function itemsOn(d) {
    return spans().filter(function (s) { return d >= s.start && d <= s.end; });
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    if (!loaded) return;
    document.querySelectorAll('.mm-sched-view').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('mm-sc-title').textContent = title();

    var el = document.getElementById('mm-sc-body');
    if (view === 'day') el.innerHTML = dayView();
    else if (view === 'week') el.innerHTML = weekView();
    else if (view === 'month') el.innerHTML = monthView();
    else el.innerHTML = listView();

    bind(el);
    if (view === 'week') trackWeekScroll(el);
  }

  function title() {
    if (view === 'day') return longDate(cursor);
    if (view === 'week') {
      var s = startOfWeek(cursor), e = addDays(s, 6);
      var same = s.getMonth() === e.getMonth();
      return MONTHS[s.getMonth()].slice(0, 3) + ' ' + s.getDate() + ' – ' +
        (same ? '' : MONTHS[e.getMonth()].slice(0, 3) + ' ') + e.getDate() +
        ', ' + e.getFullYear();
    }
    if (view === 'month') return MONTHS[cursor.getMonth()] + ' ' + cursor.getFullYear();
    return 'Everything scheduled';
  }

  function isLate(item) { return !item.done && item.end < today(); }

  // Where a task sits in its own run of days. A task spanning Mon–Wed should
  // say so on Tuesday rather than looking like three separate jobs.
  function dayNote(item, d) {
    var span = Math.round((item.end - item.start) / 86400000) + 1;
    if (span <= 1) return '';
    var n = Math.round((d - item.start) / 86400000) + 1;
    return 'Day ' + n + ' of ' + span;
  }

  function chip(item, opts) {
    opts = opts || {};
    var cls = 'mm-ev' + (item.done ? ' is-done' : (isLate(item) ? ' is-late' : ''));
    var sub = opts.showWho && item.who ? item.who : item.job;
    return '<button type="button" class="' + cls + '" data-open="' + U.esc(item.jobId || '') + '">' +
      '<span class="mm-ev-title">' + U.esc(item.title) + '</span>' +
      (sub ? '<span class="mm-ev-job">' + U.esc(sub) + '</span>' : '') +
      (opts.note ? '<span class="mm-ev-when">' + U.esc(opts.note) + '</span>' : '') +
    '</button>';
  }

  // A day's chips, capped, with a "+n more" that opens the day.
  function chipStack(d, max, opts) {
    var rows = itemsOn(d);
    if (!rows.length) return '<span class="mm-sc-none">Nothing scheduled</span>';
    var shown = rows.slice(0, max);
    var rest = rows.length - shown.length;
    return shown.map(function (i) {
      return chip(i, { note: dayNote(i, d), showWho: opts && opts.showWho });
    }).join('') +
      (rest > 0
        ? '<button type="button" class="mm-sc-more" data-day="' + key(d) + '">+' +
          rest + ' more</button>'
        : '');
  }

  // ---- Day -----------------------------------------------------------------

  function dayView() {
    var rows = itemsOn(cursor);
    if (!rows.length) return emptyState();
    return '<div class="mm-sc-day">' +
      rows.map(function (i) {
        return chip(i, { note: dayNote(i, cursor), showWho: true });
      }).join('') + '</div>';
  }

  function emptyState() {
    return '<div class="mm-sc-empty">' +
      '<p class="mm-sc-empty-title">Nothing scheduled</p>' +
      '<p class="mm-sc-empty-sub">Tasks appear here once a job reaches Material ' +
      'Ordering and someone gives the task a date.</p></div>';
  }

  // ---- Week ----------------------------------------------------------------

  function weekView() {
    var s = startOfWeek(cursor), t = today();
    var out = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(s, i);
      var n = itemsOn(d).length;
      out += '<section class="mm-sc-col' + (sameDay(d, t) ? ' is-today' : '') + '">' +
        '<button type="button" class="mm-sc-colhead" data-day="' + key(d) + '">' +
          '<span class="mm-sc-dow">' + DAY_SHORT[d.getDay()] + '</span>' +
          '<span class="mm-sc-dnum">' + d.getDate() + '</span>' +
          (n ? '<span class="mm-sc-cnt">' + n + '</span>' : '') +
        '</button>' +
        '<div class="mm-sc-colbody">' + chipStack(d, WEEK_MAX, { showWho: true }) + '</div>' +
      '</section>';
    }
    // On a phone the seven days become a sideways scroller, which is
    // invisible until someone happens to swipe. The hint says so, and is
    // hidden on desktop where all seven columns are already on screen.
    return '<p class="mm-sc-swipe">Swipe across to see the rest of the week &rarr;</p>' +
      '<div class="mm-sc-week">' + out + '</div>';
  }

  // ---- Month ---------------------------------------------------------------
  //
  // A cell is a div, not a button: it holds chips, and a button inside a
  // button is invalid and lays out unpredictably. The date sits on its own
  // button so the whole cell is still one tap away from its day.

  function monthView() {
    var gridStart = startOfWeek(startOfMonth(cursor));
    var t = today();
    var cells = '';

    for (var i = 0; i < 42; i++) {
      var d = addDays(gridStart, i);
      var rows = itemsOn(d);
      var out = d.getMonth() !== cursor.getMonth();
      var late = rows.some(isLate);

      cells +=
        '<div class="mm-sc-cell' + (out ? ' is-out' : '') +
            (sameDay(d, t) ? ' is-today' : '') + '">' +
          '<button type="button" class="mm-sc-cellnum' +
              (rows.length ? ' has-items' : '') + '" data-day="' + key(d) + '" ' +
              'aria-label="' + U.esc(longDate(d)) +
              (rows.length ? ', ' + rows.length + ' scheduled' : ', nothing scheduled') + '">' +
            d.getDate() +
          '</button>' +
          (rows.length
            ? '<div class="mm-sc-dots">' +
                rows.slice(0, 4).map(function (x) {
                  return '<i class="mm-sc-dot' + (x.done ? ' is-done' : '') +
                    (isLate(x) ? ' is-late' : '') + '"></i>';
                }).join('') +
                (rows.length > 4 ? '<span class="mm-sc-dotmore">+' + (rows.length - 4) + '</span>' : '') +
              '</div>' +
              '<div class="mm-sc-cellevents">' +
                rows.slice(0, MONTH_MAX).map(function (x) { return chip(x, {}); }).join('') +
                (rows.length > MONTH_MAX
                  ? '<button type="button" class="mm-sc-more" data-day="' + key(d) + '">+' +
                    (rows.length - MONTH_MAX) + ' more</button>'
                  : '') +
              '</div>'
            : '') +
        '</div>';
    }

    return '<div class="mm-sc-month">' +
        '<div class="mm-sc-dowrow">' +
          DAY_SHORT.map(function (n) { return '<span>' + n + '</span>'; }).join('') +
        '</div>' +
        '<div class="mm-sc-grid">' + cells + '</div>' +
      '</div>';
  }

  // ---- List ----------------------------------------------------------------

  function listView() {
    var rows = spans().slice().sort(function (a, b) { return a.start - b.start; });
    if (!rows.length) return emptyState();

    var out = '', last = '';
    rows.forEach(function (r) {
      var k = key(r.start);
      if (k !== last) {
        last = k;
        out += '<div class="mm-sc-lhead">' +
          '<span class="mm-sc-ldate">' +
            r.start.toLocaleDateString(undefined,
              { weekday: 'short', month: 'short', day: 'numeric' }) +
          '</span>' +
          '<span class="mm-sc-lrel">' + relative(r.start) + '</span>' +
        '</div>';
      }
      out += chip(r, { showWho: true, note: dayNote(r, r.start) });
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

  // ---- The day popup -------------------------------------------------------
  //
  // Everything on one day, without leaving the view you were reading. This is
  // what "+n more" and a tapped date both open, so a busy day is never
  // truncated with no way to see the rest.

  function openDay(d) {
    var rows = itemsOn(d);
    document.getElementById('mm-sc-poptitle').textContent = longDate(d);
    document.getElementById('mm-sc-popcount').textContent =
      rows.length ? rows.length + (rows.length === 1 ? ' task' : ' tasks') : 'Nothing scheduled';

    var body = document.getElementById('mm-sc-popbody');
    body.innerHTML = rows.length
      ? rows.map(function (i) {
          return chip(i, { showWho: true, note: dayNote(i, d) });
        }).join('')
      : '<p class="mm-sc-none-lg">Nothing scheduled for this day.</p>';

    bind(body);
    document.getElementById('mm-modal-schedday').classList.add('open');
  }

  function closeDay() {
    document.getElementById('mm-modal-schedday').classList.remove('open');
  }

  // ---- Interaction ---------------------------------------------------------

  // The fade at the right edge means "there is more this way", so it must
  // come off once the last day is reached, or the week looks permanently
  // unfinished. Also drives the wording of the hint above it.
  function trackWeekScroll(el) {
    var wk = el.querySelector('.mm-sc-week');
    var hint = el.querySelector('.mm-sc-swipe');
    if (!wk) return;

    function update() {
      var more = wk.scrollWidth - wk.clientWidth - wk.scrollLeft > 8;
      wk.classList.toggle('has-more', more);
      // Only the wording is set here. Whether the hint shows at all is the
      // stylesheet's decision, so setting display would override the media
      // query and leak it onto desktop.
      if (hint) {
        hint.textContent = more
          ? 'Swipe across to see the rest of the week →'
          : 'That is the whole week';
      }
    }

    wk.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function bind(el) {
    el.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var o = jobs.find(function (j) { return j.id === b.getAttribute('data-open'); });
        if (!o) return;
        closeDay();
        if (onOpenJob) onOpenJob(o);
      });
    });
    el.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var d = parseDay(b.getAttribute('data-day'));
        if (d) openDay(d);
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
    document.getElementById('mm-sc-clear').addEventListener('click', function () {
      filters = { worker: '', job: '', status: 'open' };
      document.getElementById('mm-sc-worker').value = '';
      document.getElementById('mm-sc-job').value = '';
      document.getElementById('mm-sc-status').value = 'open';
      cursor = today();
      render();
    });

    document.getElementById('mm-sc-popclose').addEventListener('click', closeDay);
    document.getElementById('mm-modal-schedday').addEventListener('click', function (e) {
      if (e.target === this) closeDay();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDay();
    });

    // Arrow keys page the calendar, as they do in a desktop calendar.
    document.getElementById('screen-schedule').addEventListener('keydown', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else return;
      e.preventDefault();
    });
  }

  window.MM.schedule = { init: init, load: load };
})();
