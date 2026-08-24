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

  function loadContacts(query, onPickContact) {
    var el = document.getElementById('mm-contacts-list');
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
  }

  window.MM.contacts = {
    loadContacts: loadContacts,
    renderContactDetail: renderContactDetail,
  };
})();
