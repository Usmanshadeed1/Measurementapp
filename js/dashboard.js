// js/dashboard.js
// Dashboard — the app's home screen. Two views over the same set of jobs:
//
//   All Jobs                — every job, with the three first-visit steps
//                             as columns. The default.
//   Waiting for First Visit — jobs still in the New Lead stage: nobody has
//                             been out to the property yet. The work queue.
//
// This is the view GHL itself cannot give you: its Kanban board shows which
// STAGE a job sits in, but a stage says nothing about which of the three
// first-visit steps are finished. The three Opportunity custom fields carry
// that, and this screen reads them across every job at once.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var allJobs = [];      // every opportunity in the sales pipeline
  var stageNames = {};   // pipelineStageId -> human stage name
  var newLeadStageId = null;
  var userNames = {};     // userId -> staff name
  var activeView = 'all';   // 'new' | 'all'
  var activeFilter = 'all';
  var searchTerm = '';
  var onOpenJob = null;     // handed in by app.js so a row can open the job

  // Which dropdown values count as "finished" for each step. Anything else
  // (including a blank field on jobs that never reached 1st Client Visit)
  // is treated as outstanding.
  var DONE_VALUES = { design: ['Done'], pricing: ['Done'], meeting: ['Held'] };

  function statusOf(o, key) { return api.oppField(o, api.STATUS_FIELD_IDS[key]); }
  function isDone(o, key) { return DONE_VALUES[key].indexOf(statusOf(o, key)) > -1; }
  function allThreeDone(o) {
    return isDone(o, 'design') && isDone(o, 'pricing') && isDone(o, 'meeting');
  }
  function isNewLead(o) { return o.pipelineStageId === newLeadStageId; }

  function customerName(o) {
    if (o.contact && o.contact.name) return o.contact.name;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n;
  }
  function jobAddress(o) {
    // Fall back to the tail of the opportunity name: WF-1 builds the name as
    // "First Last - Address", so cards created before the Property Address
    // action was fixed still carry their address there.
    var addr = api.oppField(o, api.ADDR_FIELD_ID);
    if (addr) return addr;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ') : '';
  }
  // The owner set on the job in GHL. Unassigned is worth showing plainly —
  // a job nobody owns is exactly what the owner needs to spot.
  function staffName(o) {
    if (!o.assignedTo) return '';
    return userNames[o.assignedTo] || 'Unknown user';
  }
  function staffCell(o) {
    var n = staffName(o);
    var cls = n ? 'mm-staff' : 'mm-staff mm-staff-none';
    return '<div class="mm-dash-c-staff" data-label="Staff"><span class="' + cls + '">' +
      U.esc(n || 'Unassigned') + '</span></div>';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Whole days since the job was created — how long a new lead has been waiting.
  function daysSince(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  // ---- Rendering ----------------------------------------------------------

  // Blank means the workflow never stamped this job — say so plainly rather
  // than showing an empty cell that looks like a loading bug.
  function pill(o, key) {
    var val = statusOf(o, key);
    var cls;
    // Revision reads differently from Pending: the customer rejected finished
    // work, so it is a step backwards rather than work not yet started.
    if (val === 'Revision') cls = 'revision';
    else if (isDone(o, key)) cls = 'done';
    else if (val) cls = 'pending';
    else cls = 'none';
    return '<span class="mm-pill mm-pill-' + cls + '">' + U.esc(val || 'Not set') + '</span>';
  }

  function matchesFilter(o) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'complete') return allThreeDone(o);
    if (activeFilter === 'outstanding') return !allThreeDone(o);
    if (activeFilter === 'unassigned') return !o.assignedTo;
    if (activeFilter === 'revision') {
      return statusOf(o, 'design') === 'Revision' || statusOf(o, 'pricing') === 'Revision';
    }
    if (activeFilter.indexOf('stage:') === 0) {
      return stageNames[o.pipelineStageId] === activeFilter.slice(6);
    }
    return !isDone(o, activeFilter); // 'design' | 'pricing' | 'meeting'
  }
  function matchesSearch(o) {
    if (!searchTerm) return true;
    return (customerName(o) + ' ' + jobAddress(o) + ' ' + staffName(o)).toLowerCase().indexOf(searchTerm.toLowerCase()) > -1;
  }
  function visibleJobs() {
    var base = activeView === 'new' ? allJobs.filter(isNewLead) : allJobs;
    return base.filter(function (o) {
      return matchesSearch(o) && (activeView === 'new' || matchesFilter(o));
    });
  }

  function renderStats() {
    var el = document.getElementById('mm-dash-stats');
    function stat(label, value, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + value + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }

    if (activeView === 'new') {
      var queue = allJobs.filter(isNewLead);
      // "Waiting over a week" is the number worth acting on — a lead sitting
      // untouched that long is the one at risk of going cold.
      var stale = queue.filter(function (o) { return (daysSince(o.createdAt) || 0) >= 7; }).length;
      el.innerHTML =
        stat('Awaiting first visit', queue.length, 'warn') +
        stat('Waiting over a week', stale, stale ? 'bad' : 'good') +
        stat('Total jobs', allJobs.length, 'neutral');
      return;
    }

    el.innerHTML =
      stat('Total jobs', allJobs.length, 'neutral') +
      stat('Designs pending', allJobs.filter(function (o) { return !isDone(o, 'design'); }).length, 'warn') +
      stat('Pricing pending', allJobs.filter(function (o) { return !isDone(o, 'pricing'); }).length, 'warn') +
      stat('Meetings pending', allJobs.filter(function (o) { return !isDone(o, 'meeting'); }).length, 'warn') +
      stat('All 3 complete', allJobs.filter(allThreeDone).length, 'good');

    var unassigned = allJobs.filter(function (o) { return !o.assignedTo; }).length;
    if (unassigned) {
      el.innerHTML += '<div class="mm-stat mm-stat-bad"><div class="mm-stat-num">' + unassigned +
        '</div><div class="mm-stat-label">Unassigned</div></div>';
    }
  }

  function nameCell(o) {
    return '<div class="mm-dash-c-name">' +
      '<div class="mm-dash-name">' + U.esc(customerName(o)) + '</div>' +
      '<div class="mm-dash-addr">' + U.esc(jobAddress(o) || 'No address on file') + '</div>' +
    '</div>';
  }

  // Rows are clickable: this screen is the home page, so it is also the
  // fastest way into a job. Exposed as a button for keyboard users.
  function bindRows(el) {
    el.querySelectorAll('.mm-dash-row[data-job]').forEach(function (row) {
      function open() {
        var o = allJobs.find(function (j) { return j.id === row.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o);
      }
      row.addEventListener('click', open);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  function renderNewLeadTable(rows) {
    if (!rows.length) {
      return '<div class="mm-empty">No leads waiting — every job has had its first visit.</div>';
    }
    var head =
      '<div class="mm-dash-row mm-dash-new mm-dash-head">' +
        '<div class="mm-dash-c-name">Customer</div>' +
        '<div class="mm-dash-c-staff">Staff</div>' +
        '<div class="mm-dash-c-when">Added</div>' +
        '<div class="mm-dash-c-when">Waiting</div>' +
      '</div>';
    var body = rows.map(function (o) {
      var days = daysSince(o.createdAt);
      var waitCls = days >= 7 ? 'mm-wait-bad' : (days >= 3 ? 'mm-wait-warn' : '');
      var waitTxt = days === null ? '—' : (days === 0 ? 'Today' : days === 1 ? '1 day' : days + ' days');
      return '<div class="mm-dash-row mm-dash-new" data-job="' + U.esc(o.id) + '" role="button" tabindex="0">' +
        nameCell(o) +
        staffCell(o) +
        '<div class="mm-dash-c-when" data-label="Added">' + U.esc(fmtDate(o.createdAt) || '—') + '</div>' +
        '<div class="mm-dash-c-when" data-label="Waiting"><span class="' + waitCls + '">' + U.esc(waitTxt) + '</span></div>' +
      '</div>';
    }).join('');
    return '<div class="mm-dash-table">' + head + body + '</div>';
  }

  function renderAllTable(rows) {
    if (!rows.length) {
      return '<div class="mm-empty">No jobs match this filter.</div>';
    }
    var head =
      '<div class="mm-dash-row mm-dash-head">' +
        '<div class="mm-dash-c-name">Customer</div>' +
        '<div class="mm-dash-c-staff">Staff</div>' +
        '<div class="mm-dash-c-stage">Stage</div>' +
        '<div class="mm-dash-c-status">Designs</div>' +
        '<div class="mm-dash-c-status">Pricing</div>' +
        '<div class="mm-dash-c-status">Meeting</div>' +
      '</div>';
    var body = rows.map(function (o) {
      return '<div class="mm-dash-row' + (allThreeDone(o) ? ' is-complete' : '') + '" data-job="' + U.esc(o.id) + '" role="button" tabindex="0">' +
        nameCell(o) +
        staffCell(o) +
        '<div class="mm-dash-c-stage" data-label="Stage"><span class="mm-stage">' + U.esc(stageNames[o.pipelineStageId] || '—') + '</span></div>' +
        '<div class="mm-dash-c-status" data-label="Designs">' + pill(o, 'design') + '</div>' +
        '<div class="mm-dash-c-status" data-label="Pricing">' + pill(o, 'pricing') + '</div>' +
        '<div class="mm-dash-c-status" data-label="Meeting">' + pill(o, 'meeting') + '</div>' +
      '</div>';
    }).join('');
    return '<div class="mm-dash-table">' + head + body + '</div>';
  }

  function renderTable() {
    var el = document.getElementById('mm-dash-table');
    var rows = visibleJobs();
    // The status filters only mean something against the three status
    // columns, which the New Lead queue does not show.
    document.getElementById('mm-dash-filters').style.display = activeView === 'new' ? 'none' : '';
    document.getElementById('mm-dash-stage-filters').style.display = activeView === 'new' ? 'none' : '';

    var total = activeView === 'new' ? allJobs.filter(isNewLead).length : allJobs.length;
    var tableHtml = activeView === 'new' ? renderNewLeadTable(rows) : renderAllTable(rows);

    el.innerHTML = tableHtml +
      (rows.length ? '<div class="mm-dash-count">Showing ' + rows.length + ' of ' + total + ' jobs</div>' : '');
    bindRows(el);
  }

  var VIEW_NOTES = {
    all: 'Every job in the pipeline, and how far each one has got through designs, pricing and the meeting.',
    new: 'Jobs still sitting in the New Lead stage — nobody has been out to the property yet.',
  };

  function renderNote() {
    document.getElementById('mm-dash-view-note').textContent = VIEW_NOTES[activeView] || '';
  }

  function render() { renderNote(); renderStats(); renderTable(); }

  // ---- Loading ------------------------------------------------------------

  function loadDashboard() {
    var tableEl = document.getElementById('mm-dash-table');
    var statsEl = document.getElementById('mm-dash-stats');
    statsEl.innerHTML = '';
    tableEl.innerHTML = '<div class="mm-empty">Loading dashboard...</div>';

    Promise.all([
      api.fetchAllOpportunities(),
      api.getPipelines(),
      // Staff names are a nice-to-have: if the token lacks users.readonly the
      // rest of the dashboard should still render.
      api.getUsers().catch(function () { return []; }),
    ])
      .then(function (res) {
        var ops = res[0], pipelines = res[1], users = res[2];

        userNames = {};
        users.forEach(function (u) {
          var nm = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ');
          if (u.id) userNames[u.id] = nm || u.email || 'Unknown user';
        });

        var sales = pipelines.find(function (p) { return p.id === api.SALES_PIPELINE_ID; });
        stageNames = {};
        newLeadStageId = null;
        if (sales) (sales.stages || []).forEach(function (s) {
          stageNames[s.id] = s.name;
          if (String(s.name).toLowerCase() === 'new lead') newLeadStageId = s.id;
        });

        allJobs = ops.filter(function (o) { return o.pipelineId === api.SALES_PIPELINE_ID; });

        renderStageFilters(sales);

        if (!allJobs.length) {
          statsEl.innerHTML = '';
          tableEl.innerHTML = '<div class="mm-empty">No jobs yet. Import contacts or add one in GHL to get started.</div>';
          return;
        }
        render();
      })
      .catch(function (e) {
        statsEl.innerHTML = '';
        tableEl.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  // Stage buttons are generated from the live pipeline rather than hard-coded,
  // so renaming or reordering a stage in GHL cannot leave a stale filter here.
  // Only stages that currently hold jobs get a button.
  function renderStageFilters(sales) {
    var el = document.getElementById('mm-dash-stage-filters');
    if (!sales) { el.innerHTML = ''; return; }
    var counts = {};
    allJobs.forEach(function (o) {
      var n = stageNames[o.pipelineStageId];
      if (n) counts[n] = (counts[n] || 0) + 1;
    });
    var html = (sales.stages || [])
      .filter(function (st) { return counts[st.name]; })
      .map(function (st) {
        return '<button class="mm-filter mm-filter-stage" data-filter="stage:' + U.esc(st.name) + '" aria-pressed="false">' +
          U.esc(st.name) + ' <span class="mm-filter-count">' + counts[st.name] + '</span></button>';
      }).join('');
    el.innerHTML = html;
    el.querySelectorAll('.mm-filter').forEach(bindFilterButton);
  }

  function bindFilterButton(btn) {
    btn.addEventListener('click', function () {
      activeFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('#mm-dash-filters .mm-filter, #mm-dash-stage-filters .mm-filter').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderTable();
    });
  }

  function setView(view) {
    activeView = view;
    document.querySelectorAll('#mm-dash-views .mm-view-tab').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (allJobs.length) render();
  }

  function initDashboard(openJobFn) {
    onOpenJob = openJobFn;
    renderNote();

    document.querySelectorAll('#mm-dash-views .mm-view-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-view')); });
    });

    document.querySelectorAll('#mm-dash-filters .mm-filter').forEach(bindFilterButton);

    var searchEl = document.getElementById('mm-dash-search');
    var timer = null;
    searchEl.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { searchTerm = searchEl.value.trim(); renderTable(); }, 200);
    });

    document.getElementById('mm-dash-refresh').addEventListener('click', loadDashboard);
  }

  window.MM.dashboard = { loadDashboard: loadDashboard, initDashboard: initDashboard };
})();
