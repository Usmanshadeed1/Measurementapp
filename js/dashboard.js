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
  var activeView = 'todo';  // 'todo' | 'all' | 'new'
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

  // Revision only means something once the job has been measured — there is
  // nothing for a customer to reject before that. Without this guard, a
  // status left behind from an earlier stage reports work that never happened.
  function inRevision(o) {
    if (notMeasured(o)) return false;
    return statusOf(o, 'design') === 'Revision' || statusOf(o, 'pricing') === 'Revision';
  }
  function apptDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.appointment); }
  function measuredDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.measured); }
  function designDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.design); }
  function pricingDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.pricing); }
  function notMeasured(o) { return !measuredDate(o); }
  function sentDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.proposalSent); }
  function cabinetsDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.cabinets); }
  function completedDate(o) { return api.oppField(o, api.DATE_FIELD_IDS.completed); }
  function isCompleted(o) { return !!completedDate(o); }
  function isWon(o) {
    return o.pipelineStageId === api.STAGE_WON ||
           o.pipelineStageId === api.STAGE_MATERIAL_ORDERING || !!cabinetsDate(o);
  }
  // Every active view works from this list, so a completed job disappears
  // everywhere at once rather than each view remembering to exclude it.
  function activeJobs() { return allJobs.filter(function (o) { return !isCompleted(o); }); }

  // Progress is read from the dates the staff actually enter, not from the
  // status dropdowns — a date is a fact someone recorded, whereas a status
  // can be left behind by an earlier stage move.
  function stepsDone(o) {
    return [measuredDate(o), designDate(o), pricingDate(o)].filter(Boolean).length;
  }
  function allStepsDone(o) { return stepsDone(o) === 3; }

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
    { id: 'revision',   label: 'Needs changes', test: inRevision },
    { id: 'design',     label: 'Needs design',  test: function (o) { return measuredDate(o) && !designDate(o); } },
    { id: 'pricing',    label: 'Needs pricing', test: function (o) { return designDate(o) && !pricingDate(o); } },
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
    if (activeView === 'done') return allJobs.filter(isCompleted).filter(matchesSearch);
    if (activeView === 'todo') return activeJobs().filter(matchesSearch);
    var base = activeView === 'new' ? activeJobs().filter(notMeasured) : activeJobs();
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

    if (activeView === 'done') {
      var doneJobs = allJobs.filter(isCompleted);
      var last30 = doneJobs.filter(function (o) {
        var d = daysSince(completedDate(o));
        return d !== null && d <= 30;
      }).length;
      el.innerHTML =
        stat('Completed jobs', doneJobs.length, 'good') +
        stat('In the last 30 days', last30, 'neutral') +
        stat('Still active', activeJobs().length, 'neutral');
      return;
    }

    if (activeView === 'todo') {
      var act = activeJobs();
      var counts = TASK_GROUPS.map(function (g) { return act.filter(g.test).length; });
      var overdueVisits = act.filter(function (o) {
        if (measuredDate(o) || !apptDate(o)) return false;
        var d = daysTo(apptDate(o));
        return d !== null && d < 0;
      }).length;
      el.innerHTML =
        stat('To book', counts[0], counts[0] ? 'warn' : 'good') +
        stat('To measure', counts[1], counts[1] ? 'warn' : 'good') +
        stat('To design', counts[2], counts[2] ? 'warn' : 'good') +
        stat('To price', counts[3], counts[3] ? 'warn' : 'good') +
        stat('To send', counts[4], counts[4] ? 'good' : 'neutral') +
        (counts[5] ? stat('Awaiting reply', counts[5], 'neutral') : '') +
        (counts[6] ? stat('Order cabinets', counts[6], 'warn') : '') +
        (counts[7] ? stat('In production', counts[7], 'neutral') : '') +
        (overdueVisits ? stat('Visits overdue', overdueVisits, 'bad') : '');
      return;
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

    var act2 = activeJobs();
    var needMeasure = act2.filter(notMeasured).length;
    var revisionCount = act2.filter(inRevision).length;
    var overdue = act2.filter(function (o) {
      if (!notMeasured(o)) return false;
      var d = daysTo(apptDate(o));
      return d !== null && d < 0;
    }).length;

    var doneCount = act2.filter(allStepsDone).length;
    el.innerHTML =
      stat('Active jobs', act2.length, 'neutral') +
      stat('Needs measuring', needMeasure, needMeasure ? 'warn' : 'good') +
      (overdue ? stat('Visit overdue', overdue, 'bad') : '') +
      (revisionCount ? stat('Needs changes', revisionCount, 'bad') : '') +
      (doneCount ? stat('Ready to send', doneCount, 'good') : '');
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
    if (inRevision(o)) return { text: 'Customer wants changes', tone: 'urgent' };
    if (!designDate(o)) return { text: 'Create the design', tone: 'soon' };
    if (!pricingDate(o)) return { text: 'Work out pricing', tone: 'soon' };
    if (!sentDate(o)) return { text: 'Send the proposal', tone: 'soon' };
    if (!isWon(o)) {
      var w = daysSince(sentDate(o));
      if (w >= 7) return { text: 'Chase the customer — ' + w + 'd', tone: 'urgent' };
      return { text: 'Waiting for the customer', tone: 'wait' };
    }
    if (!cabinetsDate(o)) return { text: 'Order the cabinets', tone: 'soon' };
    if (!completedDate(o)) return { text: 'Finish the job', tone: 'soon' };
    return { text: 'Completed', tone: 'done' };
  }

  // Compact progress read-out: measured -> design -> pricing -> meeting.
  function progressDots(o) {
    var steps = [
      { on: !!measuredDate(o), label: 'Measured' },
      { on: !!designDate(o), label: 'Design' },
      { on: !!pricingDate(o), label: 'Pricing' },
    ];
    var doneCount = steps.filter(function (x) { return x.on; }).length;
    return '<div class="mm-prog" role="img" aria-label="' + doneCount + ' of 3 steps done: ' +
      U.esc(steps.filter(function (x) { return x.on; }).map(function (x) { return x.label; }).join(', ') || 'none') + '">' +
      steps.map(function (x) {
        return '<span class="mm-prog-dot' + (x.on ? ' on' : '') + '" title="' + U.esc(x.label) + '"></span>';
      }).join('') +
      '<span class="mm-prog-count">' + doneCount + '/3</span></div>';
  }

  // ---- To-do view ---------------------------------------------------------
  //
  // The same jobs, asked a different question: not "how is this job going"
  // but "what does the team need to do". Each job appears once, under its
  // next action, so the list is a day plan rather than a status report.
  var TASK_GROUPS = [
    { id: 'book',    title: 'Book a visit',     hint: 'No appointment date set yet',
      test: function (o) { return !measuredDate(o) && !apptDate(o); } },
    { id: 'measure', title: 'Go and measure',   hint: 'Visit is booked, measurements not recorded',
      test: function (o) { return !measuredDate(o) && !!apptDate(o); } },
    { id: 'design',  title: 'Create the design', hint: 'Measured, design not finished',
      test: function (o) { return !!measuredDate(o) && !designDate(o); } },
    { id: 'pricing', title: 'Work out pricing',  hint: 'Design done, pricing not finished',
      test: function (o) { return !!designDate(o) && !pricingDate(o); } },
    { id: 'send',    title: 'Send the proposal', hint: 'Everything is ready for the customer',
      test: function (o) { return !!pricingDate(o) && !sentDate(o); } },
    { id: 'wait',    title: 'Waiting for the customer', hint: 'Proposal sent, no answer yet',
      test: function (o) { return !!sentDate(o) && !isWon(o); } },
    { id: 'cabinets', title: 'Order the cabinets', hint: 'Job won, cabinets not ordered',
      test: function (o) { return isWon(o) && !cabinetsDate(o); } },
    { id: 'finish',  title: 'Finish the job', hint: 'Cabinets ordered, job not marked complete',
      test: function (o) { return !!cabinetsDate(o); } },
  ];

  // Within a group, the most pressing job first: an overdue visit outranks
  // one booked for next week, and an older lead outranks a newer one.
  function taskSort(a, b) {
    var da = daysTo(apptDate(a)), db = daysTo(apptDate(b));
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (db !== null && da === null) return 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  }

  // An urgent row is one the owner should act on today.
  function taskUrgency(o, groupId) {
    if (groupId === 'measure') {
      var d = daysTo(apptDate(o));
      if (d < 0) return { cls: 'urgent', text: Math.abs(d) + 'd overdue' };
      if (d === 0) return { cls: 'soon', text: 'Today' };
      if (d === 1) return { cls: 'soon', text: 'Tomorrow' };
      return { cls: '', text: fmtDate(apptDate(o)) };
    }
    if (groupId === 'book') {
      var age = daysSince(o.createdAt);
      if (age >= 7) return { cls: 'urgent', text: age + 'd old' };
      if (age >= 3) return { cls: 'soon', text: age + 'd old' };
      return { cls: '', text: age === 0 ? 'New today' : age + 'd old' };
    }
    if (groupId === 'wait') {
      var w = daysSince(sentDate(o));
      if (w === null) return { cls: '', text: '' };
      if (w >= 7) return { cls: 'urgent', text: w + 'd — chase' };
      if (w >= 3) return { cls: 'soon', text: w + 'd waiting' };
      return { cls: '', text: w === 0 ? 'Sent today' : w + 'd waiting' };
    }
    if (inRevision(o)) return { cls: 'urgent', text: 'Changes wanted' };
    return { cls: '', text: '' };
  }

  // Which groups the user has opened. Remembered across refreshes so a
  // reload does not undo where someone was working.
  var openGroups = null;
  function loadOpenGroups() {
    if (openGroups) return openGroups;
    try {
      var raw = localStorage.getItem('mm_open_groups');
      openGroups = raw ? JSON.parse(raw) : null;
    } catch (e) { openGroups = null; }
    // First visit: open the first group that actually has work in it, so the
    // screen is never a wall of closed bars.
    if (!openGroups) openGroups = {};
    return openGroups;
  }
  function saveOpenGroups() {
    try { localStorage.setItem('mm_open_groups', JSON.stringify(openGroups)); } catch (e) { /* private mode */ }
  }

  function renderTaskView(rows) {
    var groups = TASK_GROUPS.map(function (g) {
      return { g: g, jobs: rows.filter(g.test).sort(taskSort) };
    });
    var total = groups.reduce(function (n, x) { return n + x.jobs.length; }, 0);

    if (!total) {
      return '<div class="mm-empty">Nothing to do — every job is up to date.</div>';
    }

    var open = loadOpenGroups();
    // Nothing opened yet: open the first group with work so the page opens
    // showing something useful.
    if (!Object.keys(open).length) {
      var first = groups.find(function (x) { return x.jobs.length; });
      if (first) open[first.g.id] = true;
    }

    return '<div class="mm-tacc">' + groups.map(function (x) {
      var isOpen = !!open[x.g.id] && x.jobs.length > 0;
      var empty = !x.jobs.length;
      return '<section class="mm-tgroup' + (empty ? ' mm-tgroup-empty' : '') + (isOpen ? ' is-open' : '') + '">' +
        '<button type="button" class="mm-tgroup-head" data-group="' + U.esc(x.g.id) + '"' +
          ' aria-expanded="' + (isOpen ? 'true' : 'false') + '"' + (empty ? ' disabled' : '') + '>' +
          '<span class="mm-tgroup-arrow" aria-hidden="true">&#9656;</span>' +
          '<span class="mm-tgroup-text">' +
            '<span class="mm-tgroup-title">' + U.esc(x.g.title) + '</span>' +
            '<span class="mm-tgroup-hint">' + U.esc(empty ? 'Nothing waiting' : x.g.hint) + '</span>' +
          '</span>' +
          '<span class="mm-tgroup-count">' + x.jobs.length + '</span>' +
        '</button>' +
        (empty ? '' :
        '<div class="mm-tlist">' + x.jobs.map(function (o) {
          var u = taskUrgency(o, x.g.id);
          return '<button type="button" class="mm-titem" data-job="' + U.esc(o.id) + '">' +
            '<span class="mm-titem-main">' +
              '<span class="mm-titem-name">' + U.esc(customerName(o)) + '</span>' +
              '<span class="mm-titem-addr">' + U.esc(jobAddress(o) || 'No address on file') + '</span>' +
            '</span>' +
            '<span class="mm-titem-meta">' +
              '<span class="mm-titem-staff' + (o.assignedTo ? '' : ' mm-staff-none') + '">' +
                U.esc(staffName(o) || 'Unassigned') + '</span>' +
              (u.text ? '<span class="mm-titem-flag mm-titem-' + u.cls + '">' + U.esc(u.text) + '</span>' : '') +
            '</span>' +
          '</button>';
        }).join('') + '</div>') +
      '</section>';
    }).join('') + '</div>';
  }

  function renderCompletedTable(rows) {
    if (!rows.length) {
      return '<div class="mm-empty">No completed jobs yet.</div>';
    }
    var sorted = rows.slice().sort(function (a, b) {
      return new Date(completedDate(b)) - new Date(completedDate(a));
    });
    var head =
      '<div class="mm-dash-row mm-dash-new mm-dash-head">' +
        '<div class="mm-dash-c-name">Customer</div>' +
        '<div class="mm-dash-c-staff">Staff</div>' +
        '<div class="mm-dash-c-when">Cabinets ordered</div>' +
        '<div class="mm-dash-c-when">Completed</div>' +
      '</div>';
    var body = sorted.map(function (o) {
      return '<div class="mm-dash-row mm-dash-new is-complete" data-job="' + U.esc(o.id) + '" role="button" tabindex="0">' +
        nameCell(o) + staffCell(o) +
        '<div class="mm-dash-c-when" data-label="Cabinets ordered">' + U.esc(fmtDate(cabinetsDate(o)) || '—') + '</div>' +
        '<div class="mm-dash-c-when" data-label="Completed">' + U.esc(fmtDate(completedDate(o)) || '—') + '</div>' +
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
        '<div class="mm-dash-c-next">Next step</div>' +
        '<div class="mm-dash-c-prog">Progress</div>' +
      '</div>';
    var body = rows.map(function (o) {
      var next = nextAction(o);
      return '<div class="mm-dash-row' + (allStepsDone(o) ? ' is-complete' : '') + '" data-job="' + U.esc(o.id) + '" role="button" tabindex="0">' +
        nameCell(o) +
        staffCell(o) +
        stageCell(o) +
        '<div class="mm-dash-c-next" data-label="Next step">' +
          '<span class="mm-next mm-next-' + next.tone + '">' + U.esc(next.text) + '</span></div>' +
        '<div class="mm-dash-c-prog" data-label="Progress">' + progressDots(o) + '</div>' +
      '</div>';
    }).join('');
    return '<div class="mm-dash-table">' + head + body + '</div>' +
      '<div class="mm-prog-legend"><span class="mm-prog-legend-label">Progress steps:</span>' +
      ['Measured', 'Design', 'Pricing'].map(function (n, i) {
        return '<span class="mm-prog-legend-item"><span class="mm-prog-dot on"></span>' +
          (i + 1) + '. ' + U.esc(n) + '</span>';
      }).join('') + '</div>';
  }

  function renderTable() {
    var el = document.getElementById('mm-dash-table');
    var rows = visibleJobs();
    // The work filters only mean something against the All Jobs table; the
    // other two views carry their own structure.
    document.querySelector('.mm-filter-bar').style.display =
      (activeView === 'all') ? '' : 'none';

    if (activeView === 'done') {
      var doneJobs = allJobs.filter(isCompleted);
      var last30 = doneJobs.filter(function (o) {
        var d = daysSince(completedDate(o));
        return d !== null && d <= 30;
      }).length;
      el.innerHTML =
        stat('Completed jobs', doneJobs.length, 'good') +
        stat('In the last 30 days', last30, 'neutral') +
        stat('Still active', activeJobs().length, 'neutral');
      return;
    }

    if (activeView === 'todo') {
      el.innerHTML = renderTaskView(rows);
      bindTaskItems(el);
      renderActiveFilter(rows.length, allJobs.length);
      return;
    }

    var act = activeJobs();
    var total = activeView === 'done' ? allJobs.filter(isCompleted).length
              : activeView === 'new' ? act.filter(notMeasured).length : act.length;
    var tableHtml = activeView === 'done' ? renderCompletedTable(rows)
                  : activeView === 'new' ? renderNewLeadTable(rows) : renderAllTable(rows);

    el.innerHTML = tableHtml +
      (rows.length ? '<div class="mm-dash-count">Showing ' + rows.length + ' of ' + total + ' jobs</div>' : '');
    bindRows(el);
    renderActiveFilter(rows.length, total);
  }

  function bindTaskItems(el) {
    el.querySelectorAll('.mm-tgroup-head[data-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-group');
        openGroups[id] = !openGroups[id];
        saveOpenGroups();
        renderTable();
      });
    });
    el.querySelectorAll('.mm-titem[data-job]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var o = allJobs.find(function (j) { return j.id === btn.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o);
      });
    });
  }

  var VIEW_NOTES = {
    todo: 'Your work list. Open a section to see the jobs waiting at that step.',
    all: 'Every job that is still running, with its next step and how far it has got.',
    new: 'Jobs nobody has been out to measure yet.',
    done: 'Jobs marked complete. These are kept as a record and do not show anywhere else.',
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
      var n = activeJobs().filter(f.test).length;
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
    activeJobs().forEach(function (o) {
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
    if (activeView !== 'all' || activeFilter === 'all') {
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
