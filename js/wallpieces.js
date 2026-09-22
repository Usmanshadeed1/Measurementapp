// js/wallpieces.js
// Pieces of a wall.
//
// A wall is one length in the Wall Info box, and that stays: it is the wall's
// overall run and plenty of walls need nothing more. But a countertop or a
// backsplash along that wall is cut in pieces, and the pieces are what gets
// ordered. So a wall can also carry a list of them.
//
// Each piece is a LENGTH and an optional HEIGHT, in inches, matching the tape
// in the measurer's hand and the wall length already stored that way. The app
// adds the lengths and shows the total, because the total is what the supplier
// is told. Inches are echoed back as feet and inches: 114 is hard to picture,
// 9' 6" is not.
//
// Pieces are not named, exactly as room sections are not: a name is one more
// thing to type on site for no gain.
//
// Stored one piece per line in a multi-line field on the wall, so the numbers
// are legible in GoHighLevel without this app:
//
//   wall_pieces   114|36
//                 42|36
//
// The row markup and styles are the room's (.mm-rs-*, css/roomsize.css) and
// the text and measurement helpers are roomsize.js's exports. Only the saving
// differs: this writes to the wall record, not the room.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var FIELD = 'wall_pieces';
  var KEYS = ['l', 'h'];

  function RS() { return window.MM.roomsize; }

  // ---- Rendering -----------------------------------------------------------

  function numBox(i, k, v, ph) {
    return '<span class="mm-rs-box">' +
      '<input class="mm-input mm-wp-in" type="number" inputmode="decimal" ' +
        'min="0" step="0.25" data-i="' + i + '" data-k="' + k + '" ' +
        'placeholder="' + ph + '" aria-label="' + ph + ' in inches" ' +
        'value="' + U.esc(v || '') + '">' +
      '<span class="mm-rs-unit">in</span>' +
    '</span>';
  }

  // Under the boxes: the same numbers in feet and inches, so a mistyped digit
  // shows up as an implausible shape rather than hiding in the total.
  function subText(r) {
    var fi = RS()._feetInches;
    return [fi(r.l), fi(r.h)].filter(Boolean).join(' × ');
  }

  // Always rendered, even when empty, so typing has somewhere to write the
  // feet and inches without re-rendering the row out from under the cursor.
  function subLine(r) {
    return '<div class="mm-rs-sub mm-wp-sub">' + U.esc(subText(r)) + '</div>';
  }

  function rowHtml(r, i) {
    return '<div class="mm-rs-row">' +
      '<span class="mm-rs-n">' + (i + 1) + '</span>' +
      '<div class="mm-rs-mid">' +
        '<div class="mm-rs-pair">' +
          numBox(i, 'l', r.l, 'Length') +
          '<span class="mm-rs-x">×</span>' +
          numBox(i, 'h', r.h, 'Height') +
        '</div>' +
        subLine(r) +
      '</div>' +
      '<button type="button" class="mm-rs-del mm-wp-del" data-del="' + i + '" ' +
        'aria-label="Remove piece ' + (i + 1) + '">&times;</button>' +
    '</div>';
  }

  function totalLen(rows) {
    var n = RS()._num, t = 0;
    rows.forEach(function (r) { t += n(r.l); });
    return t;
  }

  function totalText(rows) {
    var t = totalLen(rows);
    if (!t) return '';
    var fi = RS()._feetInches(t);
    return t + ' in' + (fi ? ' (' + fi + ')' : '');
  }

  // ---- The panel -----------------------------------------------------------

  // `wr` is the wall record the accordion is holding: the same object
  // walls.js saves into, so a save here is visible to it without a re-read.
  function build(wr) {
    var el = document.createElement('div');
    el.className = 'mm-wp';

    // Rows live here while they are being typed. Read from the record once,
    // on the way in, and written back on every successful save.
    var rows = RS()._parseRows(U.pv(wr, FIELD), KEYS);

    function render() {
      // No heading: the accordion this sits in is already titled "Pieces".
      var html = rows.length
        ? '<div class="mm-rs-list">' + rows.map(rowHtml).join('') + '</div>'
        : '<p class="mm-rs-empty">No pieces yet. Add one for each piece of ' +
          'this wall that gets measured separately.</p>';

      if (rows.length) {
        html += '<div class="mm-rs-total"><span>Total length</span>' +
          '<span class="mm-rs-totalval">' + U.esc(totalText(rows)) +
          '</span></div>';
      }

      html += '<div class="mm-rs-actions">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary mm-wp-add">' +
            '+ Add Piece</button>' +
          '<button type="button" class="mm-btn-sm mm-btn-primary mm-wp-save">' +
            'Save Pieces</button>' +
        '</div>' +
        '<p class="mm-rs-error mm-wp-error" role="alert"></p>';

      el.innerHTML = html;
      bind();
    }

    function bind() {
      el.querySelector('.mm-wp-add').addEventListener('click', function () {
        rows.push({ l: '', h: '' });
        render();
        // Straight into the new row's first box: on a phone that saves a tap
        // while holding a tape measure.
        var boxes = el.querySelectorAll('.mm-wp-in');
        if (boxes.length >= KEYS.length) boxes[boxes.length - KEYS.length].focus();
      });

      // The total follows the typing, so it is right while the tape is still
      // on the wall rather than only after a save.
      el.querySelectorAll('.mm-wp-in').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var i = +inp.getAttribute('data-i'), r = rows[i];
          if (r) r[inp.getAttribute('data-k')] = inp.value;
          var subs = el.querySelectorAll('.mm-wp-sub');
          if (r && subs[i]) subs[i].textContent = subText(r);
          var v = el.querySelector('.mm-rs-totalval');
          if (v) v.textContent = totalText(rows);
        });
      });

      el.querySelectorAll('.mm-wp-del').forEach(function (b) {
        b.addEventListener('click', function () {
          rows.splice(+b.getAttribute('data-del'), 1);
          save();
        });
      });

      el.querySelector('.mm-wp-save').addEventListener('click', save);
    }

    function save() {
      if (!wr.id) {
        el.querySelector('.mm-wp-error').textContent = 'Save the wall first.';
        return;
      }

      // A row added and left empty is a change of mind, not an error:
      // dropped rather than refused.
      var clean = RS()._clean;
      rows = rows.map(function (r) {
        return { l: clean(r.l), h: clean(r.h) };
      }).filter(function (r) { return !!(r.l || r.h); });

      var btn = el.querySelector('.mm-wp-save');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      var p = {};
      p[FIELD] = RS()._serialise(rows, KEYS);

      return api.updateRec('custom_objects.wall', wr.id, p)
        .then(function () {
          // Written back onto the wall in hand, so reopening it shows what
          // was saved without another read -- and so the search index being
          // a second behind cannot show stale pieces.
          (wr.properties || (wr.properties = {}))[FIELD] = p[FIELD];
          render();
          U.fbk(el.querySelector('.mm-wp-save'), 'Save Pieces');
        })
        .catch(function (e) {
          render();
          el.querySelector('.mm-wp-error').textContent =
            'Could not save: ' + e.message;
        });
    }

    render();
    return el;
  }

  window.MM.wallpieces = { build: build };
})();
