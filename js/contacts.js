// js/contacts.js
// Contacts tab: read-only list (search + columns) and a detail view.
// Wired into app.js the same way Jobs are — this module just exposes
// loadContacts()/pickContact() and app.js calls them on nav/boot.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

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

  function renderContactDetail(c) {
    var name = U.titleCase(c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name) || 'Unnamed Contact';
    document.getElementById('mm-contact-title').textContent = name;
    var el = document.getElementById('mm-contact-info');
    el.innerHTML =
      field('Name', name) +
      field('Phone', U.phone(c.phone)) +
      field('Email', c.email) +
      field('Business', fmtBusiness(c)) +
      field('Address', fmtAddress(c)) +
      field('Tags', fmtTags(c.tags)) +
      field('Created', fmtDate(c.dateAdded || c.createdAt)) +
      field('Contact ID', c.id);
    if (!el.innerHTML) el.innerHTML = '<div class="mm-empty">No details on file.</div>';
    renderJobs(c.id);
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
    contactAdded: contactAdded,
    loadContacts: loadContacts,
    renderContactDetail: renderContactDetail,
  };
})();
