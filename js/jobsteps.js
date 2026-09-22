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
  var onJobChanged = null;   // letts app.js refresh its own view after a save

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

  // Does this job need a design at all?
  //
  // Answered rather than assumed: a straight refacing job goes from measured
  // to quoted with no drawing, and the old date-only step made every job look
  // like it was waiting for one.
  //
  // Yes keeps the date box exactly as it was. No greys out Design complete
  // and hands the chain to Email the customer. The answer can be changed --
  // a customer who asks for a drawing after all must not need GoHighLevel
  // opened by hand to allow it.
  function needDesignStep(o, needDesign, measured, answer) {
    var answered = answer === 'Yes' || answer === 'No';
    var state = answered ? 'done' : (measured ? 'active' : 'waiting');
    var cls = 'mm-step mm-step-' + state;

    var body;
    if (!measured && !answered) {
      body = '<div class="mm-step-waiting">Measure the property first</div>';
    } else if (!answered) {
      body =
        '<div class="mm-step-action mm-rd-ask">' +
          '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
            'id="mm-rd-yes">Yes, design needed</button>' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-rd-no">No design needed</button>' +
        '</div>';
    } else if (answer === 'No') {
      body =
        '<div class="mm-step-value">No design needed</div>' +
        '<div class="mm-step-action mm-rd-change">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-rd-yes">Change to yes</button>' +
        '</div>';
    } else {
      // Yes: the date box it always had, plus a way back to No.
      body =
        '<div class="mm-step-action">' +
          '<input type="date" class="mm-input mm-step-date" id="mm-step-needdesign"' +
            ' value="' + U.esc(toInputDate(needDesign) || toInputDate(measured) || todayInput()) + '"' +
            ' aria-label="Need design date">' +
          '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
            'id="mm-step-needdesign-save">Save</button>' +
          (needDesign
            ? '<button type="button" class="mm-btn-sm mm-btn-secondary mm-step-clear" ' +
              'id="mm-step-needdesign-clear">Clear</button>'
            : '') +
        '</div>' +
        (needDesign ? '' : '<div class="mm-step-note">Set to the day measuring ' +
          'finished. Change it if design starts later.</div>') +
        '<div class="mm-step-action mm-rd-change">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-rd-no">Change to no design</button>' +
        '</div>';
    }

    return '<div class="' + cls + '">' +
      '<div class="mm-step-mark" aria-hidden="true">' +
        (answered ? '&#10003;' : '2') + '</div>' +
      '<div class="mm-step-body">' +
        '<div class="mm-step-label">Need design</div>' +
        body + notesHtml(o, 'needdesign') +
      '</div>' +
    '</div>';
  }

  // Winning the job. A proposal goes out, the customer says yes, and until now
  // the only way to record that was to leave the panel and change the stage by
  // hand -- which step 7 actually told you to do.
  //
  // No date: the client asked for a button that moves the stage and nothing
  // else, and a date would mean another GoHighLevel field to keep in step.
  // Winning the job, as a step of its own. It was a button inside Proposal
  // sent, which read as part of sending the proposal rather than as the thing
  // that happens next -- the customer saying yes is its own event in the job,
  // and the chain should say so.
  // ---- Proposals sent ------------------------------------------------------
  //
  // A proposal is rarely sent once: a price is revised, a second version goes
  // out after the customer asks for a change. So this keeps a list rather
  // than a single date, in the same shape as the design meetings above it --
  // one date per line in a multi-line field, newest first.
  //
  // The ORIGINAL single date field is left exactly as it was. Jobs that
  // recorded a proposal before this existed keep that date and it is read
  // back here as the oldest entry, so nothing already recorded moves or is
  // rewritten. Its own date cannot be edited from the list: it belongs to the
  // old field, and editing it would mean writing to live data that every
  // other screen still reads.

  function parseDates(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var d = raw.trim();
      if (d) out.push(d);
    });
    return out;
  }

  // Every proposal on the job, newest first: the old single date, then the
  // logged ones. The single date is marked so the row can hide its controls.
  function proposals(o) {
    var out = parseDates(api.oppField(o, api.DATE_FIELD_IDS.proposalLog))
      .map(function (d) { return { date: d, old: false }; });

    var first = dateVal(o, 'proposalSent');
    if (first) {
      var ymd = toInputDate(first);
      // Only when the log does not already carry it: a job recorded before
      // this existed and then edited should not show the same day twice.
      if (ymd && out.every(function (p) { return p.date !== ymd; })) {
        out.push({ date: ymd, old: true });
      }
    }

    return out.sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function sentStep(o, num, pricing, won, notes) {
    var list = proposals(o);
    var sent = list.length > 0;
    var cls = 'mm-step mm-step-' + (sent ? 'done' : (pricing ? 'active' : 'waiting'));

    var body;
    if (!pricing && !sent) {
      body = '<div class="mm-step-waiting">Finish the pricing first</div>';
    } else {
      body =
        (list.length ? '<div class="mm-step-log">' +
          list.map(function (p, i) {
            return '<div class="mm-step-logrow" data-prop="' + i + '">' +
              '<span class="mm-step-logwhen">' + U.esc(fmtLong(p.date)) + '</span>' +
              (i === 0 ? '<span class="mm-step-logwhat">Latest</span>' : '') +
              // The date carried over from the old single field is shown but
              // not edited here -- see the note above.
              (p.old
                ? ''
                : '<span class="mm-step-propacts">' +
                    '<button type="button" class="mm-step-propedit" ' +
                      'data-pedit="' + U.esc(p.date) + '" ' +
                      'aria-label="Change this date">&#9998;</button>' +
                    '<button type="button" class="mm-step-propdel" ' +
                      'data-pdel="' + U.esc(p.date) + '" ' +
                      'aria-label="Remove this proposal">&times;</button>' +
                  '</span>') +
            '</div>';
          }).join('') + '</div>' : '') +

        '<div class="mm-step-action">' +
          '<input type="date" class="mm-input mm-step-date" id="mm-step-sent" ' +
            'value="' + U.esc(todayInput()) + '" aria-label="Proposal sent">' +
          '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
            'id="mm-step-sent-save">' +
            (sent ? 'Record another' : 'Save') + '</button>' +
        '</div>';
    }

    return '<div class="' + cls + '">' +
      '<div class="mm-step-mark" aria-hidden="true">' +
        (sent ? '&#10003;' : num) + '</div>' +
      '<div class="mm-step-body">' +
        '<div class="mm-step-label">Proposal sent</div>' +
        body +
        '<div class="mm-step-note">' +
          (sent ? waitingNote(list[0].date, won) : '') + notes +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function wonStep(num, sent, won, notes) {
    var cls = 'mm-step mm-step-' + (won ? 'done' : (sent ? 'active' : 'waiting'));

    var body;
    if (won) {
      body = '<div class="mm-step-value">Hired Maximus</div>';
    } else {
      // Offered whether or not a proposal date is recorded: a customer can say
      // yes on the phone before anyone gets round to filling that in, and
      // making this wait for paperwork left the stage wrong in the meantime.
      body = '<div class="mm-step-action">' +
        '<button type="button" class="mm-btn-sm mm-btn-primary" id="mm-step-won">' +
          'Hired Maximus</button>' +
      '</div>';
    }

    return '<div class="' + cls + '">' +
      '<div class="mm-step-mark" aria-hidden="true">' +
        (won ? '&#10003;' : num) + '</div>' +
      '<div class="mm-step-body">' +
        '<div class="mm-step-label">Hired Maximus</div>' +
        body + (notes || '') +
      '</div>' +
    '</div>';
  }

  // ---- One step in the chain ---------------------------------------------

  // Steps render as done / active / waiting. Only the active one is
  // actionable, so the order of work is never ambiguous.
  // Booking the visit and recording that it happened, in one panel. Both
  // dates write to the fields they always used -- only the layout changed.
  //
  // Each row keeps its own Save, because the two are filled in days apart.
  // Clear is offered beside them: a visit gets cancelled, and a date typed by
  // mistake had no way back before this.
  function measurementStep(appt, apptTime, measured, apptNote, notes) {
    var done = !!measured;
    var cls = 'mm-step mm-step-' + (done ? 'done' : 'active');

    var visitRow =
      '<div class="mm-msrow">' +
        '<div class="mm-msrow-label">Visit</div>' +
        '<div class="mm-step-action">' +
          '<input type="date" class="mm-input mm-step-date" id="mm-step-appt"' +
            (toInputDate(appt) ? ' value="' + U.esc(toInputDate(appt)) + '"' : '') +
            ' aria-label="Measurement visit date">' +
          timePicker('mm-step-appt-time', apptTime, 'measurement visit') +
          '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
            'id="mm-step-appt-save">' + (appt ? 'Update' : 'Save') + '</button>' +
          (appt
            ? '<button type="button" class="mm-btn-sm mm-btn-secondary mm-step-clear" ' +
              'id="mm-step-appt-clear">Clear</button>'
            : '') +
        '</div>' +
        (apptNote ? '<div class="mm-step-note">' + apptNote + '</div>' : '') +
      '</div>';

    var doneRow =
      '<div class="mm-msrow">' +
        '<div class="mm-msrow-label">Completed</div>' +
        '<div class="mm-step-action">' +
          '<input type="date" class="mm-input mm-step-date" id="mm-step-meas"' +
            ' value="' + U.esc(toInputDate(measured) || todayInput()) + '"' +
            ' aria-label="Measurement completed date">' +
          '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
            'id="mm-step-meas-save">' + (measured ? 'Update' : 'Save') + '</button>' +
          (measured
            ? '<button type="button" class="mm-btn-sm mm-btn-secondary mm-step-clear" ' +
              'id="mm-step-meas-clear">Clear</button>'
            : '') +
        '</div>' +
        (!measured
          ? '<div class="mm-step-note">Saving this moves the job to Need Design.</div>'
          : '') +
      '</div>';

    return '<div class="' + cls + '">' +
      '<div class="mm-step-mark" aria-hidden="true">' + (done ? '&#10003;' : '1') + '</div>' +
      '<div class="mm-step-body">' +
        '<div class="mm-step-label">Measurement</div>' +
        visitRow + doneRow + (notes || '') +
      '</div>' +
    '</div>';
  }

  // Emailing the customer. Not a date to type: the send records itself, and
  // the log underneath says what went and when. One step rather than two,
  // because the design and the quote go out in whatever order suits the job.
  function emailStep(o, designDone) {
    var log = parseLog(api.oppField(o, api.DATE_FIELD_IDS.emailLog));
    var sent = log.length > 0;
    var cls = 'mm-step mm-step-' + (sent ? 'done' : (designDone ? 'active' : 'waiting'));

    var body;
    if (!designDone && !sent) {
      body = '<div class="mm-step-waiting">Finish the design first</div>';
    } else {
      body =
        (log.length ? '<div class="mm-step-log">' +
          log.map(function (e) {
            return '<div class="mm-step-logrow">' +
              '<span class="mm-step-logwhen">' + U.esc(fmtLong(e.date)) + '</span>' +
              '<span class="mm-step-logwhat">' + U.esc(kindLabel(e.kind)) + '</span>' +
              (e.subject ? '<span class="mm-step-logsub">' + U.esc(e.subject) + '</span>' : '') +
            '</div>';
          }).join('') + '</div>' : '') +
        (window.MM.senddesign.canSend()
          ? '<button type="button" class="mm-btn-sm mm-btn-primary mm-step-send" ' +
              'id="mm-step-senddesign">' +
              (sent ? 'Send another email' : 'Email the customer') + '</button>'
          : '');
    }

    return '<div class="' + cls + '">' +
      '<div class="mm-step-mark" aria-hidden="true">' +
        (sent ? '&#10003;' : '4') + '</div>' +
      '<div class="mm-step-body">' +
        '<div class="mm-step-label">Email the customer</div>' +
        body + notesHtml(o, 'email') +
      '</div>' +
    '</div>';
  }

  // "2026-09-08|design|Your design - 108 teal lane", one per line.
  function parseLog(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var p = raw.split('|');
      out.push({
        date: (p[0] || '').trim(),
        kind: (p[1] || '').trim(),
        subject: (p[2] || '').trim(),
      });
    });
    return out;
  }

  function kindLabel(k) {
    return k === 'both' ? 'Design and quote'
      : k === 'quote' ? 'Quote'
      : 'Design';
  }

  // ---- Notes on a step -----------------------------------------------------
  //
  // A job does not always go forward. Pricing goes out, the customer asks for
  // a redesign, and the panel had no way to say so -- the dates alone made it
  // look as though design had simply been done once and finished.
  //
  // A note records why. Dates are left exactly as they are: Design Complete
  // still shows the day it was completed, because it was, and the note beside
  // it says what happened afterwards.

  // Which step a note belongs to, and which stage that step is. The keys are
  // stored in the notes field, so they must not change once notes exist
  // against them.
  //
  // Every step carries a stage, because a job can be sent back to any of them:
  // a customer who wants the kitchen redesigned after seeing a price sends the
  // job to Design, and one who wants a second measurement sends it further
  // back still. Which one is the person's decision, not this file's.
  var STEP_KEYS = {
    measurement: 'Measurement',
    needdesign: 'Need design',
    design: 'Design complete',
    email: 'Email the customer',
    pricing: 'Pricing complete',
    sent: 'Proposal sent',
    won: 'Hired Maximus',
    materials: 'Material ordering',
    completed: 'Job completed',
  };

  function stageForStep(key) {
    var map = {
      measurement: api.STAGE.apptBooked,
      needdesign: api.STAGE.needDesign,
      design: api.STAGE.design,
      email: api.STAGE.emailCustomer,
      pricing: api.STAGE.pricing,
      sent: api.STAGE.proposalSent,
      won: api.STAGE.won,
      materials: api.STAGE.materials,
      completed: api.STAGE.completed,
    };
    return map[key] || '';
  }

  // Built rather than written as literals: a newline typed straight into
  // the source is one bad paste away from breaking the file.
  var NEWLINE = String.fromCharCode(10);
  var SPLIT_RE = new RegExp(String.fromCharCode(13) + '?' +
                            String.fromCharCode(10));

  // The prefix a "Move job here" note carries. Written once here and reused
  // for both writing and reading, so the two can never drift apart -- and
  // built from a character code for the same reason as the newline above:
  // the em dash is easy to mangle in a paste.
  var MOVED_MARK = 'Moved back here ' + String.fromCharCode(8212) + ' ';
  var MOVED_RE = new RegExp('^Moved back here\\s*' +
                            String.fromCharCode(8212) + '\\s*');

  function parseNotes(text) {
    var out = [];
    String(text || '').split(SPLIT_RE).forEach(function (raw) {
      if (!raw.trim()) return;
      var p = raw.split('|');
      out.push({
        date: (p[0] || '').trim(),
        step: (p[1] || '').trim(),
        // Anything after the second pipe is the note, so a note containing a
        // pipe survives instead of being cut in half.
        text: p.slice(2).join('|').trim(),
      });
    });
    return out;
  }

  function serialiseNotes(rows) {
    return rows.map(function (n) {
      return [n.date, n.step, n.text].join('|');
    }).join(NEWLINE);
  }

  function notesFor(o, stepKey) {
    return parseNotes(api.oppField(o, api.STEP_NOTES_FIELD_ID))
      .filter(function (n) { return n.step === stepKey; })
      // Newest first: the reason a job is where it is matters more than how
      // it got there the first time.
      .reverse();
  }

  // The notes already written on a step, plus a way to add one. Collapsed
  // behind a count until asked for: a panel of nine steps each showing three
  // notes would bury the dates the panel exists for.
  function notesHtml(o, stepKey) {
    var rows = notesFor(o, stepKey);
    var open = openNotes[stepKey];

    return '<div class="mm-stepnotes">' +
      '<button type="button" class="mm-stepnotes-toggle" ' +
        'data-notes="' + U.esc(stepKey) + '" aria-expanded="' +
        (open ? 'true' : 'false') + '">' +
        (rows.length
          ? rows.length + (rows.length === 1 ? ' note' : ' notes')
          : 'Add a note') +
        '<span class="mm-stepnotes-caret" aria-hidden="true">&#9662;</span>' +
      '</button>' +
      (open
        ? '<div class="mm-stepnotes-body">' +
            rows.map(function (n) {
              // A note records why something happened, and a typo in that
              // reason should be fixable. The date is left alone: it says
              // when the thing happened, not when the wording was last
              // touched. Editing is offered, deleting is not -- a note that
              // can vanish is not much of a record.
              var moved = MOVED_RE.test(n.text);
              // The note's own text is carried in an attribute so the edit
              // knows which note it is. U.esc leaves quotes alone, which is
              // fine between tags and not fine inside one, so they are
              // escaped here as well.
              var attr = U.esc(n.text).replace(/"/g, '&quot;');
              var shown = n.text.replace(MOVED_RE, '');
              // Which note is open for editing, if any. Held outside the
              // markup so a redraw does not close the box mid-sentence.
              var isEditing = editingNote &&
                editingNote.step === stepKey &&
                editingNote.date === n.date &&
                editingNote.text === n.text;

              return '<div class="mm-stepnote' +
                  (isEditing ? ' is-editing' : '') + '">' +
                '<div class="mm-stepnote-when">' + U.esc(fmtLong(n.date)) +
                  (isEditing ? '' :
                    '<button type="button" class="mm-stepnote-edit" ' +
                      'data-noteedit="' + U.esc(stepKey) + '" ' +
                      'data-notedate="' + U.esc(n.date) + '" ' +
                      'data-notetext="' + attr + '" ' +
                      'aria-label="Edit this note">&#9998;</button>') +
                '</div>' +

                (isEditing
                  // Edited where it sits, rather than in a browser dialog:
                  // the note keeps its place in the list so it is clear
                  // which one is being changed.
                  ? '<div class="mm-stepnote-editbox">' +
                      (moved
                        ? '<span class="mm-stepnote-moved">Moved back here</span> '
                        : '') +
                      '<textarea class="mm-input mm-stepnote-editin" rows="2" ' +
                        'aria-label="Edit note">' + U.esc(shown) + '</textarea>' +
                      '<div class="mm-stepnote-editbtns">' +
                        '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
                          'data-notesaveedit="1">Save</button>' +
                        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
                          'data-notecancel="1">Cancel</button>' +
                      '</div>' +
                    '</div>'
                  : '<div class="mm-stepnote-text">' +
                      // The "moved back" part is the record of a stage move,
                      // so it is shown apart from the reason and is not
                      // editable.
                      (moved
                        ? '<span class="mm-stepnote-moved">Moved back here</span> '
                        : '') +
                      U.esc(shown) +
                    '</div>') +
              '</div>';
            }).join('') +
            '<div class="mm-stepnote-add">' +
              '<textarea class="mm-input mm-stepnote-box" ' +
                'id="mm-stepnote-text-' + U.esc(stepKey) + '" rows="2" ' +
                'placeholder="Why did this change?"></textarea>' +
              '<div class="mm-stepnote-btns">' +
                '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
                  'data-notesave="' + U.esc(stepKey) + '">Add note</button>' +
                // Moving the job back and saying why are one action: a job
                // that jumped backwards with no reason recorded is the thing
                // the notes exist to prevent.
                (o.pipelineStageId !== stageForStep(stepKey)
                  ? '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
                    'data-stepback="' + U.esc(stepKey) + '">Move job here</button>'
                  : '<span class="mm-stepnote-hereis">Job is at this step</span>') +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +
    '</div>';
  }

  // Which step's notes are expanded. Kept outside render so a redraw does not
  // close a box somebody is typing into.
  var openNotes = {};

  // The note currently open for editing: { step, date, text }, or null.
  // Kept here rather than in the markup so a redraw keeps the box open.
  var editingNote = null;

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
        // Offered only where a step asks for it, and only once there is
        // something to remove.
        (opts.clearId && opts.value
          ? '<button type="button" class="mm-btn-sm mm-btn-secondary mm-step-clear" ' +
            'id="' + opts.clearId + '">Clear</button>'
          : '') +
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
    // A note left open for editing belongs to the job it was opened on:
    // moving to another job drops it rather than carrying it across.
    if (currentJob && o && currentJob.id !== o.id) editingNote = null;
    currentJob = o;
    var el = document.getElementById('mm-job-steps');
    if (!el) return;

    var appt = api.apptDateTime(o).date;
    var measured = dateVal(o, 'measured');
    var needDesign = dateVal(o, 'needDesign');
    var design = dateVal(o, 'design');
    var pricing = dateVal(o, 'pricing');
    // The most recent proposal, whether it came from the log or from the
    // single date field jobs used before the log existed. Everything after
    // this step keys off it, so it has to see both.
    var sentList = proposals(o);
    var sent = sentList.length ? sentList[0].date : '';
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

    var requires = api.requiresDesign(o);
    var skipDesign = requires === 'No';

    var html =
      measurementStep(appt, apptWhen.time, measured, apptNote,
                      notesHtml(o, 'measurement')) +
      needDesignStep(o, needDesign, measured, requires) +
      // Skipped outright when the job needs no design. Shown greyed rather
      // than removed, so the chain keeps its shape and it is obvious the step
      // was passed over on purpose rather than missed.
      (skipDesign
        ? '<div class="mm-step mm-step-skipped">' +
            '<div class="mm-step-mark" aria-hidden="true">&mdash;</div>' +
            '<div class="mm-step-body">' +
              '<div class="mm-step-label">Design complete</div>' +
              '<div class="mm-step-waiting">Not needed for this job</div>' +
              // Notes even on a skipped step: a job sent back here is exactly
              // the case where somebody needs to say why.
              notesHtml(o, 'design') +
            '</div>' +
          '</div>'
        : stepHtml({
            num: 3, label: 'Design complete',
            state: design ? 'done' : (measured ? 'active' : 'waiting'),
            valueText: fmtLong(design), value: toInputDate(design) || todayInput(),
            inputId: 'mm-step-design', btnId: 'mm-step-design-save',
            waitingText: 'Measure the property first',
            note: notesHtml(o, 'design'),
          })) +
      // With no design to wait for, emailing becomes the next thing to do.
      emailStep(o, skipDesign ? !!measured : design) +
      stepHtml({
        num: 5, label: 'Pricing complete',
        state: pricing ? 'done' : (design ? 'active' : 'waiting'),
        valueText: fmtLong(pricing), value: toInputDate(pricing) || todayInput(),
        inputId: 'mm-step-pricing', btnId: 'mm-step-pricing-save',
        waitingText: 'Finish the design first',
        note: (pricing ? '' : (design ? 'Saving this moves the job to Pricing Complete.' : '')) +
              notesHtml(o, 'pricing'),
      }) +
      // Design meetings sit here, after pricing. Not a numbered step: a job
      // does not pass through them once the way it passes through a date, and
      // three meetings are not three steps forward. meetings.js owns
      // everything inside -- this only gives it somewhere to draw.
      '<div class="mm-step mm-step-meetings" id="mm-job-meetings"></div>' +
      sentStep(o, 6, pricing, won, notesHtml(o, 'sent')) +
      wonStep(7, sent, won, notesHtml(o, 'won')) +
      stepHtml({
        num: 8, label: 'Material ordering',
        state: cabinets ? 'done' : (won ? 'active' : 'waiting'),
        valueText: fmtLong(cabinets), value: toInputDate(cabinets) || todayInput(),
        inputId: 'mm-step-cab', btnId: 'mm-step-cab-save',
        waitingText: 'Mark Hired Maximus first',
        note: (cabinets ? '' : (won ? 'Saving this moves the job to Material Ordering.' : '')) +
              notesHtml(o, 'materials'),
      }) +
      stepHtml({
        num: 9, label: 'Job completed',
        state: completed ? 'done' : (cabinets ? 'active' : 'waiting'),
        valueText: fmtLong(completed), value: toInputDate(completed) || todayInput(),
        inputId: 'mm-step-done', btnId: 'mm-step-done-save',
        waitingText: 'Order the cabinets first',
        note: (completed ? '' : (cabinets ? 'Saving this moves the job to Job Completed.' : '')) +
              notesHtml(o, 'completed'),
      });

    el.innerHTML =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Job progress</span>' +
      '</div>' +
      '<div class="mm-steps">' + html + '</div>' +
      (completed ? '<div class="mm-step-final">This job is finished and no longer appears on the active dashboard.</div>' : '') +
      '<p class="mm-step-error" id="mm-step-error" role="alert"></p>';

    bind(o, { appt: appt, measured: measured, needDesign: needDesign,
             design: design,
             pricing: pricing, sent: sent, cabinets: cabinets,
             completed: completed, won: won });
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  // Saves the date, then optionally moves the stage. The stage move is what
  // triggers the GHL workflow, so it must happen only once the date is
  // safely stored.
  var STEP_LABELS = {
    appointment: 'Set the appointment date', measured: 'Recorded the measurement date',
    needDesign: 'Marked the design as needed',
    design: 'Recorded the design as finished',
    pricing: 'Recorded the pricing as finished',
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

    // Wired whether or not a date is set, so a completed measurement can be
    // corrected the way the visit can.
    wire('mm-step-meas-save', 'mm-step-meas', function (val) {
      return saveDateThenStage(o, 'measured', val, api.STAGE.needDesign);
    });

    // Need Design keeps its date box so it can be changed or cleared, but no
    // Save that moves the stage: completing the measurement already put the
    // job there, and a button offering to do it again would only confuse.
    wire('mm-step-needdesign-save', 'mm-step-needdesign', function (val) {
      return saveDateThenStage(o, 'needDesign', val, null);
    });

    // Clearing a date leaves the stage alone. A visit gets cancelled without
    // the job going backwards, and a silent reverse move would be harder to
    // understand than doing it by hand.
    wireClear('mm-step-appt-clear', function () {
      return api.setApptDateTime(o.id, '', '');
    });
    wireClear('mm-step-meas-clear', function () {
      return api.setOpportunityField(o.id, api.DATE_FIELD_IDS.measured, '');
    });
    wireClear('mm-step-needdesign-clear', function () {
      return api.setOpportunityField(o.id, api.DATE_FIELD_IDS.needDesign, '');
    });


    // Wired whenever the button is on screen, which includes a design already
    // emailed once -- re-sending is a real need, and a button that does
    // nothing is worse than no button.
    var sendBtn = document.getElementById('mm-step-senddesign');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      window.MM.senddesign.open(o, o.contact, function () {
        // Re-read so the panel shows the date and stage the send produced.
        api.getOpportunity(o.id).then(function (fresh) {
          if (fresh) {
            o.customFields = fresh.customFields;
            o.pipelineStageId = fresh.pipelineStageId;
          }
          render(o);
          if (onJobChanged) onJobChanged(o);
        });
      });
    });


    if (st.measured && !st.design) wire('mm-step-design-save', 'mm-step-design', function (val) {
      return saveDateThenStage(o, 'design', val, api.STAGE.design);
    });

    if (st.design && !st.pricing) wire('mm-step-pricing-save', 'mm-step-pricing', function (val) {
      return saveDateThenStage(o, 'pricing', val, api.STAGE.pricing);
    });

    wireProposals(o);

    // Answering the design question. Writes the answer and nothing else: no
    // stage moves, because the job is already where the measurement put it and
    // the reminder workflow only fires after a full day of no activity.
    function answerDesign(btn, value) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        var was = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving...';
        showError('');
        // The answer sets the stage, both ways: "Yes" means the job needs a
        // design, so it belongs in Need Design; "No" means it does not, so it
        // goes to Email Customer.
        //
        // This can move a job backwards -- answering Yes on a job sitting in
        // Hired Maximus returns it to Need Design. That is deliberate. It is
        // an admin saying the job needs designing after all, and the stage
        // should say what is true rather than what used to be.
        var stage = value === 'No' ? api.STAGE.emailCustomer : api.STAGE.needDesign;

        api.setRequiresDesign(o.id, value)
          .then(function () {
            if (o.pipelineStageId === stage) return null;
            return api.setOpportunityStage(o.id, stage);
          })
          .then(function () {
            o.pipelineStageId = stage;
            // The answer is written into the job we already hold rather than
            // read back: GoHighLevel's read runs a moment behind its write,
            // so re-fetching returned the OLD answer and redrew the step
            // exactly as it was -- which looked like the button doing nothing.
            var fields = o.customFields || [];
            var found = false;
            for (var i = 0; i < fields.length; i++) {
              if (fields[i].id === api.REQUIRES_DESIGN_FIELD_ID) {
                fields[i].fieldValue = value;
                fields[i].fieldValueString = value;
                found = true;
                break;
              }
            }
            if (!found) {
              fields.push({
                id: api.REQUIRES_DESIGN_FIELD_ID,
                fieldValue: value,
                fieldValueString: value,
              });
            }
            o.customFields = fields;

            render(o);
            if (onJobChanged) onJobChanged(o);
          })
          .catch(function (e) {
            btn.disabled = false;
            btn.textContent = was;
            showError('Could not save: ' + e.message);
          });
      });
    }
    answerDesign(document.getElementById('mm-rd-yes'), 'Yes');
    answerDesign(document.getElementById('mm-rd-no'), 'No');

    // ---- Step notes --------------------------------------------------------

    // Opening one is a redraw, so the box has to be focused afterwards rather
    // than before: the element someone would be typing into does not exist
    // until render has run.
    document.querySelectorAll('[data-notes]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-notes');
        openNotes[key] = !openNotes[key];
        render(o);
        var box = document.getElementById('mm-stepnote-text-' + key);
        if (box) box.focus();
      });
    });

    // Writing a note, and optionally moving the job to that step at the same
    // time. Both buttons end up here: the only difference is whether a stage
    // goes with the note.
    function saveNote(key, btn, label, moveStage) {
      var box = document.getElementById('mm-stepnote-text-' + key);
      if (!box) return;

      // A pipe or a line break would break the one-note-per-line format, so
      // both become a space rather than being refused: someone writing a
      // note should not have to think about how it is stored.
      var text = String(box.value || '')
        .replace(/[|\r\n]+/g, ' ')
        .trim();

      // Moving a job back without saying why is the thing the notes exist to
      // prevent, so the reason is required for a move and optional otherwise.
      if (!text) {
        showError(moveStage
          ? 'Say why the job is going back to this step.'
          : 'Write the note first.');
        box.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Saving...';
      showError('');

      var rows = parseNotes(api.oppField(o, api.STEP_NOTES_FIELD_ID));
      var stage = moveStage ? stageForStep(key) : '';
      rows.push({
        date: todayInput(),
        step: key,
        text: moveStage ? MOVED_MARK + text : text,
      });
      var stored = serialiseNotes(rows);

      api.setOpportunityField(o.id, api.STEP_NOTES_FIELD_ID, stored)
        .then(function () {
          if (!stage || o.pipelineStageId === stage) return null;
          return api.setOpportunityStage(o.id, stage);
        })
        .then(function () {
          if (stage) o.pipelineStageId = stage;

          // Written into the job already held rather than read back:
          // GoHighLevel's read runs a moment behind its write, and
          // re-fetching returned the note list as it was before the save.
          var fields = o.customFields || [];
          var found = false;
          for (var i = 0; i < fields.length; i++) {
            if (fields[i].id === api.STEP_NOTES_FIELD_ID) {
              fields[i].fieldValue = stored;
              fields[i].fieldValueString = stored;
              found = true;
              break;
            }
          }
          if (!found) {
            fields.push({
              id: api.STEP_NOTES_FIELD_ID,
              fieldValue: stored,
              fieldValueString: stored,
            });
          }
          o.customFields = fields;

          window.MM.activity.log(moveStage ? 'stage' : 'note',
            (moveStage ? 'Moved back to ' : 'Note on ') +
            (STEP_KEYS[key] || key) + ': ' + text, {
              jobId: o.id,
              jobName: (o.contact && o.contact.name) || o.name,
            });

          render(o);
          if (onJobChanged) onJobChanged(o);
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = label;
          showError('Could not save: ' + e.message);
        });
    }

    document.querySelectorAll('[data-notesave]').forEach(function (b) {
      b.addEventListener('click', function () {
        saveNote(b.getAttribute('data-notesave'), b, 'Add note', false);
      });
    });

    document.querySelectorAll('[data-stepback]').forEach(function (b) {
      b.addEventListener('click', function () {
        saveNote(b.getAttribute('data-stepback'), b, 'Move job here', true);
      });
    });

    // Correcting the wording of a note already written.
    //
    // The note is found by its date, step and exact text rather than by its
    // position in the list: the list shown is filtered to one step and
    // reversed, so a position here means nothing to the stored field.
    //
    // A "Moved back here" note keeps that prefix whatever is typed, so the
    // record that the job was moved cannot be edited away -- only the reason
    // given for it changes.
    document.querySelectorAll('[data-noteedit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editingNote = {
          step: b.getAttribute('data-noteedit'),
          date: b.getAttribute('data-notedate'),
          text: b.getAttribute('data-notetext'),
        };
        showError('');
        render(o);
        // Into the box with the cursor at the end, ready to type.
        var box = document.querySelector('.mm-stepnote-editin');
        if (box) { box.focus(); box.selectionStart = box.value.length; }
      });
    });

    document.querySelectorAll('[data-notecancel]').forEach(function (b) {
      b.addEventListener('click', function () {
        editingNote = null;
        showError('');
        render(o);
      });
    });

    document.querySelectorAll('[data-notesaveedit]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!editingNote) return;
        var key = editingNote.step;
        var date = editingNote.date;
        var was = editingNote.text;
        var moved = MOVED_RE.test(was);
        var shown = was.replace(MOVED_RE, '');

        var box = document.querySelector('.mm-stepnote-editin');
        if (!box) return;

        var next = String(box.value || '').replace(/[|\r\n]+/g, ' ').trim();
        if (!next) { showError('A note cannot be empty.'); box.focus(); return; }
        if (next === shown) { editingNote = null; render(o); return; }

        var rows = parseNotes(api.oppField(o, api.STEP_NOTES_FIELD_ID));
        var hit = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].step === key && rows[i].date === date &&
              rows[i].text === was) { hit = rows[i]; break; }
        }
        if (!hit) { showError('That note is no longer there.'); return; }

        hit.text = moved ? MOVED_MARK + next : next;
        var stored = serialiseNotes(rows);

        b.disabled = true;
        b.textContent = 'Saving...';
        showError('');

        api.setOpportunityField(o.id, api.STEP_NOTES_FIELD_ID, stored)
          .then(function () {
            editingNote = null;
            // Written into the job already held rather than read back, for
            // the same reason as saving a new note does.
            var fields = o.customFields || [];
            var found = false;
            for (var j = 0; j < fields.length; j++) {
              if (fields[j].id === api.STEP_NOTES_FIELD_ID) {
                fields[j].fieldValue = stored;
                fields[j].fieldValueString = stored;
                found = true;
                break;
              }
            }
            if (!found) {
              fields.push({
                id: api.STEP_NOTES_FIELD_ID,
                fieldValue: stored,
                fieldValueString: stored,
              });
            }
            o.customFields = fields;

            // Both versions, because a note is a record: the step keeps only
            // the current wording, so if the old one is not written down
            // here it is gone for good.
            window.MM.activity.log('note',
              'Edited note on ' + (STEP_KEYS[key] || key) + ': "' +
              shown + '" ' + String.fromCharCode(8594) + ' "' + next + '"', {
                jobId: o.id,
                jobName: (o.contact && o.contact.name) || o.name,
              });

            render(o);
            if (onJobChanged) onJobChanged(o);
          })
          .catch(function (e) {
            b.disabled = false;
            b.textContent = 'Save';
            showError('Could not save: ' + e.message);
          });
      });
    });

    // Moves the stage and nothing else: no date is written, so there is no
    // field to go stale and nothing to undo but the stage itself.
    var wonBtn = document.getElementById('mm-step-won');
    if (wonBtn) wonBtn.addEventListener('click', function () {
      wonBtn.disabled = true;
      wonBtn.textContent = 'Saving...';
      showError('');
      api.setOpportunityStage(o.id, api.STAGE_WON)
        .then(function () {
          o.pipelineStageId = api.STAGE_WON;
          window.MM.activity.log('stage', 'Customer hired Maximus', {
            jobId: o.id,
            jobName: (o.contact && o.contact.name) || o.name,
          });
          render(o);
          if (onJobChanged) onJobChanged(o);
        })
        .catch(function (e) {
          wonBtn.disabled = false;
          wonBtn.textContent = 'Hired Maximus';
          showError('Could not update: ' + e.message);
        });
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

  // Clearing shares wire()'s reload so the panel redraws from what was
  // actually stored, rather than from what the screen hoped was stored.
  function wireClear(btnId, clearFn) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Clearing...';
      showError('');
      clearFn()
        .then(function () { return api.getOpportunity(currentJob.id); })
        .then(function (fresh) {
          if (fresh) {
            currentJob.customFields = fresh.customFields;
            currentJob.pipelineStageId = fresh.pipelineStageId;
          }
          render(currentJob);
          if (onJobChanged) onJobChanged(currentJob);
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = 'Clear';
          showError('Could not clear: ' + e.message);
        });
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

  // ---- Recording, changing and removing proposals --------------------------
  //
  // All three write the whole log back, then write it into the job already
  // held rather than re-reading: GoHighLevel's read runs a moment behind its
  // write, and a re-fetch here returned the list as it was before the save.

  function writeLog(o, dates, stage) {
    var stored = dates.slice().sort().reverse().join(String.fromCharCode(10));
    var id = api.DATE_FIELD_IDS.proposalLog;

    return api.setOpportunityField(o.id, id, stored)
      .then(function () {
        if (!stage || o.pipelineStageId === stage) return null;
        return api.setOpportunityStage(o.id, stage);
      })
      .then(function () {
        if (stage) o.pipelineStageId = stage;

        var fields = o.customFields || [];
        var found = false;
        for (var i = 0; i < fields.length; i++) {
          if (fields[i].id === id) {
            fields[i].fieldValue = stored;
            fields[i].fieldValueString = stored;
            found = true;
            break;
          }
        }
        if (!found) {
          fields.push({ id: id, fieldValue: stored, fieldValueString: stored });
        }
        o.customFields = fields;
      });
  }

  // The dates the log itself owns. The date carried over from the old single
  // field is not among them: it stays in that field and is never rewritten.
  function loggedDates(o) {
    return parseDates(api.oppField(o, api.DATE_FIELD_IDS.proposalLog));
  }

  function redraw(o) {
    render(o);
    if (onJobChanged) onJobChanged(o);
  }

  function wireProposals(o) {
    var btn = document.getElementById('mm-step-sent-save');
    var input = document.getElementById('mm-step-sent');

    if (btn && input) {
      btn.addEventListener('click', function () {
        var val = input.value;
        if (!val) { showError('Pick a date first.'); return; }

        var dates = loggedDates(o);
        if (dates.indexOf(val) > -1) {
          showError('That proposal is already recorded.');
          return;
        }
        dates.push(val);

        var was = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saving...';
        showError('');

        writeLog(o, dates, api.STAGE_PROPOSAL_SENT)
          .then(function () {
            window.MM.activity.log('date', STEP_LABELS.proposalSent, {
              jobId: o.id,
              jobName: (o.contact && o.contact.name) || o.name,
              detail: val,
            });
            redraw(o);
          })
          .catch(function (e) {
            btn.disabled = false; btn.textContent = was;
            showError('Could not save: ' + e.message);
          });
      });
    }

    // Changing a recorded date: the old one is replaced by the new one, so a
    // wrong day is corrected rather than added alongside.
    document.querySelectorAll('[data-pedit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var old = b.getAttribute('data-pedit');
        var next = window.prompt('Change this proposal date:', old);
        if (next === null) return;
        next = String(next).trim();
        if (!next || next === old) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
          showError('Use the form 2026-09-25.');
          return;
        }

        var dates = loggedDates(o).filter(function (d) { return d !== old; });
        if (dates.indexOf(next) < 0) dates.push(next);

        b.disabled = true;
        showError('');
        writeLog(o, dates, null)
          .then(function () {
            window.MM.activity.log('date', 'Changed a proposal date', {
              jobId: o.id,
              jobName: (o.contact && o.contact.name) || o.name,
              detail: old + ' to ' + next,
            });
            redraw(o);
          })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not save: ' + e.message);
          });
      });
    });

    document.querySelectorAll('[data-pdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.getAttribute('data-pdel');
        if (!window.confirm('Remove the proposal recorded on ' +
                            fmtLong(d) + '?')) return;

        b.disabled = true;
        showError('');
        writeLog(o, loggedDates(o).filter(function (x) { return x !== d; }), null)
          .then(function () {
            window.MM.activity.log('date', 'Removed a proposal date', {
              jobId: o.id,
              jobName: (o.contact && o.contact.name) || o.name,
              detail: d,
            });
            redraw(o);
          })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not save: ' + e.message);
          });
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
