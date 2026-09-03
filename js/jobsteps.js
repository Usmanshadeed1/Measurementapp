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

  // Stored as 24-hour so it sorts and compares; shown the way it is spoken.
  function fmtTime(hhmm) {
    var p = String(hhmm || '').split(':');
    if (p.length < 2) return hhmm || '';
    var h = parseInt(p[0], 10);
    if (isNaN(h)) return hhmm;
    var ampm = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + p[1] + ' ' + ampm;
  }

  // Half-hour slots through the working day. A native <input type="time">
  // keeps its minute segment when only the hour is changed, which silently
  // stored "2 PM" as 14:12 -- a list cannot go wrong that way, and on a phone
  // it is one tap instead of three.
  function timeOptions(selected) {
    var out = '<option value="">No time</option>';
    var found = false;
    for (var h = 6; h <= 20; h++) {
      for (var m = 0; m < 60; m += 30) {
        var v = (h < 10 ? '0' + h : h) + ':' + (m === 0 ? '00' : m);
        var on = v === selected;
        if (on) found = true;
        out += '<option value="' + v + '"' + (on ? ' selected' : '') + '>' +
          U.esc(fmtTime(v)) + '</option>';
      }
    }
    // A time already stored that is not on the half hour still has to show,
    // or opening the form would silently change it.
    if (selected && !found) {
      out += '<option value="' + U.esc(selected) + '" selected>' +
        U.esc(fmtTime(selected)) + '</option>';
    }
    return out;
  }

  function timePicker(id, value, label) {
    return '<select class="mm-input mm-step-time" id="' + id + '" ' +
      'aria-label="Time of the ' + U.esc(label) + '">' +
      timeOptions(value || '') +
    '</select>';
  }

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

    if (opts.state === 'done' && !opts.alwaysEditable) {
      body = '<div class="mm-step-value">' + U.esc(opts.valueText) + '</div>';
    } else if (opts.state === 'done' || opts.state === 'active') {
      body = '<div class="mm-step-action">' +
        '<input type="date" class="mm-input mm-step-date" id="' + opts.inputId + '"' +
        (opts.value ? ' value="' + U.esc(opts.value) + '"' : '') + ' aria-label="' + U.esc(opts.label) + '">' +
        // Only the measurement visit carries a time: someone has to be at a
        // property at an hour. The rest record when work was finished, where
        // an hour would be noise.
        (opts.timeId ? timePicker(opts.timeId, opts.timeValue, opts.label) : '') +
        '<button type="button" class="mm-btn-sm mm-btn-primary" id="' + opts.btnId + '">' +
          U.esc(opts.saveLabel || 'Save') + '</button>' +
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

    var appt = api.apptDateTime(o).date;
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

    var apptWhen = api.apptDateTime(o);

    // The visit is the one step that gets rearranged after it is set -- a
    // customer reschedules, or a time is added to a date booked before times
    // existed. So its boxes stay on screen instead of collapsing to text.
    var apptSet = !!appt;

    var html =
      stepHtml({
        num: 1, label: 'Measurement appointment', state: appt ? 'done' : 'active',
        alwaysEditable: true,
        valueText: fmtLong(appt) + (apptWhen.time ? ' at ' + fmtTime(apptWhen.time) : ''),
        value: toInputDate(appt),
        timeId: 'mm-step-appt-time', timeValue: apptWhen.time,
        inputId: 'mm-step-appt', btnId: 'mm-step-appt-save',
        saveLabel: apptSet ? 'Update' : 'Save',
        note: apptNote,
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

    el.innerHTML =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Job progress</span>' +
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

  // The appointment writes one text field holding both halves, then moves the
  // job on exactly as the other steps do.
  function saveApptThenStage(o, date, time, moveStage) {
    return api.setApptDateTime(o.id, date, time)
      .then(function (r) {
        window.MM.activity.log('date', STEP_LABELS.appointment, {
          jobId: o.id,
          jobName: (o.contact && o.contact.name) || o.name,
          detail: date + (time ? ' at ' + fmtTime(time) : ''),
        });
        return r;
      })
      .then(function () {
        if (!moveStage) return null;
        var stageId = api.STAGE.apptBooked;
        if (!stageId || o.pipelineStageId === stageId) return null;
        return api.setOpportunityStage(o.id, stageId);
      })
      .then(function () {
        if (moveStage) o.pipelineStageId = api.STAGE.apptBooked;
      });
  }

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
    // Wired whether or not a date is already set, so the visit can be moved.
    wire('mm-step-appt-save', 'mm-step-appt', function (val) {
      var t = document.getElementById('mm-step-appt-time');
      // The stage moves only on the FIRST booking. Correcting the time on a
      // job that has since been measured, quoted or won must leave it exactly
      // where it is -- dragging Kevin Cook back from Hired Maximus to
      // Measurement Appointment would be worse than no edit at all.
      return saveApptThenStage(o, val, t ? t.value : '', !st.appt);
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
