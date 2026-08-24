// js/activity.js
// The history of what people did.
//
// GoHighLevel cannot answer "who changed this" for us: the app talks to it
// with one shared integration token, so every change looks identical from
// GHL's side. Its own audit log is also only kept 60 days. So the record is
// written here, at the moment each action succeeds, with the signed-in
// person's name copied in — history has to survive a staff member leaving.
//
// Writing is deliberately silent: a failure to log must never block or undo
// the thing the user was actually doing.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var rows = [];
  var filterText = '';
  var filterActor = '';
  var filterJob = '';        // main page only; inside a job it is implied
  var jobFilterActor = '';   // the in-job panel keeps its own worker filter
  var jobFilter = null;   // set when viewing one job's history

  function db(method, path, body, quiet) { return auth.dbFetch(method, path, body, quiet); }

  // ---- Writing ------------------------------------------------------------

  // log('stage', 'Moved to Proposal Sent', { job: opportunity })
  function log(action, label, opts) {
    opts = opts || {};
    var me = auth.user();
    if (!me) return Promise.resolve();
    return db('POST', '/activity', {
      job_id: opts.jobId || null,
      job_name: opts.jobName || null,
      actor_id: me.id,
      actor_name: me.name,
      action: action,
      label: label,
      detail: opts.detail || null,
    }, true).catch(function (e) {
      // Never surface this: the user's actual action already succeeded, and
      // an error here would make a working change look broken.
      if (window.console) console.warn('activity log failed:', e.message);
    });
  }

  // ---- Reading ------------------------------------------------------------

  function loadFor(jobId) {
    jobFilter = jobId || null;
    var path = '/activity?select=*&order=created_at.desc&limit=300';
    if (jobId) path += '&job_id=eq.' + encodeURIComponent(jobId);
    return db('GET', path).then(function (r) { rows = r || []; return rows; });
  }

  // ---- Rendering ----------------------------------------------------------

  var ICONS = {
    stage: '&#8646;', date: '&#128197;', task_done: '&#10003;', task_undone: '&#8630;',
    task_added: '&#43;', task_edited: '&#9998;', task_removed: '&#215;',
    list_added: '&#9776;', staff: '&#128100;', room: '&#127968;', signin: '&#8594;',
  };

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function exactTime(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  function matches(r, opts) {
    opts = opts || {};
    var actor = opts.inJob ? jobFilterActor : filterActor;
    if (actor && r.actor_id !== actor) return false;
    if (!opts.inJob && filterJob && r.job_id !== filterJob) return false;
    if (opts.inJob || !filterText) return true;
    var hay = (r.label + ' ' + (r.detail || '') + ' ' + r.actor_name + ' ' +
               (r.job_name || '')).toLowerCase();
    return hay.indexOf(filterText.toLowerCase()) > -1;
  }

  function render(containerId, opts) {
    opts = opts || {};
    var el = document.getElementById(containerId);
    if (!el) return;

    var shown = rows.filter(function (r) { return matches(r, opts); });
    if (!rows.length) {
      el.innerHTML = '<p class="mm-task-empty">Nothing has happened here yet.</p>';
      return;
    }
    if (!shown.length) {
      el.innerHTML = '<p class="mm-task-empty">Nothing matches that search.</p>';
      return;
    }

    // Grouped by day: "what happened yesterday" is the question people ask,
    // and a flat list of 300 timestamps does not answer it.
    var days = [], byDay = {};
    shown.forEach(function (r) {
      var d = new Date(r.created_at);
      var key = isNaN(d.getTime()) ? 'Unknown' : d.toDateString();
      if (!byDay[key]) { byDay[key] = []; days.push(key); }
      byDay[key].push(r);
    });

    var today = new Date().toDateString();
    var yest = new Date(Date.now() - 86400000).toDateString();

    el.innerHTML = days.map(function (key) {
      var heading = key === today ? 'Today' : key === yest ? 'Yesterday' : key;
      return '<div class="mm-act-day">' +
        '<div class="mm-act-daylabel">' + U.esc(heading) + '</div>' +
        byDay[key].map(function (r) {
          return '<div class="mm-act">' +
            '<span class="mm-act-icon mm-act-' + U.esc(r.action) + '" aria-hidden="true">' +
              (ICONS[r.action] || '&#8226;') + '</span>' +
            '<span class="mm-act-main">' +
              '<span class="mm-act-label">' + U.esc(r.label) + '</span>' +
              (r.detail ? '<span class="mm-act-detail">' + U.esc(r.detail) + '</span>' : '') +
              '<span class="mm-act-meta">' +
                '<span class="mm-act-who">' + U.esc(r.actor_name) + '</span>' +
                (opts.showJob && r.job_name
                  ? '<span class="mm-act-job">' + U.esc(r.job_name) + '</span>' : '') +
              '</span>' +
            '</span>' +
            '<time class="mm-act-when" title="' + U.esc(exactTime(r.created_at)) + '">' +
              U.esc(when(r.created_at)) + '</time>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');
  }

  // ---- Job history panel --------------------------------------------------

  function showForJob(job) {
    var el = document.getElementById('mm-job-history');
    if (!el) return;
    // Workers do not see history — theirs or anyone's.
    if (!auth.isAdmin()) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="mm-steps-head"><span class="mm-steps-title">History</span></div>' +
                   '<div class="mm-empty">Loading...</div>';

    loadFor(job.id)
      .then(function () {
        // Only the people who appear in this job's history: offering staff
        // with nothing to show would be a list of dead ends.
        var seen = {}, people = [];
        rows.forEach(function (r) {
          if (r.actor_id && !seen[r.actor_id]) {
            seen[r.actor_id] = true;
            people.push({ id: r.actor_id, name: r.actor_name });
          }
        });
        people.sort(function (a, b) { return a.name < b.name ? -1 : 1; });

        el.innerHTML =
          '<div class="mm-steps-head">' +
            '<span class="mm-steps-title">History</span>' +
            '<span class="mm-steps-badge mm-steps-badge-done">' + rows.length + ' change' +
              (rows.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
          (people.length > 1
            ? '<div class="mm-hist-jobfilter">' +
                '<label class="mm-label" for="mm-jobhist-who">Show changes by</label>' +
                '<select class="mm-select" id="mm-jobhist-who">' +
                  '<option value="">Everyone</option>' +
                  people.map(function (p) {
                    return '<option value="' + U.esc(p.id) + '">' + U.esc(p.name) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>'
            : '') +
          '<div id="mm-job-history-list"></div>';

        jobFilterActor = '';
        render('mm-job-history-list', { inJob: true });

        var sel = document.getElementById('mm-jobhist-who');
        if (sel) sel.addEventListener('change', function () {
          jobFilterActor = this.value;
          render('mm-job-history-list', { inJob: true });
        });

        if (window.MM.wireJobPanels) window.MM.wireJobPanels();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-steps-head"><span class="mm-steps-title">History</span></div>' +
                       '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  // ---- Full history page --------------------------------------------------

  function loadPage() {
    var el = document.getElementById('mm-hist-body');
    el.innerHTML = '<div class="mm-empty">Loading...</div>';
    return loadFor(null)
      .then(function () {
        fillFilters();
        render('mm-hist-body', { showJob: true });
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  // Both dropdowns are built from the history itself, not from the full
  // staff and customer lists — a filter that returns nothing is a dead end,
  // and the narrowing below keeps the two in step with each other.
  function fillFilters() {
    var whoSel = document.getElementById('mm-hist-who');
    var jobSel = document.getElementById('mm-hist-job');

    var people = {}, jobs = {};
    rows.forEach(function (r) {
      // Each list is built from the rows the OTHER filter still allows, so
      // picking a person cannot leave a customer selected who has nothing
      // of theirs to show.
      if ((!filterJob || r.job_id === filterJob) && r.actor_id) {
        people[r.actor_id] = r.actor_name;
      }
      if ((!filterActor || r.actor_id === filterActor) && r.job_id) {
        jobs[r.job_id] = r.job_name || 'Unnamed job';
      }
    });

    function fill(sel, map, current, allLabel) {
      if (!sel) return;
      var keys = Object.keys(map).sort(function (a, b) {
        return String(map[a]).toLowerCase() < String(map[b]).toLowerCase() ? -1 : 1;
      });
      sel.innerHTML = '<option value="">' + allLabel + '</option>' +
        keys.map(function (k) {
          return '<option value="' + U.esc(k) + '">' + U.esc(map[k]) + '</option>';
        }).join('');
      // A selection that no longer exists in the narrowed list is cleared
      // rather than left pointing at nothing.
      sel.value = map[current] ? current : '';
      return sel.value;
    }

    filterActor = fill(whoSel, people, filterActor, 'All workers') || '';
    filterJob = fill(jobSel, jobs, filterJob, 'All customers') || '';
  }

  function initPage() {
    var search = document.getElementById('mm-hist-search');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        filterText = search.value.trim();
        render('mm-hist-body', { showJob: true });
      }, 200);
    });

    document.getElementById('mm-hist-who').addEventListener('change', function () {
      filterActor = this.value;
      fillFilters();
      render('mm-hist-body', { showJob: true });
    });
    document.getElementById('mm-hist-job').addEventListener('change', function () {
      filterJob = this.value;
      fillFilters();
      render('mm-hist-body', { showJob: true });
    });
    document.getElementById('mm-hist-clear').addEventListener('click', function () {
      filterText = ''; filterActor = ''; filterJob = '';
      search.value = '';
      fillFilters();
      render('mm-hist-body', { showJob: true });
    });
  }

  window.MM.activity = {
    log: log, showForJob: showForJob, loadPage: loadPage, initPage: initPage,
  };
})();
