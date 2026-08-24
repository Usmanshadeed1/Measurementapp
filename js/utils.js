// js/utils.js
// Shared helpers used across features: escaping, form field builders,
// the accordion widget, dirty-state tracking, and the font-size control.
window.MM = window.MM || {};

(function () {
  // Steps a person can actually see. Seven near-identical sizes meant a tap
  // changed almost nothing, so the control read as broken; five clear jumps
  // make each press obvious. Index 1 is the default.
  var FONT_SIZES = [17, 20, 24, 28, 34];

  // ---- Matching how GoHighLevel displays things ---------------------------
  //
  // GHL prettifies names and phone numbers on screen while storing them raw.
  // The app was showing the raw values, so the same person looked different
  // in the two places. These do what GHL's own UI does.

  // "anitha sura" -> "Anitha Sura". Hyphenated and O'Brien style names keep
  // their inner capitals, which a plain word-split would flatten.
  function titleCase(str) {
    return String(str || '').replace(/[^\s\-']+/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  // "+17328411520" -> "(732) 841-1520". Anything that is not a plain US
  // number is left exactly as stored rather than mangled into a wrong shape.
  function phone(v) {
    var raw = String(v || '').trim();
    if (!raw) return '';
    var d = raw.replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if (d.length !== 10) return raw;
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  // A link that opens this customer in GoHighLevel.
  //
  // Calling from the app itself is not possible — GoHighLevel has no API for
  // placing a call. A plain tel: link dials from the staff member's own SIM,
  // so the customer sees a personal number and GoHighLevel never records the
  // call. Handing the customer over to GoHighLevel instead means the call
  // goes out on the business number the staff member is set up with, and it
  // lands in the conversation history like any other call.
  function ghlContactUrl(contactId) {
    if (!contactId) return '';
    return 'https://app.gohighlevel.com/v2/location/' +
      encodeURIComponent(window.MM.api.LOC) +
      '/contacts/detail/' + encodeURIComponent(contactId);
  }

  // The buttons shown wherever a customer's number appears.
  //
  // The first opens the customer in GoHighLevel, where calling, texting and
  // email all live on one screen — hence "Contact Conversation" rather than a
  // name that mentions only calling. Because the staff member is signed into
  // GoHighLevel as themselves there, whatever they send goes out on their own
  // business number and is recorded against them. The app cannot do that on
  // its own: it holds one shared key, so GoHighLevel would attribute every
  // message to the integration instead of to a person.
  //
  // The direct dial is kept beside it for a quick call where none of that
  // matters. It uses the phone's own SIM, so nothing is recorded.
  function callButtons(phoneNumber, contactId) {
    if (!phoneNumber) return '';
    var out = '<span class="mm-callrow">';
    if (contactId) {
      out += '<a class="mm-callbtn mm-callbtn-ghl" href="' + esc(ghlContactUrl(contactId)) + '" ' +
        'target="_blank" rel="noopener">' +
        '<span aria-hidden="true">&#128222;</span> Contact Conversation</a>';
    }
    out += '<a class="mm-callbtn mm-callbtn-direct" href="tel:' + esc(phoneNumber) + '" ' +
      'aria-label="Call directly from this phone">Direct call</a></span>';
    return out;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function pv(r, k) { return (r && r.properties && r.properties[k]) || ''; }
  function uid() { return Math.random().toString(36).substr(2, 8); }

  function fbk(btn, lbl) {
    btn.textContent = 'Saved ✓';
    btn.style.background = 'var(--success)';
    btn.style.color = '#04220f';
    setTimeout(function () {
      btn.textContent = lbl || 'Save';
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2000);
  }

  // ---- Font size control -------------------------------------------------
  function getFontIndex() {
    var i = parseInt(localStorage.getItem('mm_font_idx'), 10);
    if (isNaN(i)) return 1;
    // The scale shrank from seven steps to five; an old saved index could
    // otherwise point past the end and silently clamp to the largest size.
    return Math.max(0, Math.min(FONT_SIZES.length - 1, i));
  }
  function applyFont(i) {
    i = Math.max(0, Math.min(FONT_SIZES.length - 1, i));
    localStorage.setItem('mm_font_idx', i);
    // Set on the root rather than #mm-app so the sign-in screen, which lives
    // outside it, scales with everything else.
    document.documentElement.style.fontSize = FONT_SIZES[i] + 'px';
    var app = document.getElementById('mm-app');
    if (app) app.style.fontSize = FONT_SIZES[i] + 'px';
    // The buttons stop responding at either end; saying so beats a dead tap.
    document.querySelectorAll('.mm-font-down').forEach(function (b) { b.disabled = i === 0; });
    document.querySelectorAll('.mm-font-up').forEach(function (b) {
      b.disabled = i === FONT_SIZES.length - 1;
    });
  }

  // ---- Theme (dark / light) control ---------------------------------------
  // Every screen has its own topbar, so there can be more than one toggle
  // button in the DOM at once — update all of them, not just one by id.
  function getTheme() {
    var t = localStorage.getItem('mm_theme');
    return (t === 'light' || t === 'dark') ? t : 'dark';
  }
  function applyTheme(theme) {
    theme = theme === 'light' ? 'light' : 'dark';
    localStorage.setItem('mm_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    var goingTo = theme === 'light' ? 'dark' : 'light';
    document.querySelectorAll('.mm-theme-toggle').forEach(function (btn) {
      btn.textContent = theme === 'light' ? '🌙' : '☀️';
      btn.setAttribute('aria-label', 'Switch to ' + goingTo + ' mode');
    });
  }
  function toggleTheme() { applyTheme(getTheme() === 'light' ? 'dark' : 'light'); }

  // ---- Form field builders ------------------------------------------------
  function fld(label, inputHtml) {
    return '<div class="mm-field-group"><label class="mm-label">' + esc(label) + '</label>' + inputHtml + '</div>';
  }
  function radios(name, opts, def) {
    return '<div class="mm-radio-row">' + opts.map(function (o) {
      return '<label><input type="radio" name="' + name + '" value="' + o[0] + '"' + (o[0] === (def || 'no') ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
    }).join('') + '</div>';
  }
  function sel(cls, opts) {
    return '<select class="mm-select ' + cls + '">' + opts.map(function (o) {
      return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function gv(el, cls) { var e = el.querySelector('.' + cls); return e ? e.value || '' : ''; }
  function sv(el, cls, v) { var e = el.querySelector('.' + cls); if (e) e.value = v || ''; }
  function gr(el, name) { var e = el.querySelector('input[name="' + name + '"]:checked'); return e ? e.value : ''; }
  function sr(el, name, v) { var e = el.querySelector('input[name="' + name + '"][value="' + (v || 'no') + '"]'); if (e) e.checked = true; }
  function clearIfPlaceholder(el) { if (!el.querySelector('.mm-acc')) el.innerHTML = ''; }

  // ---- Dirty-state tracking (drives the floating Save button) ------------
  var pendingBtns = new Set();
  function markDirty(saveBtn) { pendingBtns.add(saveBtn); updateFloatBtn(); }
  function clearDirty(saveBtn) { pendingBtns.delete(saveBtn); updateFloatBtn(); }
  function updateFloatBtn() {
    var btn = document.getElementById('mm-float-save');
    if (btn) btn.style.display = pendingBtns.size ? 'inline-block' : 'none';
  }
  function watchDirty(bodyEl, saveBtn) {
    bodyEl.querySelectorAll('input,select,textarea').forEach(function (el) {
      el.addEventListener('change', function () { markDirty(saveBtn); });
      el.addEventListener('input', function () { markDirty(saveBtn); });
    });
  }
  function getPendingButtons() { return Array.from(pendingBtns); }

  // ---- Accordion core ------------------------------------------------------
  function makeAcc(isNew, isSub, titleText, subText, bodyEl) {
    var acc = document.createElement('div');
    acc.className = 'mm-acc' + (isSub ? ' mm-sub' : '') + (isNew ? ' open' : '');
    var hdr = document.createElement('div');
    hdr.className = 'mm-acc-hdr';
    hdr.setAttribute('role', 'button');
    hdr.setAttribute('tabindex', '0');
    hdr.setAttribute('aria-expanded', isNew ? 'true' : 'false');
    hdr.innerHTML = '<div class="mm-acc-hdr-text"><div class="mm-acc-title">' + esc(titleText) + '</div><div class="mm-acc-sub">' + esc(subText) + '</div></div><span class="mm-acc-arrow" aria-hidden="true">&#9660;</span>';
    function toggle() {
      var open = acc.classList.toggle('open');
      hdr.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    hdr.addEventListener('click', toggle);
    hdr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    acc.appendChild(hdr);
    acc.appendChild(bodyEl);
    return { acc: acc, hdr: hdr, body: bodyEl };
  }

  function loadSub(listEl, parentId, aId, sk, builderFn, onComplete) {
    listEl.innerHTML = '<div class="mm-empty">Loading...</div>';
    window.MM.api.rels(parentId, aId).then(function (ids) {
      if (!ids.length) { listEl.innerHTML = '<div class="mm-empty">None yet.</div>'; if (onComplete) onComplete(); return; }
      return Promise.all(ids.map(function (id) { return window.MM.api.getRec(sk, id); })).then(function (rs) {
        listEl.innerHTML = '';
        rs.filter(Boolean).forEach(function (r) { listEl.appendChild(builderFn(r)); });
        if (onComplete) onComplete();
      });
    }).catch(function (e) { listEl.innerHTML = '<div class="mm-empty">' + esc(e.message) + '</div>'; if (onComplete) onComplete(); });
  }

  window.MM.utils = {
    esc: esc, titleCase: titleCase, phone: phone, ghlContactUrl: ghlContactUrl, callButtons: callButtons, pv: pv, uid: uid, fbk: fbk,
    FONT_SIZES: FONT_SIZES, getFontIndex: getFontIndex, applyFont: applyFont,
    getTheme: getTheme, applyTheme: applyTheme, toggleTheme: toggleTheme,
    fld: fld, radios: radios, sel: sel, gv: gv, sv: sv, gr: gr, sr: sr, clearIfPlaceholder: clearIfPlaceholder,
    markDirty: markDirty, clearDirty: clearDirty, updateFloatBtn: updateFloatBtn, watchDirty: watchDirty, getPendingButtons: getPendingButtons,
    makeAcc: makeAcc, loadSub: loadSub,
  };
})();
