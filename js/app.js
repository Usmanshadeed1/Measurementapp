// js/app.js
// Top-level app: screens (Jobs / Job / Room), navigation, room CRUD,
// and wiring the Walls/Islands/Lighting/Media loaders together.
// This is the entry point — loaded last, after api/utils/media/entities/walls/lighting.
(function () {
  var U = window.MM.utils, api = window.MM.api, MD = window.MM.media, W = window.MM.walls, L = window.MM.lighting, C = window.MM.contacts, IMP = window.MM.importer, DASH = window.MM.dashboard, STEPS = window.MM.jobsteps, TASKS = window.MM.tasks, TLISTS = window.MM.tasklists, ACT = window.MM.activity, MY = window.MM.mytasks, ACCESS = window.MM.jobaccess, MEASURE = window.MM.measure;

  var job = null, room = null, editRoom = null, contactSearchTimer = null;

  // ===== FONT CONTROL ===== (one button pair per topbar, same handler for all)
  U.applyFont(U.getFontIndex());
  document.querySelectorAll('.mm-font-up').forEach(function (btn) { btn.addEventListener('click', function () { U.applyFont(U.getFontIndex() + 1); }); });
  document.querySelectorAll('.mm-font-down').forEach(function (btn) { btn.addEventListener('click', function () { U.applyFont(U.getFontIndex() - 1); }); });

  // ===== THEME CONTROL (dark / light) =====
  U.applyTheme(U.getTheme());
  document.querySelectorAll('.mm-theme-toggle').forEach(function (btn) { btn.addEventListener('click', function () { U.toggleTheme(); }); });

  // ===== SITE NAV (header links, desktop + mobile copies, and brand link) =====
  function goToTab(tab) {
    // A worker has one screen. Anything else is refused here as well as
    // being hidden, so a stale link or a back button cannot get them in.
    var workerTabs = { mytasks: 1, measure: 1 };
    if (!window.MM.auth.isAdmin() && !workerTabs[tab]) tab = 'mytasks';

    if (tab === 'dashboard') { showScreen('dashboard'); DASH.loadDashboard(); }
    else if (tab === 'tasklists') { showScreen('tasklists'); TLISTS.load(); }
    else if (tab === 'mytasks') { showScreen('mytasks'); MY.load(); }
    else if (tab === 'measure') { showScreen('measure'); MEASURE.load(); }
    else if (tab === 'history') { showScreen('history'); ACT.loadPage(); }
    else if (tab === 'contacts') { showScreen('contacts'); loadContacts(); }
    setActiveNavLink(tab);
    closeMobileNav();
  }
  function setActiveNavLink(tab) {
    document.querySelectorAll('.mm-nav-link').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === tab);
    });
  }
  document.querySelectorAll('.mm-nav-link, .mm-brand').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      goToTab(a.getAttribute('data-tab') ||
              (window.MM.auth.isAdmin() ? 'dashboard' : 'mytasks'));
    });
  });

  // ===== MOBILE HAMBURGER =====
  var mobileNav = document.getElementById('mm-mobile-nav');
  var hamburgerBtn = document.getElementById('mm-hamburger-btn');
  function closeMobileNav() { mobileNav.classList.remove('open'); hamburgerBtn.setAttribute('aria-expanded', 'false'); }
  function toggleMobileNav() {
    var open = mobileNav.classList.toggle('open');
    hamburgerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  hamburgerBtn.addEventListener('click', toggleMobileNav);

  // Sign out appears twice — in the header on desktop, in the menu on a
  // phone — so both need wiring to the same handler.
  document.querySelectorAll('.mm-signout-m').forEach(function (b) {
    b.addEventListener('click', function () { window.MM.auth.signOut(); });
  });

  // Prevent accidental scroll-wheel changes on number inputs
  document.addEventListener('wheel', function (e) { if (document.activeElement && document.activeElement.type === 'number') e.preventDefault(); }, { passive: false });

  // ===== SCREEN NAV =====
  function showScreen(n) {
    document.querySelectorAll('#mm-app .screen').forEach(function (s) { s.classList.remove('active'); });
    document.getElementById('screen-' + n).classList.add('active');
    U.updateFloatBtn();
  }
  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  function customerName(o) {
    if (o.contact && o.contact.name) return o.contact.name;
    var n = o.name || '';
    return n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n;
  }
  function jobAddress(o) {
    return api.oppField(o, api.ADDR_FIELD_ID);
  }

  // ===== JOB =====
  // ---- Collapsible job panels ---------------------------------------------
  //
  // Each panel already renders a .mm-steps-head; making that the toggle keeps
  // the behaviour in one place rather than teaching four modules to build
  // accordions. Panels re-render often, so this runs after each render and
  // is safe to call repeatedly.
  //
  // The first panel on a tab opens by default: a screen of closed bars gives
  // the reader nothing to land on.
  var panelOpen = {};
  try {
    panelOpen = JSON.parse(localStorage.getItem('mm_job_panels') || '{}');
  } catch (e) { panelOpen = {}; }

  function savePanels() {
    try { localStorage.setItem('mm_job_panels', JSON.stringify(panelOpen)); } catch (e) { /* private mode */ }
  }

  function wirePanels() {
    document.querySelectorAll('#screen-job .mm-steps-card').forEach(function (card, i) {
      var head = card.querySelector('.mm-steps-head');
      if (!head || head.dataset.wired) return;

      var id = card.id || ('panel' + i);
      // Default: the first panel in each pane is open, the rest closed.
      if (!(id in panelOpen)) {
        panelOpen[id] = card.parentElement &&
          card.parentElement.querySelector('.mm-steps-card') === card;
      }

      head.dataset.wired = '1';
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      if (!head.querySelector('.mm-panel-arrow')) {
        var arrow = document.createElement('span');
        arrow.className = 'mm-panel-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.innerHTML = '&#9662;';
        head.insertBefore(arrow, head.firstChild);
      }

      function apply() {
        card.classList.toggle('is-open', !!panelOpen[id]);
        head.setAttribute('aria-expanded', panelOpen[id] ? 'true' : 'false');
      }
      function toggle() { panelOpen[id] = !panelOpen[id]; savePanels(); apply(); }

      head.addEventListener('click', toggle);
      head.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      apply();
    });
  }

  // Panels rebuild their own markup, which drops the wiring, so re-run after
  // anything that re-renders one.
  window.MM.wireJobPanels = wirePanels;

  // ---- Job tabs -----------------------------------------------------------

  function showJobTab(name) {
    document.querySelectorAll('#mm-jobtabs .mm-jobtab').forEach(function (b) {
      var on = b.getAttribute('data-jobtab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#screen-job .mm-jobpane').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-pane') === name);
    });
    // A tab switch is a new screen as far as the reader is concerned.
    var c = document.querySelector('#screen-job .mm-content');
    if (c) c.scrollTop = 0;
  }

  document.querySelectorAll('#mm-jobtabs .mm-jobtab').forEach(function (btn) {
    btn.addEventListener('click', function () { showJobTab(btn.getAttribute('data-jobtab')); });
  });

  var jobCameFrom = 'dashboard';

  function pickJob(o, tab) {
    jobCameFrom = tab === 'measure' ? 'measure'
                : window.MM.auth.isAdmin() ? 'dashboard' : 'mytasks';
    // A worker may open a job they are on — that is how measuring happens —
    // but nothing else. The check is here as well as in the lists, so a stale
    // reference cannot open a job they were removed from.
    if (!ACCESS.canOpen(o.id)) return;
    job = o;
    document.getElementById('mm-job-title').textContent = customerName(o);
    showScreen('job');
    showJobTab(tab || 'overview');

    // Tasks and crew are admin work; a worker opening a job is there to
    // measure, so the tab would only be an empty panel for them.
    var admin = window.MM.auth.isAdmin();
    var tasksTab = document.querySelector('#mm-jobtabs [data-jobtab="tasks"]');
    if (tasksTab) tasksTab.style.display = admin ? '' : 'none';

    var stage = DASH.stageNameFor(o);
    var infoEl = document.getElementById('mm-job-info');
    infoEl.innerHTML =
      '<div class="mm-field-display"><div class="flabel">Address</div><div class="fvalue">' + U.esc(jobAddress(o) || '—') + '</div></div>' +
      // The stage is actionable here too: the crew finishes measuring at the
      // property and can move the job on without opening GHL.
      '<div class="mm-field-display"><div class="flabel">Stage</div>' +
        '<div class="fvalue"><button type="button" class="mm-btn-sm mm-btn-secondary" id="mm-job-stage-btn">' +
        U.esc(stage || 'Set stage') + ' &#9662;</button></div></div>' +
      '<div class="mm-field-display"><div class="flabel">Job ID</div><div class="fvalue mono">' + U.esc(o.id) + '</div></div>';

    var stageBtn = document.getElementById('mm-job-stage-btn');
    if (stageBtn) stageBtn.addEventListener('click', function () { DASH.openStage(o); });

    STEPS.render(o);
    TASKS.showForJob(o);
    ACCESS.showForJob(o);
    ACT.showForJob(o);
    wirePanels();

    loadRooms();
    loadJobMedia();
  }

  // ===== ROOMS =====
  function loadRooms() {
    var el = document.getElementById('mm-rooms-list'); el.innerHTML = '<div class="mm-empty">Loading...</div>';
    api.rels(job.id, api.A.rO).then(function (ids) {
      if (!ids.length) { el.innerHTML = '<div class="mm-empty">No rooms yet.</div>'; return; }
      return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.room', id); })).then(function (rs) {
        el.innerHTML = '';
        rs.filter(Boolean).forEach(function (r) {
          var item = document.createElement('div'); item.className = 'mm-acc';
          var hdr = document.createElement('div'); hdr.className = 'mm-acc-hdr';
          hdr.setAttribute('role', 'button'); hdr.setAttribute('tabindex', '0');
          hdr.innerHTML = '<div class="mm-acc-hdr-text"><div class="mm-acc-title">' + U.esc(U.pv(r, 'name') || 'Room') + '</div><div class="mm-acc-sub">' + U.esc(U.pv(r, 'ceiling_height') ? 'Ceiling: ' + U.pv(r, 'ceiling_height') + '"' : '') + '</div></div><span class="mm-acc-arrow" aria-hidden="true">&#8250;</span>';
          hdr.addEventListener('click', function () { pickRoom(r); });
          hdr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRoom(r); } });
          item.appendChild(hdr); el.appendChild(item);
        });
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  document.getElementById('mm-add-room-btn').addEventListener('click', function () {
    editRoom = null;
    document.getElementById('mm-room-modal-title').textContent = 'Add Room';
    ['mm-rm-name', 'mm-rm-ceiling', 'mm-rm-floor', 'mm-rm-notes'].forEach(function (id) { document.getElementById(id).value = ''; });
    openModal('mm-modal-room');
  });
  document.getElementById('mm-cancel-room-btn').addEventListener('click', function () { closeModal('mm-modal-room'); });
  document.getElementById('mm-save-room-btn').addEventListener('click', function () {
    var n = document.getElementById('mm-rm-name').value.trim(); if (!n) { alert('Name required.'); return; }
    var p = { name: n }, c = document.getElementById('mm-rm-ceiling').value, f = document.getElementById('mm-rm-floor').value.trim(), nt = document.getElementById('mm-rm-notes').value.trim();
    if (c) p.ceiling_height = parseFloat(c); if (f) p.flooring_type = f; if (nt) p.notes = nt;
    var pr = editRoom ? api.updateRec('custom_objects.room', editRoom.id, p) : api.makeRec('custom_objects.room', p).then(function (rec) { return api.makeRel(api.A.rO, rec.id, job.id); });
    pr.then(function () { closeModal('mm-modal-room'); editRoom = null; loadRooms(); }).catch(function (e) { alert(e.message); });
  });
  document.getElementById('mm-modal-room').addEventListener('click', function (e) { if (e.target === this) closeModal('mm-modal-room'); });
  document.getElementById('mm-float-save').addEventListener('click', function () {
    U.getPendingButtons().forEach(function (btn) { btn.click(); });
  });

  function pickRoom(r) {
    room = r;
    document.getElementById('mm-room-title').textContent = U.pv(r, 'name') || 'Room';
    showScreen('room');
    var el = document.getElementById('mm-room-info'); el.innerHTML = '';

    var infoBody = document.createElement('div'); infoBody.className = 'mm-acc-body';
    infoBody.innerHTML =
      U.fld('Room Name', '<input class="mm-input f-name" placeholder="e.g. Kitchen">') +
      U.fld('Ceiling Height (in)', '<input class="mm-input f-ceiling" type="number" placeholder="e.g. 96">') +
      U.fld('Flooring Type', '<input class="mm-input f-floor" placeholder="e.g. Tile, Hardwood">') +
      U.fld('Notes', '<textarea class="mm-input f-notes"></textarea>') +
      '<div class="acc-save-row"><button class="mm-btn mm-btn-primary f-save" style="margin-bottom:0">Save Room</button>' +
      '<button class="mm-btn mm-btn-danger f-del" style="margin-bottom:0;width:auto;padding:14px 20px">Delete Room</button></div>';
    U.sv(infoBody, 'f-name', U.pv(r, 'name')); U.sv(infoBody, 'f-ceiling', U.pv(r, 'ceiling_height')); U.sv(infoBody, 'f-floor', U.pv(r, 'flooring_type')); U.sv(infoBody, 'f-notes', U.pv(r, 'notes'));
    var c = U.pv(r, 'ceiling_height');
    var builtInfo = U.makeAcc(false, true, U.pv(r, 'name') ? U.pv(r, 'name') : 'Room Info', c ? 'Ceiling: ' + c + '"' : '', infoBody);
    el.appendChild(builtInfo.acc);

    var sb = infoBody.querySelector('.f-save'), db = infoBody.querySelector('.f-del');
    sb.addEventListener('click', function () {
      var n = U.gv(infoBody, 'f-name'); if (!n) { alert('Name required.'); return; }
      var p = { name: n }, cc = infoBody.querySelector('.f-ceiling').value, f = U.gv(infoBody, 'f-floor'), nt = U.gv(infoBody, 'f-notes');
      if (cc) p.ceiling_height = parseFloat(cc); if (f) p.flooring_type = f; if (nt) p.notes = nt;
      sb.textContent = 'Saving...'; sb.disabled = true;
      api.updateRec('custom_objects.room', r.id, p).then(function () {
        Object.assign(r.properties || (r.properties = {}), p);
        document.getElementById('mm-room-title').textContent = n;
        builtInfo.hdr.querySelector('.mm-acc-title').textContent = n;
        builtInfo.hdr.querySelector('.mm-acc-sub').textContent = cc ? 'Ceiling: ' + cc + '"' : '';
        U.fbk(sb, 'Save Room');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save Room'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!confirm('Delete this room?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.room', r.id).then(function () { showScreen('job'); loadRooms(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });

    loadWalls(); loadIslands(); loadLights(); loadRoomMedia();
  }

  // ===== ROOM SUB-LOADERS =====
  function loadWalls() {
    var el = document.getElementById('mm-walls-list'); el.innerHTML = '<div class="mm-empty">Loading...</div>';
    api.rels(room.id, api.A.wR).then(function (ids) {
      if (!ids.length) { el.innerHTML = '<div class="mm-empty">None yet.</div>'; return; }
      return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.wall', id); })).then(function (rs) {
        el.innerHTML = ''; rs.filter(Boolean).forEach(function (r) { el.appendChild(W.buildWallAcc(r, { job: job, room: room })); });
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }
  function loadIslands() {
    var el = document.getElementById('mm-islands-list'); el.innerHTML = '<div class="mm-empty">Loading...</div>';
    api.rels(room.id, api.A.iR).then(function (ids) {
      if (!ids.length) { el.innerHTML = '<div class="mm-empty">None yet.</div>'; return; }
      return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.island', id); })).then(function (rs) {
        el.innerHTML = ''; rs.filter(Boolean).forEach(function (r) { el.appendChild(W.buildIslandAcc(r, { room: room })); });
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }
  function loadLights() {
    var el = document.getElementById('mm-lights-list'); el.innerHTML = '<div class="mm-empty">Loading...</div>';
    api.rels(room.id, api.A.lR).then(function (ids) {
      if (!ids.length) { el.innerHTML = '<div class="mm-empty">None yet.</div>'; return; }
      return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.lighting_fixture', id); })).then(function (rs) {
        el.innerHTML = ''; rs.filter(Boolean).forEach(function (r) { el.appendChild(L.buildLightAcc(r, { room: room })); });
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  document.getElementById('mm-add-wall-btn').addEventListener('click', function () {
    var el = document.getElementById('mm-walls-list'); U.clearIfPlaceholder(el);
    var na = W.buildWallAcc(null, { job: job, room: room }); el.appendChild(na); na.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('mm-add-island-btn').addEventListener('click', function () {
    var el = document.getElementById('mm-islands-list'); U.clearIfPlaceholder(el);
    var na = W.buildIslandAcc(null, { room: room }); el.appendChild(na); na.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('mm-add-light-btn').addEventListener('click', function () {
    var el = document.getElementById('mm-lights-list'); U.clearIfPlaceholder(el);
    var na = L.buildLightAcc(null, { room: room }); el.appendChild(na); na.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ===== NAV =====
  document.getElementById('mm-back-to-jobs').addEventListener('click', function () {
    showScreen(jobCameFrom);
    setActiveNavLink(jobCameFrom);
  });
  document.getElementById('mm-back-to-job').addEventListener('click', function () { showScreen('job'); });
  document.getElementById('mm-back-to-contacts').addEventListener('click', function () { showScreen('contacts'); });

  // ===== CONTACTS =====
  function loadContacts(q) { C.loadContacts(q, pickContact); }
  function pickContact(c) {
    C.renderContactDetail(c);
    showScreen('contact');
  }
  document.getElementById('mm-contact-search').addEventListener('input', function () {
    clearTimeout(contactSearchTimer);
    var q = this.value.trim();
    contactSearchTimer = setTimeout(function () { loadContacts(q || undefined); }, 400);
  });

  // ===== ADD CONTACT =====
  var contactFieldIds = ['mm-ct-first', 'mm-ct-last', 'mm-ct-email', 'mm-ct-phone', 'mm-ct-business', 'mm-ct-address', 'mm-ct-city', 'mm-ct-state', 'mm-ct-postal'];
  var selectedTags = [];   // tag names currently checked in the dropdown
  var allTagNames = [];    // every known tag name in this location (selection only, no creating here)

  var tagSelectWrap = document.getElementById('mm-ct-tags-select');
  var tagSelectBtn = document.getElementById('mm-ct-tags-btn');
  var tagSelectPanel = document.getElementById('mm-ct-tags-panel');
  var tagSelectSummary = document.getElementById('mm-ct-tags-summary');

  function updateTagSummary() {
    if (!selectedTags.length) {
      tagSelectSummary.textContent = 'Select tags...';
      tagSelectSummary.classList.remove('has-selection');
    } else {
      tagSelectSummary.textContent = selectedTags.join(', ');
      tagSelectSummary.classList.add('has-selection');
    }
  }
  function renderTagPanel() {
    tagSelectPanel.innerHTML = '';
    if (!allTagNames.length) { tagSelectPanel.innerHTML = '<div class="mm-empty">No tags exist in GHL yet.</div>'; return; }
    allTagNames.forEach(function (name) {
      var opt = document.createElement('label');
      opt.className = 'mm-tag-option';
      opt.setAttribute('role', 'option');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedTags.indexOf(name) > -1;
      cb.addEventListener('change', function () {
        var i = selectedTags.indexOf(name);
        if (cb.checked && i === -1) selectedTags.push(name);
        else if (!cb.checked && i > -1) selectedTags.splice(i, 1);
        updateTagSummary();
      });
      var span = document.createElement('span'); span.textContent = name;
      opt.appendChild(cb); opt.appendChild(span);
      tagSelectPanel.appendChild(opt);
    });
  }
  function openTagPanel() { tagSelectWrap.classList.add('open'); tagSelectBtn.setAttribute('aria-expanded', 'true'); }
  function closeTagPanel() { tagSelectWrap.classList.remove('open'); tagSelectBtn.setAttribute('aria-expanded', 'false'); }
  tagSelectBtn.addEventListener('click', function () {
    tagSelectWrap.classList.contains('open') ? closeTagPanel() : openTagPanel();
  });
  document.addEventListener('click', function (e) {
    if (!tagSelectWrap.contains(e.target)) closeTagPanel();
  });

  document.getElementById('mm-add-contact-btn').addEventListener('click', function () {
    contactFieldIds.forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('mm-ct-type').value = 'lead';
    document.getElementById('mm-ct-country').value = 'US';
    selectedTags = [];
    updateTagSummary();
    closeTagPanel();
    openModal('mm-modal-contact');
    tagSelectPanel.innerHTML = '<div class="mm-empty">Loading tags...</div>';
    api.getTags().then(function (tags) {
      allTagNames = tags.map(function (t) { return t.name; }).filter(Boolean);
      renderTagPanel();
    }).catch(function (e) {
      allTagNames = [];
      tagSelectPanel.innerHTML = '<div class="mm-empty">Could not load tags.</div>';
    });
  });
  document.getElementById('mm-cancel-contact-btn').addEventListener('click', function () { closeModal('mm-modal-contact'); });
  document.getElementById('mm-modal-contact').addEventListener('click', function (e) { if (e.target === this) closeModal('mm-modal-contact'); });
  document.getElementById('mm-save-contact-btn').addEventListener('click', function () {
    var btn = this;
    var first = document.getElementById('mm-ct-first').value.trim();
    if (!first) { alert('First name is required.'); return; }
    var p = { firstName: first };
    var last = document.getElementById('mm-ct-last').value.trim(); if (last) p.lastName = last;
    var email = document.getElementById('mm-ct-email').value.trim(); if (email) p.email = email;
    var phone = document.getElementById('mm-ct-phone').value.trim(); if (phone) p.phone = phone;
    var business = document.getElementById('mm-ct-business').value.trim(); if (business) p.companyName = business;
    var address = document.getElementById('mm-ct-address').value.trim(); if (address) p.address1 = address;
    var city = document.getElementById('mm-ct-city').value.trim(); if (city) p.city = city;
    var state = document.getElementById('mm-ct-state').value.trim(); if (state) p.state = state.toUpperCase();
    var postal = document.getElementById('mm-ct-postal').value.trim(); if (postal) p.postalCode = postal;
    var country = document.getElementById('mm-ct-country').value.trim(); if (country) p.country = country.toUpperCase();
    p.type = document.getElementById('mm-ct-type').value || 'lead';
    if (selectedTags.length) p.tags = selectedTags.slice();

    btn.textContent = 'Saving...'; btn.disabled = true;
    api.createContact(p).then(function () {
      closeModal('mm-modal-contact');
      U.fbk(btn, 'Save Contact');
      loadContacts();
    }).catch(function (e) {
      alert(e.message);
      btn.textContent = 'Save Contact'; btn.disabled = false;
    });
  });

  // ===== IMPORT CONTACTS (CSV) =====
  var importWizard = IMP.build(document.getElementById('mm-import-body'));
  importWizard.setCloseHandler(function (didImport) {
    closeModal('mm-modal-import');
    if (didImport) loadContacts();
  });
  document.getElementById('mm-import-contacts-btn').addEventListener('click', function () {
    openModal('mm-modal-import');
    importWizard.open();
  });
  document.getElementById('mm-modal-import').addEventListener('click', function (e) { if (e.target === this) { importWizard.cancelIfRunning(); closeModal('mm-modal-import'); } });

  // ===== MEDIA (room/job level) =====
  function loadRoomMedia() {
    if (!room || !room.id) return;
    var el = document.getElementById('mm-media-gallery'); el.innerHTML = '<div class="mm-empty">Loading...</div>';
    Promise.all([
      api.queryMediaByField(api.PHOTO, 'room_id', room.id),
      api.queryMediaByField(api.VIDEO, 'room_id', room.id),
      api.rels(room.id, api.A.wR).then(function (ids) { return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.wall', id); })); }).catch(function () { return []; }),
    ]).then(function (results) {
      var photos = results[0] || [], videos = results[1] || [], walls = (results[2] || []).filter(Boolean);
      var wallNameById = {}; walls.forEach(function (w) { wallNameById[w.id] = U.pv(w, 'name') || 'Wall'; });
      var all = [].concat(photos, videos).sort(function (a, b) { return new Date(U.pv(b, 'date_taken')) - new Date(U.pv(a, 'date_taken')); });
      if (!all.length) { el.innerHTML = '<div class="mm-empty">No photos or videos yet.</div>'; return; }
      el.innerHTML = '';
      var grid = MD.makeMediaGrid();
      all.forEach(function (m) {
        var isVid = photos.indexOf(m) < 0;
        var wid = U.pv(m, 'wall_id');
        var wallLabel = wid ? (wallNameById[wid] || 'Wall') : '';
        grid.appendChild(MD.buildMediaThumb(m, isVid, grid, el, wallLabel));
      });
      el.appendChild(grid);
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  function loadJobMedia() {
    if (!job || !job.id) return;
    var el = document.getElementById('mm-job-media'); el.innerHTML = '<div class="mm-empty">Loading...</div>';
    Promise.all([
      api.queryMediaByField(api.PHOTO, 'job_id', job.id),
      api.queryMediaByField(api.VIDEO, 'job_id', job.id),
      api.rels(job.id, api.A.rO).then(function (ids) { return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.room', id); })); }).catch(function () { return []; }),
    ]).then(function (results) {
      var photos = results[0] || [], videos = results[1] || [], rooms = (results[2] || []).filter(Boolean);
      var roomNameById = {}; rooms.forEach(function (r) { roomNameById[r.id] = U.pv(r, 'name') || 'Room'; });
      return Promise.all(rooms.map(function (r) {
        return api.rels(r.id, api.A.wR).then(function (ids) { return Promise.all(ids.map(function (id) { return api.getRec('custom_objects.wall', id); })); }).catch(function () { return []; });
      })).then(function (wallLists) {
        var wallNameById = {};
        wallLists.forEach(function (walls) { (walls || []).filter(Boolean).forEach(function (w) { wallNameById[w.id] = U.pv(w, 'name') || 'Wall'; }); });
        return { photos: photos, videos: videos, roomNameById: roomNameById, wallNameById: wallNameById };
      });
    }).then(function (d) {
      var photos = d.photos, videos = d.videos, roomNameById = d.roomNameById, wallNameById = d.wallNameById;
      var items = photos.map(function (m) { return { m: m, isVid: false }; }).concat(videos.map(function (m) { return { m: m, isVid: true }; }));
      if (!items.length) { el.innerHTML = '<div class="mm-empty">No photos or videos yet.</div>'; return; }
      var groups = {};
      items.forEach(function (item) {
        var rid = U.pv(item.m, 'room_id') || '__none__';
        (groups[rid] = groups[rid] || []).push(item);
      });
      el.innerHTML = '';
      Object.keys(groups).sort(function (a, b) { return (roomNameById[a] || 'Unassigned').localeCompare(roomNameById[b] || 'Unassigned'); }).forEach(function (rid) {
        var group = groups[rid];
        group.sort(function (a, b) { return new Date(U.pv(b.m, 'date_taken')) - new Date(U.pv(a.m, 'date_taken')); });
        var label = rid === '__none__' ? 'Unassigned' : (roomNameById[rid] || 'Room');
        var body = document.createElement('div'); body.className = 'mm-acc-body';
        var grid = MD.makeMediaGrid();
        body.appendChild(grid);
        var built = U.makeAcc(false, true, label, group.length + ' item' + (group.length === 1 ? '' : 's'), body);
        built.acc.setAttribute('data-room-group', rid);
        el.appendChild(built.acc);
        group.forEach(function (item) {
          var wid = U.pv(item.m, 'wall_id');
          var wallLabel = wid ? (wallNameById[wid] || 'Wall') : '';
          grid.appendChild(MD.buildMediaThumb(item.m, item.isVid, grid, body, wallLabel, function () { MD.updateJobGroupCount(el, built.acc); }));
        });
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  document.getElementById('mm-photo-camera').addEventListener('click', function () {
    var btn = this;
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,video/*'; input.capture = 'environment';
    input.addEventListener('change', function () {
      if (!input.files[0]) return;
      var file = input.files[0];
      var isVid = file.type.indexOf('video') === 0;
      var roomName = U.pv(room, 'name') || 'Room';
      btn.textContent = 'Uploading...'; btn.disabled = true;
      api.uploadMediaFile(file).then(function (url) {
        return api.createPhotoOrVideo(isVid ? api.VIDEO : api.PHOTO, 'Photo – ' + roomName + ' – ' + new Date().toISOString().split('T')[0], url, job.id, room.id);
      }).then(function (rec) { MD.addMediaThumb(rec, isVid); MD.addJobMediaThumb(rec, isVid, room.id, '', room); })
        .catch(function (e) { alert(e.message); })
        .then(function () { btn.textContent = '📷 Camera'; btn.disabled = false; });
    });
    input.click();
  });
  document.getElementById('mm-photo-upload').addEventListener('click', function () { document.getElementById('mm-file-input').click(); });
  document.getElementById('mm-file-input').addEventListener('change', function () {
    if (!this.files[0]) return;
    var file = this.files[0];
    var input = this;
    var isVid = file.type.indexOf('video') === 0;
    var btn = document.getElementById('mm-photo-upload');
    var roomName = U.pv(room, 'name') || 'Room';
    btn.textContent = 'Uploading...'; btn.disabled = true;
    api.uploadMediaFile(file).then(function (url) {
      return api.createPhotoOrVideo(isVid ? api.VIDEO : api.PHOTO, 'Photo – ' + roomName + ' – ' + new Date().toISOString().split('T')[0], url, job.id, room.id);
    }).then(function (rec) { MD.addMediaThumb(rec, isVid); MD.addJobMediaThumb(rec, isVid, room.id, '', room); input.value = ''; })
      .catch(function (e) { alert(e.message); })
      .then(function () { btn.textContent = '📁 Upload'; btn.disabled = false; });
  });

  // Redraw the stage button whenever the stage changes, from either route:
  // saving a progress step, or picking a stage directly.
  function refreshStageButton(o) {
    var btn = document.getElementById('mm-job-stage-btn');
    if (btn) btn.innerHTML = U.esc(DASH.stageNameFor(o) || 'Set stage') + ' &#9662;';
  }
  STEPS.onChange(refreshStageButton);
  DASH.onStageChange(function (o) {
    // Only the job currently on screen needs redrawing.
    if (!job || o.id !== job.id) return;
    refreshStageButton(o);
    STEPS.render(o);   // which steps are available depends on the stage
  });

  // ===== BOOT =====
  // Nothing loads until someone is signed in: no job data should be fetched
  // for a visitor who has not proved who they are.
  DASH.initDashboard(function (o) { pickJob(o); });
  TASKS.init();
  TLISTS.init();
  ACT.initPage();
  MY.onOpenJob(pickJob);
  MEASURE.init(pickJob);
  document.getElementById('mm-measure-refresh').addEventListener('click', function () { MEASURE.load(); });

  window.MM.auth.init(function () {
    var admin = window.MM.auth.isAdmin();

    // A worker gets their own task list and nothing else. The customer list,
    // every job's address and the whole pipeline are not theirs to browse —
    // and the database enforces the same split, so hiding the nav is the
    // presentation of a rule rather than the rule itself.
    // Toggle a class rather than the inline display property. Setting
    // display:'' on a link inside the mobile nav made it visible on desktop
    // too, because the mobile nav is hidden by its own container rule and an
    // inline style on the child overrides nothing — the link simply appeared
    // twice.
    document.body.classList.toggle('is-admin', admin);
    document.body.classList.toggle('is-worker', !admin);
    document.querySelectorAll('.mm-admin-only, .mm-worker-only').forEach(function (el) {
      el.style.display = '';
    });

    if (admin) {
      setActiveNavLink('dashboard');
      showScreen('dashboard');
      DASH.loadDashboard();
    } else {
      setActiveNavLink('mytasks');
      showScreen('mytasks');
      MY.load();   // loads job access as part of its own fetch
    }
  });
})();
