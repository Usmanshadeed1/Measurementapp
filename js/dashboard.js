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
  var salesPipeline = null;
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
    return '<div class="mm-dash-c-staff" data-label="Staff">' +
      '<button type="button" class="mm-staff-btn" data-assign="' + U.esc(o.id) + '" ' +
      'aria-label="Change staff for ' + U.esc(customerName(o)) + '">' +
      '<span class="' + cls + '">' + U.esc(n || 'Unassigned') + '</span>' +
      '<span class="mm-staff-edit" aria-hidden="true">Change</span></button></div>';
  }

  // ---- Assign staff -------------------------------------------------------

  var assigningJob = null;

  function openAssign(o) {
    assigningJob = o;
    document.getElementById('mm-assign-job').textContent =
      customerName(o) + (jobAddress(o) ? ' — ' + jobAddress(o) : '');
    document.getElementById('mm-assign-error').textContent = '';

    var list = document.getElementById('mm-assign-list');
    var ids = Object.keys(userNames);
    if (!ids.length) {
      list.innerHTML = '<div class="mm-empty">No staff found in this location.</div>';
    } else {
      // "Nobody" first so clearing an assignment is as easy as setting one.
      list.innerHTML =
        optionHtml('', 'Nobody (unassigned)', !o.assignedTo) +
        ids.map(function (id) { return optionHtml(id, userNames[id], o.assignedTo === id); }).join('');
      list.querySelectorAll('.mm-assign-opt').forEach(function (btn) {
        btn.addEventListener('click', function () { doAssign(btn.getAttribute('data-user')); });
      });
    }
    document.getElementById('mm-modal-assign').classList.add('open');
    var first = list.querySelector('.mm-assign-opt');
    if (first) first.focus();
  }

  function optionHtml(id, label, isCurrent) {
    return '<button type="button" class="mm-assign-opt' + (isCurrent ? ' is-current' : '') + '"' +
      ' data-user="' + U.esc(id) + '" role="radio" aria-checked="' + (isCurrent ? 'true' : 'false') + '">' +
      '<span>' + U.esc(label) + '</span>' +
      (isCurrent ? '<span class="mm-assign-tick" aria-hidden="true">&#10003;</span>' : '') +
      '</button>';
  }

  function closeAssign() {
    document.getElementById('mm-modal-assign').classList.remove('open');
    assigningJob = null;
  }

  function doAssign(userId) {
    if (!assigningJob) return;
    var job = assigningJob;
    var list = document.getElementById('mm-assign-list');
    list.querySelectorAll('.mm-assign-opt').forEach(function (b) { b.disabled = true; });
    document.getElementById('mm-assign-error').textContent = '';

    api.assignOpportunity(job.id, userId || null)
      .then(function () {
        // Update the row in place rather than refetching everything. This is
        // also the correct move regardless: GHL's opportunity search index
        // lags a few seconds behind a write, so an immediate reload can hand
        // back the old owner and look like the save failed.
        job.assignedTo = userId || null;
        closeAssign();
        renderStats();
        renderWorkFilters();
        renderTable();
      })
      .catch(function (e) {
        list.querySelectorAll('.mm-assign-opt').forEach(function (b) { b.disabled = false; });
        document.getElementById('mm-assign-error').textContent = 'Could not save: ' + e.message;
      });
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

  // Filters are named for what the owner is looking for, not for the field
  // they happen to read. Each carries a count so a filter that would return
  // nothing is visibly empty before it is clicked.
  var WORK_FILTERS = [
    { id: 'all',        label: 'All jobs',            test: function () { return true; } },
    { id: 'outstanding',label: 'Anything unfinished', test: function (o) { return !allThreeDone(o); } },
    { id: 'design',     label: 'Needs designs',       test: function (o) { return !isDone(o, 'design'); } },
    { id: 'pricing',    label: 'Needs pricing',       test: function (o) { return !isDone(o, 'pricing'); } },
    { id: 'meeting',    label: 'Needs meeting',       test: function (o) { return !isDone(o, 'meeting'); } },
    { id: 'revision',   label: 'Customer wants changes', test: function (o) {
        return statusOf(o, 'design') === 'Revision' || statusOf(o, 'pricing') === 'Revision'; } },
    { id: 'complete',   label: 'Ready to proceed',    test: allThreeDone },
    { id: 'unassigned', label: 'No staff assigned',   test: function (o) { return !o.assignedTo; } },
  ];
  function workFilter(id) {
    return WORK_FILTERS.find(function (f) { return f.id === id; });
  }

  function matchesFilter(o) {
    if (activeFilter.indexOf('stage:') === 0) {
      return stageNames[o.pipelineStageId] === activeFilter.slice(6);
    }
    var f = workFilter(activeFilter);
    return f ? f.test(o) : true;
  }

  // The label for whatever is currently selected, for the "showing…" line.
  function activeFilterLabel() {
    if (activeFilter.indexOf('stage:') === 0) return activeFilter.slice(6);
    var f = workFilter(activeFilter);
    return f ? f.label : '';
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
    el.querySelectorAll('.mm-staff-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();   // the row itself opens the job
        var o = allJobs.find(function (j) { return j.id === btn.getAttribute('data-assign'); });
        if (o) openAssign(o);
      });
    });
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
      return '<div class="mm-empty">No jobs match &ldquo;' + U.esc(activeFilterLabel()) + '&rdquo;.</div>';
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
    document.querySelector('.mm-filter-bar').style.display = activeView === 'new' ? 'none' : '';

    var total = activeView === 'new' ? allJobs.filter(isNewLead).length : allJobs.length;
    var tableHtml = activeView === 'new' ? renderNewLeadTable(rows) : renderAllTable(rows);

    el.innerHTML = tableHtml +
      (rows.length ? '<div class="mm-dash-count">Showing ' + rows.length + ' of ' + total + ' jobs</div>' : '');
    bindRows(el);
    renderActiveFilter(rows.length, total);
  }

  var VIEW_NOTES = {
    all: 'Every job in the pipeline, and how far each one has got through designs, pricing and the meeting.',
    new: 'Jobs still sitting in the New Lead stage — nobody has been out to the property yet.',
  };

  function renderNote() {
    document.getElementById('mm-dash-view-note').textContent = VIEW_NOTES[activeView] || '';
  }

  function render() {
    renderNote(); renderStats();
    renderWorkFilters(); renderStageFilters();
    renderTable();
  }

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
        salesPipeline = sales;
        stageNames = {};
        newLeadStageId = null;
        if (sales) (sales.stages || []).forEach(function (s) {
          stageNames[s.id] = s.name;
          if (String(s.name).toLowerCase() === 'new lead') newLeadStageId = s.id;
        });

        allJobs = ops.filter(function (o) { return o.pipelineId === api.SALES_PIPELINE_ID; });


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

  function filterBtn(id, label, count, isZero) {
    return '<button class="mm-filter' + (activeFilter === id ? ' active' : '') + (isZero ? ' is-empty' : '') + '"' +
      ' data-filter="' + U.esc(id) + '" aria-pressed="' + (activeFilter === id ? 'true' : 'false') + '">' +
      U.esc(label) + '<span class="mm-filter-count">' + count + '</span></button>';
  }

  function renderWorkFilters() {
    var el = document.getElementById('mm-dash-filters');
    el.innerHTML = WORK_FILTERS.map(function (f) {
      var n = allJobs.filter(f.test).length;
      return filterBtn(f.id, f.label, n, n === 0 && f.id !== 'all');
    }).join('');
    el.querySelectorAll('.mm-filter').forEach(bindFilterButton);
  }

  // Stage buttons are generated from the live pipeline rather than hard-coded,
  // so renaming or reordering a stage in GHL cannot leave a stale filter here.
  // Only stages that currently hold jobs get a button.
  function renderStageFilters() {
    var el = document.getElementById('mm-dash-stage-filters');
    var group = document.getElementById('mm-stage-group');
    var counts = {};
    allJobs.forEach(function (o) {
      var n = stageNames[o.pipelineStageId];
      if (n) counts[n] = (counts[n] || 0) + 1;
    });
    var stages = (salesPipeline && salesPipeline.stages ? salesPipeline.stages : [])
      .filter(function (st) { return counts[st.name]; });
    group.style.display = stages.length ? '' : 'none';
    el.innerHTML = stages.map(function (st) {
      return filterBtn('stage:' + st.name, st.name, counts[st.name], false);
    }).join('');
    el.querySelectorAll('.mm-filter').forEach(bindFilterButton);
  }

  // One plain sentence naming what is on screen, so the selection is never
  // ambiguous — the highlighted button alone is easy to miss.
  function renderActiveFilter(shown, total) {
    var el = document.getElementById('mm-dash-active-filter');
    if (activeView === 'new' || activeFilter === 'all') {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<span class="mm-active-filter-text">Showing <strong>' + shown +
      '</strong> of ' + total + ' jobs — ' + U.esc(activeFilterLabel()) + '</span>' +
      '<button class="mm-clear-filter" type="button">Clear filter</button>';
    el.querySelector('.mm-clear-filter').addEventListener('click', function () {
      activeFilter = 'all';
      renderWorkFilters(); renderStageFilters(); renderTable();
    });
  }

  function bindFilterButton(btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-filter');
      // Clicking the selected filter again clears it — the quickest way back
      // to the full list without hunting for "All jobs".
      activeFilter = (activeFilter === id && id !== 'all') ? 'all' : id;
      renderWorkFilters();
      renderStageFilters();
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


    var searchEl = document.getElementById('mm-dash-search');
    var timer = null;
    searchEl.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { searchTerm = searchEl.value.trim(); renderTable(); }, 200);
    });

    document.getElementById('mm-dash-refresh').addEventListener('click', loadDashboard);

    document.getElementById('mm-assign-cancel').addEventListener('click', closeAssign);
    document.getElementById('mm-modal-assign').addEventListener('click', function (e) {
      if (e.target === this) closeAssign();   // click the backdrop to dismiss
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && assigningJob) closeAssign();
    });
  }

  window.MM.dashboard = { loadDashboard: loadDashboard, initDashboard: initDashboard };
})();
