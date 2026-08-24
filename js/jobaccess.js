// js/jobaccess.js
// Which jobs a worker may open.
//
// Two routes, because the work arrives in two ways:
//
//   1. A task on a job — the crew member doing "Install cabinets" needs the
//      address, so being given the task is enough.
//   2. Assigned to the job directly — the field crew measure a property long
//      before there is anything to make a task out of, so an admin can put
//      someone on a job on its own.
//
// Admins are never filtered; this only ever narrows what a worker sees.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var myJobIds = null;      // Set of job ids this worker may open
  var workersByJob = {};    // job_id -> [{staff_id, name}] for the admin panel
  var staffCache = null;

  function db(method, path, body, quiet) { return auth.dbFetch(method, path, body, quiet); }

  // ---- What this person may open -----------------------------------------

  // Built once per sign-in from both routes, so every later check is a plain
  // lookup rather than another round trip.
  function loadMine() {
    var me = auth.user();
    if (!me) return Promise.resolve(new Set());
    if (auth.isAdmin()) { myJobIds = null; return Promise.resolve(null); }

    return Promise.all([
      db('GET', '/job_workers?staff_id=eq.' + me.id + '&select=job_id'),
      db('GET', '/tasks?select=job_id,task_assignees!inner(staff_id)' +
                '&task_assignees.staff_id=eq.' + me.id),
    ]).then(function (res) {
      var ids = new Set();
      (res[0] || []).forEach(function (r) { if (r.job_id) ids.add(r.job_id); });
      (res[1] || []).forEach(function (r) { if (r.job_id) ids.add(r.job_id); });
      myJobIds = ids;
      return ids;
    }).catch(function () {
      // Fail closed: if the list cannot be read, show nothing rather than
      // everything.
      myJobIds = new Set();
      return myJobIds;
    });
  }

  function canOpen(jobId) {
    if (auth.isAdmin()) return true;
    return !!(myJobIds && myJobIds.has(jobId));
  }
  function mineOnly(jobs) {
    if (auth.isAdmin()) return jobs;
    return jobs.filter(function (o) { return canOpen(o.id); });
  }
  function count() { return myJobIds ? myJobIds.size : 0; }

  // ---- Admin: who is on this job ------------------------------------------

  function loadStaff() {
    if (staffCache) return Promise.resolve(staffCache);
    return db('GET', '/staff?select=id,name,role&active=eq.true&order=name')
      .then(function (rows) { staffCache = rows || []; return staffCache; });
  }

  function loadForJob(jobId) {
    return db('GET', '/job_workers?job_id=eq.' + encodeURIComponent(jobId) + '&select=staff_id')
      .then(function (rows) {
        workersByJob[jobId] = (rows || []).map(function (r) { return r.staff_id; });
        return workersByJob[jobId];
      });
  }

  function showForJob(job) {
    var el = document.getElementById('mm-job-crew');
    if (!el) return;
    // A worker on the job does not need to manage who else is on it.
    if (!auth.isAdmin()) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="mm-steps-head"><span class="mm-steps-title">Who can work on this job</span></div>' +
                   '<div class="mm-empty">Loading...</div>';

    Promise.all([loadStaff(), loadForJob(job.id)])
      .then(function (res) {
        var staff = res[0].filter(function (s) { return s.role !== 'admin'; });
        var on = res[1];

        if (!staff.length) {
          el.innerHTML = head(0) +
            '<p class="mm-task-empty">No workers yet. They can sign up with the team code.</p>';
          return;
        }

        el.innerHTML = head(on.length) +
          '<p class="mm-crew-note">Anyone ticked here can open this job and use the measurement tool. ' +
          'People given a task on this job get access automatically.</p>' +
          '<div class="mm-crew-list">' +
            staff.map(function (s) {
              return '<label class="mm-te-person"><input type="checkbox" value="' + U.esc(s.id) + '"' +
                (on.indexOf(s.id) > -1 ? ' checked' : '') + '> ' + U.esc(s.name) + '</label>';
            }).join('') +
          '</div>' +
          '<p class="mm-task-error" id="mm-crew-error" role="alert"></p>';

        el.querySelectorAll('.mm-crew-list input').forEach(function (cb) {
          cb.addEventListener('change', function () { toggle(job, cb, cb.value, cb.checked); });
        });
        if (window.MM.wireJobPanels) window.MM.wireJobPanels();
      })
      .catch(function (e) {
        el.innerHTML = head(0) + '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });

    function head(n) {
      return '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Who can work on this job</span>' +
        '<span class="mm-steps-badge ' + (n ? 'mm-steps-badge-done' : 'mm-steps-badge-todo') + '">' +
          (n ? n + ' assigned' : 'Nobody assigned') + '</span></div>';
    }
  }

  function toggle(job, cb, staffId, on) {
    cb.disabled = true;
    var errEl = document.getElementById('mm-crew-error');
    if (errEl) errEl.textContent = '';

    var name = (staffCache.find(function (s) { return s.id === staffId; }) || {}).name || 'someone';
    var jobName = jobLabel(job);

    var req = on
      ? db('POST', '/job_workers', {
          job_id: job.id, staff_id: staffId,
          job_name: jobName, job_address: jobAddr(job),
          added_by: (auth.user() || {}).id,
        }, true)
      : db('DELETE', '/job_workers?job_id=eq.' + encodeURIComponent(job.id) +
                     '&staff_id=eq.' + staffId);

    req
      .then(function () {
        window.MM.activity.log('crew',
          (on ? 'Gave ' : 'Removed ') + name + (on ? ' access to this job' : ' from this job'),
          { jobId: job.id, jobName: jobName });
        return showForJob(job);
      })
      .catch(function (e) {
        cb.disabled = false;
        cb.checked = !on;
        if (errEl) errEl.textContent = 'Could not save: ' + e.message;
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

  window.MM.jobaccess = {
    loadMine: loadMine, canOpen: canOpen, mineOnly: mineOnly, count: count,
    showForJob: showForJob,
  };
})();
