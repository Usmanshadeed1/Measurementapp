// js/jobedit.js
// Editing the customer's details from inside a job.
//
// The details shown on a job come from two different records, and the
// difference matters when they are changed:
//
//   Name, phone, email   the CONTACT. One contact can have several jobs, so a
//                        correction here shows up on all of them — which is
//                        usually the point, a wrong phone number is wrong
//                        everywhere.
//   Property address     the OPPORTUNITY. Each job is a different property,
//                        so this one belongs to the job alone.
//
// The form says which is which rather than leaving someone to find out by
// changing a phone number and seeing it move on another job.
//
// Renaming the customer also renames the job, because a job is titled
// "Customer - Address" and would otherwise keep the old spelling forever.
//
// Admin only, matching the Contacts page: a worker changing a customer's
// phone number is not something the business would want.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var job = null;        // the opportunity being edited
  var contact = null;    // its contact
  var onSaved = null;

  // ---- Reading -------------------------------------------------------------

  // The contact's own address, assembled the way the Contacts page shows it.
  // Used as a fallback: a job with no property address of its own is almost
  // always at the customer's address, and showing a blank hides something the
  // app already knows.
  function contactAddress(c) {
    if (!c) return '';
    var cityLine = [c.city, c.state].filter(Boolean).join(', ');
    if (c.postalCode) cityLine = (cityLine + ' ' + c.postalCode).trim();
    return [c.address1, cityLine, c.country].filter(Boolean).join(', ');
  }

  // ---- The form ------------------------------------------------------------

  function open(o, c, after) {
    job = o;
    contact = c || {};
    onSaved = after || null;

    var f = document.getElementById('mm-je-form');
    f.innerHTML =
      group('The customer',
        'Shared with every job for this customer, so a change here applies to ' +
        'all of them.',
        field('mm-je-first', 'First name', contact.firstName || '') +
        field('mm-je-last', 'Last name', contact.lastName || '') +
        field('mm-je-phone', 'Phone', contact.phone || '', 'tel') +
        field('mm-je-email', 'Email', contact.email || '', 'email')) +
      group('This job',
        'The property being worked on. Only this job uses it.',
        field('mm-je-addr', 'Property address',
          api.oppField(job, api.ADDR_FIELD_ID) || '') +
        hint());

    document.getElementById('mm-je-error').textContent = '';
    var btn = document.getElementById('mm-je-save');
    btn.disabled = false;
    btn.textContent = 'Save changes';

    document.getElementById('mm-modal-jobedit').classList.add('open');
    document.getElementById('mm-je-first').focus();
  }

  // Offered when the job has no address but the customer does: the usual case
  // is a job created before the address was filled in.
  function hint() {
    var have = api.oppField(job, api.ADDR_FIELD_ID);
    var fromContact = contactAddress(contact);
    if (have || !fromContact) return '';
    return '<button type="button" class="mm-je-use" id="mm-je-use">' +
      'Use the customer address: ' + U.esc(fromContact) + '</button>';
  }

  function group(title, note, body) {
    return '<div class="mm-je-group">' +
      '<div class="mm-je-grouphead">' + U.esc(title) + '</div>' +
      '<p class="mm-je-groupnote">' + U.esc(note) + '</p>' +
      body +
    '</div>';
  }

  function field(id, label, val, type) {
    return '<div class="mm-field-group">' +
      '<label class="mm-label" for="' + id + '">' + U.esc(label) + '</label>' +
      '<input class="mm-input" id="' + id + '"' +
        (type ? ' type="' + type + '"' : '') +
        ' value="' + U.esc(val) + '"></div>';
  }

  function close() {
    document.getElementById('mm-modal-jobedit').classList.remove('open');
    job = null;
    contact = null;
  }

  // ---- Saving --------------------------------------------------------------

  function save() {
    if (!job) return;
    var btn = document.getElementById('mm-je-save');
    var err = document.getElementById('mm-je-error');
    var v = function (id) { return (document.getElementById(id).value || '').trim(); };

    var first = v('mm-je-first');
    if (!first) {
      err.textContent = 'A first name is required.';
      document.getElementById('mm-je-first').focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';
    err.textContent = '';

    var addr = v('mm-je-addr');
    var name = [first, v('mm-je-last')].filter(Boolean).join(' ');

    // Every field is sent, including empty ones, so clearing a value in the
    // form actually clears it in GoHighLevel rather than silently keeping the
    // old one.
    var fields = {
      firstName: first,
      lastName: v('mm-je-last'),
      phone: v('mm-je-phone'),
      email: v('mm-je-email'),
    };

    var jobId = job.id;
    var contactId = contact.id;
    var oldAddr = api.oppField(job, api.ADDR_FIELD_ID) || '';

    var work = [api.updateContact(contactId, fields)];

    // Only written when it actually changed: every avoidable write to live
    // data is one that cannot go wrong.
    if (addr !== oldAddr) {
      work.push(api.setOpportunityField(jobId, api.ADDR_FIELD_ID, addr));
    }

    // The job is titled "Customer - Address", so it goes stale the moment
    // either half is corrected.
    var title = [U.titleCase(name), addr].filter(Boolean).join(' - ');
    if (title && title !== job.name) {
      work.push(api.renameOpportunity(jobId, title));
    }

    Promise.all(work)
      .then(function () {
        window.MM.activity.log('note', 'Updated customer details for ' + name, {
          jobId: jobId, jobName: title || job.name,
        });
        close();
        if (onSaved) onSaved();
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Save changes';
        err.textContent = 'Could not save: ' + e.message;
      });
  }

  // ---- Wiring --------------------------------------------------------------

  function init() {
    var cancel = document.getElementById('mm-je-cancel');
    if (cancel) cancel.addEventListener('click', close);

    var saveBtn = document.getElementById('mm-je-save');
    if (saveBtn) saveBtn.addEventListener('click', save);

    var overlay = document.getElementById('mm-modal-jobedit');
    if (overlay) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    // The "use the customer address" button lives inside the form, which is
    // rebuilt each time it opens, so it is caught here rather than bound.
    var form = document.getElementById('mm-je-form');
    if (form) form.addEventListener('click', function (e) {
      if (!e.target || e.target.id !== 'mm-je-use') return;
      var box = document.getElementById('mm-je-addr');
      box.value = contactAddress(contact);
      e.target.remove();
      box.focus();
    });
  }

  window.MM.jobedit = {
    init: init,
    open: open,
    contactAddress: contactAddress,
    canEdit: function () { return auth.isAdmin(); },
  };
})();
