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
  function apptDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.appointment); }
  function measuredDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.measured); }
  function notMeasured(o) { return !measuredDate(o); }

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

  // ---- Change stage --------------------------------------------------------

  var stagingJob = null;

  function openStage(o) {
    // The job screen can open this before the dashboard has ever loaded, so
    // fetch the pipeline on demand rather than showing an empty list.
    if (!salesPipeline) {
      api.getPipelines().then(function (pipelines) {
        var sales = pipelines.find(function (p) { return p.id === api.SALES_PIPELINE_ID; });
        salesPipeline = sales;
        stageNames = {};
        if (sales) (sales.stages || []).forEach(function (st) { stageNames[st.id] = st.name; });
        openStage(o);
      }).catch(function () { /* fall through to the empty-state message */ });
      return;
    }
    stagingJob = o;
    document.getElementById('mm-stage-job').textContent =
      customerName(o) + (jobAddress(o) ? ' — ' + jobAddress(o) : '');
    document.getElementById('mm-stage-error').textContent = '';

    var list = document.getElementById('mm-stage-list');
    var stages = (salesPipeline && salesPipeline.stages) || [];
    if (!stages.length) {
      list.innerHTML = '<div class="mm-empty">No stages found.</div>';
    } else {
      list.innerHTML = stages.map(function (st) {
        var isCurrent = o.pipelineStageId === st.id;
        return '<button type="button" class="mm-assign-opt' + (isCurrent ? ' is-current' : '') + '"' +
          ' data-stage="' + U.esc(st.id) + '" role="radio" aria-checked="' + (isCurrent ? 'true' : 'false') + '">' +
          '<span>' + U.esc(st.name) + '</span>' +
          (isCurrent ? '<span class="mm-assign-tick" aria-hidden="true">&#10003;</span>' : '') +
          '</button>';
      }).join('');
      list.querySelectorAll('.mm-assign-opt').forEach(function (btn) {
        btn.addEventListener('click', function () { doStage(btn.getAttribute('data-stage')); });
      });
    }
    document.getElementById('mm-modal-stage').classList.add('open');
    var first = list.querySelector('.mm-assign-opt');
    if (first) first.focus();
  }

  function closeStage() {
    document.getElementById('mm-modal-stage').classList.remove('open');
    stagingJob = null;
  }

  function doStage(stageId) {
    if (!stagingJob) return;
    var job = stagingJob;
    if (job.pipelineStageId === stageId) { closeStage(); return; }

    var list = document.getElementById('mm-stage-list');
    list.querySelectorAll('.mm-assign-opt').forEach(function (b) { b.disabled = true; });
    document.getElementById('mm-stage-error').textContent = '';

    api.setOpportunityStage(job.id, stageId)
      .then(function () {
        job.pipelineStageId = stageId;
        closeStage();
        if (allJobs.length) render();
        // The stage move fires GHL workflows that write the status fields a
        // few seconds later, so pull fresh data once rather than leaving the
        // row showing statuses that are about to change.
        if (allJobs.length) setTimeout(loadDashboard, 6000);
      })
      .catch(function (e) {
        list.querySelectorAll('.mm-assign-opt').forEach(function (b) { b.disabled = false; });
        document.getElementById('mm-stage-error').textContent = 'Could not move job: ' + e.message;
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
    { id: 'all',        label: 'All jobs',      test: function () { return true; } },
    { id: 'measure',    label: 'Needs measuring', test: notMeasured },
    { id: 'revision',   label: 'Needs changes', test: function (o) {
        return statusOf(o, 'design') === 'Revision' || statusOf(o, 'pricing') === 'Revision'; } },
    { id: 'unassigned', label: 'No staff',      test: function (o) { return !o.assignedTo; } },
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
    var base = activeView === 'new' ? allJobs.filter(notMeasured) : allJobs;
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
      var queue = allJobs.filter(notMeasured);
      // "Waiting over a week" is the number worth acting on — a lead sitting
      // untouched that long is the one at risk of going cold.
      var noDate = queue.filter(function (o) { return !apptDate(o); }).length;
      var overdue = queue.filter(function (o) {
        var d = daysTo(apptDate(o));
        return d !== null && d < 0;
      }).length;
      el.innerHTML =
        stat('Not measured yet', queue.length, 'warn') +
        stat('No visit booked', noDate, noDate ? 'bad' : 'good') +
        stat('Visit date passed', overdue, overdue ? 'bad' : 'good') +
        stat('Total jobs', allJobs.length, 'neutral');
      return;
    }

    var needMeasure = allJobs.filter(notMeasured).length;
    var inRevision = allJobs.filter(function (o) {
      return statusOf(o, 'design') === 'Revision' || statusOf(o, 'pricing') === 'Revision';
    }).length;
    var overdue = allJobs.filter(function (o) {
      if (!notMeasured(o)) return false;
      var d = daysTo(apptDate(o));
      return d !== null && d < 0;
    }).length;

    el.innerHTML =
      stat('Total jobs', allJobs.length, 'neutral') +
      stat('Needs measuring', needMeasure, needMeasure ? 'warn' : 'good') +
      stat('Visit overdue', overdue, overdue ? 'bad' : 'good') +
      stat('Needs changes', inRevision, inRevision ? 'bad' : 'good') +
      stat('All steps done', allJobs.filter(allThreeDone).length, 'good');
  }

  function stageCell(o) {
    return '<div class="mm-dash-c-stage" data-label="Stage">' +
      '<button type="button" class="mm-stage-btn" data-stage-job="' + U.esc(o.id) + '" ' +
      'aria-label="Move ' + U.esc(customerName(o)) + ' to another stage">' +
      '<span class="mm-stage">' + U.esc(stageNames[o.pipelineStageId] || '—') + '</span>' +
      '<span class="mm-staff-edit" aria-hidden="true">Move</span></button></div>';
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
    el.querySelectorAll('.mm-stage-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var o = allJobs.find(function (j) { return j.id === btn.getAttribute('data-stage-job'); });
        if (o) openStage(o);
      });
    });
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

  // Days from today to a date string: negative means it has passed.
  function daysTo(v) {
    if (!v) return null;
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date();
    t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d - t) / 86400000);
  }

  // The visit column tells the owner the one thing he needs: is a visit
  // booked, is it due, or has the date passed with nothing recorded?
  function visitCell(o) {
    var appt = apptDate(o);
    if (!appt) {
      return '<div class="mm-dash-c-when" data-label="Visit">' +
        '<span class="mm-wait-bad">No date set</span></div>';
    }
    var d = daysTo(appt);
    var cls = '', suffix = '';
    if (d < 0) { cls = 'mm-wait-bad'; suffix = ' · ' + Math.abs(d) + 'd overdue'; }
    else if (d === 0) { cls = 'mm-wait-warn'; suffix = ' · today'; }
    else if (d === 1) { suffix = ' · tomorrow'; }
    return '<div class="mm-dash-c-when" data-label="Visit"><span class="' + cls + '">' +
      U.esc(fmtDate(appt)) + U.esc(suffix) + '</span></div>';
  }

  function renderNewLeadTable(rows) {
    if (!rows.length) {
      return '<div class="mm-empty">Every job has been measured.</div>';
    }
    var head =
      '<div class="mm-dash-row mm-dash-new mm-dash-head">' +
        '<div class="mm-dash-c-name">Customer</div>' +
        '<div class="mm-dash-c-staff">Staff</div>' +
        '<div class="mm-dash-c-when">Visit booked</div>' +
        '<div class="mm-dash-c-when">Lead age</div>' +
      '</div>';
    var body = rows.map(function (o) {
      var days = daysSince(o.createdAt);
      var waitCls = days >= 7 ? 'mm-wait-bad' : (days >= 3 ? 'mm-wait-warn' : '');
      var waitTxt = days === null ? '—' : (days === 0 ? 'Today' : days === 1 ? '1 day' : days + ' days');
      return '<div class="mm-dash-row mm-dash-new" data-job="' + U.esc(o.id) + '" role="button" tabindex="0">' +
        nameCell(o) +
        staffCell(o) +
        visitCell(o) +
        '<div class="mm-dash-c-when" data-label="Lead age"><span class="' + waitCls + '">' + U.esc(waitTxt) + '</span></div>' +
      '</div>';
    }).join('');
    return '<div class="mm-dash-table">' + head + body + '</div>';
  }

  // "What is the next thing anyone has to do on this job?" — one answer per
  // row, so the table can be scanned rather than decoded. The three status
  // pills only said what state each step was in; this says what to do.
  function nextAction(o) {
    if (!measuredDate(o)) {
      var appt = apptDate(o);
      if (!appt) return { text: 'Book the visit', tone: 'urgent' };
      var d = daysTo(appt);
      if (d < 0) return { text: 'Visit overdue — measure', tone: 'urgent' };
      if (d === 0) return { text: 'Visit today — measure', tone: 'soon' };
      return { text: 'Visit ' + fmtDate(appt), tone: 'wait' };
    }
    if (statusOf(o, 'design') === 'Revision' || statusOf(o, 'pricing') === 'Revision') {
      return { text: 'Customer wants changes', tone: 'urgent' };
    }
    if (!isDone(o, 'design')) return { text: 'Create the design', tone: 'soon' };
    if (!isDone(o, 'pricing')) return { text: 'Work out pricing', tone: 'soon' };
    if (!isDone(o, 'meeting')) return { text: 'Hold the meeting', tone: 'soon' };
    return { text: 'All steps done', tone: 'done' };
  }

  // Compact progress read-out: measured -> design -> pricing -> meeting.
  function progressDots(o) {
    var steps = [
      { on: !!measuredDate(o), label: 'Measured' },
      { on: isDone(o, 'design'), label: 'Design' },
      { on: isDone(o, 'pricing'), label: 'Pricing' },
      { on: isDone(o, 'meeting'), label: 'Meeting' },
    ];
    var doneCount = steps.filter(function (x) { return x.on; }).length;
    return '<div class="mm-prog" role="img" aria-label="' + doneCount + ' of 4 steps done: ' +
      U.esc(steps.filter(function (x) { return x.on; }).map(function (x) { return x.label; }).join(', ') || 'none') + '">' +
      steps.map(function (x) {
        return '<span class="mm-prog-dot' + (x.on ? ' on' : '') + '" title="' + U.esc(x.label) + '"></span>';
      }).join('') +
      '<span class="mm-prog-count">' + doneCount + '/4</span></div>';
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
        '<div class="mm-dash-c-next">Next step</div>' +
        '<div class="mm-dash-c-prog">Progress</div>' +
      '</div>';
    var body = rows.map(function (o) {
      var next = nextAction(o);
      return '<div class="mm-dash-row' + (next.tone === 'done' ? ' is-complete' : '') + '" data-job="' + U.esc(o.id) + '" role="button" tabindex="0">' +
        nameCell(o) +
        staffCell(o) +
        stageCell(o) +
        '<div class="mm-dash-c-next" data-label="Next step">' +
          '<span class="mm-next mm-next-' + next.tone + '">' + U.esc(next.text) + '</span></div>' +
        '<div class="mm-dash-c-prog" data-label="Progress">' + progressDots(o) + '</div>' +
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

    var total = activeView === 'new' ? allJobs.filter(notMeasured).length : allJobs.length;
    var tableHtml = activeView === 'new' ? renderNewLeadTable(rows) : renderAllTable(rows);

    el.innerHTML = tableHtml +
      (rows.length ? '<div class="mm-dash-count">Showing ' + rows.length + ' of ' + total + ' jobs</div>' : '');
    bindRows(el);
    renderActiveFilter(rows.length, total);
  }

  var VIEW_NOTES = {
    all: 'Every job in the pipeline, and how far each one has got through designs, pricing and the meeting.',
    new: 'Jobs with no measurement recorded yet — someone still needs to visit the property.',
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

    document.getElementById('mm-stage-cancel').addEventListener('click', closeStage);
    document.getElementById('mm-modal-stage').addEventListener('click', function (e) {
      if (e.target === this) closeStage();
    });
    document.getElementById('mm-assign-cancel').addEventListener('click', closeAssign);
    document.getElementById('mm-modal-assign').addEventListener('click', function (e) {
      if (e.target === this) closeAssign();   // click the backdrop to dismiss
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (assigningJob) closeAssign();
      if (stagingJob) closeStage();
    });
  }

  window.MM.dashboard = {
    loadDashboard: loadDashboard, initDashboard: initDashboard,
    openStage: openStage, stageNameFor: function (o) { return stageNames[o.pipelineStageId] || ''; },
  };
})();
