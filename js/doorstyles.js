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

  // Enough of the door for a model to copy it, and few enough that someone
  // actually sets one up. Straight-on beats artful.
  var MIN_SHOTS = 1;
  var WANT_SHOTS = 3;

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
        // The colours this style comes in, as the little doors themselves:
        // it is what someone recognises, and it says at a glance which
        // styles are set up and which are still waiting.
        (cols.length
          ? '<div class="mm-ds-cols">' +
              cols.map(function (c) {
                return '<span class="mm-ds-col" title="' + U.esc(c.name) + '">' +
                  (c.image
                    ? '<img src="' + U.esc(c.image) + '" alt="">'
                    : '<span class="mm-ds-colsw" style="background:' +
                      U.esc(c.swatch || '#ccc') + '"></span>') +
                  '<span class="mm-ds-colname">' + U.esc(c.name) + '</span>' +
                '</span>';
              }).join('') +
            '</div>'
          : '<div class="mm-ds-nocols">No colours yet &mdash; add them so ' +
            'they can be chosen on a job.</div>') +
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
        // The advice matters more than any wording in the prompt: a sharp,
        // square-on, evenly lit photo is what makes a render show THIS door
        // rather than something that merely resembles it.
        '<p class="mm-tt-hint">Take ' + WANT_SHOTS + ' if you can: the door ' +
          'square-on in good light, a close-up of the panel and edge, and one ' +
          'showing the handle. Sharp, straight photos give much better ' +
          'results than artful ones.</p>' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-ds-notes">Notes ' +
          '<span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-ds-notes" ' +
          'placeholder="e.g. soft close, shaker profile, matt finish" ' +
          'value="' + U.esc(draft.notes) + '">' +
        '<p class="mm-tt-hint">Anything here is told to the AI as well, so a ' +
          'word about the finish or the profile is worth adding.</p>' +
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

  // ---- The colours this style comes in --------------------------------------
  //
  // Each style has its OWN list: Fusion comes in Dove and Pitch Black,
  // Catalina comes in Black Gloss and Clubhouse Oak. They are not the same
  // colours with different names -- they are different finishes on different
  // doors, which is why they live inside the style rather than in a list of
  // their own.
  //
  // Each colour is a name and a PHOTOGRAPH of this door in that finish. The
  // photograph is what makes a stain or a gloss come out right: no
  // description of "Clubhouse Oak" produces oak, but a picture of it does.
  // The swatch is a fallback so a colour still reads before its photograph
  // is added.

  function colorsBlock() {
    return '<div class="mm-field-group">' +
      '<span class="mm-label">Colours this door comes in</span>' +
      '<p class="mm-tt-hint">On a job you pick the door first, then one of ' +
        'these. The photograph is what the AI is shown, so the finish comes ' +
        'out right.</p>' +

      (draft.colors.length
        ? '<div class="mm-ds-collist">' +
            draft.colors.map(colorRow).join('') +
          '</div>'
        : '') +

      '<div class="mm-btn-row">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-ds-addcol"' + (busy ? ' disabled' : '') + '>' +
          '+ Add colour</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-ds-addmany"' + (busy ? ' disabled' : '') + '>' +
          '&#128193; Add several photos</button>' +
      '</div>' +
      '<p class="mm-tt-hint">&ldquo;Add several photos&rdquo; takes a whole ' +
        'folder at once and names each one after its file &mdash; quicker ' +
        'than adding twenty by hand.</p>' +
    '</div>';
  }

  function colorRow(c, i) {
    return '<div class="mm-ds-colrow">' +
      (c.image
        ? '<img class="mm-ds-colshot" src="' + U.esc(c.image) + '" alt="">'
        : '<span class="mm-ds-colshot mm-ds-colempty" ' +
          'style="background:' + U.esc(c.swatch || '#cccccc') + '"></span>') +

      '<div class="mm-ds-colfields">' +
        '<input class="mm-input mm-ds-colin" data-ci="' + i + '" ' +
          'data-ck="name" placeholder="Colour name, e.g. Pitch Black" ' +
          'value="' + U.esc(c.name || '') + '">' +
        '<div class="mm-ds-colbtns">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'data-colshot="' + i + '">' +
            (c.image ? 'Change photo' : '&#128193; Photo') + '</button>' +
          // Offered for a colour with no photograph of its own: better than
          // nothing, and the only way to show a custom paint the
          // manufacturer has no sample of.
          '<input class="mm-input mm-ds-colpick" type="color" ' +
            'data-ci="' + i + '" data-ck="swatch" ' +
            'value="' + U.esc(c.swatch || '#cccccc') + '" ' +
            'aria-label="Colour swatch">' +
        '</div>' +
      '</div>' +

      '<button type="button" class="mm-ds-colrm" data-colrm="' + i + '" ' +
        'aria-label="Remove this colour">&times;</button>' +
    '</div>';
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

    var addCol = el.querySelector('#mm-ds-addcol');
    if (addCol) addCol.addEventListener('click', function () {
      draft.colors.push({ name: '', image: '', swatch: '#cccccc' });
      render();
      var boxes = document.querySelectorAll('.mm-ds-colin');
      if (boxes.length) boxes[boxes.length - 1].focus();
    });

    // Typing is written straight into the draft, so a redraw after an
    // upload cannot lose a half-typed name.
    el.querySelectorAll('.mm-ds-colin,.mm-ds-colpick').forEach(function (inp) {
      function take() {
        var c = draft.colors[+inp.getAttribute('data-ci')];
        if (c) c[inp.getAttribute('data-ck')] = inp.value;
      }
      inp.addEventListener('input', take);
      inp.addEventListener('change', take);
    });

    el.querySelectorAll('[data-colrm]').forEach(function (b) {
      b.addEventListener('click', function () {
        draft.colors.splice(+b.getAttribute('data-colrm'), 1);
        render();
      });
    });

    el.querySelectorAll('[data-colshot]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-colshot');
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (!file) return;
          busy = true; render();
          api.uploadMediaFile(file)
            .then(function (url) {
              if (draft.colors[i]) draft.colors[i].image = url;
            })
            .catch(function (e) { showError('Could not upload: ' + e.message); })
            .then(function () { busy = false; render(); });
        });
        input.click();
      });
    });

    // A folder of swatches in one go. The file name becomes the colour
    // name -- "pitch-black.jpg" becomes "Pitch Black" -- because naming
    // twenty colours by hand after uploading them is the tedious part.
    var addMany = el.querySelector('#mm-ds-addmany');
    if (addMany) addMany.addEventListener('click', function () {
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

        list.reduce(function (chain, file, i) {
          return chain.then(function () {
            var b = document.getElementById('mm-ds-addmany');
            if (b) b.textContent = 'Uploading ' + (i + 1) + ' of ' + list.length + '...';
            return api.uploadMediaFile(file)
              .then(function (url) {
                draft.colors.push({
                  name: nameFromFile(file.name),
                  image: url,
                  swatch: '#cccccc',
                });
              })
              .catch(function () { /* one bad file does not stop the rest */ });
          });
        }, Promise.resolve()).then(function () {
          busy = false;
          render();
        });
      });
      input.click();
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
          // Copied one level deep, so editing a colour and cancelling
          // leaves the saved style untouched.
          colors: (s.colors || []).map(function (c) {
            return {
              name: c.name || '', image: c.image || '',
              swatch: c.swatch || '#cccccc',
            };
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

  // "pitch-black.jpg" -> "Pitch Black". A guess at the name, and one that is
  // right often enough to save the typing; it is editable either way.
  function nameFromFile(fname) {
    return String(fname || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(^|\s)\S/g, function (ch) { return ch.toUpperCase(); })
      .slice(0, 60);
  }

  function saveStyle() {
    var name = (draft.name || '').trim();
    if (!name) {
      showError('Give the style a name.');
      var f = document.getElementById('mm-ds-name');
      if (f) f.focus();
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
      // A colour with no name was a row someone started and thought better
      // of, so it is dropped rather than refused.
      colors: draft.colors.filter(function (c) {
        return !!String(c.name || '').trim();
      }).map(function (c) {
        return {
          name: String(c.name).trim(),
          image: c.image || '',
          swatch: c.swatch || '#cccccc',
        };
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
