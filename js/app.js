// js/app.js
// Top-level app: screens (Jobs / Job / Room), navigation, room CRUD,
// and wiring the Walls/Islands/Lighting/Media loaders together.
// This is the entry point — loaded last, after api/utils/media/entities/walls/lighting.
(function () {
  var U = window.MM.utils, api = window.MM.api, MD = window.MM.media, W = window.MM.walls, L = window.MM.lighting;

  var job = null, room = null, editRoom = null, searchTimer = null;

  // ===== FONT CONTROL =====
  U.applyFont(U.getFontIndex());
  document.getElementById('mm-font-up').addEventListener('click', function () { U.applyFont(U.getFontIndex() + 1); });
  document.getElementById('mm-font-down').addEventListener('click', function () { U.applyFont(U.getFontIndex() - 1); });

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
    var f = (o.customFields || []).find(function (x) { return x.id === api.ADDR_FIELD_ID; });
    return f && f.fieldValue ? f.fieldValue : '';
  }

  // ===== JOBS =====
  function loadJobs(q) {
    var el = document.getElementById('mm-jobs-list'); el.innerHTML = '<div class="mm-empty">Loading jobs...</div>';
    api.searchJobs(q).then(function (ops) {
      if (!ops.length) { el.innerHTML = '<div class="mm-empty">No jobs found.</div>'; return; }
      el.innerHTML = '';
      ops.forEach(function (o) {
        var item = document.createElement('div'); item.className = 'mm-acc';
        var hdr = document.createElement('div'); hdr.className = 'mm-acc-hdr';
        hdr.setAttribute('role', 'button'); hdr.setAttribute('tabindex', '0');
        hdr.innerHTML = '<div class="mm-acc-hdr-text"><div class="mm-acc-title">' + U.esc(customerName(o)) + '</div><div class="mm-acc-sub">' + U.esc(jobAddress(o) || 'No address on file') + '</div></div><span class="mm-acc-arrow" aria-hidden="true">&#8250;</span>';
        hdr.addEventListener('click', function () { pickJob(o); });
        hdr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickJob(o); } });
        item.appendChild(hdr); el.appendChild(item);
      });
    }).catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }
  document.getElementById('mm-job-search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = this.value.trim();
    searchTimer = setTimeout(function () { loadJobs(q || undefined); }, 400);
  });

  function pickJob(o) {
    job = o;
    document.getElementById('mm-job-title').textContent = customerName(o);
    showScreen('job');
    document.getElementById('mm-job-info').innerHTML =
      '<div class="mm-field-display"><div class="flabel">Address</div><div class="fvalue">' + U.esc(jobAddress(o) || '—') + '</div></div>' +
      '<div class="mm-field-display"><div class="flabel">Job ID</div><div class="fvalue mono">' + U.esc(o.id) + '</div></div>';
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
  document.getElementById('mm-back-to-jobs').addEventListener('click', function () { showScreen('jobs'); });
  document.getElementById('mm-back-to-job').addEventListener('click', function () { showScreen('job'); });

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

  // ===== BOOT =====
  showScreen('jobs');
  loadJobs();
})();
