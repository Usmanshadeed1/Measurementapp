// js/dashboard.js
// The dashboard: two ways to look at the same jobs.
//
//   Work list  — every job grouped by the ONE next thing that has to happen
//                to it. This is the day plan, and the default.
//   All jobs   — one flat list of everything, for searching and filtering.
//
// Both read the same data and share the same job card, so switching tabs
// never looks like switching apps. Progress is taken from the DATES staff
// enter (appointment -> measured -> design -> pricing -> proposal sent ->
// cabinets -> completed), never from the older status dropdowns: a date is a
// fact someone recorded, whereas a status can be left behind by an earlier
// stage move.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var allJobs = [];
  var stageNames = {};
  var salesPipeline = null;
  var userNames = {};
  var activeView = 'work';   // 'work' | 'all'
  var activeFilter = 'all';
  var searchTerm = '';
  var onOpenJob = null;
  var openGroups = null;

  // ---- Reading a job ------------------------------------------------------

  function dv(o, key) { return api.oppField(o, api.DATE_FIELD_IDS[key]); }
  function apptDate(o) { return dv(o, 'appointment'); }
  function measuredDate(o) { return dv(o, 'measured'); }
  function designDate(o) { return dv(o, 'design'); }
  function pricingDate(o) { return dv(o, 'pricing'); }
  function sentDate(o) { return dv(o, 'proposalSent'); }
  function cabinetsDate(o) { return dv(o, 'cabinets'); }
  function completedDate(o) { return dv(o, 'completed'); }

  function isCompleted(o) { return !!completedDate(o); }
  function isDead(o) { return o.pipelineStageId === api.STAGE_DEAD; }
  function isWon(o) {
    return o.pipelineStageId === api.STAGE_WON ||
           o.pipelineStageId === api.STAGE_MATERIAL_ORDERING || !!cabinetsDate(o);
  }
  // Finished or lost jobs need no more work, so they stay out of the day plan
  // and out of the active counts — but remain findable in their own group.
  function isClosed(o) { return isCompleted(o) || isDead(o); }
  function openJobs() { return allJobs.filter(function (o) { return !isClosed(o); }); }

  function customerName(o) {
    if (o.contact && o.contact.name) return o.contact.name;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n;
  }
  function jobAddress(o) {
    // Cards created before the Property Address action was fixed keep their
    // address inside the opportunity name instead.
    var addr = api.oppField(o, api.ADDR_FIELD_ID);
    if (addr) return addr;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ') : '';
  }
  function staffName(o) {
    if (!o.assignedTo) return '';
    return userNames[o.assignedTo] || 'Unknown user';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function daysSince(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  // Days from today to a date: negative means it has already passed.
  function daysTo(v) {
    if (!v) return null;
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date();
    t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d - t) / 86400000);
  }

  // ---- The one thing each job needs next ----------------------------------
  //
  // Every job belongs to exactly one group. The order is the order the work
  // actually happens, so the page reads top-to-bottom like the process does.
  var GROUPS = [
    { id: 'book', title: 'Book a visit', hint: 'No appointment date set yet',
      test: function (o) { return !measuredDate(o) && !apptDate(o); } },
    { id: 'measure', title: 'Go and measure', hint: 'Visit booked, measurements not recorded',
      test: function (o) { return !measuredDate(o) && !!apptDate(o); } },
    { id: 'design', title: 'Create the design', hint: 'Measured, design not finished',
      test: function (o) { return !!measuredDate(o) && !designDate(o); } },
    { id: 'pricing', title: 'Work out the pricing', hint: 'Design done, pricing not finished',
      test: function (o) { return !!designDate(o) && !pricingDate(o); } },
    { id: 'send', title: 'Send the proposal', hint: 'Ready to go to the customer',
      test: function (o) { return !!pricingDate(o) && !sentDate(o); } },
    { id: 'wait', title: 'Waiting for the customer', hint: 'Proposal sent, no answer yet',
      test: function (o) { return !!sentDate(o) && !isWon(o); } },
    { id: 'cabinets', title: 'Order the cabinets', hint: 'Job won, cabinets not ordered',
      test: function (o) { return isWon(o) && !cabinetsDate(o); } },
    { id: 'finish', title: 'Finish the job', hint: 'Cabinets ordered, work in progress',
      test: function (o) { return !!cabinetsDate(o); } },
  ];
  // Closed jobs get their own groups, so "which ones are finished?" is
  // answered in the same place as everything else.
  var CLOSED_GROUPS = [
    { id: 'done', title: 'Finished jobs', hint: 'Completed — no more work needed',
      test: isCompleted, closed: true },
    { id: 'lost', title: 'Lost jobs', hint: 'Marked as a dead lead',
      test: function (o) { return isDead(o) && !isCompleted(o); }, closed: true },
  ];
  var ALL_GROUPS = GROUPS.concat(CLOSED_GROUPS);

  // A short label for the job's state, shown on the All jobs list.
  function nextStep(o) {
    if (isCompleted(o)) return { text: 'Finished', tone: 'done' };
    if (isDead(o)) return { text: 'Lost', tone: 'wait' };
    if (!measuredDate(o)) {
      var appt = apptDate(o);
      if (!appt) return { text: 'Book a visit', tone: 'urgent' };
      var dd = daysTo(appt);
      if (dd < 0) return { text: 'Visit overdue', tone: 'urgent' };
      if (dd === 0) return { text: 'Visit today', tone: 'soon' };
      return { text: 'Visit ' + fmtDate(appt), tone: 'wait' };
    }
    if (!designDate(o)) return { text: 'Create the design', tone: 'soon' };
    if (!pricingDate(o)) return { text: 'Work out pricing', tone: 'soon' };
    if (!sentDate(o)) return { text: 'Send the proposal', tone: 'soon' };
    if (!isWon(o)) {
      var w = daysSince(sentDate(o));
      if (w >= 7) return { text: 'Chase customer (' + w + 'd)', tone: 'urgent' };
      return { text: 'Waiting for customer', tone: 'wait' };
    }
    if (!cabinetsDate(o)) return { text: 'Order the cabinets', tone: 'soon' };
    return { text: 'Finish the job', tone: 'soon' };
  }

  // The fact worth showing beside a job in its group — the thing that
  // explains why it is sitting there and whether it is slipping.
  function groupFlag(o, groupId) {
    if (groupId === 'measure') {
      var dd = daysTo(apptDate(o));
      if (dd < 0) return { cls: 'urgent', text: Math.abs(dd) + 'd overdue' };
      if (dd === 0) return { cls: 'soon', text: 'Today' };
      if (dd === 1) return { cls: 'soon', text: 'Tomorrow' };
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
    if (groupId === 'done') return { cls: 'done', text: fmtDate(completedDate(o)) };
    return { cls: '', text: '' };
  }

  // Most pressing first: overdue visits, then soonest dates, then oldest job.
  function sortJobs(a, b) {
    var da = daysTo(apptDate(a)), db = daysTo(apptDate(b));
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (db !== null && da === null) return 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  }

  function matchesSearch(o) {
    if (!searchTerm) return true;
    var hay = (customerName(o) + ' ' + jobAddress(o) + ' ' + staffName(o)).toLowerCase();
    return hay.indexOf(searchTerm.toLowerCase()) > -1;
  }

  // ---- The shared job card ------------------------------------------------
  //
  // One design for a job, used by both views. The progress bar is six steps
  // because that is how many dates a job collects on its way through.
  function jobCard(o, opts) {
    opts = opts || {};
    var flag = opts.flag || { cls: '', text: '' };
    var step = opts.showStep ? nextStep(o) : null;
    var done = [measuredDate(o), designDate(o), pricingDate(o),
                sentDate(o), cabinetsDate(o), completedDate(o)].filter(Boolean).length;

    return '<button type="button" class="mm-jcard' + (isClosed(o) ? ' is-closed' : '') +
        '" data-job="' + U.esc(o.id) + '">' +
      '<span class="mm-jcard-main">' +
        '<span class="mm-jcard-name">' + U.esc(customerName(o)) + '</span>' +
        '<span class="mm-jcard-addr">' + U.esc(jobAddress(o) || 'No address on file') + '</span>' +
        '<span class="mm-jbar" role="img" aria-label="' + done + ' of 6 steps done">' +
          '<span class="mm-jbar-fill" style="width:' + Math.round((done / 6) * 100) + '%"></span>' +
        '</span>' +
      '</span>' +
      '<span class="mm-jcard-side">' +
        (step ? '<span class="mm-next mm-next-' + step.tone + '">' + U.esc(step.text) + '</span>' : '') +
        '<span class="mm-jcard-staff' + (o.assignedTo ? '' : ' mm-staff-none') + '">' +
          U.esc(staffName(o) || 'Unassigned') + '</span>' +
        (flag.text ? '<span class="mm-jflag mm-jflag-' + flag.cls + '">' + U.esc(flag.text) + '</span>' : '') +
      '</span>' +
      '<span class="mm-jcard-arrow" aria-hidden="true">&#8250;</span>' +
    '</button>';
  }

  // ---- Work list ----------------------------------------------------------

  function loadOpenGroups() {
    if (openGroups) return openGroups;
    try {
      var raw = localStorage.getItem('mm_open_groups');
      openGroups = raw ? JSON.parse(raw) : {};
    } catch (e) { openGroups = {}; }
    return openGroups;
  }
  function saveOpenGroups() {
    try { localStorage.setItem('mm_open_groups', JSON.stringify(openGroups)); } catch (e) { /* private mode */ }
  }

  function renderWorkList() {
    var open = loadOpenGroups();
    var searching = !!searchTerm;

    var sections = ALL_GROUPS.map(function (g) {
      var jobs = allJobs.filter(function (o) { return g.test(o) && matchesSearch(o); }).sort(sortJobs);
      return { g: g, jobs: jobs };
    });

    if (searching && !sections.some(function (s) { return s.jobs.length; })) {
      return '<div class="mm-empty">Nothing matches &ldquo;' + U.esc(searchTerm) + '&rdquo;.</div>';
    }

    return '<div class="mm-acclist">' + sections.map(function (s) {
      var empty = !s.jobs.length;
      // A search reveals its matches without the user hunting for the right
      // section to open.
      var isOpen = !empty && (searching || !!open[s.g.id]);
      return '<section class="mm-agroup' + (empty ? ' is-empty' : '') + (isOpen ? ' is-open' : '') +
             (s.g.closed ? ' is-closedgroup' : '') + '">' +
        '<button type="button" class="mm-agroup-head" data-group="' + U.esc(s.g.id) + '"' +
          ' aria-expanded="' + (isOpen ? 'true' : 'false') + '"' + (empty ? ' disabled' : '') + '>' +
          '<span class="mm-agroup-arrow" aria-hidden="true">&#9662;</span>' +
          '<span class="mm-agroup-text">' +
            '<span class="mm-agroup-title">' + U.esc(s.g.title) + '</span>' +
            '<span class="mm-agroup-hint">' + U.esc(empty ? 'Nothing here' : s.g.hint) + '</span>' +
          '</span>' +
          '<span class="mm-agroup-count">' + s.jobs.length + '</span>' +
        '</button>' +
        (empty ? '' : '<div class="mm-agroup-body">' +
          s.jobs.map(function (o) { return jobCard(o, { flag: groupFlag(o, s.g.id) }); }).join('') +
          '</div>') +
      '</section>';
    }).join('') + '</div>';
  }

  // ---- All jobs -----------------------------------------------------------
  //
  // Filters mirror the work-list groups exactly, so the two views can never
  // disagree about what state a job is in.
  var FILTERS = [
    { id: 'all', label: 'All active', test: function (o) { return !isClosed(o); } },
    { id: 'book', label: 'Book a visit', test: GROUPS[0].test },
    { id: 'measure', label: 'To measure', test: GROUPS[1].test },
    { id: 'design', label: 'To design', test: GROUPS[2].test },
    { id: 'pricing', label: 'To price', test: GROUPS[3].test },
    { id: 'send', label: 'To send', test: GROUPS[4].test },
    { id: 'wait', label: 'Awaiting reply', test: GROUPS[5].test },
    { id: 'cabinets', label: 'Order cabinets', test: GROUPS[6].test },
    { id: 'finish', label: 'In production', test: GROUPS[7].test },
    { id: 'unassigned', label: 'No staff', test: function (o) { return !isClosed(o) && !o.assignedTo; } },
    { id: 'done', label: 'Finished', test: isCompleted },
    { id: 'lost', label: 'Lost', test: function (o) { return isDead(o) && !isCompleted(o); } },
  ];
  function filterById(id) { return FILTERS.find(function (f) { return f.id === id; }); }

  function renderAllList() {
    var f = filterById(activeFilter) || FILTERS[0];
    var rows = allJobs.filter(function (o) { return f.test(o) && matchesSearch(o); }).sort(sortJobs);

    if (!rows.length) {
      return '<div class="mm-empty">No jobs under &ldquo;' + U.esc(f.label) + '&rdquo;.</div>';
    }
    return '<div class="mm-jlist">' +
      rows.map(function (o) { return jobCard(o, { showStep: true }); }).join('') +
      '</div><div class="mm-dash-count">' + rows.length + ' job' + (rows.length === 1 ? '' : 's') + '</div>';
  }

  function renderFilters() {
    var el = document.getElementById('mm-dash-filters');
    if (activeView !== 'all') { el.innerHTML = ''; return; }
    el.innerHTML = FILTERS.map(function (f) {
      var n = allJobs.filter(f.test).length;
      var on = activeFilter === f.id;
      return '<button type="button" class="mm-filter' + (on ? ' active' : '') + (n ? '' : ' is-empty') + '"' +
        ' data-filter="' + U.esc(f.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        U.esc(f.label) + '<span class="mm-filter-count">' + n + '</span></button>';
    }).join('');
    el.querySelectorAll('.mm-filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeFilter = btn.getAttribute('data-filter');
        renderFilters();
        renderBody();
      });
    });
  }

  // ---- Summary ------------------------------------------------------------
  //
  // Four numbers, always the same four, so the header never reshuffles as the
  // data changes. Only counts that need action are coloured.
  function renderStats() {
    var el = document.getElementById('mm-dash-stats');
    var open = openJobs();
    var urgent = open.filter(function (o) { return nextStep(o).tone === 'urgent'; }).length;
    var needAction = open.filter(function (o) {
      var t = nextStep(o).tone;
      return t === 'urgent' || t === 'soon';
    }).length;

    function stat(label, value, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + value + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }
    el.innerHTML =
      stat('Active jobs', open.length, 'neutral') +
      stat('Need action', needAction, needAction ? 'warn' : 'good') +
      stat('Urgent', urgent, urgent ? 'bad' : 'good') +
      stat('Finished', allJobs.filter(isCompleted).length, 'good');
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
        // Update in place: GHL's opportunity search index lags a few seconds
        // behind a write, so an immediate reload can hand back the old owner
        // and look like the save failed.
        job.assignedTo = userId || null;
        closeAssign();
        if (allJobs.length) render();
      })
      .catch(function (e) {
        list.querySelectorAll('.mm-assign-opt').forEach(function (b) { b.disabled = false; });
        document.getElementById('mm-assign-error').textContent = 'Could not save: ' + e.message;
      });
  }

  // ---- Change stage -------------------------------------------------------

  var stagingJob = null;
  var onStageChanged = null;   // set by app.js so the job screen can redraw

  function openStage(o) {
    // The job screen can open this before the dashboard has ever loaded.
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
        if (onStageChanged) onStageChanged(job);
        if (allJobs.length) {
          render();
          // The stage move fires GHL workflows that write fields a few
          // seconds later, so pull fresh data once rather than leaving the
          // card showing values that are about to change.
          setTimeout(loadDashboard, 6000);
        }
      })
      .catch(function (e) {
        list.querySelectorAll('.mm-assign-opt').forEach(function (b) { b.disabled = false; });
        document.getElementById('mm-stage-error').textContent = 'Could not move job: ' + e.message;
      });
  }

  // ---- Rendering ----------------------------------------------------------

  var VIEW_NOTES = {
    work: 'Your day, grouped by what needs doing. Tap a section to open it.',
    all: 'Every job in one list. Use the filters or search to narrow it down.',
  };

  function renderBody() {
    var el = document.getElementById('mm-dash-table');
    el.innerHTML = activeView === 'work' ? renderWorkList() : renderAllList();
    bindBody(el);
  }

  function bindBody(el) {
    el.querySelectorAll('.mm-agroup-head[data-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-group');
        openGroups[id] = !openGroups[id];
        saveOpenGroups();
        renderBody();
      });
    });
    el.querySelectorAll('.mm-jcard[data-job]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var o = allJobs.find(function (j) { return j.id === btn.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o);
      });
    });
  }

  function render() {
    document.getElementById('mm-dash-view-note').textContent = VIEW_NOTES[activeView] || '';
    document.getElementById('mm-filter-wrap').style.display = activeView === 'all' ? '' : 'none';
    renderStats();
    renderFilters();
    renderBody();
  }

  // ---- Loading ------------------------------------------------------------

  function loadDashboard() {
    var tableEl = document.getElementById('mm-dash-table');
    var statsEl = document.getElementById('mm-dash-stats');
    statsEl.innerHTML = '';
    tableEl.innerHTML = '<div class="mm-empty">Loading...</div>';

    Promise.all([
      api.fetchAllOpportunities(),
      api.getPipelines(),
      // Staff names are a nice-to-have: without the users scope the rest of
      // the dashboard should still render.
      api.getUsers().catch(function () { return []; }),
    ])
      .then(function (res) {
        var ops = res[0], pipelines = res[1], users = res[2];

        var sales = pipelines.find(function (p) { return p.id === api.SALES_PIPELINE_ID; });
        salesPipeline = sales;
        stageNames = {};
        if (sales) (sales.stages || []).forEach(function (st) { stageNames[st.id] = st.name; });

        userNames = {};
        users.forEach(function (u) {
          var nm = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ');
          if (u.id) userNames[u.id] = nm || u.email || 'Unknown user';
        });

        allJobs = ops.filter(function (o) { return o.pipelineId === api.SALES_PIPELINE_ID; });

        if (!allJobs.length) {
          statsEl.innerHTML = '';
          tableEl.innerHTML = '<div class="mm-empty">No jobs yet.</div>';
          return;
        }
        render();
      })
      .catch(function (e) {
        statsEl.innerHTML = '';
        tableEl.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
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

    document.querySelectorAll('#mm-dash-views .mm-view-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-view')); });
    });

    var searchEl = document.getElementById('mm-dash-search');
    var timer = null;
    searchEl.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        searchTerm = searchEl.value.trim();
        if (allJobs.length) render();
      }, 200);
    });

    document.getElementById('mm-dash-refresh').addEventListener('click', loadDashboard);

    document.getElementById('mm-stage-cancel').addEventListener('click', closeStage);
    document.getElementById('mm-modal-stage').addEventListener('click', function (e) {
      if (e.target === this) closeStage();
    });
    document.getElementById('mm-assign-cancel').addEventListener('click', closeAssign);
    document.getElementById('mm-modal-assign').addEventListener('click', function (e) {
      if (e.target === this) closeAssign();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (assigningJob) closeAssign();
      if (stagingJob) closeStage();
    });
  }

  window.MM.dashboard = {
    loadDashboard: loadDashboard, initDashboard: initDashboard,
    openStage: openStage, openAssign: openAssign,
    onStageChange: function (fn) { onStageChanged = fn; },
    stageNameFor: function (o) { return stageNames[o.pipelineStageId] || ''; },
  };
})();
