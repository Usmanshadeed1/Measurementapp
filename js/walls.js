// js/walls.js
// Wall and Island accordions — each contains its own sub-accordions for
// Openings/Appliances/Electrical/Plumbing (walls) or Plumbing (islands),
// plus wall-level photo/video capture. Ported behavior-for-behavior from
// the original build.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, A = api.A, MD = window.MM.media, EN = window.MM.entities;

  function makeSub(title, listClass) {
    var body = document.createElement('div'); body.className = 'mm-acc-body';
    var list = document.createElement('div'); list.className = listClass;
    body.appendChild(list);
    var acc = document.createElement('div'); acc.className = 'mm-acc mm-sub';
    var hdr = document.createElement('div'); hdr.className = 'mm-acc-hdr';
    var addBtn = document.createElement('button'); addBtn.className = 'mm-btn-sm mm-btn-primary'; addBtn.style.marginLeft = 'auto';
    var badge = document.createElement('span'); badge.className = 'mm-acc-badge'; badge.textContent = '0'; badge.style.marginLeft = '8px';
    hdr.innerHTML = '<div class="mm-acc-hdr-text"><div class="mm-acc-title">' + U.esc(title) + '</div></div><span class="mm-acc-arrow" aria-hidden="true">&#9660;</span>';
    hdr.insertBefore(addBtn, hdr.querySelector('.mm-acc-arrow'));
    hdr.querySelector('.mm-acc-title').appendChild(badge);
    hdr.setAttribute('role', 'button'); hdr.setAttribute('tabindex', '0');
    hdr.addEventListener('click', function (e) { if (e.target !== addBtn) acc.classList.toggle('open'); });
    hdr.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target !== addBtn) { e.preventDefault(); acc.classList.toggle('open'); } });
    acc.appendChild(hdr); acc.appendChild(body);
    function updateCount() { badge.textContent = list.querySelectorAll('.mm-acc').length; }
    return { acc: acc, list: list, btn: addBtn, updateCount: updateCount };
  }

  function buildWallAcc(w, ctx) {
    // ctx = { job, room }
    var isNew = !w || !w.id, wr = w || { id: null, properties: {} }, id = U.uid();
    var ph = '<div class="mm-empty">Save wall first.</div>';

    var infoBody = document.createElement('div'); infoBody.className = 'mm-acc-body';
    infoBody.innerHTML =
      U.fld('Wall Name', '<input class="mm-input f-name" placeholder="e.g. North Wall">') +
      U.fld('Length (in)', '<input class="mm-input f-len" type="number" placeholder="e.g. 120">') +
      U.fld('Height (in)', '<input class="mm-input f-hgt" type="number" placeholder="Leave blank = ceiling height">') +
      U.fld('Base Molding', U.radios('base-' + id, [['yes', 'Yes'], ['no', 'No']], 'no')) +
      U.fld('Crown Molding', U.radios('crown-' + id, [['yes', 'Yes'], ['no', 'No']], 'no')) +
      U.fld('Soffit', U.radios('soffit-' + id, [['yes', 'Yes'], ['no', 'No']], 'no')) +
      '<div class="f-soff-dims" style="display:none">' +
        U.fld('Soffit Height (in)', '<input class="mm-input f-sh" type="number">') +
        U.fld('Soffit Depth (in)', '<input class="mm-input f-sd" type="number">') +
      '</div>' +
      U.fld('Notes', '<textarea class="mm-input f-notes" placeholder="Any observations..."></textarea>') +
      '<div class="acc-save-row"><button class="mm-btn mm-btn-primary f-save" style="margin-bottom:0">Save Wall</button>' +
      '<button class="mm-btn mm-btn-danger f-del" style="' + (isNew ? 'display:none;' : '') + 'margin-bottom:0;width:auto;padding:14px 20px">Delete</button></div>';
    if (!isNew) {
      U.sv(infoBody, 'f-name', U.pv(wr, 'name')); U.sv(infoBody, 'f-len', U.pv(wr, 'wall_length')); U.sv(infoBody, 'f-hgt', U.pv(wr, 'wall_height')); U.sv(infoBody, 'f-notes', U.pv(wr, 'notes'));
      U.sr(infoBody, 'base-' + id, U.pv(wr, 'base_molding') || 'no'); U.sr(infoBody, 'crown-' + id, U.pv(wr, 'crown_molding') || 'no'); U.sr(infoBody, 'soffit-' + id, U.pv(wr, 'soffit') || 'no');
      if (U.pv(wr, 'soffit') === 'yes') { infoBody.querySelector('.f-soff-dims').style.display = 'block'; U.sv(infoBody, 'f-sh', U.pv(wr, 'soffit_height')); U.sv(infoBody, 'f-sd', U.pv(wr, 'soffit_depth')); }
    }
    var title = isNew ? 'New Wall' : (U.pv(wr, 'name') || 'Wall'), sub = isNew ? '' : (U.pv(wr, 'wall_length') ? U.pv(wr, 'wall_length') + '" long' : '');
    var builtInfo = U.makeAcc(isNew, true, U.pv(wr, 'name') ? U.pv(wr, 'name') : 'Wall Info', sub, infoBody), infoAcc = builtInfo.acc;

    var mainBody = document.createElement('div'); mainBody.className = 'mm-acc-body';
    mainBody.appendChild(infoAcc);

    var op = makeSub('Wall Openings', 'f-op-list'); op.btn.textContent = '+ Add'; op.list.innerHTML = isNew ? ph : ''; mainBody.appendChild(op.acc);
    var oL = op.list;
    var ap = makeSub('Appliances', 'f-ap-list'); ap.btn.textContent = '+ Add'; ap.list.innerHTML = isNew ? ph : ''; mainBody.appendChild(ap.acc);
    var aL = ap.list;
    var el = makeSub('Electrical', 'f-el-list'); el.btn.textContent = '+ Add'; el.list.innerHTML = isNew ? ph : ''; mainBody.appendChild(el.acc);
    var eL = el.list;
    var pl = makeSub('Plumbing', 'f-pl-list'); pl.btn.textContent = '+ Add'; pl.list.innerHTML = isNew ? ph : ''; mainBody.appendChild(pl.acc);
    var pL = pl.list;

    // Photos & Videos sub-accordion
    var mediaBody = document.createElement('div'); mediaBody.className = 'mm-acc-body';
    var mediaBtnRow = document.createElement('div'); mediaBtnRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px';
    var camBtn = document.createElement('button'); camBtn.className = 'mm-btn-sm mm-btn-primary'; camBtn.textContent = '📷 Camera';
    var upBtn = document.createElement('button'); upBtn.className = 'mm-btn-sm mm-btn-primary'; upBtn.textContent = '📁 Upload';
    mediaBtnRow.appendChild(camBtn); mediaBtnRow.appendChild(upBtn);
    var mediaGalleryEl = document.createElement('div'); mediaGalleryEl.innerHTML = isNew ? ph : '';
    mediaBody.appendChild(mediaBtnRow); mediaBody.appendChild(mediaGalleryEl);
    var mediaAcc = document.createElement('div'); mediaAcc.className = 'mm-acc mm-sub';
    var mediaHdr = document.createElement('div'); mediaHdr.className = 'mm-acc-hdr';
    var mediaBadge = document.createElement('span'); mediaBadge.className = 'mm-acc-badge'; mediaBadge.textContent = '0'; mediaBadge.style.marginLeft = '8px';
    mediaHdr.innerHTML = '<div class="mm-acc-hdr-text"><div class="mm-acc-title">Photos &amp; Videos</div></div><span class="mm-acc-arrow" aria-hidden="true">&#9660;</span>';
    mediaHdr.querySelector('.mm-acc-title').appendChild(mediaBadge);
    mediaHdr.setAttribute('role', 'button'); mediaHdr.setAttribute('tabindex', '0');
    mediaHdr.addEventListener('click', function () { mediaAcc.classList.toggle('open'); });
    mediaHdr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mediaAcc.classList.toggle('open'); } });
    mediaAcc.appendChild(mediaHdr); mediaAcc.appendChild(mediaBody); mainBody.appendChild(mediaAcc);

    function loadWallMedia() {
      if (!wr.id) return;
      mediaGalleryEl.innerHTML = '<div class="mm-empty">Loading...</div>';
      Promise.all([
        api.queryMediaByField(api.PHOTO, 'wall_id', wr.id),
        api.queryMediaByField(api.VIDEO, 'wall_id', wr.id),
      ]).then(function (results) {
        var photos = results[0] || [], videos = results[1] || [];
        var all = [].concat(photos, videos).sort(function (a, b) { return new Date(U.pv(b, 'date_taken')) - new Date(U.pv(a, 'date_taken')); });
        mediaBadge.textContent = all.length;
        if (!all.length) { mediaGalleryEl.innerHTML = '<div class="mm-empty">No photos or videos yet.</div>'; return; }
        mediaGalleryEl.innerHTML = '';
        var grid = MD.makeMediaGrid();
        all.forEach(function (m) { var isVid = photos.indexOf(m) < 0; grid.appendChild(MD.buildMediaThumb(m, isVid, grid, mediaGalleryEl, '', updateWallMediaBadge)); });
        mediaGalleryEl.appendChild(grid);
      }).catch(function (e) { mediaGalleryEl.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
    }
    function updateWallMediaBadge() { var g = mediaGalleryEl.querySelector('.mm-media-grid'); mediaBadge.textContent = g ? g.children.length : 0; }
    function addWallMediaThumb(rec, isVid) {
      var grid = mediaGalleryEl.querySelector('.mm-media-grid');
      if (!grid) { mediaGalleryEl.innerHTML = ''; grid = MD.makeMediaGrid(); mediaGalleryEl.appendChild(grid); }
      grid.insertBefore(MD.buildMediaThumb(rec, isVid, grid, mediaGalleryEl, '', updateWallMediaBadge), grid.firstChild);
      mediaBadge.textContent = grid.children.length;
    }
    function handleWallMediaFile(file) {
      if (!wr.id) { alert('Save the wall first.'); return Promise.resolve(); }
      var isVid = file.type.indexOf('video') === 0;
      return api.uploadMediaFile(file).then(function (url) {
        return api.createPhotoOrVideo(isVid ? api.VIDEO : api.PHOTO, 'Photo – ' + (U.pv(wr, 'name') || 'Wall') + ' – ' + new Date().toISOString().split('T')[0], url, ctx.job.id, ctx.room.id, wr.id);
      }).then(function (rec) {
        var wallLabel = U.pv(wr, 'name') || 'Wall';
        addWallMediaThumb(rec, isVid);
        MD.addMediaThumb(rec, isVid, wallLabel);
        MD.addJobMediaThumb(rec, isVid, ctx.room.id, wallLabel, ctx.room);
      });
    }
    camBtn.addEventListener('click', function () {
      var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,video/*'; input.capture = 'environment';
      input.addEventListener('change', function () {
        if (!input.files[0]) return;
        camBtn.textContent = 'Uploading...'; camBtn.disabled = true;
        handleWallMediaFile(input.files[0]).catch(function (e) { alert(e.message); }).then(function () { camBtn.textContent = '📷 Camera'; camBtn.disabled = false; });
      });
      input.click();
    });
    upBtn.addEventListener('click', function () {
      var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,video/*';
      input.addEventListener('change', function () {
        if (!input.files[0]) return;
        upBtn.textContent = 'Uploading...'; upBtn.disabled = true;
        handleWallMediaFile(input.files[0]).catch(function (e) { alert(e.message); }).then(function () { upBtn.textContent = '📁 Upload'; upBtn.disabled = false; });
      });
      input.click();
    });

    function updateSubCounts() { op.updateCount(); ap.updateCount(); el.updateCount(); pl.updateCount(); }

    var built = U.makeAcc(isNew, false, title, sub, mainBody), acc = built.acc, hdr = built.hdr;
    infoBody.querySelectorAll('input[name="soffit-' + id + '"]').forEach(function (r) {
      r.addEventListener('change', function () { infoBody.querySelector('.f-soff-dims').style.display = this.value === 'yes' ? 'block' : 'none'; });
    });
    var sb = infoBody.querySelector('.f-save'), db = infoBody.querySelector('.f-del');
    U.watchDirty(infoBody, sb);
    function activate() {
      U.loadSub(oL, wr.id, A.oW, 'custom_objects.wall_opening', function (r) { return EN.buildOpeningAcc(r, wr.id, updateSubCounts); }, updateSubCounts);
      U.loadSub(aL, wr.id, A.aW, 'custom_objects.appliance', function (r) { return EN.buildApplianceAcc(r, wr.id, updateSubCounts); }, updateSubCounts);
      U.loadSub(eL, wr.id, A.eW, 'custom_objects.electrical', function (r) { return EN.buildElectricalAcc(r, wr.id, updateSubCounts); }, updateSubCounts);
      U.loadSub(pL, wr.id, A.pW, 'custom_objects.plumbing', function (r) { return EN.buildPlumbingAcc(r, wr.id, false, updateSubCounts); }, updateSubCounts);
      loadWallMedia();
    }
    if (!isNew) activate();
    sb.addEventListener('click', function () {
      var n = U.gv(infoBody, 'f-name'); if (!n) { alert('Wall name required.'); return; }
      var p = { name: n }, l = U.gv(infoBody, 'f-len'), h = U.gv(infoBody, 'f-hgt'), nt = U.gv(infoBody, 'f-notes');
      if (l) p.wall_length = parseFloat(l); if (h) p.wall_height = parseFloat(h); if (nt) p.notes = nt;
      p.base_molding = U.gr(infoBody, 'base-' + id); p.crown_molding = U.gr(infoBody, 'crown-' + id); p.soffit = U.gr(infoBody, 'soffit-' + id);
      if (p.soffit === 'yes') { var sh = U.gv(infoBody, 'f-sh'), sd = U.gv(infoBody, 'f-sd'); if (sh) p.soffit_height = parseFloat(sh); if (sd) p.soffit_depth = parseFloat(sd); }
      sb.textContent = 'Saving...'; sb.disabled = true;
      var pr;
      if (!wr.id) {
        pr = api.makeRec('custom_objects.wall', p).then(function (rec) {
          return api.makeRel(A.wR, ctx.room.id, rec.id).then(function () { wr.id = rec.id; wr.properties = p; db.style.display = ''; activate(); });
        });
      } else {
        pr = api.updateRec('custom_objects.wall', wr.id, p).then(function () { Object.assign(wr.properties || (wr.properties = {}), p); });
      }
      pr.then(function () {
        hdr.querySelector('.mm-acc-title').textContent = n;
        hdr.querySelector('.mm-acc-sub').textContent = l ? l + '" long' : '';
        U.clearDirty(sb); U.fbk(sb, 'Save Wall');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save Wall'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!wr.id || !confirm('Delete this wall?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.wall', wr.id).then(function () { acc.remove(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    function addSub(listEl, builderFn) {
      if (!wr.id) { alert('Save the wall first.'); return; }
      U.clearIfPlaceholder(listEl);
      var na = builderFn(); listEl.appendChild(na); na.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      updateSubCounts();
    }
    op.btn.addEventListener('click', function () { addSub(oL, function () { return EN.buildOpeningAcc(null, wr.id, updateSubCounts); }); });
    ap.btn.addEventListener('click', function () { addSub(aL, function () { return EN.buildApplianceAcc(null, wr.id, updateSubCounts); }); });
    el.btn.addEventListener('click', function () { addSub(eL, function () { return EN.buildElectricalAcc(null, wr.id, updateSubCounts); }); });
    pl.btn.addEventListener('click', function () { addSub(pL, function () { return EN.buildPlumbingAcc(null, wr.id, false, updateSubCounts); }); });
    return acc;
  }

  function buildIslandAcc(r, ctx) {
    // ctx = { room }
    var isNew = !r || !r.id, ir = r || { id: null, properties: {} }, id = U.uid();
    var ph = '<div class="mm-empty">Save island first.</div>';

    var infoBody = document.createElement('div'); infoBody.className = 'mm-acc-body';
    infoBody.innerHTML =
      U.fld('Island Name', '<input class="mm-input f-name" placeholder="e.g. Center Island">') +
      U.fld('Length (in)', '<input class="mm-input f-len" type="number" placeholder="e.g. 60">') +
      U.fld('Width (in)', '<input class="mm-input f-wid" type="number" placeholder="e.g. 36">') +
      U.fld('Outlet', U.radios('iout-' + id, [['yes', 'Yes'], ['no', 'No']], 'no')) +
      U.fld('Second Level', U.radios('isec-' + id, [['yes', 'Yes'], ['no', 'No']], 'no')) +
      U.fld('Notes', '<textarea class="mm-input f-notes" placeholder="Any observations..."></textarea>') +
      '<div class="acc-save-row"><button class="mm-btn mm-btn-primary f-save" style="margin-bottom:0">Save Island</button>' +
      '<button class="mm-btn mm-btn-danger f-del" style="' + (isNew ? 'display:none;' : '') + 'margin-bottom:0;width:auto;padding:14px 20px">Delete</button></div>';
    if (!isNew) { U.sv(infoBody, 'f-name', U.pv(ir, 'name')); U.sv(infoBody, 'f-len', U.pv(ir, 'length')); U.sv(infoBody, 'f-wid', U.pv(ir, 'width')); U.sv(infoBody, 'f-notes', U.pv(ir, 'notes')); U.sr(infoBody, 'iout-' + id, U.pv(ir, 'outlet') || 'no'); U.sr(infoBody, 'isec-' + id, U.pv(ir, 'second_level') || 'no'); }
    var l0 = U.pv(ir, 'length'), w0 = U.pv(ir, 'width');
    var builtInfo = U.makeAcc(isNew, true, U.pv(ir, 'name') ? U.pv(ir, 'name') : 'Island Info', l0 && w0 ? l0 + '" x ' + w0 + '"' : '', infoBody), infoAcc = builtInfo.acc;

    var mainBody = document.createElement('div'); mainBody.className = 'mm-acc-body';
    mainBody.appendChild(infoAcc);

    var pl = makeSub('Plumbing', 'f-pl-list'); pl.btn.textContent = '+ Add'; pl.list.innerHTML = isNew ? ph : ''; mainBody.appendChild(pl.acc);
    var pL = pl.list;

    var title = isNew ? 'New Island' : (U.pv(ir, 'name') || 'Island'), sub = isNew ? '' : (l0 && w0 ? l0 + '" x ' + w0 + '"' : l0 ? l0 + '" L' : w0 ? w0 + '" W' : '');
    var built = U.makeAcc(isNew, false, title, sub, mainBody), acc = built.acc, hdr = built.hdr;
    var sb = infoBody.querySelector('.f-save'), db = infoBody.querySelector('.f-del');
    U.watchDirty(infoBody, sb);
    function activateP() { U.loadSub(pL, ir.id, A.plI, 'custom_objects.plumbing', function (r) { return EN.buildPlumbingAcc(r, ir.id, true, pl.updateCount); }, pl.updateCount); }
    if (!isNew) activateP();
    sb.addEventListener('click', function () {
      var n = U.gv(infoBody, 'f-name'); if (!n) { alert('Island name required.'); return; }
      var p = { name: n }, l = U.gv(infoBody, 'f-len'), w = U.gv(infoBody, 'f-wid'), nt = U.gv(infoBody, 'f-notes');
      if (l) p.length = parseFloat(l); if (w) p.width = parseFloat(w); if (nt) p.notes = nt;
      p.outlet = U.gr(infoBody, 'iout-' + id); p.second_level = U.gr(infoBody, 'isec-' + id);
      sb.textContent = 'Saving...'; sb.disabled = true;
      var pr;
      if (!ir.id) {
        pr = api.makeRec('custom_objects.island', p).then(function (rec) {
          return api.makeRel(A.iR, rec.id, ctx.room.id).then(function () { ir.id = rec.id; ir.properties = p; db.style.display = ''; activateP(); });
        });
      } else {
        pr = api.updateRec('custom_objects.island', ir.id, p).then(function () { Object.assign(ir.properties || (ir.properties = {}), p); });
      }
      pr.then(function () {
        hdr.querySelector('.mm-acc-title').textContent = n;
        hdr.querySelector('.mm-acc-sub').textContent = l && w ? l + '" x ' + w + '"' : l ? l + '" L' : w ? w + '" W' : '';
        U.clearDirty(sb); U.fbk(sb, 'Save Island');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save Island'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!ir.id || !confirm('Delete this island?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.island', ir.id).then(function () { acc.remove(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    pl.btn.addEventListener('click', function () {
      if (!ir.id) { alert('Save the island first.'); return; }
      U.clearIfPlaceholder(pL);
      var na = EN.buildPlumbingAcc(null, ir.id, true, pl.updateCount); pL.appendChild(na); na.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      pl.updateCount();
    });
    return acc;
  }

  window.MM.walls = { buildWallAcc: buildWallAcc, buildIslandAcc: buildIslandAcc };
})();
