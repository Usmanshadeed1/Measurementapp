// js/jobsteps.js
// The job's progress panel: the dates that move a job forward, shown as an
// ordered chain so it is obvious what has happened and what is next.
//
// Entering the measurement date does two things — it stores the date AND
// moves the job to "1st Client Visit", which is what fires the GHL workflow
// that creates the design / pricing / meeting tasks. Doing both from one
// action means nobody has to remember to also move the card.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var currentJob = null;
  var onJobChanged = null;   // lets app.js refresh its own view after a save

  function dateVal(o, key) {
    return api.oppField(o, api.DATE_FIELD_IDS[key]);
  }

  // GHL returns dates as ISO strings; <input type="date"> needs YYYY-MM-DD.
  function toInputDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    return d.toISOString().slice(0, 10);
  }
  function fmtLong(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function todayInput() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function daysUntil(v) {
    if (!v) return null;
    var d = new Date(toInputDate(v) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date(todayInput() + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }

  // ---- One step in the chain ---------------------------------------------

  // Steps render as done / active / waiting. Only the active one is
  // actionable, so the order of work is never ambiguous.
  function stepHtml(opts) {
    var cls = 'mm-step mm-step-' + opts.state;
    var mark = opts.state === 'done' ? '&#10003;' : opts.num;
    var body;

    if (opts.state === 'done') {
      body = '<div class="mm-step-value">' + U.esc(opts.valueText) + '</div>';
    } else if (opts.state === 'active') {
      body = '<div class="mm-step-action">' +
        '<input type="date" class="mm-input mm-step-date" id="' + opts.inputId + '"' +
        (opts.value ? ' value="' + U.esc(opts.value) + '"' : '') + ' aria-label="' + U.esc(opts.label) + '">' +
        '<button type="button" class="mm-btn-sm mm-btn-primary" id="' + opts.btnId + '">Save</button>' +
      '</div>';
    } else {
      body = '<div class="mm-step-waiting">' + U.esc(opts.waitingText || 'Waiting for the previous step') + '</div>';
    }

    return '<div class="' + cls + '">' +
      '<div class="mm-step-mark" aria-hidden="true">' + mark + '</div>' +
      '<div class="mm-step-body">' +
        '<div class="mm-step-label">' + U.esc(opts.label) + '</div>' +
        body +
        (opts.note ? '<div class="mm-step-note">' + opts.note + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function render(o) {
    currentJob = o;
    var el = document.getElementById('mm-job-steps');
    if (!el) return;

    var appt = dateVal(o, 'appointment');
    var measured = dateVal(o, 'measured');

    // Step 1 is always actionable: the visit can be rebooked at any time,
    // even after measuring.
    var apptNote = '';
    if (appt && !measured) {
      var d = daysUntil(appt);
      if (d === 0) apptNote = '<span class="mm-step-soon">Visit is today</span>';
      else if (d === 1) apptNote = '<span class="mm-step-soon">Visit is tomorrow</span>';
      else if (d > 1) apptNote = 'In ' + d + ' days';
      else if (d < 0) apptNote = '<span class="mm-step-late">' + Math.abs(d) + ' day' +
        (Math.abs(d) === 1 ? '' : 's') + ' ago — not measured yet</span>';
    }

    var html =
      stepHtml({
        num: 1, label: 'Appointment date', state: appt ? 'done' : 'active',
        valueText: fmtLong(appt), value: toInputDate(appt),
        inputId: 'mm-step-appt', btnId: 'mm-step-appt-save', note: apptNote,
      }) +
      stepHtml({
        num: 2, label: 'Measurement completed',
        state: measured ? 'done' : (appt ? 'active' : 'waiting'),
        valueText: fmtLong(measured), value: toInputDate(measured) || todayInput(),
        inputId: 'mm-step-meas', btnId: 'mm-step-meas-save',
        waitingText: 'Set the appointment date first',
        note: measured ? '' : (appt ? 'Saving this also moves the job to 1st Client Visit.' : ''),
      });

    el.innerHTML =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Job progress</span>' +
        (measured ? '<span class="mm-steps-badge mm-steps-badge-done">Measured</span>'
                  : '<span class="mm-steps-badge mm-steps-badge-todo">Needs measuring</span>') +
      '</div>' +
      '<div class="mm-steps">' + html + '</div>' +
      '<p class="mm-step-error" id="mm-step-error" role="alert"></p>';

    bind(o, appt, measured);
  }

  function bind(o, appt, measured) {
    if (!appt) wire('mm-step-appt-save', 'mm-step-appt', function (val) {
      return api.setOpportunityField(o.id, api.DATE_FIELD_IDS.appointment, val);
    });

    if (appt && !measured) wire('mm-step-meas-save', 'mm-step-meas', function (val) {
      // Store the date, then move the stage. The stage move is what triggers
      // the workflow, so it must happen after the date is safely saved.
      return api.setOpportunityField(o.id, api.DATE_FIELD_IDS.measured, val)
        .then(function () {
          if (o.pipelineStageId === api.STAGE_AFTER_MEASURED) return null;
          return api.setOpportunityStage(o.id, api.STAGE_AFTER_MEASURED);
        })
        .then(function () { o.pipelineStageId = api.STAGE_AFTER_MEASURED; });
    });
  }

  function wire(btnId, inputId, saveFn) {
    var btn = document.getElementById(btnId);
    var input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var val = input.value;
      if (!val) { showError('Pick a date first.'); return; }
      btn.disabled = true; btn.textContent = 'Saving...';
      showError('');
      saveFn(val)
        .then(function () {
          // Re-read so the panel reflects exactly what GHL stored, rather
          // than what we hoped it stored.
          return api.getOpportunity(currentJob.id);
        })
        .then(function (fresh) {
          if (fresh) {
            currentJob.customFields = fresh.customFields;
            currentJob.pipelineStageId = fresh.pipelineStageId;
          }
          render(currentJob);
          if (onJobChanged) onJobChanged(currentJob);
        })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = 'Save';
          showError('Could not save: ' + e.message);
        });
    });
  }

  function showError(msg) {
    var el = document.getElementById('mm-step-error');
    if (el) el.textContent = msg || '';
  }

  window.MM.jobsteps = {
    render: render,
    onChange: function (fn) { onJobChanged = fn; },
  };
})();
