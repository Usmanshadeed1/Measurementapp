// js/jobsteps.js
// The job's progress panel: the dates that move a job forward, shown as an
// ordered chain so it is obvious what has happened and what is next.
//
// Entering a date can also move the job's stage — that stage move is what
// fires the GHL workflows, so doing both from one action means nobody has to
// remember to also drag the card in GoHighLevel.
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

  // Once the proposal is out, the useful fact is how long the customer has
  // had it — that is the number that tells you to chase.
  function waitingNote(sentDate, won) {
    if (won) return '';
    var d = daysUntil(sentDate);
    if (d === null) return '';
    var ago = Math.abs(d);
    if (ago === 0) return 'Sent today';
    var txt = ago + ' day' + (ago === 1 ? '' : 's') + ' with the customer';
    if (ago >= 7) return '<span class="mm-step-late">' + txt + ' &mdash; worth chasing</span>';
    return txt;
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
    var design = dateVal(o, 'design');
    var pricing = dateVal(o, 'pricing');
    var sent = dateVal(o, 'proposalSent');
    var cabinets = dateVal(o, 'cabinets');
    var completed = dateVal(o, 'completed');
    // Cabinets are ordered only once the customer has actually signed, so
    // that half of the chain unlocks on the job being won rather than on a
    // date — winning is a stage move, not something anyone types.
    var won = o.pipelineStageId === api.STAGE_WON ||
              o.pipelineStageId === api.STAGE_MATERIAL_ORDERING || !!cabinets;

    // Step 1 stays informative once set: how soon the visit is, or how long
    // it has been overdue with nothing recorded.
    var apptNote = '';
    if (appt && !measured) {
      var d = daysUntil(appt);
      if (d === 0) apptNote = '<span class="mm-step-soon">Visit is today</span>';
      else if (d === 1) apptNote = '<span class="mm-step-soon">Visit is tomorrow</span>';
      else if (d > 1) apptNote = 'In ' + d + ' days';
      else if (d < 0) apptNote = '<span class="mm-step-late">' + Math.abs(d) + ' day' +
        (Math.abs(d) === 1 ? '' : 's') + ' ago &mdash; not measured yet</span>';
    }

    var html =
      stepHtml({
        num: 1, label: 'Measurement appointment', state: appt ? 'done' : 'active',
        valueText: fmtLong(appt), value: toInputDate(appt),
        inputId: 'mm-step-appt', btnId: 'mm-step-appt-save', note: apptNote,
      }) +
      stepHtml({
        num: 2, label: 'Measurement complete',
        state: measured ? 'done' : (appt ? 'active' : 'waiting'),
        valueText: fmtLong(measured), value: toInputDate(measured) || todayInput(),
        inputId: 'mm-step-meas', btnId: 'mm-step-meas-save',
        waitingText: 'Set the appointment date first',
        note: measured ? '' : (appt ? 'Saving this moves the job to Measurement Complete.' : ''),
      }) +
      stepHtml({
        num: 3, label: 'Design complete',
        state: design ? 'done' : (measured ? 'active' : 'waiting'),
        valueText: fmtLong(design), value: toInputDate(design) || todayInput(),
        inputId: 'mm-step-design', btnId: 'mm-step-design-save',
        waitingText: 'Measure the property first',
      }) +
      stepHtml({
        num: 4, label: 'Pricing complete',
        state: pricing ? 'done' : (design ? 'active' : 'waiting'),
        valueText: fmtLong(pricing), value: toInputDate(pricing) || todayInput(),
        inputId: 'mm-step-pricing', btnId: 'mm-step-pricing-save',
        waitingText: 'Finish the design first',
        note: pricing ? '' : (design ? 'Saving this moves the job to Pricing Complete.' : ''),
      }) +
      stepHtml({
        num: 5, label: 'Proposal sent',
        state: sent ? 'done' : (pricing ? 'active' : 'waiting'),
        valueText: fmtLong(sent), value: toInputDate(sent) || todayInput(),
        inputId: 'mm-step-sent', btnId: 'mm-step-sent-save',
        waitingText: 'Finish the pricing first',
        note: sent ? waitingNote(sent, won) : (pricing ? 'Email the customer yourself, then record the date here.' : ''),
      }) +
      stepHtml({
        num: 6, label: 'Material ordering',
        state: cabinets ? 'done' : (won ? 'active' : 'waiting'),
        valueText: fmtLong(cabinets), value: toInputDate(cabinets) || todayInput(),
        inputId: 'mm-step-cab', btnId: 'mm-step-cab-save',
        waitingText: 'Move the job to Hired Maximus once the customer signs',
        note: cabinets ? '' : (won ? 'Saving this moves the job to Material Ordering.' : ''),
      }) +
      stepHtml({
        num: 7, label: 'Job completed',
        state: completed ? 'done' : (cabinets ? 'active' : 'waiting'),
        valueText: fmtLong(completed), value: toInputDate(completed) || todayInput(),
        inputId: 'mm-step-done', btnId: 'mm-step-done-save',
        waitingText: 'Order the cabinets first',
        note: completed ? '' : (cabinets ? 'Saving this moves the job to Job Completed.' : ''),
      });

    // The badge names the single next thing to do, so the panel answers that
    // question without the reader working down the list.
    var badge;
    if (completed) badge = { cls: 'done', text: 'Completed' };
    else if (cabinets) badge = { cls: 'todo', text: 'In production' };
    else if (won) badge = { cls: 'todo', text: 'Order cabinets' };
    else if (sent) badge = { cls: 'todo', text: 'Waiting for customer' };
    else if (!measured) badge = { cls: 'todo', text: 'Needs measuring' };
    else if (!design) badge = { cls: 'todo', text: 'Needs design' };
    else if (!pricing) badge = { cls: 'todo', text: 'Needs pricing' };
    else badge = { cls: 'todo', text: 'Ready to send' };

    el.innerHTML =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Job progress</span>' +
        '<span class="mm-steps-badge mm-steps-badge-' + badge.cls + '">' + U.esc(badge.text) + '</span>' +
      '</div>' +
      '<div class="mm-steps">' + html + '</div>' +
      (completed ? '<div class="mm-step-final">This job is finished and no longer appears on the active dashboard.</div>' : '') +
      '<p class="mm-step-error" id="mm-step-error" role="alert"></p>';

    bind(o, { appt: appt, measured: measured, design: design, pricing: pricing,
             sent: sent, cabinets: cabinets, completed: completed, won: won });
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  // Saves the date, then optionally moves the stage. The stage move is what
  // triggers the GHL workflow, so it must happen only once the date is
  // safely stored.
  var STEP_LABELS = {
    appointment: 'Set the appointment date', measured: 'Recorded the measurement date',
    design: 'Recorded the design as finished', pricing: 'Recorded the pricing as finished',
    proposalSent: 'Recorded the proposal as sent', cabinets: 'Recorded the cabinets as ordered',
    completed: 'Marked the job completed',
  };

  function saveDateThenStage(o, fieldKey, val, stageId) {
    return api.setOpportunityField(o.id, api.DATE_FIELD_IDS[fieldKey], val)
      .then(function (r) {
        window.MM.activity.log('date', STEP_LABELS[fieldKey] || 'Updated a date', {
          jobId: o.id,
          jobName: (o.contact && o.contact.name) || o.name,
          detail: val,
        });
        return r;
      })
      .then(function () {
        if (!stageId || o.pipelineStageId === stageId) return null;
        return api.setOpportunityStage(o.id, stageId);
      })
      .then(function () { if (stageId) o.pipelineStageId = stageId; });
  }

  function bind(o, st) {
    if (!st.appt) wire('mm-step-appt-save', 'mm-step-appt', function (val) {
      return saveDateThenStage(o, 'appointment', val, api.STAGE.apptBooked);
    });

    if (st.appt && !st.measured) wire('mm-step-meas-save', 'mm-step-meas', function (val) {
      return saveDateThenStage(o, 'measured', val, api.STAGE.measured);
    });

    if (st.measured && !st.design) wire('mm-step-design-save', 'mm-step-design', function (val) {
      return saveDateThenStage(o, 'design', val, api.STAGE.design);
    });

    if (st.design && !st.pricing) wire('mm-step-pricing-save', 'mm-step-pricing', function (val) {
      return saveDateThenStage(o, 'pricing', val, api.STAGE.pricing);
    });

    if (st.pricing && !st.sent) wire('mm-step-sent-save', 'mm-step-sent', function (val) {
      return saveDateThenStage(o, 'proposalSent', val, api.STAGE_PROPOSAL_SENT);
    });

    if (st.won && !st.cabinets) wire('mm-step-cab-save', 'mm-step-cab', function (val) {
      return saveDateThenStage(o, 'cabinets', val, api.STAGE_MATERIAL_ORDERING);
    });

    // Completion only records the date — the job is already in the right
    // stage, and the dashboard archives it on the date alone.
    if (st.cabinets && !st.completed) wire('mm-step-done-save', 'mm-step-done', function (val) {
      return saveDateThenStage(o, 'completed', val, api.STAGE.completed);
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
