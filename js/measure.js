// js/measure.js
// The Room Measurement tab — a way into the measuring tool that starts from
// "which house am I standing outside", rather than from the dashboard.
//
// The field crew open the app at a property. Making them go via the job
// dashboard, find the row, open it and then switch tabs is three steps too
// many when they only ever want one thing. This screen lists the jobs they
// can measure and drops them straight into the Measure tab.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var jobs = [];
  var searchTerm = '';
  var onOpenJob = null;

  function customerName(o) {
    // Formatted the way GHL shows it, not the way it is stored.
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }
  function jobAddress(o) {
    var a = api.oppField(o, api.ADDR_FIELD_ID);
    if (a) return a;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ') : '';
  }
  function measuredDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.measured); }
  function apptDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.appointment); }

  function fmt(v) {
    if (!v) return '';
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? String(v)
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function daysTo(v) {
    if (!v) return null;
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date();
    t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d - t) / 86400000);
  }

  function load() {
    var el = document.getElementById('mm-measure-body');
    el.innerHTML = '<div class="mm-empty">Loading jobs...</div>';

    return Promise.all([
      api.fetchAllOpportunities(),
      window.MM.jobaccess.loadMine(),
    ])
      .then(function (res) {
        var ops = (res[0] || []).filter(function (o) {
          return o.pipelineId === api.SALES_PIPELINE_ID;
        });
        // A worker only ever sees jobs they are on; an admin sees everything.
        jobs = window.MM.jobaccess.mineOnly(ops);
        render();
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  function matches(o) {
    if (!searchTerm) return true;
    return (customerName(o) + ' ' + jobAddress(o)).toLowerCase()
      .indexOf(searchTerm.toLowerCase()) > -1;
  }

  function render() {
    var el = document.getElementById('mm-measure-body');
    var rows = jobs.filter(matches);

    if (!jobs.length) {
      el.innerHTML = '<div class="mm-empty">No jobs to measure yet.</div>';
      renderStats(0, 0);
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<div class="mm-empty">Nothing matches &ldquo;' + U.esc(searchTerm) + '&rdquo;.</div>';
      return;
    }

    // Not yet measured comes first — that is the work. Measured jobs stay
    // reachable underneath for going back and correcting something.
    var todo = rows.filter(function (o) { return !measuredDate(o); });
    var done = rows.filter(function (o) { return !!measuredDate(o); });
    renderStats(jobs.filter(function (o) { return !measuredDate(o); }).length, jobs.length);

    el.innerHTML =
      (todo.length
        ? section('To measure', todo.length,
            todo.sort(byAppointment).map(function (o) { return card(o, false); }).join(''))
        : '<p class="mm-task-empty">Every job has been measured.</p>') +
      (done.length
        ? section('Already measured', done.length,
            done.map(function (o) { return card(o, true); }).join(''))
        : '');

    el.querySelectorAll('[data-job]').forEach(function (b) {
      b.addEventListener('click', function () {
        var o = jobs.find(function (j) { return j.id === b.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o, 'measure');
      });
    });
  }

  // Soonest appointment first; jobs with no date sink to the bottom, since
  // there is nothing scheduled to act on.
  function byAppointment(a, b) {
    var da = daysTo(apptDate(a)), db = daysTo(apptDate(b));
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }

  function section(title, n, body) {
    return '<section class="mm-mygroup">' +
      '<div class="mm-mygroup-head">' +
        '<h3 class="mm-mygroup-title">' + U.esc(title) + '</h3>' +
        '<span class="mm-mygroup-count">' + n + '</span>' +
      '</div>' + body + '</section>';
  }

  function card(o, isDone) {
    var flag, cls = '';
    if (isDone) {
      flag = 'Measured ' + fmt(measuredDate(o));
      cls = 'done';
    } else {
      var appt = apptDate(o);
      var d = daysTo(appt);
      if (!appt) { flag = 'No date booked'; cls = 'urgent'; }
      else if (d < 0) { flag = Math.abs(d) + 'd overdue'; cls = 'urgent'; }
      else if (d === 0) { flag = 'Today'; cls = 'soon'; }
      else if (d === 1) { flag = 'Tomorrow'; cls = 'soon'; }
      else { flag = fmt(appt); }
    }

    return '<button type="button" class="mm-myjob' + (isDone ? ' is-measured' : '') +
        '" data-job="' + U.esc(o.id) + '">' +
      '<span class="mm-myjob-main">' +
        '<span class="mm-myjob-name">' + U.esc(customerName(o)) + '</span>' +
        '<span class="mm-myjob-addr">' + U.esc(jobAddress(o) || 'No address on file') + '</span>' +
      '</span>' +
      '<span class="mm-jflag mm-jflag-' + cls + '">' + U.esc(flag) + '</span>' +
      '<span class="mm-jcard-arrow" aria-hidden="true">&#8250;</span>' +
    '</button>';
  }

  function renderStats(todo, total) {
    var el = document.getElementById('mm-measure-stats');
    if (!el) return;
    function stat(label, n, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + n + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }
    el.innerHTML =
      stat('To measure', todo, todo ? 'warn' : 'good') +
      stat('Measured', total - todo, 'good') +
      stat('All jobs', total, 'neutral');
  }

  function init(openJobFn) {
    onOpenJob = openJobFn;
    var search = document.getElementById('mm-measure-search');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        searchTerm = search.value.trim();
        if (jobs.length) render();
      }, 200);
    });
  }

  window.MM.measure = { init: init, load: load };
})();
