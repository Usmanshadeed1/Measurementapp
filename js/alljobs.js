// js/alljobs.js
// Every job in one flat list.
//
// The dashboard answers "what is happening at each stage" and groups jobs
// into accordions to do it. That is the wrong shape for "where is the Kennedy
// Mill job" -- you have to guess the stage before you can look. This page is
// the other view: one list, newest first, filtered by stage when you want it.
//
// Finished and lost jobs are included. They are excluded from the dashboard's
// counts on purpose, which leaves this as the only place they can be found.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;
  var ACCESS = window.MM.jobaccess;

  var allJobs = [];
  var stageNames = {};   // stage id -> name
  var stageList = [];    // in pipeline order, for the filter
  var loaded = false;
  var onOpenJob = null;

  var filters = { stage: '', search: '' };

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-aj-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading every job...</div>';

    return Promise.all([
      api.fetchAllOpportunities(),
      api.getPipelines(),
      ACCESS.loadMine(),
    ])
      .then(function (res) {
        var ops = res[0] || [], pipelines = res[1] || [];

        var sales = pipelines.find(function (p) { return p.id === api.SALES_PIPELINE_ID; });
        stageNames = {};
        stageList = [];
        if (sales) {
          (sales.stages || []).forEach(function (st) {
            stageNames[st.id] = st.name;
            stageList.push({ id: st.id, name: st.name });
          });
        }

        // A worker sees only the jobs they are on, exactly as everywhere else.
        var mine = ACCESS.mineOnly(ops.filter(function (o) {
          return o.pipelineId === api.SALES_PIPELINE_ID;
        }));

        // Newest first: a job created this morning is the one being looked
        // for far more often than one from six months ago.
        allJobs = mine.sort(function (a, b) {
          return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });

        loaded = true;
        fillStages();
        render();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function fillStages() {
    var sel = document.getElementById('mm-aj-stage');
    if (!sel || sel.options.length > 1) return;
    stageList.forEach(function (st) {
      var o = document.createElement('option');
      o.value = st.id;
      o.textContent = st.name;
      sel.appendChild(o);
    });
  }

  // ---- Reading a job -------------------------------------------------------

  function customerName(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  // The job's own address, or the one inside its name. Jobs created by the
  // GoHighLevel workflow carry the address in the title but not the field.
  function jobAddress(o) {
    var addr = api.oppField(o, api.ADDR_FIELD_ID);
    if (addr) return addr;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ') : '';
  }

  function stageOf(o) { return stageNames[o.pipelineStageId] || 'No stage'; }

  function fmtWhen(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---- Filtering -----------------------------------------------------------

  function visible() {
    var q = filters.search.toLowerCase();
    return allJobs.filter(function (o) {
      if (filters.stage && o.pipelineStageId !== filters.stage) return false;
      if (!q) return true;
      var hay = (customerName(o) + ' ' + jobAddress(o) + ' ' + stageOf(o)).toLowerCase();
      // Every word must appear, so two words narrow rather than widen.
      return q.split(/\s+/).every(function (w) { return !w || hay.indexOf(w) > -1; });
    });
  }

  function activeFilterCount() {
    var n = 0;
    if (filters.stage) n++;
    if (filters.search) n++;
    return n;
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    if (!loaded) return;
    var el = document.getElementById('mm-aj-body');
    if (!el) return;

    updateCount();

    var rows = visible();
    document.getElementById('mm-aj-total').textContent =
      rows.length + (rows.length === 1 ? ' job' : ' jobs') +
      (rows.length !== allJobs.length ? ' of ' + allJobs.length : '');

    if (!rows.length) {
      el.innerHTML = '<div class="mm-empty">' +
        (allJobs.length ? 'No jobs match that.' : 'No jobs yet.') + '</div>';
      return;
    }

    el.innerHTML = '<div class="mm-aj-list">' + rows.map(row).join('') + '</div>';
    bind(el);
  }

  function row(o) {
    var addr = jobAddress(o);
    return '<button type="button" class="mm-aj" data-job="' + U.esc(o.id) + '">' +
      '<span class="mm-aj-main">' +
        '<span class="mm-aj-name">' + U.esc(customerName(o)) + '</span>' +
        (addr ? '<span class="mm-aj-addr">' + U.esc(addr) + '</span>' : '') +
      '</span>' +
      '<span class="mm-aj-side">' +
        '<span class="mm-aj-stage">' + U.esc(stageOf(o)) + '</span>' +
        '<span class="mm-aj-when">' + U.esc(fmtWhen(o.createdAt)) + '</span>' +
      '</span>' +
    '</button>';
  }

  function updateCount() {
    var el = document.getElementById('mm-aj-filtercount');
    if (!el) return;
    var n = activeFilterCount();
    el.textContent = n ? String(n) : '';
    el.classList.toggle('is-on', n > 0);
  }

  function bind(el) {
    el.querySelectorAll('[data-job]').forEach(function (b) {
      b.addEventListener('click', function () {
        var o = allJobs.find(function (j) { return j.id === b.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o);
      });
    });
  }

  // ---- Wiring --------------------------------------------------------------

  function init(openJobFn) {
    onOpenJob = openJobFn;

    var searchEl = document.getElementById('mm-aj-search');
    if (searchEl) {
      var timer = null;
      searchEl.addEventListener('input', function () {
        clearTimeout(timer);
        // Waits for a pause in typing: re-rendering on every keystroke makes
        // a long list feel sluggish.
        timer = setTimeout(function () {
          filters.search = searchEl.value.trim();
          render();
        }, 200);
      });
    }

    var stageEl = document.getElementById('mm-aj-stage');
    if (stageEl) stageEl.addEventListener('change', function () {
      filters.stage = stageEl.value;
      render();
    });

    var clearEl = document.getElementById('mm-aj-clear');
    if (clearEl) clearEl.addEventListener('click', function () {
      filters = { stage: '', search: '' };
      if (searchEl) searchEl.value = '';
      if (stageEl) stageEl.value = '';
      render();
    });

    // On a phone the filters sit behind a button, same as the schedule.
    var fBtn = document.getElementById('mm-aj-filterbtn');
    var fPanel = document.getElementById('mm-aj-filters');
    if (fBtn && fPanel) {
      fBtn.addEventListener('click', function () {
        var open = !fPanel.classList.contains('is-open');
        fPanel.classList.toggle('is-open', open);
        fBtn.classList.toggle('is-open', open);
        fBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  window.MM.alljobs = { init: init, load: load };
})();
