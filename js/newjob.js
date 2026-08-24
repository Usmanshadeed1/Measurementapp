// js/newjob.js
// Creating a job for an existing customer.
//
// A customer can own several properties over time, each one its own job. The
// contact already exists, so this only needs to know which customer and which
// property — everything else follows from that.
//
// Adding a CONTACT is handled elsewhere: the GHL workflow creates that job
// automatically. This is for the second and third property, where no new
// contact is involved.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var contacts = [];
  var picked = null;
  var onCreated = null;

  function nameOf(c) {
    return U.titleCase(c.contactName ||
      [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name) || 'Unnamed contact';
  }

  // The address GHL holds for the person, used as a starting point. Most
  // second jobs are at a different property, so it is only a default.
  function addressOf(c) {
    var line = c.address1 || '';
    var rest = [c.city, c.state].filter(Boolean).join(', ');
    if (c.postalCode) rest += (rest ? ' ' : '') + c.postalCode;
    return [line, rest].filter(Boolean).join(', ');
  }

  // Same shape WF-1 builds, so jobs read identically however they were made.
  function jobName(c, address) {
    var n = nameOf(c);
    return address ? n + ' - ' + address : n;
  }

  function open() {
    picked = null;
    document.getElementById('mm-nj-error').textContent = '';
    document.getElementById('mm-nj-search').value = '';
    document.getElementById('mm-nj-address').value = '';
    document.getElementById('mm-nj-chosen').innerHTML = '';
    document.getElementById('mm-nj-preview').textContent = '';
    setStep(1);
    document.getElementById('mm-modal-newjob').classList.add('open');

    search('');
    document.getElementById('mm-nj-search').focus();
  }

  function close() {
    document.getElementById('mm-modal-newjob').classList.remove('open');
  }

  // Step 1 picks the customer, step 2 confirms the property. Splitting them
  // keeps a long contact list from burying the address field.
  function setStep(n) {
    document.getElementById('mm-nj-step1').style.display = n === 1 ? '' : 'none';
    document.getElementById('mm-nj-step2').style.display = n === 2 ? '' : 'none';
  }

  // The search runs in GoHighLevel, not here. It returns 50 contacts at a
  // time, so filtering the loaded page would only ever search those first
  // fifty — and this account has far more than that.
  var seq = 0;
  function search(q) {
    var list = document.getElementById('mm-nj-list');
    var mine = ++seq;
    list.innerHTML = '<div class="mm-empty">Searching...</div>';
    api.searchContacts(q)
      .then(function (rows) {
        if (mine !== seq) return;   // a later keystroke already won
        contacts = rows || [];
        renderList(q);
      })
      .catch(function (e) {
        if (mine !== seq) return;
        list.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function renderList(q) {
    var list = document.getElementById('mm-nj-list');
    var rows = contacts;
    if (!rows.length) {
      list.innerHTML = '<div class="mm-empty">' +
        (q ? 'No customers match &ldquo;' + U.esc(q) + '&rdquo;.' : 'No customers yet.') +
        '</div>';
      return;
    }
    list.innerHTML = rows.map(function (c) {
      var sub = [U.phone(c.phone), c.email].filter(Boolean).join(' · ');
      return '<button type="button" class="mm-assign-opt" data-c="' + U.esc(c.id) + '">' +
        '<span><span class="mm-pick-name">' + U.esc(nameOf(c)) + '</span>' +
        (sub ? '<span class="mm-pick-desc">' + U.esc(sub) + '</span>' : '') +
        '</span></button>';
    }).join('') +
      (rows.length >= 50
        ? '<p class="mm-task-empty">Showing the first 50. Type a name to narrow it down.</p>'
        : '');
    list.querySelectorAll('[data-c]').forEach(function (b) {
      b.addEventListener('click', function () {
        choose(contacts.find(function (c) { return c.id === b.getAttribute('data-c'); }));
      });
    });
  }

  function choose(c) {
    if (!c) return;
    picked = c;
    var sub = [U.phone(c.phone), c.email].filter(Boolean).join(' · ');
    document.getElementById('mm-nj-chosen').innerHTML =
      '<div class="mm-nj-card">' +
        '<div class="mm-nj-name">' + U.esc(nameOf(c)) + '</div>' +
        (sub ? '<div class="mm-nj-sub">' + U.esc(sub) + '</div>' : '') +
        '<button type="button" class="mm-nj-change" id="mm-nj-change">Change</button>' +
      '</div>';
    document.getElementById('mm-nj-change').addEventListener('click', function () { setStep(1); });

    // Prefill with the customer's own address: often right for a first job,
    // and quicker to correct than to type from nothing.
    var addr = document.getElementById('mm-nj-address');
    addr.value = addressOf(c);
    updatePreview();
    setStep(2);
    addr.focus();
  }

  function updatePreview() {
    if (!picked) return;
    var address = (document.getElementById('mm-nj-address').value || '').trim();
    document.getElementById('mm-nj-preview').textContent = jobName(picked, address);
  }

  function create() {
    if (!picked) { setStep(1); return; }
    var addr = (document.getElementById('mm-nj-address').value || '').trim();
    var err = document.getElementById('mm-nj-error');
    if (!addr) {
      err.textContent = 'Enter the property address for this job.';
      document.getElementById('mm-nj-address').focus();
      return;
    }

    var btn = document.getElementById('mm-nj-create');
    btn.disabled = true; btn.textContent = 'Creating...';
    err.textContent = '';

    api.createOpportunity({
      contactId: picked.id,
      name: jobName(picked, addr),
      address: addr,
    })
      .then(function (opp) {
        window.MM.activity.log('job_added', 'Created the job', {
          jobId: opp && opp.id,
          jobName: jobName(picked, addr),
          detail: addr,
        });
        close();
        btn.disabled = false; btn.textContent = 'Create job';
        if (onCreated) onCreated(opp);
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Create job';
        err.textContent = 'Could not create the job: ' + e.message;
      });
  }

  function init(afterCreate) {
    onCreated = afterCreate;

    var box = document.getElementById('mm-nj-search');
    var timer = null;
    box.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { search(box.value.trim()); }, 300);
    });

    document.getElementById('mm-nj-address').addEventListener('input', updatePreview);
    document.getElementById('mm-nj-create').addEventListener('click', create);
    document.getElementById('mm-nj-cancel').addEventListener('click', close);
    document.getElementById('mm-modal-newjob').addEventListener('click', function (e) {
      if (e.target === this) close();
    });
  }

  window.MM.newjob = { init: init, open: open };
})();
