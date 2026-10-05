// js/doorstyles.js
// The cabinet doors this business sells.
//
// Each style is a name and a few photographs of the real door. They exist so
// that a visualisation shows the customer THE DOOR THEY WOULD BE BUYING,
// rather than a generic cabinet an image model invented -- which was the
// first thing the client asked for when the idea came up.
//
// Saved once and used on every job afterwards, so this is set up here rather
// than being re-uploaded each time.
//
// The photos are uploaded to GoHighLevel like any other media and the style
// keeps their URLs. That avoids a second place for files to live, and the
// image model is given the URLs' contents when a render is asked for.
//
// Stored in Supabase rather than GoHighLevel: a door style belongs to the
// business, not to any one customer, so there is no opportunity to attach it
// to -- the same reasoning as task and material templates.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var MIN_SHOTS = 1;

  var rows = [];
  var editing = null;    // style being edited, or null
  var adding = false;
  var draft = { name: '', notes: '', images: [], colors: [] };
  var busy = false;

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-ds-body');
    if (el) el.innerHTML = '<div class="mm-empty">Loading...</div>';

    return db('GET', '/door_styles?select=*&active=eq.true&order=position,name')
      .then(function (r) {
        rows = r || [];
        render();
      })
      .catch(function (e) {
        if (el) el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
        throw e;
      });
  }

  // The styles, fetched if they have not been read yet. Called from the job
  // screen, which needs them without showing this page.
  function ensure() {
    return rows.length ? Promise.resolve(rows.slice())
                       : load().then(function () { return rows.slice(); });
  }

  function all() { return rows.slice(); }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-ds-body');
    if (!el) return;

    el.innerHTML =
      (adding || editing ? form() : '') +
      (rows.length
        ? '<div class="mm-ds-list">' + rows.map(card).join('') + '</div>'
        : (adding ? '' : emptyState())) +
      '<p class="mm-task-error" id="mm-ds-error" role="alert"></p>';

    bind(el);
  }

  function emptyState() {
    return '<div class="mm-tt-empty">' +
      '<p class="mm-tt-empty-title">No door styles yet</p>' +
      '<p class="mm-tt-empty-sub">Add the doors you sell, with a photo of ' +
      'each. They are what a visualisation puts into the ' +
      'customer&rsquo;s kitchen.</p></div>';
  }

  function card(s) {
    var imgs = s.images || [];
    var cols = s.colors || [];
    return '<div class="mm-ds">' +
      '<div class="mm-ds-shots">' +
        (imgs.length
          ? imgs.slice(0, 2).map(function (u) {
              return '<img class="mm-ds-shot" src="' + U.esc(u) + '" alt="">';
            }).join('')
          : '<div class="mm-ds-noshot">No photo</div>') +
      '</div>' +
      '<div class="mm-ds-main">' +
        '<div class="mm-ds-name">' + U.esc(s.name) + '</div>' +
        (s.notes ? '<div class="mm-ds-notes">' + U.esc(s.notes) + '</div>' : '') +
        // The colours as the little doors themselves, because that is what
        // someone recognises -- and because a style with none cannot be
        // used on a job, which is worth seeing without opening it.
        (cols.length
          ? '<div class="mm-ds-cardcols">' +
              cols.slice(0, 8).map(function (c) {
                return '<span class="mm-ds-cardcol" title="' +
                    U.esc(c.name) + '">' +
                  '<img src="' + U.esc(c.image) + '" alt="">' +
                  '<span>' + U.esc(c.name) + '</span>' +
                '</span>';
              }).join('') +
              (cols.length > 8
                ? '<span class="mm-ds-cardmore">+' + (cols.length - 8) + '</span>'
                : '') +
            '</div>'
          : '<div class="mm-ds-nocols">No colours yet</div>') +
      '</div>' +
      '<div class="mm-ds-side">' +
        '<button type="button" class="mm-ds-icon" data-edit="' + U.esc(s.id) + '" ' +
          'aria-label="Edit ' + U.esc(s.name) + '">&#9998;</button>' +
        '<button type="button" class="mm-ds-icon mm-ds-del" data-del="' + U.esc(s.id) + '" ' +
          'aria-label="Delete ' + U.esc(s.name) + '">&times;</button>' +
      '</div>' +
    '</div>';
  }

  function form() {
    return '<div class="mm-tt-form">' +
      '<h3 class="mm-tt-formtitle">' +
        (editing ? 'Edit door style' : 'New door style') + '</h3>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-ds-name">Name</label>' +
        '<input class="mm-input" id="mm-ds-name" placeholder="e.g. Nexus Linen" ' +
          'value="' + U.esc(draft.name) + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<span class="mm-label">Photos of this door</span>' +
        (draft.images.length
          ? '<div class="mm-ds-edshots">' +
              draft.images.map(function (u, i) {
                return '<div class="mm-ds-edshot">' +
                  '<img src="' + U.esc(u) + '" alt="">' +
                  '<button type="button" class="mm-ds-rm" data-rm="' + i + '" ' +
                    'aria-label="Remove photo ' + (i + 1) + '">&times;</button>' +
                '</div>';
              }).join('') +
            '</div>'
          : '') +
        '<div class="mm-btn-row">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-ds-shoot"' + (busy ? ' disabled' : '') + '>&#128247; Camera</button>' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-ds-pick"' + (busy ? ' disabled' : '') + '>&#128193; Upload</button>' +
        '</div>' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-ds-notes">Notes ' +
          '<span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-ds-notes" ' +
          'placeholder="e.g. soft close, shaker profile, matt finish" ' +
          'value="' + U.esc(draft.notes) + '">' +
      '</div>' +

      colorsBlock() +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-ds-cancel"' +
          (busy ? ' disabled' : '') + '>Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-ds-save"' +
          (busy ? ' disabled' : '') + '>' +
          (busy ? 'Working...' : (editing ? 'Save changes' : 'Add style')) +
        '</button>' +
      '</div>' +
    '</div>';
  }

  // ---- The colours this door comes in --------------------------------------
  //
  // Each style has its OWN finishes: Catalina comes in Black Gloss and
  // Clubhouse Oak, Fusion in Dove and Pitch Black. They are not one shared
  // palette, so they live inside the style.
  //
  // Each colour is a PHOTOGRAPH. A name alone is not enough -- as the client
  // put it, "when we cut a wood there are different shades, it's not just a
  // solid color", and a matte white and a gloss white are the same word and
  // different materials. The photograph is what the AI is shown.
  //
  // Adding them is ONE action: pick the whole folder of swatches, and each
  // file becomes a colour named after itself. Nobody types a file name, and
  // nobody fills in an empty row. A name that comes out wrong can be
  // corrected by clicking it, but it is never required.

  function colorsBlock() {
    return '<div class="mm-field-group">' +
      '<span class="mm-label">Colours</span>' +

      (draft.colors.length
        ? '<div class="mm-ds-cols">' + draft.colors.map(colorTile).join('') + '</div>' +
          (draft.colors.some(function (c) { return !String(c.name || '').trim(); })
            ? '<p class="mm-ds-colwarn">Type a name under each one.</p>'
            : '')
        : '') +

      '<div class="mm-btn-row">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary mm-ds-addcols" ' +
          'id="mm-ds-addcols"' + (busy ? ' disabled' : '') + '>' +
          '&#128193; ' + (draft.colors.length ? 'Add more colours' : 'Add colours') +
          '</button>' +
      '</div>' +
    '</div>';
  }

  // The photograph, with its name typed under it.
  //
  // The name is NOT guessed from the picture, though it easily could be: it
  // is a product name shown to a paying customer, and a colour read as Dove
  // when it is Linen puts the wrong product in front of them. Six short
  // words once per style is worth that certainty.
  //
  // The file name pre-fills the box when it happens to be useful. Nobody has
  // to rename anything for it to work.
  function colorTile(c, i) {
    var named = !!String(c.name || '').trim();
    return '<div class="mm-ds-col' + (named ? '' : ' needs-name') + '">' +
      '<img class="mm-ds-colshot" src="' + U.esc(c.image) + '" alt="">' +
      '<button type="button" class="mm-ds-colrm" data-colrm="' + i + '" ' +
        'aria-label="Remove this colour">&times;</button>' +
      '<input class="mm-input mm-ds-colname" data-ci="' + i + '" ' +
        'placeholder="Name it" ' +
        'value="' + U.esc(c.name) + '" aria-label="Colour name">' +
    '</div>';
  }

  // "black-gloss.jpg" -> "Black Gloss". Right often enough to save the
  // typing, and editable when it is not.
  function nameFromFile(fname) {
    return String(fname || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(^|\s)\S/g, function (ch) { return ch.toUpperCase(); })
      .slice(0, 60);
  }

  function showError(msg) {
    var el = document.getElementById('mm-ds-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Photos --------------------------------------------------------------

  // Uploaded straight away rather than held until Save: a photo that exists
  // can be seen, and seeing it is how someone knows the shot was good enough.
  function addShots(files, btn, label) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    busy = true;
    render();
    var b = document.getElementById(btn);

    function step(i) {
      if (i >= list.length) return Promise.resolve();
      if (b) b.textContent = list.length > 1
        ? 'Uploading ' + (i + 1) + ' of ' + list.length + '...'
        : 'Uploading...';
      return api.uploadMediaFile(list[i])
        .then(function (url) { draft.images.push(url); })
        .catch(function (e) { showError('Could not upload: ' + e.message); })
        .then(function () { return step(i + 1); });
    }

    step(0).then(function () {
      busy = false;
      render();
    });
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var cancel = el.querySelector('#mm-ds-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null;
      draft = { name: '', notes: '', images: [], colors: [] };
      showError('');
      render();
    });

    // Typing is kept as it is entered, so a redraw after an upload does not
    // throw away a half-typed name.
    var nameBox = el.querySelector('#mm-ds-name');
    if (nameBox) nameBox.addEventListener('input', function () {
      draft.name = this.value;
    });
    var notesBox = el.querySelector('#mm-ds-notes');
    if (notesBox) notesBox.addEventListener('input', function () {
      draft.notes = this.value;
    });

    var shoot = el.querySelector('#mm-ds-shoot');
    if (shoot) shoot.addEventListener('click', function () {
      var input = U.cameraInput(document.createElement('input'));
      input.addEventListener('change', function () {
        addShots(input.files, 'mm-ds-shoot', '📷 Camera');
      });
      input.click();
    });

    var pick = el.querySelector('#mm-ds-pick');
    if (pick) pick.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', function () {
        addShots(input.files, 'mm-ds-pick', '📁 Upload');
      });
      input.click();
    });

    el.querySelectorAll('[data-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        draft.images.splice(+b.getAttribute('data-rm'), 1);
        render();
      });
    });

    // ---- The colours ----

    // One action for the whole set: pick the folder of swatches and each
    // file becomes a colour. This is the only way to add one, on purpose --
    // an empty row to type into was the part nobody could use.
    var addCols = el.querySelector('#mm-ds-addcols');
    if (addCols) addCols.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', function () {
        var list = Array.prototype.slice.call(input.files || []);
        if (!list.length) return;

        busy = true;
        showError('');
        render();

        var failed = 0;
        list.reduce(function (chain, file, i) {
          return chain.then(function () {
            var b = document.getElementById('mm-ds-addcols');
            if (b) {
              b.textContent = 'Uploading ' + (i + 1) + ' of ' + list.length + '...';
            }
            return api.uploadMediaFile(file)
              .then(function (url) {
                draft.colors.push({ name: nameFromFile(file.name), image: url });
              })
              // One bad file does not stop the rest: nineteen colours are
              // worth having while the twentieth is sorted out.
              .catch(function () { failed++; });
          });
        }, Promise.resolve()).then(function () {
          busy = false;
          render();
          if (failed) {
            showError(failed + (failed === 1 ? ' photo' : ' photos') +
                      ' could not be uploaded. The rest were added.');
          }
        });
      });
      input.click();
    });

    // Correcting a name the filename got wrong. Written straight into the
    // draft so a redraw cannot lose it.
    el.querySelectorAll('.mm-ds-colname').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var c = draft.colors[+inp.getAttribute('data-ci')];
        if (c) c.name = inp.value;
      });
    });

    el.querySelectorAll('[data-colrm]').forEach(function (b) {
      b.addEventListener('click', function () {
        draft.colors.splice(+b.getAttribute('data-colrm'), 1);
        render();
      });
    });

    var save = el.querySelector('#mm-ds-save');
    if (save) save.addEventListener('click', saveStyle);

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = rows.find(function (x) {
          return String(x.id) === String(b.getAttribute('data-edit'));
        });
        if (!s) return;
        editing = s;
        adding = false;
        // A copy, so cancelling leaves the saved style exactly as it was.
        draft = {
          name: s.name || '',
          notes: s.notes || '',
          images: (s.images || []).slice(),
          // Copied a level deep, so editing a colour and cancelling leaves
          // the saved style untouched.
          colors: (s.colors || []).map(function (c) {
            return { name: c.name || '', image: c.image || '' };
          }),
        };
        showError('');
        render();
        var f = document.getElementById('mm-ds-name');
        if (f) f.focus();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        var s = rows.find(function (x) { return String(x.id) === String(id); });
        if (!s) return;
        if (!window.confirm('Delete the door style "' + s.name + '"?')) return;

        b.disabled = true;
        showError('');
        // Marked inactive rather than removed, matching the templates: one
        // deleted by mistake can be brought back in the database.
        db('PATCH', '/door_styles?id=eq.' + encodeURIComponent(id), { active: false })
          .then(function () {
            window.MM.activity.log('list_added', 'Deleted door style ' + s.name, {});
            return load();
          })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not delete: ' + e.message);
          });
      });
    });
  }

  function saveStyle() {
    var name = (draft.name || '').trim();
    if (!name) {
      showError('Give the style a name.');
      var f = document.getElementById('mm-ds-name');
      if (f) f.focus();
      return;
    }
    // A colour with no name cannot be chosen on a job, so it is caught here
    // rather than saved as "Colour 3".
    var unnamed = draft.colors.filter(function (c) {
      return c.image && !String(c.name || '').trim();
    }).length;
    if (unnamed) {
      showError('Name ' + (unnamed === 1 ? 'the colour' : 'all ' + unnamed + ' colours') +
                ' before saving.');
      var box = document.querySelector('.mm-ds-col.needs-name .mm-ds-colname');
      if (box) box.focus();
      return;
    }

    if (draft.images.length < MIN_SHOTS) {
      showError('Add at least one photo of the door.');
      return;
    }

    var body = {
      name: name,
      notes: (draft.notes || '').trim() || null,
      images: draft.images,
      colors: draft.colors.filter(function (c) { return !!c.image; })
        .map(function (c) {
          return { name: String(c.name || '').trim(), image: c.image };
        }),
    };

    showError('');
    busy = true;
    render();

    var req = editing
      ? db('PATCH', '/door_styles?id=eq.' + encodeURIComponent(editing.id), body)
      : db('POST', '/door_styles', body);

    req.then(function () {
      window.MM.activity.log('list_added',
        (editing ? 'Updated door style ' : 'Added door style ') + name, {});
      busy = false;
      adding = false; editing = null;
      draft = { name: '', notes: '', images: [], colors: [] };
      return load();
    }).catch(function (e) {
      busy = false;
      render();
      showError('Could not save: ' + e.message);
    });
  }

  function startAdd() {
    adding = true; editing = null;
    draft = { name: '', notes: '', images: [], colors: [] };
    showError('');
    render();
    var f = document.getElementById('mm-ds-name');
    if (f) f.focus();
  }

  function init() {
    var add = document.getElementById('mm-ds-add');
    if (add) add.addEventListener('click', startAdd);
  }

  window.MM.doorstyles = {
    init: init,
    load: load,
    ensure: ensure,
    all: all,
    startAdd: startAdd,
  };
})();
