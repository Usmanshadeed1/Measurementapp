// js/dashboard.js
// Dashboard tab: one row per Job in the Remodeling Sales pipeline showing
// whether Designs, Pricing and the Virtual Meeting are done or still pending.
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
  var activeFilter = 'all';
  var searchTerm = '';

  // Which dropdown values count as "finished" for each step. Anything else
  // (including a blank field on jobs that never reached 1st Client Visit)
  // is treated as outstanding.
  var DONE_VALUES = { design: ['Done'], pricing: ['Done'], meeting: ['Held'] };

  function statusOf(o, key) {
    return api.oppField(o, api.STATUS_FIELD_IDS[key]);
  }
  function isDone(o, key) {
    return DONE_VALUES[key].indexOf(statusOf(o, key)) > -1;
  }
  // A job counts as fully cleared only when all three steps are done.
  function allThreeDone(o) {
    return isDone(o, 'design') && isDone(o, 'pricing') && isDone(o, 'meeting');
  }

  function customerName(o) {
    if (o.contact && o.contact.name) return o.contact.name;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n;
  }
  function jobAddress(o) {
    // Fall back to the tail of the opportunity name: WF-1 builds the name as
    // "First Last - Address", so older cards created before the Property
    // Address action was fixed still have their address there.
    var addr = api.oppField(o, api.ADDR_FIELD_ID);
    if (addr) return addr;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ') : '';
  }

  // ---- Rendering ----------------------------------------------------------

  // Blank means the workflow never stamped this job — say so plainly rather
  // than showing an empty cell that looks like a loading bug.
  function pill(o, key) {
    var val = statusOf(o, key);
    var cls = isDone(o, key) ? 'done' : (val ? 'pending' : 'none');
    var label = val || 'Not set';
    return '<span class="mm-pill mm-pill-' + cls + '">' + U.esc(label) + '</span>';
  }

  function matchesFilter(o) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'complete') return allThreeDone(o);
    if (activeFilter === 'outstanding') return !allThreeDone(o);
    return !isDone(o, activeFilter); // 'design' | 'pricing' | 'meeting'
  }
  function matchesSearch(o) {
    if (!searchTerm) return true;
    var hay = (customerName(o) + ' ' + jobAddress(o)).toLowerCase();
    return hay.indexOf(searchTerm.toLowerCase()) > -1;
  }

  function renderStats() {
    var el = document.getElementById('mm-dash-stats');
    var total = allJobs.length;
    var counts = {
      design: allJobs.filter(function (o) { return !isDone(o, 'design'); }).length,
      pricing: allJobs.filter(function (o) { return !isDone(o, 'pricing'); }).length,
      meeting: allJobs.filter(function (o) { return !isDone(o, 'meeting'); }).length,
      complete: allJobs.filter(allThreeDone).length,
    };
    function stat(label, value, tone) {
      return '<div class="mm-stat mm-stat-' + tone + '">' +
        '<div class="mm-stat-num">' + value + '</div>' +
        '<div class="mm-stat-label">' + U.esc(label) + '</div></div>';
    }
    el.innerHTML =
      stat('Total jobs', total, 'neutral') +
      stat('Designs pending', counts.design, 'warn') +
      stat('Pricing pending', counts.pricing, 'warn') +
      stat('Meetings pending', counts.meeting, 'warn') +
      stat('All 3 complete', counts.complete, 'good');
  }

  function renderTable() {
    var el = document.getElementById('mm-dash-table');
    var rows = allJobs.filter(function (o) { return matchesFilter(o) && matchesSearch(o); });

    if (!rows.length) {
      el.innerHTML = '<div class="mm-empty">No jobs match this filter.</div>';
      return;
    }

    var head =
      '<div class="mm-dash-row mm-dash-head">' +
        '<div class="mm-dash-c-name">Customer</div>' +
        '<div class="mm-dash-c-stage">Stage</div>' +
        '<div class="mm-dash-c-status">Designs</div>' +
        '<div class="mm-dash-c-status">Pricing</div>' +
        '<div class="mm-dash-c-status">Meeting</div>' +
      '</div>';

    var body = rows.map(function (o) {
      var addr = jobAddress(o);
      return '<div class="mm-dash-row' + (allThreeDone(o) ? ' is-complete' : '') + '">' +
        '<div class="mm-dash-c-name">' +
          '<div class="mm-dash-name">' + U.esc(customerName(o)) + '</div>' +
          '<div class="mm-dash-addr">' + U.esc(addr || 'No address on file') + '</div>' +
        '</div>' +
        '<div class="mm-dash-c-stage"><span class="mm-stage">' + U.esc(stageNames[o.pipelineStageId] || '—') + '</span></div>' +
        '<div class="mm-dash-c-status" data-label="Designs">' + pill(o, 'design') + '</div>' +
        '<div class="mm-dash-c-status" data-label="Pricing">' + pill(o, 'pricing') + '</div>' +
        '<div class="mm-dash-c-status" data-label="Meeting">' + pill(o, 'meeting') + '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = '<div class="mm-dash-table">' + head + body + '</div>' +
      '<div class="mm-dash-count">Showing ' + rows.length + ' of ' + allJobs.length + ' jobs</div>';
  }

  function render() { renderStats(); renderTable(); }

  // ---- Loading ------------------------------------------------------------

  function loadDashboard() {
    var tableEl = document.getElementById('mm-dash-table');
    var statsEl = document.getElementById('mm-dash-stats');
    statsEl.innerHTML = '';
    tableEl.innerHTML = '<div class="mm-empty">Loading dashboard...</div>';

    Promise.all([api.fetchAllOpportunities(), api.getPipelines()])
      .then(function (res) {
        var ops = res[0], pipelines = res[1];

        var sales = pipelines.find(function (p) { return p.id === api.SALES_PIPELINE_ID; });
        stageNames = {};
        if (sales) (sales.stages || []).forEach(function (s) { stageNames[s.id] = s.name; });

        allJobs = ops.filter(function (o) { return o.pipelineId === api.SALES_PIPELINE_ID; });

        if (!allJobs.length) {
          statsEl.innerHTML = '';
          tableEl.innerHTML = '<div class="mm-empty">No jobs in the Remodeling Sales pipeline yet.</div>';
          return;
        }
        render();
      })
      .catch(function (e) {
        statsEl.innerHTML = '';
        tableEl.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function initDashboard() {
    document.querySelectorAll('#mm-dash-filters .mm-filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeFilter = btn.getAttribute('data-filter');
        document.querySelectorAll('#mm-dash-filters .mm-filter').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderTable();
      });
    });

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
