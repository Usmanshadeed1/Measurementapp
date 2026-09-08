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

  function defaultSubject(withQuote) {
    var a = addressOf();
    var what = withQuote ? 'Your design and quote' : 'Your design';
    return a ? what + ' — ' + a : what;
  }

  function defaultBody(withQuote) {
    var a = addressOf();
    var where = a ? ' for ' + a : '';
    return 'Hi ' + firstName() + ',\n\n' +
      (withQuote
        ? 'Please find the drawings and the quote' + where + ' below.\n\n' +
          'Any questions, or anything you would like changed? Happy to talk it ' +
          'through whenever suits you.'
        : 'Please find the drawings' + where + ' below.\n\n' +
          'Any questions, or anything you would like changed? Happy to walk you ' +
          'through them whenever suits you.') +
      '\n\nEddie\nMaximus Construction NJ';
  }

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
    document.getElementById('mm-modal-senddesign').classList.add('open');

    loadFiles().then(render).catch(function (e) {
      el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
    });
  }

  function render() {
    var el = document.getElementById('mm-sd-body');
    if (!el) return;

    var withQuote = document.getElementById('mm-sd-quote');
    withQuote = withQuote ? withQuote.checked : false;

    el.innerHTML =
      // Who it is going to, stated plainly. Nobody should have to guess which
      // address an email is about to leave for.
      '<div class="mm-sd-to">' +
        '<span class="mm-sd-tolabel">To</span>' +
        '<span class="mm-sd-toval">' +
          U.esc(contact.email || 'No email address on this customer') +
        '</span>' +
      '</div>' +

      '<label class="mm-sd-check">' +
        '<input type="checkbox" id="mm-sd-quote"' + (withQuote ? ' checked' : '') + '>' +
        '<span><strong>The quote is included</strong>' +
          '<span class="mm-sd-checknote">Tick this if you are sending the price ' +
          'as well as the drawings.</span></span>' +
      '</label>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-sd-subject">Subject</label>' +
        '<input class="mm-input" id="mm-sd-subject" value="' +
          U.esc(defaultSubject(withQuote)) + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-sd-msg">Message</label>' +
        '<textarea class="mm-input mm-sd-msg" id="mm-sd-msg" rows="9">' +
          U.esc(defaultBody(withQuote)) + '</textarea>' +
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
        '<p class="mm-sd-empty">There are no files on this job yet. Upload the ' +
        'drawings in Documents &amp; Photos first.</p></div>';
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
    '</div>';
  }

  function bind(el) {
    var q = el.querySelector('#mm-sd-quote');
    // Re-rendered so the subject and wording follow the choice, rather than
    // leaving a message about drawings when a quote is included too.
    if (q) q.addEventListener('change', render);

    el.querySelectorAll('[data-file]').forEach(function (b) {
      b.addEventListener('change', function () {
        chosen[b.getAttribute('data-file')] = b.checked;
      });
    });
  }

  function close() {
    document.getElementById('mm-modal-senddesign').classList.remove('open');
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
    var withQuote = document.getElementById('mm-sd-quote').checked;
    var picked = files.filter(function (f) { return chosen[f.id]; });

    sending = true;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    err.textContent = '';

    var today = todayStr();
    var jobId = job.id;

    api.sendEmailToContact(contact.id, subject, toHtml(msg, picked))
      .then(function () {
        // Recorded only after the email actually left. A date written before
        // a failed send would say something happened that did not.
        var work = [
          api.setOpportunityField(jobId, api.DATE_FIELD_IDS.designEmailed, today),
        ];
        if (withQuote) {
          work.push(api.setOpportunityField(jobId, api.DATE_FIELD_IDS.emailQuote, today));
        }
        return Promise.all(work);
      })
      .then(function () {
        // Sending the quote too means the customer now has everything, so the
        // job goes straight to Proposal Sent rather than through Email Quote.
        var stage = withQuote ? api.STAGE.proposalSent : api.STAGE.designEmailed;
        return api.setOpportunityStage(jobId, stage);
      })
      .then(function () {
        window.MM.activity.log('note',
          (withQuote ? 'Emailed the design and quote to ' : 'Emailed the design to ') +
          (contact.email || 'the customer'),
          { jobId: jobId, jobName: job.name });
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
