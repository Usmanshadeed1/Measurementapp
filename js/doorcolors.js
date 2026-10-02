// js/doorcolors.js
// The paint colours the cabinet doors come in.
//
// One list, shared by every door style -- which is how the manufacturer sells
// them, and how the customer chooses: first the door, then the colour.
//
// A colour is a NAME, a PHOTOGRAPH of the door in that finish, and a swatch.
//
// The photograph is the important one. A name alone was not enough: the
// stains are real wood, and no description of "Timber" produces timber --
// the model has to see it. With the photograph it sees the finish as well
// as being told its name, and the result comes back in the right paint.
//
// The swatch is only so the list is recognisable at a glance before the
// photographs are added.
//
// The list is seeded from the manufacturer's own finishes the first time
// this page is opened, because typing twenty-three colours by hand is how
// names get mistyped. Everything is editable afterwards.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth, api = window.MM.api;

  var rows = [];
  var editing = null;    // colour being edited, or null
  var adding = false;
  var busy = false;
  var seeded = false;    // only ever tried once per page load

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  // The finishes as the manufacturer groups them. The swatches are read from
  // their own samples and are close rather than exact -- near enough to
  // recognise, and correctable with the colour picker.
  var SEED = [
    { grp: 'Signature', name: 'Frost', swatch: '#f2f0ea' },

    { grp: 'Signature Select', name: 'Dove', swatch: '#efebe0' },
    { grp: 'Signature Select', name: 'Indigo', swatch: '#2b3440' },
    { grp: 'Signature Select', name: 'Nickel', swatch: '#b4b5ae' },
    { grp: 'Signature Select', name: 'Linen', swatch: '#e8e3d5' },
    { grp: 'Signature Select', name: 'Stone', swatch: '#8d8178' },
    { grp: 'Signature Select', name: 'Oyster', swatch: '#c2ab8f' },
    { grp: 'Signature Select', name: 'Pitch Black', swatch: '#1c1c1e' },
    { grp: 'Signature Select', name: 'Pistachio Green', swatch: '#b4bda7' },

    { grp: 'Designer', name: 'Sage Green', swatch: '#b3c4b4' },
    { grp: 'Designer', name: 'Cloud White', swatch: '#eeece5' },
    { grp: 'Designer', name: 'Denim Blue', swatch: '#4a6e8c' },
    { grp: 'Designer', name: 'Hunter Green', swatch: '#3c4634' },
    { grp: 'Designer', name: 'Graphite Black', swatch: '#33352f' },
    { grp: 'Designer', name: 'Cabernet Red', swatch: '#6d1f2a' },
    { grp: 'Designer', name: 'Forest Green', swatch: '#5c6354' },
    { grp: 'Designer', name: 'Macadamia Beige', swatch: '#e2d6bd' },
    { grp: 'Designer', name: 'Mint Green', swatch: '#dde3d9' },
    { grp: 'Designer', name: 'Orchid Purple', swatch: '#d9bdd4' },
    { grp: 'Designer', name: 'Izel Blue', swatch: '#7fa3bb' },

    { grp: 'Custom', name: 'Naval', swatch: '#2f3e52' },
    { grp: 'Custom', name: 'Pewter Green', swatch: '#5f6355' },
    { grp: 'Custom', name: 'Repose Gray', swatch: '#cbc7bd' },
    { grp: 'Custom', name: 'Retreat', swatch: '#6d7466' },
  ];

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-dc-body');
    if (el) el.innerHTML = '<div class="mm-empty">Loading...</div>';

    return db('GET', '/door_colors?select=*&active=eq.true&order=position,name')
      .then(function (r) {
        rows = r || [];
        // An empty list on a fresh install means the finishes have never
        // been put in. Seeded once, and never again -- a deleted colour
        // stays deleted.
        if (!rows.length && !seeded) {
          seeded = true;
          return seed().then(function () {
            return db('GET', '/door_colors?select=*&active=eq.true&order=position,name');
          }).then(function (r2) { rows = r2 || []; });
        }
      })
      .then(function () { render(); })
      .catch(function (e) {
        if (el) el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
        throw e;
      });
  }

  function seed() {
    return db('POST', '/door_colors', SEED.map(function (c, i) {
      return { name: c.name, swatch: c.swatch, grp: c.grp, position: i };
    })).catch(function () { /* a failed seed is not worth stopping for */ });
  }

  function ensure() {
    return rows.length ? Promise.resolve(rows.slice())
                       : load().then(function () { return rows.slice(); });
  }

  function all() { return rows.slice(); }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-dc-body');
    if (!el) return;

    el.innerHTML =
      (adding || editing ? form() : '') +
      (rows.length
        ? groups()
        : '<p class="mm-task-empty">No colours yet.</p>') +
      '<p class="mm-task-error" id="mm-dc-error" role="alert"></p>';

    bind(el);
  }

  // Kept in the manufacturer's own groups, because that is how the customer
  // is shown them and how someone looking for one expects to find it.
  function groups() {
    var seen = [];
    rows.forEach(function (c) {
      var g = c.grp || 'Other';
      if (seen.indexOf(g) < 0) seen.push(g);
    });

    return seen.map(function (g) {
      var mine = rows.filter(function (c) { return (c.grp || 'Other') === g; });
      return '<div class="mm-dc-group">' +
        '<div class="mm-dc-grouphead">' + U.esc(g) + '</div>' +
        '<div class="mm-dc-list">' + mine.map(chip).join('') + '</div>' +
      '</div>';
    }).join('');
  }

  // The photograph leads, because that is what someone recognises. A colour
  // with none falls back to its swatch and says so: without the photograph
  // the AI can only be told the name, which is not enough for a stain.
  function chip(c) {
    return '<div class="mm-dc">' +
      (c.image
        ? '<img class="mm-dc-shot" src="' + U.esc(c.image) + '" alt="">'
        : '<span class="mm-dc-shot mm-dc-noshot" ' +
          'style="background:' + U.esc(c.swatch || '#ccc') + '" ' +
          'aria-hidden="true"></span>') +
      '<span class="mm-dc-name">' + U.esc(c.name) + '</span>' +
      (c.image ? '' : '<span class="mm-dc-need">No photo</span>') +
      '<span class="mm-dc-acts">' +
        '<button type="button" class="mm-dc-icon" data-edit="' + U.esc(c.id) + '" ' +
          'aria-label="Edit ' + U.esc(c.name) + '">&#9998;</button>' +
        '<button type="button" class="mm-dc-icon mm-dc-del" data-del="' + U.esc(c.id) + '" ' +
          'aria-label="Delete ' + U.esc(c.name) + '">&times;</button>' +
      '</span>' +
    '</div>';
  }

  // Held while the form is open, so an upload does not lose a half-typed
  // name and cancelling leaves the saved colour exactly as it was.
  var draft = { name: '', swatch: '#cccccc', grp: '', image: '' };

  function form() {
    var c = draft;
    var seenGrps = [];
    rows.forEach(function (x) {
      var g = x.grp || '';
      if (g && seenGrps.indexOf(g) < 0) seenGrps.push(g);
    });

    return '<div class="mm-tt-form">' +
      '<h3 class="mm-tt-formtitle">' +
        (editing ? 'Edit colour' : 'New colour') + '</h3>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-dc-name">Name</label>' +
        '<input class="mm-input" id="mm-dc-name" placeholder="e.g. Pitch Black" ' +
          'value="' + U.esc(c.name) + '">' +
        // The name is not decoration: it is what the image model is told, so
        // it has to match what the manufacturer calls it.
        '<p class="mm-tt-hint">Exactly as the manufacturer names it &mdash; ' +
          'this is the word the AI is given.</p>' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<span class="mm-label">Photo of the door in this finish</span>' +
        (c.image
          ? '<div class="mm-dc-edshot">' +
              '<img src="' + U.esc(c.image) + '" alt="">' +
              '<button type="button" class="mm-dc-rm" id="mm-dc-rmshot" ' +
                'aria-label="Remove this photo">&times;</button>' +
            '</div>'
          : '') +
        '<div class="mm-btn-row">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-dc-pickshot"' + (busy ? ' disabled' : '') + '>' +
            '&#128193; ' + (c.image ? 'Change photo' : 'Add photo') + '</button>' +
        '</div>' +
        // The reason it matters, said once where someone is deciding
        // whether to bother.
        '<p class="mm-tt-hint">The AI is shown this photograph, so the ' +
          'finish comes out right &mdash; a stain especially, which no ' +
          'description produces on its own.</p>' +
      '</div>' +

      '<div class="mm-mt-sub" style="margin-bottom:12px">' +
        '<label class="mm-mt-f" style="flex:0 0 110px">' +
          '<span class="mm-mt-flab">Swatch</span>' +
          '<input class="mm-input mm-dc-pick" type="color" id="mm-dc-swatch" ' +
            'value="' + U.esc(c.swatch || '#cccccc') + '">' +
        '</label>' +
        '<label class="mm-mt-f" style="flex:1 1 160px">' +
          '<span class="mm-mt-flab">Group <span class="mm-opt">(optional)</span></span>' +
          '<input class="mm-input" id="mm-dc-grp" list="mm-dc-grps" ' +
            'placeholder="e.g. Designer" value="' + U.esc(c.grp || '') + '">' +
        '</label>' +
      '</div>' +
      '<datalist id="mm-dc-grps">' +
        seenGrps.map(function (g) {
          return '<option value="' + U.esc(g) + '"></option>';
        }).join('') +
      '</datalist>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-dc-cancel"' +
          (busy ? ' disabled' : '') + '>Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-dc-save"' +
          (busy ? ' disabled' : '') + '>' +
          (busy ? 'Saving...' : (editing ? 'Save changes' : 'Add colour')) +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function showError(msg) {
    var el = document.getElementById('mm-dc-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var cancel = el.querySelector('#mm-dc-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null;
      draft = { name: '', swatch: '#cccccc', grp: '', image: '' };
      showError(''); render();
    });

    // Typing is kept as it is entered: uploading a photo redraws the form,
    // and a redraw must not throw away a half-typed name.
    var nameBox = el.querySelector('#mm-dc-name');
    if (nameBox) nameBox.addEventListener('input', function () {
      draft.name = this.value;
    });
    var grpBox = el.querySelector('#mm-dc-grp');
    if (grpBox) grpBox.addEventListener('input', function () {
      draft.grp = this.value;
    });
    var swBox = el.querySelector('#mm-dc-swatch');
    if (swBox) swBox.addEventListener('input', function () {
      draft.swatch = this.value;
    });

    var pickShot = el.querySelector('#mm-dc-pickshot');
    if (pickShot) pickShot.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        busy = true; render();
        api.uploadMediaFile(file)
          .then(function (url) { draft.image = url; })
          .catch(function (e) { showError('Could not upload: ' + e.message); })
          .then(function () { busy = false; render(); });
      });
      input.click();
    });

    var rmShot = el.querySelector('#mm-dc-rmshot');
    if (rmShot) rmShot.addEventListener('click', function () {
      draft.image = '';
      render();
    });

    var save = el.querySelector('#mm-dc-save');
    if (save) save.addEventListener('click', saveColor);

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = rows.find(function (x) {
          return String(x.id) === String(b.getAttribute('data-edit'));
        });
        if (!c) return;
        editing = c; adding = false;
        // A copy, so cancelling leaves the saved colour as it was.
        draft = {
          name: c.name || '', swatch: c.swatch || '#cccccc',
          grp: c.grp || '', image: c.image || '',
        };
        showError(''); render();
        var f = document.getElementById('mm-dc-name');
        if (f) f.focus();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        var c = rows.find(function (x) { return String(x.id) === String(id); });
        if (!c) return;
        if (!window.confirm('Delete the colour "' + c.name + '"?')) return;

        b.disabled = true;
        showError('');
        // Marked inactive rather than removed, matching the styles: one
        // deleted by mistake can be brought back in the database.
        db('PATCH', '/door_colors?id=eq.' + encodeURIComponent(id), { active: false })
          .then(function () { return load(); })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not delete: ' + e.message);
          });
      });
    });
  }

  function saveColor() {
    var name = (draft.name || '').trim();
    if (!name) {
      showError('Give the colour a name.');
      var f = document.getElementById('mm-dc-name');
      if (f) f.focus();
      return;
    }

    var body = {
      name: name,
      swatch: draft.swatch || '#cccccc',
      grp: (draft.grp || '').trim() || null,
      image: draft.image || null,
    };

    showError('');
    busy = true; render();

    var req = editing
      ? db('PATCH', '/door_colors?id=eq.' + encodeURIComponent(editing.id), body)
      : db('POST', '/door_colors', body);

    req.then(function () {
      busy = false;
      adding = false; editing = null;
      return load();
    }).catch(function (e) {
      busy = false;
      render();
      showError('Could not save: ' + e.message);
    });
  }

  function startAdd() {
    adding = true; editing = null;
    draft = { name: '', swatch: '#cccccc', grp: '', image: '' };
    showError(''); render();
    var f = document.getElementById('mm-dc-name');
    if (f) f.focus();
  }

  function init() {
    var add = document.getElementById('mm-dc-add');
    if (add) add.addEventListener('click', startAdd);
  }

  window.MM.doorcolors = {
    init: init,
    load: load,
    ensure: ensure,
    all: all,
  };
})();
