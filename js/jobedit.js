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

  // The customer's street line, used when a job has no property address of
  // its own. Only the street: a job is titled and identified by it, and the
  // town, postcode and country are noise everywhere this appears.
  function contactAddress(c) {
    return c && c.address1 ? String(c.address1).trim() : '';
  }


  // Jobs are titled "Customer - Address", and the workflow that creates them
  // fills the title but not the address field.
  function addressInName(o) {
    var n = (o && o.name) || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ').slice(1).join(' - ').trim() : '';
  }

  // ---- The form ------------------------------------------------------------

  function open(o, c, after) {
    job = o;
    contact = c || {};
    onSaved = after || null;

    // The job's own address, split the way an address form splits one.
    var parts = api.jobAddressParts(job);

    // A street the job does not have yet: the one inside its name, which is
    // where the GoHighLevel workflow puts it, and only then the customer's
    // own. A second job is usually at a different property, so the contact's
    // address is the last resort rather than the first.
    if (!parts.street) {
      parts.street = addressInName(job) ||
        (contact.address1 ? String(contact.address1).trim() : '');
    }

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
        'The property being worked on. Only this job uses it. The job is ' +
        'named after the street, so the rest stays out of its title.',
        field('mm-je-addr', 'Street address', parts.street) +
        field('mm-je-city', 'City', parts.city) +
        field('mm-je-state', 'State', parts.state) +
        field('mm-je-postal', 'Postal code', parts.postal));

    document.getElementById('mm-je-error').textContent = '';
    var btn = document.getElementById('mm-je-save');
    btn.disabled = false;
    btn.textContent = 'Save changes';

    document.getElementById('mm-modal-jobedit').classList.add('open');
    // The address box is built fresh each time this opens, so suggestions are
    // attached to the new one. Does nothing when no key is saved.
    if (window.MM.addressauto) window.MM.addressauto.attach('mm-je-addr');
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

    var parts = {
      street: v('mm-je-addr'),
      city: v('mm-je-city'),
      state: v('mm-je-state'),
      postal: v('mm-je-postal'),
    };
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
    var was = api.jobAddressParts(job);

    var work = [api.updateContact(contactId, fields)];

    // Only written when something actually changed: every avoidable write to
    // live data is one that cannot go wrong. All four go in one call, so a
    // half-written address is not possible.
    var addrChanged = parts.street !== was.street || parts.city !== was.city ||
      parts.state !== was.state || parts.postal !== was.postal;
    if (addrChanged) work.push(api.setJobAddress(jobId, parts));

    // The job is titled "Customer - Street", so it goes stale the moment
    // either half is corrected. The street is its own field now, so there is
    // nothing to cut out of a longer address -- and a GoHighLevel workflow
    // can build exactly the same title by copying that one field.
    //
    // Clearing the street gives the bare customer name, with no trailing
    // dash. An earlier version refused to rename at all when the address was
    // empty, to avoid titles like "Peace - " -- but that meant a cleared
    // address left the old one sitting in the title, which is worse: the job
    // then claims a property it is no longer for.
    var street = parts.street;
    var newName = street
      ? U.titleCase(name) + ' - ' + street
      : U.titleCase(name);
    if (newName !== job.name) work.push(api.renameOpportunity(jobId, newName));

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
