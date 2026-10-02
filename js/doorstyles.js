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
  var draft = { name: '', notes: '', images: [] };
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
    return '<div class="mm-ds">' +
      '<div class="mm-ds-shots">' +
        (imgs.length
          ? imgs.slice(0, 4).map(function (u) {
              return '<img class="mm-ds-shot" src="' + U.esc(u) + '" alt="">';
            }).join('')
          : '<div class="mm-ds-noshot">No photo</div>') +
      '</div>' +
      '<div class="mm-ds-main">' +
        '<div class="mm-ds-name">' + U.esc(s.name) + '</div>' +
        '<div class="mm-ds-count">' + imgs.length +
          (imgs.length === 1 ? ' photo' : ' photos') + '</div>' +
        (s.notes ? '<div class="mm-ds-notes">' + U.esc(s.notes) + '</div>' : '') +
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
      draft = { name: '', notes: '', images: [] };
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
    if (draft.images.length < MIN_SHOTS) {
      showError('Add at least one photo of the door.');
      return;
    }

    var body = {
      name: name,
      notes: (draft.notes || '').trim() || null,
      images: draft.images,
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
      draft = { name: '', notes: '', images: [] };
      return load();
    }).catch(function (e) {
      busy = false;
      render();
      showError('Could not save: ' + e.message);
    });
  }

  function startAdd() {
    adding = true; editing = null;
    draft = { name: '', notes: '', images: [] };
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
