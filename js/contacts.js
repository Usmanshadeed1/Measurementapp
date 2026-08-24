// js/contacts.js
// Contacts tab: read-only list (search + columns) and a detail view.
// Wired into app.js the same way Jobs are — this module just exposes
// loadContacts()/pickContact() and app.js calls them on nav/boot.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  function fmtTags(tags) {
    if (!tags || !tags.length) return '';
    return tags.join(', ');
  }
  function fmtBusiness(c) {
    return c.companyName || (c.businessName) || '';
  }
  function fmtAddress(c) {
    var line1 = c.address1 || '';
    var cityStateZip = [c.city, c.state].filter(Boolean).join(', ') + (c.postalCode ? ' ' + c.postalCode : '');
    var parts = [line1, cityStateZip.trim(), c.country].filter(Boolean);
    return parts.join(', ');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  var lastPick = null;

  function loadContacts(query, onPickContact) {
    var el = document.getElementById('mm-contacts-list');
    if (onPickContact) lastPick = onPickContact;
    el.innerHTML = '<div class="mm-empty">Loading contacts...</div>';
    api.searchContacts(query).then(function (contacts) {
      if (!contacts.length) { el.innerHTML = '<div class="mm-empty">No contacts found.</div>'; return; }
      el.innerHTML = '';
      contacts.forEach(function (c) {
        var name = U.titleCase(c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name) || 'Unnamed Contact';
        var subParts = [U.phone(c.phone), c.email].filter(Boolean);
        var business = fmtBusiness(c);
        if (business) subParts.push(business);

        var item = document.createElement('div'); item.className = 'mm-acc';
        var hdr = document.createElement('div'); hdr.className = 'mm-acc-hdr';
        hdr.setAttribute('role', 'button'); hdr.setAttribute('tabindex', '0');
        hdr.innerHTML =
          '<div class="mm-acc-hdr-text"><div class="mm-acc-title">' + U.esc(name) + '</div>' +
          '<div class="mm-acc-sub">' + U.esc(subParts.join(' · ') || 'No contact info on file') + '</div></div>' +
          '<span class="mm-acc-arrow" aria-hidden="true">&#8250;</span>';
        hdr.addEventListener('click', function () { onPickContact(c); });
        hdr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickContact(c); } });
        item.appendChild(hdr); el.appendChild(item);
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  function field(label, value) {
    if (!value) return '';
    return '<div class="mm-field-display"><div class="flabel">' + U.esc(label) + '</div><div class="fvalue">' + U.esc(value) + '</div></div>';
  }

  // Same row, but the value is HTML that has already been escaped by its
  // builder. Kept separate so field() above goes on escaping unconditionally.
  function fieldHtml(label, html) {
    if (!html) return '';
    return '<div class="mm-field-display"><div class="flabel">' + U.esc(label) +
      '</div><div class="fvalue">' + html + '</div></div>';
  }

  // ---- Editing a contact ---------------------------------------------------
  //
  // Admin only: a worker changing a customer's phone number is not something
  // the business would want, and the database enforces the same split.

  var editingContact = null;
  var onSaved = null;

  function openEdit(c) {
    editingContact = c;
    var f = document.getElementById('mm-ce-form');
    f.innerHTML =
      field('mm-ce-first', 'First name', c.firstName || '') +
      field('mm-ce-last', 'Last name', c.lastName || '') +
      field('mm-ce-phone', 'Phone', c.phone || '', 'tel') +
      field('mm-ce-email', 'Email', c.email || '', 'email') +
      field('mm-ce-address', 'Street address', c.address1 || '') +
      field('mm-ce-city', 'City', c.city || '') +
      field('mm-ce-state', 'State', c.state || '') +
      field('mm-ce-postal', 'Postal code', c.postalCode || '');
    document.getElementById('mm-ce-error').textContent = '';
    var btn = document.getElementById('mm-ce-save');
    btn.disabled = false; btn.textContent = 'Save changes';
    document.getElementById('mm-modal-contactedit').classList.add('open');
    document.getElementById('mm-ce-first').focus();

    function field(id, label, val, type) {
      return '<div class="mm-field-group">' +
        '<label class="mm-label" for="' + id + '">' + U.esc(label) + '</label>' +
        '<input class="mm-input" id="' + id + '"' + (type ? ' type="' + type + '"' : '') +
        ' value="' + U.esc(val) + '"></div>';
    }
  }

  function closeEdit() {
    document.getElementById('mm-modal-contactedit').classList.remove('open');
    editingContact = null;
  }

  function saveEdit() {
    if (!editingContact) return;
    var btn = document.getElementById('mm-ce-save');
    var err = document.getElementById('mm-ce-error');
    var v = function (id) { return (document.getElementById(id).value || '').trim(); };

    var first = v('mm-ce-first');
    if (!first) { err.textContent = 'A first name is required.'; return; }

    btn.disabled = true; btn.textContent = 'Saving...';
    err.textContent = '';

    // Every field is sent, including empty ones, so clearing a value in the
    // form actually clears it in GHL rather than silently keeping the old one.
    var fields = {
      firstName: first,
      lastName: v('mm-ce-last'),
      phone: v('mm-ce-phone'),
      email: v('mm-ce-email'),
      address1: v('mm-ce-address'),
      city: v('mm-ce-city'),
      state: v('mm-ce-state').toUpperCase(),
      postalCode: v('mm-ce-postal'),
    };

    api.updateContact(editingContact.id, fields)
      .then(function (updated) {
        closeEdit();
        // Re-read rather than trusting the form: GHL normalises phone numbers
        // and may reformat what was typed.
        return api.getContact(editingContact ? editingContact.id : updated.id)
          .catch(function () { return updated; });
      })
      .then(function (fresh) {
        if (fresh) renderContactDetail(fresh);
        if (onSaved) onSaved();
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Save changes';
        err.textContent = 'Could not save: ' + e.message;
      });
  }

  function initEdit(afterSave) {
    onSaved = afterSave;
    document.getElementById('mm-ce-save').addEventListener('click', saveEdit);
    document.getElementById('mm-ce-cancel').addEventListener('click', closeEdit);
    document.getElementById('mm-modal-contactedit').addEventListener('click', function (e) {
      if (e.target === this) closeEdit();
    });
  }

  function renderContactDetail(c) {
    var name = U.titleCase(c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name) || 'Unnamed Contact';
    document.getElementById('mm-contact-title').textContent = name;

    // The pencil lives beside the title so it is obvious what it edits.
    var editBtn = document.getElementById('mm-contact-edit');
    if (editBtn) {
      editBtn.style.display = auth.isAdmin() ? '' : 'none';
      editBtn.onclick = function () { openEdit(c); };
    }
    var el = document.getElementById('mm-contact-info');
    var details =
      field('Name', name) +
      fieldHtml('Phone', c.phone
        ? U.esc(U.phone(c.phone)) + U.callButtons(c.phone, c.id)
        : '') +
      field('Email', c.email) +
      field('Business', fmtBusiness(c)) +
      field('Address', fmtAddress(c)) +
      field('Tags', fmtTags(c.tags)) +
      field('Created', fmtDate(c.dateAdded || c.createdAt)) +
      field('Contact ID', c.id);

    // An accordion, matching the job screen: the details are worth having but
    // the customer's jobs are usually what someone came here for.
    el.innerHTML =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Contact details</span>' +
      '</div>' +
      (details || '<div class="mm-empty">No details on file.</div>');
    el.classList.add('mm-steps-card');

    renderJobs(c.id);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels('#screen-contact');
  }

  // ---- This customer's jobs ------------------------------------------------
  //
  // A customer can own several properties, each its own opportunity. Without
  // this you can go job -> customer but not customer -> jobs, which meant
  // going back to the dashboard and searching by name.

  var onOpenJob = null;

  function renderJobs(contactId) {
    var el = document.getElementById('mm-contact-jobs');
    if (!el) return;
    el.innerHTML = '<div class="mm-empty">Loading jobs...</div>';

    var api = window.MM.api;
    api.fetchAllOpportunities()
      .then(function (ops) {
        var mine = (ops || []).filter(function (o) {
          return o.pipelineId === api.SALES_PIPELINE_ID && o.contactId === contactId;
        });

        if (!mine.length) {
          el.innerHTML =
            '<div class="section-header"><span class="section-title">Jobs</span></div>' +
            '<p class="mm-task-empty">This customer has no jobs yet.</p>';
          return;
        }

        // Newest first: the job someone is asking about is usually the
        // current one, not the kitchen they had done three years ago.
        mine.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

        el.innerHTML =
          '<div class="section-header">' +
            '<span class="section-title">Jobs</span>' +
            '<span class="mm-mygroup-count">' + mine.length + '</span>' +
          '</div>' +
          mine.map(function (o) {
            var stage = window.MM.dashboard.stageNameFor(o);
            return '<button type="button" class="mm-myjob" data-job="' + U.esc(o.id) + '">' +
              '<span class="mm-myjob-main">' +
                '<span class="mm-myjob-name">' + U.esc(U.titleCase(o.name) || 'Job') + '</span>' +
                '<span class="mm-myjob-addr">' + U.esc(stage || 'No stage') + '</span>' +
              '</span>' +
              '<span class="mm-jcard-arrow" aria-hidden="true">&#8250;</span>' +
            '</button>';
          }).join('');

        el.querySelectorAll('[data-job]').forEach(function (b) {
          b.addEventListener('click', function () {
            var o = mine.find(function (j) { return j.id === b.getAttribute('data-job'); });
            if (o && onOpenJob) onOpenJob(o);
          });
        });
      })
      .catch(function (e) {
        el.innerHTML = '<div class="section-header"><span class="section-title">Jobs</span></div>' +
                       '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  // GHL's contact search index lags a few seconds behind a write, so a
  // refresh fired immediately comes back without the new person. Rather than
  // inventing a row and correcting it later, wait for GHL and say so — then
  // the list only ever shows what is really there.
  function contactAdded(newContact, onDone) {
    var el = document.getElementById('mm-contacts-list');
    if (el) {
      el.innerHTML = '<div class="mm-loading">' +
        '<span class="mm-spinner" aria-hidden="true"></span>' +
        '<span>Saving ' + U.esc(contactName(newContact)) + '&hellip;</span></div>';
    }

    var attempts = 0;
    (function check() {
      attempts += 1;
      api.searchContacts()
        .then(function (contacts) {
          var found = newContact && newContact.id &&
            contacts.some(function (c) { return c.id === newContact.id; });
          // Give up after ~8s and show whatever GHL has: the contact was
          // created either way, and a spinner that never stops is worse than
          // a list that is briefly a moment behind.
          if (found || attempts >= 5) {
            loadContacts(undefined, lastPick);
            if (onDone) onDone();
            return;
          }
          setTimeout(check, 1600);
        })
        .catch(function () {
          loadContacts(undefined, lastPick);
          if (onDone) onDone();
        });
    })();
  }

  function contactName(c) {
    if (!c) return 'contact';
    return U.titleCase(c.contactName ||
      [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name) || 'contact';
  }

  window.MM.contacts = {
    onOpenJob: function (fn) { onOpenJob = fn; },
    initEdit: initEdit,
    contactAdded: contactAdded,
    loadContacts: loadContacts,
    renderContactDetail: renderContactDetail,
  };
})();
