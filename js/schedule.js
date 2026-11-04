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
  var ACCESS = window.MM.jobaccess;

  var view = 'week';
  var cursor = startOfDay(new Date());   // the day the view is centred on
  var tasks = [], staff = [], jobs = [];
  var stages = [];                       // the sales pipeline's stages, in order
  var jobById = {};
  var loaded = false;
  var onOpenJob = null;

  var filters = { worker: '', job: '', stage: '', status: 'all', kind: 'all' };
  var searchTerm = '';

  // The List opens on unfinished work, as the Tasks page does; the calendar
  // views show everything. Only until someone picks a status themselves --
  // after that their choice stands in every view.
  var statusTouched = false;
  function restingStatus() { return view === 'list' ? 'open' : 'all'; }
  function applyRestingStatus() {
    if (statusTouched) return;
    filters.status = restingStatus();
    var sel = document.getElementById('mm-sc-status');
    if (sel) sel.value = filters.status;
  }

  // An optional date window. Both null means show everything, which is the
  // default: the Day/Week/Month views already narrow by date on their own.
  var rangeFrom = null, rangeTo = null;

  // Every item on a day is shown: the client would rather scroll a long day
  // than open a "+n more". No limit, so "+n more" never appears.
  var WEEK_MAX = Infinity, MONTH_MAX = Infinity;

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
    el.innerHTML = '<div class="mm-empty">Loading the calendar...</div>';

    return Promise.all([
      window.MM.ghltasks.loadAllJobTasks(),
      window.MM.workerlist.load().catch(function () { return null; }),
      api.fetchAllOpportunities().catch(function () { return []; }),
      ACCESS.loadMine(),
      // For the stage filter. Without it the filter is simply empty; the
      // calendar itself must still load.
      api.getPipelines().catch(function () { return []; }),
    ])
      .then(function (res) {
        var allTasks = res[0] || [];
        staff = window.MM.workerlist.assignableNames();

        var ops = (res[2] || []).filter(function (o) {
          return o.pipelineId === api.SALES_PIPELINE_ID;
        });
        jobs = ACCESS.mineOnly(ops);
        jobById = {};
        jobs.forEach(function (o) { jobById[o.id] = o; });

        var sales = (res[4] || []).find(function (p) { return p.id === api.SALES_PIPELINE_ID; });
        stages = (sales && sales.stages) || [];

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

  // The customer and the property, which is what identifies a task: "Get
  // Permits" says nothing on its own, and the worker's name said less -- on
  // your own schedule every row was your own name.
  //
  // The address is looked up from the opportunity rather than carried on the
  // task, because a GoHighLevel task knows only its job's name.
  function jobSub(item) {
    var name = item.job || '';
    var street = '';

    if (item.jobId) {
      var o = jobs.find(function (j) { return j.id === item.jobId; });
      if (o) {
        street = api.jobStreet(o);
        if (!name) name = jobLabel(o);
      }
    }

    if (name && street) return name + ' — ' + street;
    return name || street;
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
    // Stages in pipeline order, the order the business moves a job through.
    var st = document.getElementById('mm-sc-stage');
    if (st && st.options.length <= 1) {
      stages.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        st.appendChild(o);
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
  }

  // A task in GoHighLevel stores the worker as plain text, so the filter
  // compares names rather than ids.
  function readDates() {
    rangeFrom = parseDay(document.getElementById('mm-sc-from').value);
    rangeTo = parseDay(document.getElementById('mm-sc-to').value);
    if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
      var swap = rangeFrom; rangeFrom = rangeTo; rangeTo = swap;
    }
  }

  function inRange(item) {
    if (!rangeFrom && !rangeTo) return true;
    if (rangeTo && item.start > rangeTo) return false;
    if (rangeFrom && item.end < rangeFrom) return false;
    return true;
  }

  // What the search can find: the jobs and the people, each labelled so it is
  // obvious what picking one will do. Built from the tasks actually loaded, so
  // nothing offered can come back empty.
  function findable() {
    var jobs = {}, people = {};
    tasks.forEach(function (t) {
      if (t.jobName) jobs[t.jobName] = true;
      String(t.who || '').split(',').forEach(function (n) {
        n = n.trim(); if (n) people[n] = true;
      });
    });
    return Object.keys(jobs).sort().map(function (v) {
      return { value: v, kind: 'Job' };
    }).concat(Object.keys(people).sort().map(function (v) {
      return { value: v, kind: 'Worker' };
    }));
  }

  function renderHits(term) {
    var box = document.getElementById('mm-sc-hits');
    var input = document.getElementById('mm-sc-search');
    if (!box) return;

    var q = String(term || '').trim().toLowerCase();
    if (!q) {
      box.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    var hits = findable().filter(function (h) {
      return h.value.toLowerCase().indexOf(q) > -1;
    }).slice(0, 8);

    box.innerHTML = hits.length
      ? hits.map(function (h) {
          return '<button type="button" class="mm-sc-hit" role="option" ' +
              'data-pick="' + U.esc(h.value) + '">' +
            '<span class="mm-sc-hitname">' + U.esc(h.value) + '</span>' +
            '<span class="mm-sc-hitkind">' + h.kind + '</span>' +
          '</button>';
        }).join('')
      : '<p class="mm-sc-nohit">Nothing matches that.</p>';

    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');

    box.querySelectorAll('[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () {
        input.value = b.getAttribute('data-pick');
        searchTerm = input.value.toLowerCase();
        box.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        render();
      });
    });
  }

  function matchesSearch(item) {
    if (!searchTerm) return true;
    var hay = [item.job, item.who].join(' ').toLowerCase();
    // Every word must appear somewhere, so "usman counters" narrows rather
    // than widening.
    return searchTerm.split(/\s+/).every(function (w) {
      return !w || hay.indexOf(w) > -1;
    });
  }

  function passes(item) {
    if (filters.job && item.jobId !== filters.job) return false;
    // The stage of the job the item belongs to, so a stage shows its jobs'
    // tasks, visits and design work alike.
    if (filters.stage) {
      var o = jobById[item.jobId];
      if (!o || o.pipelineStageId !== filters.stage) return false;
    }
    if (filters.worker &&
        !window.MM.ghltasks.isAssignedTo(item.who, filters.worker)) return false;
    // To do / Done / Overdue describe a task. A visit has no such state, so
    // it steps aside rather than claiming one it does not have.
    // Under "To do" a visit still to happen counts as work ahead; one already
    // past does not. Design work waiting to start is always still to do.
    if (item.isVisit) {
      if (filters.status === 'all') return true;
      if (filters.status === 'open') return !!item.isDesign || item.end >= today();
      return false;
    }
    if (filters.status === 'done') return !!item.done;
    if (filters.status === 'open') return !item.done;
    if (filters.status === 'late') return !item.done && item.end < today();
    return true;
  }

  // The booked measurement visits, in the same shape as a task span so every
  // view, filter and search downstream treats them alike. Built from the jobs
  // already loaded for the job filter, so this costs no extra request.
  //
  // A visit is not work to tick off -- it is an appointment at an hour --
  // so it carries its time and is marked as its own kind.
  function visitSpans() {
    var out = [];
    (jobs || []).forEach(function (o) {
      var when = api.apptDateTime(o);
      var d = parseDay(when.date);
      if (!d) return;
      out.push({
        id: 'visit:' + o.id, raw: null, isVisit: true,
        jobId: o.id,
        title: 'Measurement visit',
        job: jobLabel(o),
        who: '',
        time: when.time,
        start: d, end: d,
        // A visit is never "done": it happens or it does not, and the
        // measurement date is what records that it happened.
        done: false,
      });
    });
    return out;
  }

  // Design work waiting to be started. Dated the day measuring finished, so
  // it appears on the calendar the moment it becomes due rather than staying
  // invisible until somebody remembers it.
  //
  // Dropped once the design is finished: the job has moved on, and a calendar
  // full of work already done is a calendar nobody reads.
  function designSpans() {
    var out = [];
    (jobs || []).forEach(function (o) {
      if (api.oppField(o, api.DATE_FIELD_IDS.design)) return;
      var d = parseDay(api.oppField(o, api.DATE_FIELD_IDS.needDesign));
      if (!d) return;
      out.push({
        id: 'design:' + o.id, raw: null, isVisit: true, isDesign: true,
        jobId: o.id,
        title: 'Needs design',
        job: jobLabel(o),
        who: '',
        time: '',
        start: d, end: d,
        done: false,
      });
    });
    return out;
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

  function spans() {
    var list = [];
    if (filters.kind !== 'visits') {
      list = tasks.map(toSpan).filter(Boolean);
    }
    if (filters.kind !== 'tasks') {
      list = list.concat(visitSpans()).concat(designSpans());
    }
    return list.filter(passes).filter(inRange).filter(matchesSearch);
  }

  // A day reads in the order it happens. Without this the items came out in
  // whatever order they were built -- tasks, then visits by job -- so a noon
  // visit could sit above an eleven o'clock one.
  //
  // Everything with a time comes first, earliest to latest. Tasks and design
  // work carry no time and cannot claim a place in the morning, so they
  // follow. Ties keep their original order, so nothing shuffles between
  // renders.
  function activeFilterCount() {
    var n = 0;
    if (filters.worker) n++;
    if (filters.job) n++;
    if (filters.stage) n++;
    if (filters.status && filters.status !== restingStatus()) n++;
    if (filters.kind && filters.kind !== 'all') n++;
    if (searchTerm) n++;
    if (rangeFrom || rangeTo) n++;
    return n;
  }

  function updateFilterCount() {
    var el = document.getElementById('mm-sc-filtercount');
    if (!el) return;
    var n = activeFilterCount();
    el.textContent = n ? String(n) : '';
    el.classList.toggle('is-on', n > 0);
  }

  function itemsOn(d) {
    return spans()
      .filter(function (s) { return d >= s.start && d <= s.end; })
      .map(function (s, i) { return { s: s, i: i }; })
      .sort(function (a, b) {
        var ta = minutesOf(a.s.time), tb = minutesOf(b.s.time);
        if (ta !== tb) {
          if (ta === null) return 1;
          if (tb === null) return -1;
          return ta - tb;
        }
        return a.i - b.i;
      })
      .map(function (x) { return x.s; });
  }

  // "14:30" -> 870. Anything without a usable time sorts last.
  function minutesOf(hhmm) {
    var p = String(hhmm || '').split(':');
    if (p.length < 2) return null;
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
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
    updateFilterCount();


    var el = document.getElementById('mm-sc-body');
    if (view === 'day') el.innerHTML = dayView();
    else if (view === 'week') el.innerHTML = weekView();
    else if (view === 'month') el.innerHTML = monthView();
    else el.innerHTML = listView();

    bind(el);
    if (view === 'week') trackWeekScroll(el);
    if (view === 'list') bindList(el);
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
    // A visit is an appointment somebody has to attend, not work to tick off,
    // so it is coloured apart from the tasks and leads with its time.
    var cls = item.isDesign ? 'mm-ev is-design'
      : item.isVisit ? 'mm-ev is-visit'
      : 'mm-ev' + (item.done ? ' is-done' : (isLate(item) ? ' is-late' : ''));
    var sub = jobSub(item);
    var title = item.isVisit && item.time
      ? fmtTime(item.time) + ' \u00b7 ' + item.title
      : (item.done ? '\u2713 ' : '') + item.title;
    // Who is on it, so a day can be read for who is where -- in every view.
    var who = workersOf(item);
    return '<button type="button" class="' + cls + '" data-open="' + U.esc(item.jobId || '') + '">' +
      '<span class="mm-ev-title">' + U.esc(title) + '</span>' +
      (sub ? '<span class="mm-ev-job">' + U.esc(sub) + '</span>' : '') +
      (who ? '<span class="mm-ev-who">' + U.esc(who) + '</span>' : '') +
      (opts.note ? '<span class="mm-ev-when">' + U.esc(opts.note) + '</span>' : '') +
    '</button>';
  }

  // A task's workers are stored as one comma-separated line of names.
  function workersOf(item) {
    return String(item.who || '').split(',')
      .map(function (n) { return n.trim(); })
      .filter(Boolean)
      .join(', ');
  }

  // 14:00 is what is stored; 2:00 PM is what people say.
  function fmtTime(hhmm) {
    var p = String(hhmm || '').split(':');
    if (p.length < 2) return hhmm || '';
    var h = parseInt(p[0], 10);
    if (isNaN(h)) return hhmm;
    var ampm = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + p[1] + ' ' + ampm;
  }

  // A day's chips, capped, with a "+n more" that opens the day.
  function chipStack(d, max, opts) {
    var rows = itemsOn(d);
    if (!rows.length) return '<span class="mm-sc-none">Nothing scheduled</span>';
    var shown = rows.slice(0, max);
    var rest = rows.length - shown.length;
    return shown.map(function (i) {
      return chip(i, { note: dayNote(i, d) });
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
        return chip(i, { note: dayNote(i, cursor) });
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
        '<div class="mm-sc-colbody">' + chipStack(d, WEEK_MAX) + '</div>' +
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

    // One section per date, opening and closing like the Tasks page. They
    // start closed, and stay as the person left them across redraws.
    var groups = [], byKey = {};
    rows.forEach(function (r) {
      var k = key(r.start);
      if (!byKey[k]) { byKey[k] = { k: k, d: r.start, rows: [] }; groups.push(byKey[k]); }
      byKey[k].rows.push(r);
    });

    return '<div class="mm-sc-list">' + groups.map(function (g) {
      var late = g.d < today() && g.rows.some(function (r) { return !r.done; });
      return '<details class="mm-td mm-sc-lday' + (late ? ' is-late' : '') + '" data-lday="' + g.k + '"' +
          (openListDays[g.k] ? ' open' : '') + '>' +
        '<summary class="mm-td-head">' + LIST_ARROW +
          '<span class="mm-td-date">' + U.esc(g.d.toLocaleDateString(undefined,
            { weekday: 'short', month: 'short', day: 'numeric' })) + '</span>' +
          '<span class="mm-td-rel">' + relative(g.d) + '</span>' +
          '<span class="mm-mygroup-count">' + g.rows.length + '</span>' +
        '</summary>' +
        '<div class="mm-td-body mm-sc-ldaybody">' + g.rows.map(listCard).join('') + '</div>' +
      '</details>';
    }).join('') + '</div>';
  }

  var openListDays = {};
  // The same drawn arrow as the Tasks page; a text triangle renders too small.
  var LIST_ARROW = '<span class="mm-tj-arrow" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="6 9 12 15 18 9"></polyline></svg></span>';

  // A task in the list is worked on in place, as on the Tasks page: tick it
  // done, tick its checklist, edit it. Visits and design work are not tasks
  // and keep their plain chip.
  function listCard(item) {
    var t = item.raw;
    if (!t) return chip(item, { note: dayNote(item, item.start) });

    var done = t.status === 'done';
    var admin = auth.isAdmin();
    var sub = jobSub(item);
    var who = workersOf(item);
    var note = dayNote(item, item.start);
    var items = t.items || [];
    var ticked = items.filter(function (x) { return x.done; }).length;

    return '<div class="mm-mytask mm-sc-ltask' + (done ? ' is-done' : (isLate(item) ? ' is-late' : '')) + '">' +
      '<button type="button" class="mm-task-tick" data-tick="' + U.esc(t.id) + '" ' +
        'aria-label="' + (done ? 'Reopen ' : 'Mark ') + U.esc(t.title) + (done ? '' : ' done') + '">' +
        (done ? '&#10003;' : '') + '</button>' +
      '<div class="mm-mytask-main">' +
        (admin
          ? '<button type="button" class="mm-mytask-title mm-mytask-edit" data-edit="' + U.esc(t.id) + '">' +
              U.esc(t.title) + '</button>'
          : '<div class="mm-mytask-title">' + U.esc(t.title) + '</div>') +
        (sub
          ? '<button type="button" class="mm-sc-ljob" data-open="' + U.esc(item.jobId || '') + '">' +
              U.esc(sub) + '</button>'
          : '') +
        (who ? '<span class="mm-ev-who">' + U.esc(who) + '</span>' : '') +
        (note ? '<span class="mm-ev-when">' + U.esc(note) + '</span>' : '') +
        (items.length
          ? '<div class="mm-mytask-items">' +
              '<div class="mm-mytask-itemhead">' + ticked + ' of ' + items.length + '</div>' +
              items.map(function (it, j) {
                return '<button type="button" class="mm-mytask-item' + (it.done ? ' is-done' : '') + '" ' +
                    'data-sub="' + U.esc(t.id) + '.' + j + '">' +
                  '<span class="mm-mytask-tick">' + (it.done ? '&#10003;' : '') + '</span>' +
                  U.esc(it.title) + '</button>';
              }).join('') +
            '</div>'
          : '') +
      '</div>' +
      (admin
        ? '<div class="mm-mytask-side">' +
            '<button type="button" class="mm-mytask-pencil" data-edit="' + U.esc(t.id) + '" ' +
              'aria-label="Edit ' + U.esc(t.title) + '">&#9998;</button>' +
          '</div>'
        : '') +
    '</div>';
  }

  function taskById(id) {
    return tasks.find(function (t) { return t.id === id; });
  }

  function showListError(msg) {
    var el = document.getElementById('mm-sc-body');
    var p = el && el.querySelector('.mm-sc-lerr');
    if (!p && el) {
      p = document.createElement('p');
      p.className = 'mm-task-error mm-sc-lerr';
      p.setAttribute('role', 'alert');
      el.insertBefore(p, el.firstChild);
    }
    if (p) p.textContent = msg;
  }

  // The same writes the Tasks page makes, against the same task in the job.
  // The task's id is "jobId:position", which is what the writers need.
  function bindList(el) {
    el.querySelectorAll('details[data-lday]').forEach(function (x) {
      x.addEventListener('toggle', function () { openListDays[x.getAttribute('data-lday')] = x.open; });
    });

    el.querySelectorAll('[data-tick]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var t = taskById(b.getAttribute('data-tick'));
        if (!t) return;
        var undo = t.status === 'done';
        var id = String(t.id).split(':');
        b.disabled = true;
        window.MM.ghltasks.setStatusOnJob(id[0], +id[1], undo ? 'todo' : 'done')
          .then(function () {
            window.MM.activity.log(undo ? 'task_undone' : 'task_done',
              (undo ? 'Reopened "' : 'Finished "') + t.title + '"',
              { jobId: t.jobId, jobName: t.jobName });
            t.status = undo ? 'todo' : 'done';
            render();
          })
          .catch(function (err) {
            b.disabled = false;
            showListError('Could not save: ' + err.message);
          });
      });
    });

    el.querySelectorAll('[data-sub]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var parts = b.getAttribute('data-sub').split('.');
        var t = taskById(parts[0]);
        var j = +parts[1];
        if (!t || !t.items || !t.items[j]) return;
        var want = !t.items[j].done;
        var id = String(t.id).split(':');
        b.disabled = true;
        window.MM.ghltasks.setItemOnJob(id[0], +id[1], j, want)
          .then(function () {
            window.MM.activity.log(want ? 'task_done' : 'task_undone',
              (want ? 'Ticked off "' : 'Reopened "') + t.items[j].title + '" in ' + t.title,
              { jobId: t.jobId, jobName: t.jobName });
            t.items[j].done = want;
            render();
          })
          .catch(function (err) {
            b.disabled = false;
            showListError('Could not save: ' + err.message);
          });
      });
    });

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var t = taskById(b.getAttribute('data-edit'));
        if (t && window.MM.mytasks && window.MM.mytasks.editTask) {
          window.MM.mytasks.editTask(t, render);
        }
      });
    });
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
          return chip(i, { note: dayNote(i, d) });
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
        applyRestingStatus();
        render();
      });
    });

    // Typing filters as you go; the suggestion list is the browser's own,
    // so picking one behaves exactly like finishing the word.
    var box = document.getElementById('mm-sc-search');
    var timer = null;
    box.addEventListener('input', function () {
      clearTimeout(timer);
      renderHits(box.value);
      timer = setTimeout(function () {
        searchTerm = box.value.trim().toLowerCase();
        render();
      }, 200);
    });
    box.addEventListener('focus', function () {
      if (box.value) renderHits(box.value);
    });
    // Escape closes the list without losing what was typed.
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.getElementById('mm-sc-hits').hidden = true;
        box.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('click', function (e) {
      var wrap = document.querySelector('.mm-sc-find');
      if (wrap && !wrap.contains(e.target)) {
        var hits = document.getElementById('mm-sc-hits');
        if (hits) hits.hidden = true;
        box.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('mm-sc-worker').addEventListener('change', function () {
      filters.worker = this.value; render();
    });
    document.getElementById('mm-sc-job').addEventListener('change', function () {
      filters.job = this.value; render();
    });
    document.getElementById('mm-sc-stage').addEventListener('change', function () {
      filters.stage = this.value; render();
    });
    document.getElementById('mm-sc-status').addEventListener('change', function () {
      filters.status = this.value; statusTouched = true; render();
    });
    document.getElementById('mm-sc-kind').addEventListener('change', function () {
      filters.kind = this.value; render();
    });
    ['mm-sc-from', 'mm-sc-to'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        readDates();
        // Move the calendar to the chosen date so the change is visible
        // instead of leaving the view on a week with nothing in it.
        if (rangeFrom) cursor = rangeFrom;
        render();
      });
    });

    // On a phone the filters live behind a button. The panel is plain CSS --
    // hidden below 620px until opened -- so this only flips the classes and
    // keeps the count in step.
    var fBtn = document.getElementById('mm-sc-filterbtn');
    var fPanel = document.getElementById('mm-sched-filters');
    if (fBtn && fPanel) {
      fBtn.addEventListener('click', function () {
        var open = !fPanel.classList.contains('is-open');
        fPanel.classList.toggle('is-open', open);
        fBtn.classList.toggle('is-open', open);
        fBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    document.getElementById('mm-sc-clear').addEventListener('click', function () {
      statusTouched = false;
      filters = { worker: '', job: '', stage: '', status: restingStatus(), kind: 'all' };
      searchTerm = '';
      document.getElementById('mm-sc-search').value = '';
      document.getElementById('mm-sc-hits').hidden = true;
      rangeFrom = null; rangeTo = null;
      document.getElementById('mm-sc-from').value = '';
      document.getElementById('mm-sc-to').value = '';
      document.getElementById('mm-sc-worker').value = '';
      document.getElementById('mm-sc-job').value = '';
      document.getElementById('mm-sc-stage').value = '';
      document.getElementById('mm-sc-status').value = filters.status;
      document.getElementById('mm-sc-kind').value = 'all';
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
