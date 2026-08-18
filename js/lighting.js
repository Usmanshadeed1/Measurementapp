// js/lighting.js
// Lighting fixture accordion (room-level, no sub-entities).
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, A = api.A;

  function buildLightAcc(r, ctx) {
    // ctx = { room }
    var isNew = !r || !r.id, rec = r || { id: null, properties: {} };

    var infoBody = document.createElement('div'); infoBody.className = 'mm-acc-body';
    infoBody.innerHTML =
      U.fld('Fixture Name', '<input class="mm-input f-name" placeholder="Lighting">') +
      U.fld('Type', U.sel('f-type', [['recessed', 'Recessed'], ['pendant', 'Pendant'], ['overhead', 'Overhead'], ['under_cabinet', 'Under Cabinet'], ['range_hood', 'Range Hood'], ['exhaust_fan', 'Exhaust Fan'], ['other', 'Other']])) +
      U.fld('Quantity', '<input class="mm-input f-qty" type="number">') +
      U.fld('Notes', '<textarea class="mm-input f-notes"></textarea>') +
      '<div class="acc-save-row"><button class="mm-btn mm-btn-primary f-save" style="margin-bottom:0">Save Fixture</button>' +
      '<button class="mm-btn mm-btn-danger f-del" style="' + (isNew ? 'display:none;' : '') + 'margin-bottom:0;width:auto;padding:14px 20px">Delete</button></div>';
    if (!isNew) { U.sv(infoBody, 'f-name', U.pv(rec, 'name')); if (U.pv(rec, 'type')) infoBody.querySelector('.f-type').value = U.pv(rec, 'type'); U.sv(infoBody, 'f-qty', U.pv(rec, 'quantity')); U.sv(infoBody, 'f-notes', U.pv(rec, 'notes')); }
    var builtInfo = U.makeAcc(isNew, true, U.pv(rec, 'name') ? U.pv(rec, 'name') : 'Lighting Info', [U.pv(rec, 'type'), U.pv(rec, 'quantity') ? 'Qty: ' + U.pv(rec, 'quantity') : ''].filter(Boolean).join(' · '), infoBody), infoAcc = builtInfo.acc;

    var mainBody = document.createElement('div'); mainBody.className = 'mm-acc-body';
    mainBody.appendChild(infoAcc);

    var title = isNew ? 'New Fixture' : (U.pv(rec, 'name') || 'Lighting'), sub = isNew ? '' : [U.pv(rec, 'type'), U.pv(rec, 'quantity') ? 'Qty: ' + U.pv(rec, 'quantity') : ''].filter(Boolean).join(' · ');
    var built = U.makeAcc(isNew, false, title, sub, mainBody), acc = built.acc, hdr = built.hdr;
    var sb = infoBody.querySelector('.f-save'), db = infoBody.querySelector('.f-del');
    U.watchDirty(infoBody, sb);
    sb.addEventListener('click', function () {
      var n = U.gv(infoBody, 'f-name') || 'Lighting', type = infoBody.querySelector('.f-type').value;
      var p = { name: n, type: type }, q = U.gv(infoBody, 'f-qty'), nt = U.gv(infoBody, 'f-notes');
      if (q) p.quantity = parseFloat(q); if (nt) p.notes = nt;
      sb.textContent = 'Saving...'; sb.disabled = true;
      var pr = rec.id ? api.updateRec('custom_objects.lighting_fixture', rec.id, p) : api.makeRec('custom_objects.lighting_fixture', p).then(function (nr) { return api.makeRel(A.lR, nr.id, ctx.room.id).then(function () { rec.id = nr.id; db.style.display = ''; }); });
      pr.then(function () {
        Object.assign(rec.properties || (rec.properties = {}), p);
        hdr.querySelector('.mm-acc-title').textContent = n;
        hdr.querySelector('.mm-acc-sub').textContent = [type, q ? 'Qty: ' + q : ''].filter(Boolean).join(' · ');
        U.clearDirty(sb); U.fbk(sb, 'Save Fixture');
      }).catch(function (e) { alert(e.message); sb.textContent = 'Save Fixture'; sb.disabled = false; });
    });
    db.addEventListener('click', function () {
      if (!rec.id || !confirm('Delete?')) return;
      db.disabled = true;
      api.deleteRec('custom_objects.lighting_fixture', rec.id).then(function () { acc.remove(); }).catch(function (e) { alert(e.message); db.disabled = false; });
    });
    return acc;
  }

  window.MM.lighting = { buildLightAcc: buildLightAcc };
})();
