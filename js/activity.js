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

  function matches(r) {
    if (filterActor && r.actor_id !== filterActor) return false;
    if (!filterText) return true;
    var hay = (r.label + ' ' + (r.detail || '') + ' ' + r.actor_name + ' ' +
               (r.job_name || '')).toLowerCase();
    return hay.indexOf(filterText.toLowerCase()) > -1;
  }

  function render(containerId, opts) {
    opts = opts || {};
    var el = document.getElementById(containerId);
    if (!el) return;

    var shown = rows.filter(matches);
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
        el.innerHTML =
          '<div class="mm-steps-head">' +
            '<span class="mm-steps-title">History</span>' +
            '<span class="mm-steps-badge mm-steps-badge-done">' + rows.length + ' change' +
              (rows.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
          '<div id="mm-job-history-list"></div>';
        filterText = ''; filterActor = '';
        render('mm-job-history-list');
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
    return Promise.all([loadFor(null), window.MM.tasks.loadStaff()])
      .then(function (res) {
        var staff = res[1] || [];
        var sel = document.getElementById('mm-hist-who');
        sel.innerHTML = '<option value="">Everyone</option>' +
          staff.map(function (s) {
            return '<option value="' + U.esc(s.id) + '">' + U.esc(s.name) + '</option>';
          }).join('');
        sel.value = filterActor;
        render('mm-hist-body', { showJob: true });
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
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
      render('mm-hist-body', { showJob: true });
    });
  }

  window.MM.activity = {
    log: log, showForJob: showForJob, loadPage: loadPage, initPage: initPage,
  };
})();
