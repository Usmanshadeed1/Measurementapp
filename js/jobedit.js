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

    // The job's own address if it has one, otherwise the customer's, already
    // filled in. Asking someone to retype an address the app can see, or to
    // press a button to accept it, is work for no reason.
    var addr = api.oppField(job, api.ADDR_FIELD_ID) || contactAddress(contact);

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
        field('mm-je-addr', 'Property address', addr));

    document.getElementById('mm-je-error').textContent = '';
    var btn = document.getElementById('mm-je-save');
    btn.disabled = false;
    btn.textContent = 'Save changes';

    document.getElementById('mm-modal-jobedit').classList.add('open');
    document.getElementById('mm-je-first').focus();
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
    // either half is corrected. Renamed only when BOTH halves are present:
    // with an empty address the title would collapse to the bare name and the
    // address in it would be lost for good.
    var newName = '';
    if (addr) {
      newName = U.titleCase(name) + ' - ' + addr;
      if (newName !== job.name) work.push(api.renameOpportunity(jobId, newName));
    }

    Promise.all(work)
      .then(function () {
        window.MM.activity.log('note', 'Updated customer details for ' + name, {
          jobId: jobId, jobName: newName || job.name,
        });
        // Read back rather than trusting the form: GoHighLevel reformats
        // phone numbers, and the panel should show what was actually stored.
        return Promise.all([
          api.getOpportunity(jobId).catch(function () { return null; }),
          api.getContact(contactId).catch(function () { return null; }),
        ]);
      })
      .then(function (fresh) {
        close();
        if (onSaved) onSaved(fresh[0], fresh[1]);
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
  }

  window.MM.jobedit = {
    init: init,
    open: open,
    contactAddress: contactAddress,
    canEdit: function () { return auth.isAdmin(); },
  };
})();
