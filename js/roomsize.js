// js/roomsize.js
// Two things that belong to a room rather than to the job: its size, and the
// cabinet doors going into it.
//
// SIZE. A room is measured in sections because rooms are rarely rectangles.
// An L-shaped kitchen is two rectangles; a room with an alcove is two. Each
// section is a width and a length, and the room's area is their total.
//
// Measurements are entered in INCHES, matching the tape in the measurer's hand
// and the ceiling height already stored that way. Area is shown in SQUARE FEET,
// which is how flooring and countertop are quoted. Inches are echoed back as
// feet and inches, because 114 is hard to picture and 9' 6" is not.
//
// Sections are not named: asked for directly, and a name is one more thing to
// type while holding a tape measure.
//
// DOORS. Kept here rather than on the job because the kitchen, the island and
// the pantry each take a different door, and the order is placed per room.
//
// Both store one record per line in a multi-line field on the room, so the
// numbers are legible in GoHighLevel without this app:
//
//   room_sections   114|168
//   cabinet_doors   Shaker|White
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var SEP = '|';
  var F_SECTIONS = 'room_sections';
  var F_DOORS = 'cabinet_doors';

  // ---- Text format ---------------------------------------------------------

  function parseRows(text, keys) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var p = raw.split(SEP), row = {};
      keys.forEach(function (k, i) { row[k] = (p[i] || '').trim(); });
      out.push(row);
    });
    return out;
  }

  function serialise(rows, keys) {
    return rows.map(function (r) {
      return keys.map(function (k) { return r[k]; }).join(SEP);
    }).join('\n');
  }

  // A pipe or newline would break the one-per-line format.
  function clean(v) { return String(v || '').replace(/[|\r\n]/g, ' ').trim(); }

  // ---- Measurements --------------------------------------------------------

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // Inches shown the way they are spoken: 114 -> 9' 6". Whole feet stay plain.
  function feetInches(inches) {
    var n = num(inches);
    if (!n) return '';
    var ft = Math.floor(n / 12), inch = Math.round((n - ft * 12) * 10) / 10;
    if (inch === 12) { ft += 1; inch = 0; }
    return ft + '\u2032' + (inch ? ' ' + inch + '\u2033' : '');
  }

  function areaSqFt(w, l) {
    return (num(w) * num(l)) / 144;   // 144 square inches to the square foot
  }

  function fmtArea(sf) {
    if (!sf) return '0';
    return (Math.round(sf * 10) / 10).toLocaleString();
  }

  function totalArea(rows) {
    return rows.reduce(function (sum, s) { return sum + areaSqFt(s.w, s.l); }, 0);
  }

  // ---- A panel -------------------------------------------------------------
  //
  // Sections and doors are the same shape of problem: a list of short rows on
  // one room, added and removed in place. One renderer serves both.

  var state = {};   // elId -> { room, rows }

  function panel(cfg) {
    var el = document.getElementById(cfg.elId);
    if (!el) return;
    var rows = state[cfg.elId].rows;

    var html = '<div class="mm-rs-head">' +
        '<span class="mm-rs-title">' + cfg.title + '</span>' +
        '<span class="mm-rs-badge">' + U.esc(cfg.badge(rows)) + '</span>' +
      '</div>';

    html += rows.length
      ? '<div class="mm-rs-list">' + rows.map(cfg.row).join('') + '</div>'
      : '<p class="mm-rs-empty">' + cfg.empty + '</p>';

    if (cfg.foot) html += cfg.foot(rows);

    html += '<div class="mm-rs-actions">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary mm-rs-add">' +
          cfg.addLabel + '</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-primary mm-rs-save">' +
          cfg.saveLabel + '</button>' +
      '</div>' +
      '<p class="mm-rs-error" role="alert"></p>';

    el.innerHTML = html;
    bindPanel(el, cfg);
  }

  function bindPanel(el, cfg) {
    var st = state[cfg.elId];

    el.querySelector('.mm-rs-add').addEventListener('click', function () {
      st.rows.push(cfg.blank());
      panel(cfg);
      // Straight into the first box of the new row: on a phone that saves a
      // tap while holding a tape measure.
      var boxes = el.querySelectorAll('.mm-rs-in');
      if (boxes.length >= cfg.fields.length) {
        boxes[boxes.length - cfg.fields.length].focus();
      }
    });

    // Totals follow the typing, so the square footage is there while the tape
    // is still on the wall rather than only after a save.
    el.querySelectorAll('.mm-rs-in').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var r = st.rows[+inp.getAttribute('data-i')];
        if (r) r[inp.getAttribute('data-k')] = inp.value;
        if (cfg.live) cfg.live(el, st.rows);
      });
    });

    el.querySelectorAll('.mm-rs-del').forEach(function (b) {
      b.addEventListener('click', function () {
        st.rows.splice(+b.getAttribute('data-del'), 1);
        save(cfg);
      });
    });

    el.querySelector('.mm-rs-save').addEventListener('click', function () {
      save(cfg);
    });
  }

  function save(cfg) {
    var el = document.getElementById(cfg.elId);
    var st = state[cfg.elId];

    // An added row left empty is a change of mind, not an error: dropped
    // rather than refused.
    st.rows = st.rows.map(function (r) {
      var o = {};
      cfg.fields.forEach(function (k) { o[k] = clean(r[k]); });
      return o;
    }).filter(cfg.keep);

    var btn = el.querySelector('.mm-rs-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    var p = {};
    p[cfg.field] = serialise(st.rows, cfg.fields);

    return api.updateRec('custom_objects.room', st.room.id, p)
      .then(function () {
        // Written back onto the room in hand, so reopening it shows what was
        // saved without another read.
        (st.room.properties || (st.room.properties = {}))[cfg.field] = p[cfg.field];
        panel(cfg);
        U.fbk(el.querySelector('.mm-rs-save'), cfg.saveLabel);
      })
      .catch(function (e) {
        panel(cfg);
        el.querySelector('.mm-rs-error').textContent = 'Could not save: ' + e.message;
      });
  }

  function delBtn(i, label) {
    return '<button type="button" class="mm-rs-del" data-del="' + i + '" ' +
      'aria-label="' + label + '">&times;</button>';
  }

  // ---- Room size -----------------------------------------------------------

  function numBox(i, k, v, ph) {
    return '<span class="mm-rs-box">' +
      '<input class="mm-input mm-rs-in" type="number" inputmode="decimal" min="0" ' +
        'step="0.25" data-i="' + i + '" data-k="' + k + '" ' +
        'placeholder="' + ph + '" aria-label="' + ph + ' in inches" ' +
        'value="' + U.esc(v) + '">' +
      '<span class="mm-rs-unit">in</span>' +
    '</span>';
  }

  function sizeLine(r) {
    var parts = [feetInches(r.w), feetInches(r.l)].filter(Boolean);
    return parts.length === 2 ? parts.join(' × ') : '';
  }

  var SIZE = {
    elId: 'mm-room-size', field: F_SECTIONS, fields: ['w', 'l'],
    title: 'Room Size', addLabel: '+ Add Section', saveLabel: 'Save Size',
    empty: 'No measurements yet. Add a section to work out the square feet.',
    blank: function () { return { w: '', l: '' }; },
    keep: function (r) { return !!(r.w || r.l); },
    badge: function (rows) {
      var t = totalArea(rows);
      return t ? fmtArea(t) + ' sq ft' : '';
    },
    row: function (r, i) {
      var a = areaSqFt(r.w, r.l);
      return '<div class="mm-rs-row">' +
        '<span class="mm-rs-n">' + (i + 1) + '</span>' +
        '<div class="mm-rs-mid">' +
          '<div class="mm-rs-pair">' +
            numBox(i, 'w', r.w, 'Width') +
            '<span class="mm-rs-x" aria-hidden="true">&times;</span>' +
            numBox(i, 'l', r.l, 'Length') +
          '</div>' +
          '<div class="mm-rs-sub">' +
            '<span class="mm-rs-ft" data-ft="' + i + '">' + U.esc(sizeLine(r)) + '</span>' +
            '<span class="mm-rs-area" data-area="' + i + '">' +
              (a ? fmtArea(a) + ' sq ft' : '') + '</span>' +
          '</div>' +
        '</div>' +
        delBtn(i, 'Remove section ' + (i + 1)) +
      '</div>';
    },
    foot: function (rows) {
      return '<div class="mm-rs-total">' +
          '<span>Total</span>' +
          '<strong class="mm-rs-totalval">' + fmtArea(totalArea(rows)) + ' sq ft</strong>' +
        '</div>' +
        '<p class="mm-rs-hint">Measurements in inches. A rectangular room is ' +
          'one section; an L-shaped room is two.</p>';
    },
    live: function (el, rows) {
      rows.forEach(function (r, i) {
        var sf = areaSqFt(r.w, r.l);
        var a = el.querySelector('[data-area="' + i + '"]');
        if (a) a.textContent = sf ? fmtArea(sf) + ' sq ft' : '';
        var f = el.querySelector('[data-ft="' + i + '"]');
        if (f) f.textContent = sizeLine(r);
      });
      var total = totalArea(rows);
      var tv = el.querySelector('.mm-rs-totalval');
      if (tv) tv.textContent = fmtArea(total) + ' sq ft';
      var bd = el.querySelector('.mm-rs-badge');
      if (bd) bd.textContent = total ? fmtArea(total) + ' sq ft' : '';
    },
  };

  // ---- Cabinet doors -------------------------------------------------------

  function txtBox(i, k, v, ph) {
    return '<input class="mm-input mm-rs-in" data-i="' + i + '" data-k="' + k + '" ' +
      'placeholder="' + ph + '" aria-label="' + ph + '" value="' + U.esc(v) + '">';
  }

  var DOORS = {
    elId: 'mm-room-doors', field: F_DOORS, fields: ['style', 'finish'],
    title: 'Cabinet Doors', addLabel: '+ Add Door Style', saveLabel: 'Save Doors',
    empty: 'No door styles recorded for this room yet.',
    blank: function () { return { style: '', finish: '' }; },
    keep: function (r) { return !!(r.style || r.finish); },
    badge: function (rows) {
      return rows.length ? rows.length + (rows.length === 1 ? ' style' : ' styles') : '';
    },
    row: function (r, i) {
      return '<div class="mm-rs-row">' +
        '<div class="mm-rs-mid">' +
          '<div class="mm-rs-pair mm-rs-pair-text">' +
            txtBox(i, 'style', r.style, 'Door style') +
            txtBox(i, 'finish', r.finish, 'Finish') +
          '</div>' +
        '</div>' +
        delBtn(i, 'Remove door style ' + (i + 1)) +
      '</div>';
    },
  };

  // ---- Entry point ---------------------------------------------------------

  // Given the room already in hand: both fields ride on the record, so there
  // is nothing to fetch.
  function showForRoom(room) {
    [SIZE, DOORS].forEach(function (cfg) {
      if (!document.getElementById(cfg.elId)) return;
      state[cfg.elId] = {
        room: room,
        rows: parseRows(U.pv(room, cfg.field), cfg.fields),
      };
      panel(cfg);
    });
  }

  window.MM.roomsize = {
    showForRoom: showForRoom,
    _parseRows: parseRows, _serialise: serialise, _clean: clean,
    _feetInches: feetInches, _areaSqFt: areaSqFt, _fmtArea: fmtArea,
    _totalArea: totalArea, _num: num, _sizeLine: sizeLine,
    _SIZE: SIZE, _DOORS: DOORS,
    F_SECTIONS: F_SECTIONS, F_DOORS: F_DOORS,
  };
})();
