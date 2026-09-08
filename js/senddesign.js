// js/senddesign.js
// Emailing the design, and optionally the quote, to the customer.
//
// The client used to send this from his own inbox and then record the date by
// hand. Two problems with that: the date got forgotten, and GoHighLevel never
// saw the email -- so it could not tell whether the customer had replied, and
// could not chase them if they had not.
//
// Sending through GoHighLevel fixes both. The email lands in the customer's
// conversation, the date is recorded because sending IS the action, and the
// stage moves on its own.
//
// The files travel as LINKS rather than attachments. They already live in
// GoHighLevel from the Documents panel, so the link cannot break when someone
// renames a file, and a large drawing cannot bounce the email.
//
// Admin only, and deliberately one customer at a time: there is no bulk send
// here and there should not be.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var job = null;
  var contact = null;
  var files = [];        // documents on this job
  var chosen = {};       // file id -> included in the email
  var sending = false;
  var onSent = null;

  // What this email contains. The design and the quote go out separately as
  // often as together -- sometimes the drawings first and the price after a
  // conversation, sometimes both at once -- so this is a choice, not a
  // sequence of two steps.
  var KINDS = [
    { v: 'design', label: 'The design' },
    { v: 'quote', label: 'The quote' },
    { v: 'both', label: 'Both' },
  ];
  var kind = 'design';

  // ---- Reading the job's files ---------------------------------------------

  function labelOf(rec) {
    var n = U.pv(rec, 'name') || 'Untitled';
    var i = n.indexOf(' - ');
    return i < 0 ? n : n.slice(i + 3).trim() || n;
  }

  function urlOf(rec) { return U.pv(rec, 'file_url') || ''; }

  function loadFiles() {
    return Promise.all([
      api.queryMediaByField(api.PHOTO, 'job_id', job.id).catch(function () { return []; }),
      api.queryMediaByField(api.VIDEO, 'job_id', job.id).catch(function () { return []; }),
    ]).then(function (res) {
      files = (res[0] || []).concat(res[1] || []).filter(function (r) {
        return urlOf(r);
      });
      return files;
    });
  }

  // ---- The default wording -------------------------------------------------
  //
  // Rewritten from the template every time the box opens. An edit made for one
  // customer should not quietly become the wording for the next.

  function firstName() {
    var n = (contact && contact.firstName) || '';
    if (n) return U.titleCase(n);
    var full = (contact && contact.name) || '';
    return U.titleCase(full.split(' ')[0] || 'there');
  }

  function addressOf() {
    return api.oppField(job, api.ADDR_FIELD_ID) || '';
  }

  // The saved template for this kind, with the customer's details filled in.
  // Editable in Settings, so the wording changes without a deploy.
  function templateFor(k) {
    return window.MM.emailtpl.forKind(k, {
      name: firstName(),
      address: addressOf(),
    });
  }

  function subjectFor(k) { return templateFor(k).subject; }
  function bodyFor(k) { return templateFor(k).body; }

  // ---- The form ------------------------------------------------------------

  function open(o, c, after) {
    job = o;
    contact = c || (o && o.contact) || {};
    onSent = after || null;
    chosen = {};
    sending = false;

    var el = document.getElementById('mm-sd-body');
    el.innerHTML = '<div class="mm-empty">Loading the files on this job...</div>';
    document.getElementById('mm-sd-error').textContent = '';

    // The modal is reused, so the send button carries over whatever state the
    // last send left on it. Reset here or a second send opens already
    // disabled and still reading "Sending...".
    var btn = document.getElementById('mm-sd-send');
    btn.disabled = false;
    btn.textContent = 'Send email';

    document.getElementById('mm-modal-senddesign').classList.add('open');

    Promise.all([loadFiles(), window.MM.emailtpl.load()])
      .then(render)
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function render() {
    var el = document.getElementById('mm-sd-body');
    if (!el) return;

    el.innerHTML =
      // Who it is going to, stated plainly. Nobody should have to guess which
      // address an email is about to leave for.
      '<div class="mm-sd-to">' +
        '<span class="mm-sd-tolabel">To</span>' +
        '<span class="mm-sd-toval">' +
          U.esc(contact.email || 'No email address on this customer') +
        '</span>' +
      '</div>' +

      '<div class="mm-sd-kind">' +
        '<div class="mm-sd-kindhead">What are you sending?</div>' +
        '<div class="mm-sd-kinds">' +
          KINDS.map(function (k) {
            return '<label class="mm-sd-kindopt' +
                (kind === k.v ? ' is-on' : '') + '">' +
              '<input type="radio" name="mm-sd-kind" value="' + k.v + '"' +
                (kind === k.v ? ' checked' : '') + '>' +
              '<span>' + U.esc(k.label) + '</span>' +
            '</label>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-sd-subject">Subject</label>' +
        '<input class="mm-input" id="mm-sd-subject" value="' +
          U.esc(subjectFor(kind)) + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-sd-msg">Message</label>' +
        '<textarea class="mm-input mm-sd-msg" id="mm-sd-msg" rows="9">' +
          U.esc(bodyFor(kind)) + '</textarea>' +
      '</div>' +

      fileList() +
      '<p class="mm-sd-note">The files are sent as links. They stay stored in ' +
        'GoHighLevel, so the links keep working.</p>';

    bind(el);
  }

  function fileList() {
    if (!files.length) {
      return '<div class="mm-sd-files">' +
        '<div class="mm-sd-fileshead">Files to include</div>' +
        '<p class="mm-sd-empty">No files on this job yet.</p>' +
        uploadRow() +
      '</div>';
    }
    return '<div class="mm-sd-files">' +
      '<div class="mm-sd-fileshead">Files to include</div>' +
      files.map(function (f) {
        return '<label class="mm-sd-file">' +
          '<input type="checkbox" data-file="' + U.esc(f.id) + '"' +
            (chosen[f.id] ? ' checked' : '') + '>' +
          '<span class="mm-sd-filename">' + U.esc(labelOf(f)) + '</span>' +
        '</label>';
      }).join('') +
      uploadRow() +
    '</div>';
  }

  // Uploading here saves a trip to Documents and back. The file lands on the
  // job like any other, so it is still there afterwards -- this is a shortcut
  // to the same place, not a separate store.
  function uploadRow() {
    return '<div class="mm-sd-upload">' +
      '<button type="button" class="mm-btn-sm mm-btn-secondary" id="mm-sd-pick">' +
        'Upload from this computer</button>' +
      '<span class="mm-sd-uploading" id="mm-sd-uploading"></span>' +
      '<input type="file" id="mm-sd-fileinput" multiple ' +
        'accept="application/pdf,image/*" hidden>' +
    '</div>';
  }

  function bind(el) {
    // Changing what is being sent rewrites the subject and message, rather
    // than leaving a note about drawings on an email carrying a price.
    el.querySelectorAll('input[name="mm-sd-kind"]').forEach(function (r) {
      r.addEventListener('change', function () {
        kind = r.value;
        render();
      });
    });

    el.querySelectorAll('[data-file]').forEach(function (b) {
      b.addEventListener('change', function () {
        chosen[b.getAttribute('data-file')] = b.checked;
      });
    });

    var pick = el.querySelector('#mm-sd-pick');
    var input = el.querySelector('#mm-sd-fileinput');
    if (pick && input) {
      pick.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var list = Array.prototype.slice.call(input.files || []);
        if (list.length) uploadFiles(list);
      });
    }
  }

  // Uploaded one at a time rather than all at once: the proxy has a size
  // limit per request, and one failure should not lose the rest.
  function uploadFiles(list) {
    var note = document.getElementById('mm-sd-uploading');
    var pick = document.getElementById('mm-sd-pick');
    var done = 0, failed = [];

    if (pick) pick.disabled = true;
    function say(t) { if (note) note.textContent = t; }
    say('Uploading 1 of ' + list.length + '...');

    return list.reduce(function (chain, file) {
      return chain.then(function () {
        return api.uploadMediaFile(file)
          .then(function (url) {
            return api.createPhotoOrVideo(
              /^video\//.test(file.type) ? api.VIDEO : api.PHOTO,
              'Design' + ' - ' + file.name,
              url,
              job.id,          // job only: no room, no wall
              null, null
            );
          })
          .then(function (rec) {
            done++;
            // Ticked straight away: a file uploaded here was uploaded to be
            // sent, so making someone tick it again is a pointless step.
            if (rec && rec.id) chosen[rec.id] = true;
            if (done < list.length) say('Uploading ' + (done + 1) + ' of ' + list.length + '...');
          })
          .catch(function (e) { failed.push(file.name + ': ' + e.message); });
      });
    }, Promise.resolve())
      .then(function () {
        say('');
        if (pick) pick.disabled = false;
        // Re-read so the new files appear in the list with their real ids.
        return loadFiles().then(function () {
          render();
          if (failed.length) {
            var err = document.getElementById('mm-sd-error');
            if (err) err.textContent = 'Could not upload: ' + failed.join('; ');
          }
        });
      });
  }

  function close() {
    document.getElementById('mm-modal-senddesign').classList.remove('open');
    var btn = document.getElementById('mm-sd-send');
    if (btn) { btn.disabled = false; btn.textContent = 'Send email'; }
    sending = false;
    job = null;
    contact = null;
    files = [];
    chosen = {};
  }

  // ---- Sending -------------------------------------------------------------

  // Plain text becomes simple HTML: the message is typed in a textarea, so its
  // line breaks are all the formatting there is.
  function toHtml(text, picked) {
    var body = String(text || '').split(/\n\n+/).map(function (para) {
      return '<p>' + U.esc(para).replace(/\n/g, '<br>') + '</p>';
    }).join('');

    if (picked.length) {
      body += '<p><strong>Your files</strong></p><ul>' +
        picked.map(function (f) {
          return '<li><a href="' + U.esc(urlOf(f)) + '">' +
            U.esc(labelOf(f)) + '</a></li>';
        }).join('') + '</ul>';
    }
    return body;
  }

  function send() {
    if (!job || sending) return;
    var err = document.getElementById('mm-sd-error');
    var btn = document.getElementById('mm-sd-send');

    if (!contact.email) {
      err.textContent = 'This customer has no email address. Add one on the ' +
        'job first, using the pencil on Job details.';
      return;
    }

    var subject = (document.getElementById('mm-sd-subject').value || '').trim();
    if (!subject) {
      err.textContent = 'The email needs a subject.';
      return;
    }
    var msg = document.getElementById('mm-sd-msg').value || '';
    var picked = files.filter(function (f) { return chosen[f.id]; });
    var sentKind = kind;

    sending = true;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    err.textContent = '';

    var jobId = job.id;
    // Read before the send so the stage decision is made on what was true
    // when the button was pressed.
    var alreadyEmailing = job.pipelineStageId === api.STAGE.emailCustomer;

    api.sendEmailToContact(contact.id, subject, toHtml(msg, picked))
      .then(function () {
        // Written only after the email actually left. A log line recorded
        // before a failed send would claim something that never happened.
        return appendLog(jobId, sentKind, subject);
      })
      .then(function () {
        // The job moves here on the FIRST email and then stays, however many
        // follow. Where it goes next depends on what the customer says, which
        // a person reads and decides -- not something a send can know.
        if (alreadyEmailing) return null;
        return api.setOpportunityStage(jobId, api.STAGE.emailCustomer);
      })
      .then(function () {
        window.MM.activity.log('note',
          'Emailed ' + kindLabel(sentKind) + ' to ' +
          (contact.email || 'the customer'),
          { jobId: jobId, jobName: job.name });
        sending = false;
        close();
        if (onSent) onSent();
      })
      .catch(function (e) {
        sending = false;
        btn.disabled = false;
        btn.textContent = 'Send email';
        err.textContent = 'Could not send: ' + e.message;
      });
  }

  // One line per email, newest last, on the job itself. A date field could
  // hold only the most recent send and could not say what was in it.
  //
  //   2026-09-08|design|Your design - 108 teal lane
  function appendLog(jobId, k, subject) {
    return api.getOpportunity(jobId)
      .then(function (fresh) {
        var existing = fresh ? (api.oppField(fresh, api.DATE_FIELD_IDS.emailLog) || '') : '';
        var line = [todayStr(), k, clean(subject)].join('|');
        var next = existing ? existing + '\n' + line : line;
        return api.setOpportunityField(jobId, api.DATE_FIELD_IDS.emailLog, next);
      })
      // A log that fails to save must not fail the send: the email has gone,
      // and saying otherwise would be worse than a missing line.
      .catch(function () { return null; });
  }

  // A pipe or newline would break the one-per-line format.
  function clean(v) { return String(v || '').replace(/[|\r\n]/g, ' ').trim(); }

  function kindLabel(k) {
    return k === 'both' ? 'the design and quote'
      : k === 'quote' ? 'the quote'
      : 'the design';
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ---- Wiring --------------------------------------------------------------

  function init() {
    var cancel = document.getElementById('mm-sd-cancel');
    if (cancel) cancel.addEventListener('click', close);

    var sendBtn = document.getElementById('mm-sd-send');
    if (sendBtn) sendBtn.addEventListener('click', send);

    var overlay = document.getElementById('mm-modal-senddesign');
    if (overlay) overlay.addEventListener('click', function (e) {
      // Not while sending: closing mid-request would hide whether it worked.
      if (e.target === overlay && !sending) close();
    });
  }

  window.MM.senddesign = {
    init: init,
    open: open,
    canSend: function () { return auth.isAdmin(); },
  };
})();
