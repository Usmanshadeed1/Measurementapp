// js/entities.js
// Accordion builders for the leaf entities that hang off a wall or island:
// Plumbing, Electrical, Appliance, Opening. Same fields/behavior as the
// original build, just split out into their own module.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, A = api.A;

  var OL = { window: 'Window', door: 'Door', opening: 'Opening' };
  var EL = { outlet: 'Outlet', switch: 'Switch' };
  var PL = { sink: 'Sink', dishwasher: 'Dishwasher', refrigerator_water_line: 'Refrigerator Water Line', other: 'Other' };

  function saveRow(isNew) {
    return '<div class="acc-save-row"><button class="mm-btn mm-btn-primary f-save" style="margin-bottom:0">Save</button>' +
      '<button class="mm-btn mm-btn-danger f-del" style="' + (isNew ? 'display:none;' : '') + 'margin-bottom:0;width:auto;padding:14px 20px">Delete</button></div>';
  }

  // ===== PLUMBING =====
  function buildPlumbingAcc(r, parentId, isIsland, onDelete) {
    var isNew = !r || !r.id, rec = r || { id: null, properties: {} };
    var body = document.createElement('div'); body.className = 'mm-acc-body';
    body.innerHTML =
      U.fld('Type', U.sel('f-type', [['sink', 'Sink'], ['dishwasher', 'Dishwasher'], ['refrigerator_water_line', 'Refrigerator Water Line'], ['other', 'Other']])) +
      U.fld('Distance from Left Corner (in)', '<input class="mm-input f-left" type="number">') +
      U.fld('Distance from Right Corner (in)', '<input class="mm-input f-right" type="number">') +
      U.fld('Notes', '<textarea class="mm-input f-notes"></textarea>') +
      saveRow(isNew);
    if (!isNew) {
      if (U.pv(rec, 'type')) body.querySelector('.f-type').value = U.pv(rec, 'type');
      U.sv(body, 'f-left', U.pv(rec, 'distance_from_left_corner')); U.sv(body, 'f-right', U.pv(rec, 'distance_from_right_corner')); U.sv(body, 'f-notes', U.pv(rec, 'notes'));
    }
    var title = isNew ? 'New Plumbing' : (PL[U.pv(rec, 'type')] || U.pv(rec, 'type') || 'Plumbing');
    var sub = isNew ? '' : (U.pv(rec, 'distance_from_left_corner') ? 'Left: ' + U.pv(rec, 'distance_from_left_corner') + '"' : '');
    var built = U.makeAcc(isNew, true, title, sub, body), acc = built.acc, hdr = built.hdr;
    var sb = body.querySelector('.f-save'), db = body.querySelector('.f-del');
    U.watchDirty(body, sb);
    sb.addEventListener('click', function () {
      var type = body.querySelector('.f-type').value;
      var p = { name: PL[type] || type, type: type }, l = U.gv(body, 'f-left'), r2 = U.gv(body, 'f-right'), nt = U.gv(body, 'f-notes');
      if (l) p.distance_from_left_corner = parseFloat(l); if (r2) p.distance_from_right_corner = parseFloat(r2); if (nt) p.notes = nt;
      sb.textContent = 'Saving...'; sb.disabled = true;
      var assocId = isIsland ? A.plI : A.pW;
      var pr = rec.id ? api.updateRec('custom_objects.plumbing', rec.id, p) : api.makeRec('custom_objects.plumbing', p).then(function (nr) { return api.makeRel(assocId, nr.id, parentId).then(function () { rec.id = nr.id; db.style.display = ''; }); });
      pr.then(function () {
        Object.assign(rec.properties || (rec.properties = {}), p);
        hdr.querySelector('.mm-acc-title').textContent = PL[type] || type;
        hdr.querySelector('.mm-acc-sub').textContent = l ? 'Left: ' + l + '"' : '';
        U.clearDirty(sb); U.fbk(sb, 'Save');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!rec.id || !confirm('Delete?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.plumbing', rec.id).then(function () { acc.remove(); if (onDelete) onDelete(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    return acc;
  }

  // ===== ELECTRICAL =====
  function buildElectricalAcc(r, wallId, onDelete) {
    var isNew = !r || !r.id, rec = r || { id: null, properties: {} };
    var id = U.uid(), body = document.createElement('div'); body.className = 'mm-acc-body';
    body.innerHTML =
      U.fld('Type', U.radios('el-' + id, [['outlet', 'Outlet'], ['switch', 'Switch']], isNew ? 'outlet' : (U.pv(rec, 'type') || 'outlet'))) +
      U.fld('Distance from Left Corner (in)', '<input class="mm-input f-left" type="number">') +
      U.fld('Distance from Right Corner (in)', '<input class="mm-input f-right" type="number">') +
      U.fld('Notes', '<textarea class="mm-input f-notes"></textarea>') +
      saveRow(isNew);
    if (!isNew) { U.sv(body, 'f-left', U.pv(rec, 'distance_from_left_corner')); U.sv(body, 'f-right', U.pv(rec, 'distance_from_right_corner')); U.sv(body, 'f-notes', U.pv(rec, 'notes')); }
    var title = isNew ? 'New Outlet/Switch' : (EL[U.pv(rec, 'type')] || U.pv(rec, 'type') || 'Electrical');
    var sub = isNew ? '' : (U.pv(rec, 'distance_from_left_corner') ? 'Left: ' + U.pv(rec, 'distance_from_left_corner') + '"' : '');
    var built = U.makeAcc(isNew, true, title, sub, body), acc = built.acc, hdr = built.hdr;
    var sb = body.querySelector('.f-save'), db = body.querySelector('.f-del');
    U.watchDirty(body, sb);
    sb.addEventListener('click', function () {
      var type = U.gr(body, 'el-' + id) || 'outlet';
      var p = { name: EL[type] || type, type: type }, l = U.gv(body, 'f-left'), r2 = U.gv(body, 'f-right'), nt = U.gv(body, 'f-notes');
      if (l) p.distance_from_left_corner = parseFloat(l); if (r2) p.distance_from_right_corner = parseFloat(r2); if (nt) p.notes = nt;
      sb.textContent = 'Saving...'; sb.disabled = true;
      var pr = rec.id ? api.updateRec('custom_objects.electrical', rec.id, p) : api.makeRec('custom_objects.electrical', p).then(function (nr) { return api.makeRel(A.eW, nr.id, wallId).then(function () { rec.id = nr.id; db.style.display = ''; }); });
      pr.then(function () {
        Object.assign(rec.properties || (rec.properties = {}), p);
        hdr.querySelector('.mm-acc-title').textContent = EL[type] || type;
        hdr.querySelector('.mm-acc-sub').textContent = l ? 'Left: ' + l + '"' : '';
        U.clearDirty(sb); U.fbk(sb, 'Save');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!rec.id || !confirm('Delete?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.electrical', rec.id).then(function () { acc.remove(); if (onDelete) onDelete(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    return acc;
  }

  // ===== APPLIANCE =====
  function buildApplianceAcc(r, wallId, onDelete) {
    var isNew = !r || !r.id, rec = r || { id: null, properties: {} };
    var body = document.createElement('div'); body.className = 'mm-acc-body';
    body.innerHTML =
      U.fld('Appliance Name', '<input class="mm-input f-name" placeholder="e.g. Refrigerator">') +
      U.fld('Width (in)', '<input class="mm-input f-width" type="number">') +
      U.fld('Distance from Left Corner (in)', '<input class="mm-input f-left" type="number">') +
      U.fld('Distance from Right Corner (in)', '<input class="mm-input f-right" type="number">') +
      U.fld('Notes', '<textarea class="mm-input f-notes"></textarea>') +
      saveRow(isNew);
    if (!isNew) { U.sv(body, 'f-name', U.pv(rec, 'name')); U.sv(body, 'f-width', U.pv(rec, 'width')); U.sv(body, 'f-left', U.pv(rec, 'distance_from_left_corner')); U.sv(body, 'f-right', U.pv(rec, 'distance_from_right_corner')); U.sv(body, 'f-notes', U.pv(rec, 'notes')); }
    var title = isNew ? 'New Appliance' : (U.pv(rec, 'name') || 'Appliance');
    var sub = isNew ? '' : [U.pv(rec, 'width') ? 'W: ' + U.pv(rec, 'width') + '"' : '', U.pv(rec, 'distance_from_left_corner') ? 'Left: ' + U.pv(rec, 'distance_from_left_corner') + '"' : ''].filter(Boolean).join(' · ');
    var built = U.makeAcc(isNew, true, title, sub, body), acc = built.acc, hdr = built.hdr;
    var sb = body.querySelector('.f-save'), db = body.querySelector('.f-del');
    U.watchDirty(body, sb);
    sb.addEventListener('click', function () {
      var n = U.gv(body, 'f-name'); if (!n) { alert('Name required.'); return; }
      var p = { name: n }, w = U.gv(body, 'f-width'), l = U.gv(body, 'f-left'), r2 = U.gv(body, 'f-right'), nt = U.gv(body, 'f-notes');
      if (w) p.width = parseFloat(w); if (l) p.distance_from_left_corner = parseFloat(l); if (r2) p.distance_from_right_corner = parseFloat(r2); if (nt) p.notes = nt;
      sb.textContent = 'Saving...'; sb.disabled = true;
      var pr = rec.id ? api.updateRec('custom_objects.appliance', rec.id, p) : api.makeRec('custom_objects.appliance', p).then(function (nr) { return api.makeRel(A.aW, nr.id, wallId).then(function () { rec.id = nr.id; db.style.display = ''; }); });
      pr.then(function () {
        Object.assign(rec.properties || (rec.properties = {}), p);
        hdr.querySelector('.mm-acc-title').textContent = n;
        hdr.querySelector('.mm-acc-sub').textContent = [w ? 'W: ' + w + '"' : '', l ? 'Left: ' + l + '"' : ''].filter(Boolean).join(' · ');
        U.clearDirty(sb); U.fbk(sb, 'Save');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!rec.id || !confirm('Delete?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.appliance', rec.id).then(function () { acc.remove(); if (onDelete) onDelete(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    return acc;
  }

  // ===== OPENING =====
  function buildOpeningAcc(r, wallId, onDelete) {
    var isNew = !r || !r.id, rec = r || { id: null, properties: {} };
    var body = document.createElement('div'); body.className = 'mm-acc-body';
    body.innerHTML =
      U.fld('Type', U.sel('f-type', [['window', 'Window'], ['door', 'Door'], ['opening', 'Opening']])) +
      U.fld('Opening Width (in)', '<input class="mm-input f-ow" type="number">') +
      U.fld('Opening Height (in)', '<input class="mm-input f-oh" type="number">') +
      U.fld('Distance from Left Wall (in)', '<input class="mm-input f-left" type="number">') +
      U.fld('Distance from Right Wall (in)', '<input class="mm-input f-right" type="number">') +
      U.fld('Trim Width (in)', '<input class="mm-input f-tw" type="number">') +
      U.fld('Trim Height (in)', '<input class="mm-input f-th" type="number">') +
      U.fld('Notes', '<textarea class="mm-input f-notes"></textarea>') +
      saveRow(isNew);
    if (!isNew) {
      if (U.pv(rec, 'type')) body.querySelector('.f-type').value = U.pv(rec, 'type');
      U.sv(body, 'f-ow', U.pv(rec, 'opening_width')); U.sv(body, 'f-oh', U.pv(rec, 'opening_height'));
      U.sv(body, 'f-left', U.pv(rec, 'distance_from_left_corner')); U.sv(body, 'f-right', U.pv(rec, 'distance_from_right_corner'));
      U.sv(body, 'f-tw', U.pv(rec, 'trim_width')); U.sv(body, 'f-th', U.pv(rec, 'trim_height')); U.sv(body, 'f-notes', U.pv(rec, 'notes'));
    }
    var title = isNew ? 'New Opening' : (OL[U.pv(rec, 'type')] || U.pv(rec, 'type') || 'Opening');
    var sub = isNew ? '' : [U.pv(rec, 'opening_width') ? U.pv(rec, 'opening_width') + '" W' : '', U.pv(rec, 'opening_height') ? U.pv(rec, 'opening_height') + '" H' : ''].filter(Boolean).join(' · ');
    var built = U.makeAcc(isNew, true, title, sub, body), acc = built.acc, hdr = built.hdr;
    var sb = body.querySelector('.f-save'), db = body.querySelector('.f-del');
    U.watchDirty(body, sb);
    sb.addEventListener('click', function () {
      var type = body.querySelector('.f-type').value;
      var p = { name: OL[type] || type, type: type };
      [['f-ow', 'opening_width'], ['f-oh', 'opening_height'], ['f-left', 'distance_from_left_corner'], ['f-right', 'distance_from_right_corner'], ['f-tw', 'trim_width'], ['f-th', 'trim_height']].forEach(function (pair) {
        var v = U.gv(body, pair[0]); if (v) p[pair[1]] = parseFloat(v);
      });
      var nt = U.gv(body, 'f-notes'); if (nt) p.notes = nt;
      sb.textContent = 'Saving...'; sb.disabled = true;
      var pr = rec.id ? api.updateRec('custom_objects.wall_opening', rec.id, p) : api.makeRec('custom_objects.wall_opening', p).then(function (nr) { return api.makeRel(A.oW, wallId, nr.id).then(function () { rec.id = nr.id; db.style.display = ''; }); });
      pr.then(function () {
        Object.assign(rec.properties || (rec.properties = {}), p);
        hdr.querySelector('.mm-acc-title').textContent = OL[type] || type;
        hdr.querySelector('.mm-acc-sub').textContent = [p.opening_width ? p.opening_width + '" W' : '', p.opening_height ? p.opening_height + '" H' : ''].filter(Boolean).join(' · ');
        U.clearDirty(sb); U.fbk(sb, 'Save');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!rec.id || !confirm('Delete?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.wall_opening', rec.id).then(function () { acc.remove(); if (onDelete) onDelete(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    return acc;
  }

  window.MM.entities = {
    buildPlumbingAcc: buildPlumbingAcc,
    buildElectricalAcc: buildElectricalAcc,
    buildApplianceAcc: buildApplianceAcc,
    buildOpeningAcc: buildOpeningAcc,
  };
})();
