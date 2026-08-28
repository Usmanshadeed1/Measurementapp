// js/meetings.js
// Design meetings on a job.
//
// A design review is rarely one meeting. The customer sees the drawings, asks
// for changes, and comes back — sometimes three or four times. A single date
// field can only hold the last one, which loses the fact that a customer
// needed four visits to agree. That history is worth keeping.
//
// So the meetings live in one multi-line field on the opportunity, one per
// line, newest shown first:
//
//   2026-09-04|14:00|First design review
//   2026-09-11|10:00|Showed revised layout
//
// A GoHighLevel DATE field cannot hold a time, which is the other reason for
// storing them as text: a meeting without a time is not much use.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var FIELD_ID = 'FqK5INgQVhb1CAB6b1DX';   // Opportunity -> Design Meetings
  var SEP = '|';

  var currentJob = null;
  var meetings = [];
  var adding = false;
  var saving = false;
  var showAll = false;

  // ---- Reading and writing -------------------------------------------------

  function parse(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var p = raw.split(SEP);
      out.push({
        date: (p[0] || '').trim(),
        time: (p[1] || '').trim(),
        note: (p[2] || '').trim(),
      });
    });
    // Newest first: the next meeting is the one that matters day to day.
    return out.sort(function (a, b) {
      return (b.date + b.time).localeCompare(a.date + a.time);
    });
  }

  function serialise(rows) {
    return rows.map(function (m) {
      return [m.date, m.time, m.note].join(SEP);
    }).join('\n');
  }

  function save(logText) {
    saving = true;
    render();
    return api.setOpportunityField(currentJob.id, FIELD_ID, serialise(meetings))
      .then(function () {
        saving = false;
        adding = false;
        if (logText) {
          window.MM.activity.log('date', logText, {
            jobId: currentJob.id, jobName: jobLabel(currentJob),
          });
        }
        render();
      })
      .catch(function (e) {
        saving = false;
        render();
        showError('Could not save: ' + e.message);
      });
  }

  function showError(msg) {
    var el = document.getElementById('mm-dm-error');
    if (el) el.textContent = msg || '';
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  // ---- Formatting ----------------------------------------------------------

  function fmtDate(v) {
    if (!v) return '';
    var p = String(v).split('-');
    if (p.length !== 3) return v;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? v
      : d.toLocaleDateString(undefined,
          { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // 14:00 -> 2:00pm. Written the way it would be said out loud.
  function fmtTime(v) {
    if (!v) return '';
    var p = String(v).split(':');
    if (p.length < 2) return v;
    var h = +p[0], m = p[1];
    if (isNaN(h)) return v;
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ampm;
  }

  function whenText(m) {
    return [fmtDate(m.date), fmtTime(m.time)].filter(Boolean).join(', ');
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function isPast(m) {
    if (!m.date) return false;
    var p = m.date.split('-');
    if (p.length !== 3) return false;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    return d < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // ---- Loading -------------------------------------------------------------

  function showForJob(job) {
    currentJob = job;
    meetings = [];
    adding = false; showAll = false;

    var el = document.getElementById('mm-job-meetings');
    if (!el) return Promise.resolve();
    el.innerHTML = head(0) + '<div class="mm-empty">Loading...</div>';

    return api.getOpportunity(job.id)
      .then(function (opp) {
        meetings = parse(opp ? api.oppField(opp, FIELD_ID) : '');
        render();
      })
      .catch(function (e) {
        el.innerHTML = head(0) + '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function head(n) {
    return '<div class="mm-steps-head">' +
      '<span class="mm-steps-title">Design Meetings</span>' +
      (n
        ? '<span class="mm-steps-badge mm-steps-badge-done">' + n +
          (n === 1 ? ' meeting' : ' meetings') + '</span>'
        : '<span class="mm-steps-badge mm-steps-badge-todo">None yet</span>') +
    '</div>';
  }

  // ---- Rendering -----------------------------------------------------------
  //
  // Only the latest meeting is shown by default. That is the one being worked
  // towards; the earlier ones are history, one tap away.

  function render() {
    var el = document.getElementById('mm-job-meetings');
    if (!el) return;

    var latest = meetings[0];
    var rest = meetings.slice(1);

    el.innerHTML =
      head(meetings.length) +
      (adding ? '' :
        '<div class="mm-dm-actions">' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-dm-add">+ Add Meeting</button>' +
        '</div>') +
      (adding ? form() : '') +
      (latest
        ? '<div class="mm-dm-latest">' +
            '<div class="mm-dm-label">Latest meeting</div>' +
            row(latest, 0) +
          '</div>' +
          (rest.length
            ? '<button type="button" class="mm-dm-more" id="mm-dm-toggle">' +
                (showAll ? 'Hide earlier meetings'
                         : 'Show ' + rest.length + ' earlier meeting' +
                           (rest.length === 1 ? '' : 's')) +
              '</button>' +
              (showAll
                ? '<div class="mm-dm-earlier">' +
                    rest.map(function (m, i) { return row(m, i + 1); }).join('') +
                  '</div>'
                : '')
            : '')
        : (adding ? '' : '<p class="mm-task-empty">No meetings booked yet.</p>')) +
      '<p class="mm-task-error" id="mm-dm-error" role="alert"></p>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function row(m, i) {
    return '<div class="mm-dm' + (isPast(m) ? ' is-past' : '') + '">' +
      '<div class="mm-dm-main">' +
        '<div class="mm-dm-when">' + U.esc(whenText(m) || 'No date') + '</div>' +
        (m.note ? '<div class="mm-dm-note">' + U.esc(m.note) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="mm-dm-del" data-del="' + i + '" ' +
        'aria-label="Remove this meeting">&times;</button>' +
    '</div>';
  }

  function form() {
    return '<div class="mm-dm-form">' +
      '<div class="mm-dm-row">' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-dm-date">Date</label>' +
          '<input class="mm-input" type="date" id="mm-dm-date" value="' +
            todayStr() + '">' +
        '</div>' +
        '<div class="mm-field-group">' +
          '<label class="mm-label" for="mm-dm-time">Time</label>' +
          '<input class="mm-input" type="time" id="mm-dm-time">' +
        '</div>' +
      '</div>' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-dm-note">Note ' +
          '<span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-dm-note" ' +
          'placeholder="e.g. Showed revised layout">' +
      '</div>' +
      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-dm-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-dm-save"' +
          (saving ? ' disabled' : '') + '>' +
          (saving ? 'Saving...' : 'Add meeting') + '</button>' +
      '</div>' +
    '</div>';
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var add = el.querySelector('#mm-dm-add');
    if (add) add.addEventListener('click', function () {
      adding = true; render();
      var f = document.getElementById('mm-dm-date');
      if (f) f.focus();
    });

    var cancel = el.querySelector('#mm-dm-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; render();
    });

    var toggle = el.querySelector('#mm-dm-toggle');
    if (toggle) toggle.addEventListener('click', function () {
      showAll = !showAll; render();
    });

    var save2 = el.querySelector('#mm-dm-save');
    if (save2) save2.addEventListener('click', addMeeting);

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-del');
        var gone = meetings[i];
        if (!gone) return;
        meetings.splice(i, 1);
        save('Removed design meeting ' + whenText(gone));
      });
    });
  }

  function addMeeting() {
    var date = document.getElementById('mm-dm-date').value;
    if (!date) {
      showError('Pick a date for the meeting.');
      document.getElementById('mm-dm-date').focus();
      return;
    }
    var m = {
      date: date,
      time: document.getElementById('mm-dm-time').value || '',
      // A pipe or newline would break the one-line-per-meeting format.
      note: (document.getElementById('mm-dm-note').value || '')
        .replace(/[|\r\n]/g, ' ').trim(),
    };
    showError('');
    meetings.push(m);
    meetings = parse(serialise(meetings));   // re-sort, newest first
    save('Design meeting booked for ' + whenText(m));
  }

  window.MM.meetings = { showForJob: showForJob };
})();
