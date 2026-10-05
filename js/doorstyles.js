// js/doorstyles.js
// The cabinet doors this business sells, and the colours each one comes in.
//
// A visualisation has to show the customer THE DOOR THEY WOULD BE BUYING,
// not a generic cabinet an image model invented. So a style keeps real
// photographs of the real door, and those are what the model is shown.
//
// COLOURS BELONG TO A STYLE. Catalina comes in Black Gloss and Clubhouse
// Oak; Fusion comes in Dove and Pitch Black. They are not one shared palette
// with different names -- they are different finishes on different doors.
//
// Every colour carries PHOTOGRAPHS, not just a name. As the client put it:
// "when we cut a wood there are different shades, it's not just a solid
// color". A matte white and a gloss white are the same word and different
// materials, and only a picture carries that.
//
// Nothing is typed twice. The colour box offers every colour already used on
// any style, so "Pitch Black" is written once and picked from then on.
// Typing a new one adds it to that list by itself -- there is no separate
// colours page to keep up to date.
//
// Each style is an accordion: six styles with six colours each is a long
// page otherwise.
//
// Stored in Supabase rather than GoHighLevel: a door style belongs to the
// business, not to any one customer, so there is no opportunity to attach it
// to -- the same reasoning as task and material templates.
//
// The photographs are uploaded to GoHighLevel like any other media and the
// style keeps their URLs, so there is no second place for files to live.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var rows = [];
  var open = {};         // style id -> is its accordion open
  var drafts = {};       // style id -> the edits in progress
  var adding = false;    // is the new-style form showing
  var newDraft = null;
  var colourFor = null;  // which style is adding a colour: its id, or '+'
  var colourDraft = null;
  var busy = false;
  var err = '';

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function blank() { return { name: '', notes: '', images: [], colors: [] }; }

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-ds-body');
    if (el) el.innerHTML = '<div class="mm-empty">Loading...</div>';

    return db('GET', '/door_styles?select=*&active=eq.true&order=position,name')
      .then(function (r) { rows = r || []; render(); })
      .catch(function (e) {
        if (el) el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
        throw e;
      });
  }

  function ensure() {
    return rows.length ? Promise.resolve(rows.slice())
                       : load().then(function () { return rows.slice(); });
  }

  function all() { return rows.slice(); }

  // Every colour name used on any style, for the suggestion list. Built from
  // what is already there rather than kept as a list of its own: a name
  // typed once for Nexus is then offered for Catalina, and there is nothing
  // separate to maintain.
  function knownColours() {
    var seen = {};
    function take(c) {
      var n = String(c.name || '').trim();
      if (n) seen[n.toLowerCase()] = n;
    }
    rows.forEach(function (s) { (s.colors || []).forEach(take); });
    // Anything typed this session but not saved yet counts too.
    Object.keys(drafts).forEach(function (k) {
      (drafts[k].colors || []).forEach(take);
    });
    if (newDraft) (newDraft.colors || []).forEach(take);
    return Object.keys(seen).sort().map(function (k) { return seen[k]; });
  }

  // The edits in progress for one style, started from what is saved.
  function draftFor(id) {
    if (id === '+') return newDraft || (newDraft = blank());
    if (!drafts[id]) {
      var s = rows.find(function (x) { return String(x.id) === String(id); });
      drafts[id] = s
        ? {
            name: s.name || '',
            notes: s.notes || '',
            images: (s.images || []).slice(),
            // Copied a level deep, so cancelling leaves the saved style
            // untouched.
            colors: (s.colors || []).map(function (c) {
              return {
                name: c.name || '',
                swatch: c.swatch || '',
                images: (c.images || []).slice(),
              };
            }),
          }
        : blank();
    }
    return drafts[id];
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-ds-body');
    if (!el) return;

    el.innerHTML =
      (adding ? '<div class="mm-ds is-open is-new">' +
                  '<div class="mm-ds-body">' + styleForm('+') + '</div>' +
                '</div>'
              : '') +
      (rows.length
        ? '<div class="mm-ds-list">' + rows.map(accordion).join('') + '</div>'
        : (adding ? '' : emptyState())) +
      (err ? '<p class="mm-task-error" role="alert">' + U.esc(err) + '</p>' : '');

    bind(el);
  }

  function emptyState() {
    return '<div class="mm-tt-empty">' +
      '<p class="mm-tt-empty-title">No door styles yet</p>' +
      '<p class="mm-tt-empty-sub">Add the doors you sell and the colours ' +
      'each one comes in.</p></div>';
  }

  // ---- One style, as an accordion ------------------------------------------

  function accordion(s) {
    var isOpen = !!open[s.id];
    var cols = s.colors || [];
    var imgs = s.images || [];

    return '<div class="mm-ds' + (isOpen ? ' is-open' : '') + '">' +
      '<button type="button" class="mm-ds-hdr" data-toggle="' + U.esc(s.id) + '" ' +
          'aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<span class="mm-ds-arrow" aria-hidden="true">&#9662;</span>' +
        (imgs.length
          ? '<img class="mm-ds-face" src="' + U.esc(imgs[0]) + '" alt="">'
          : '<span class="mm-ds-face mm-ds-noface" aria-hidden="true"></span>') +
        '<span class="mm-ds-hdrmain">' +
          '<span class="mm-ds-name">' + U.esc(s.name) + '</span>' +
          (s.notes ? '<span class="mm-ds-notes">' + U.esc(s.notes) + '</span>' : '') +
        '</span>' +
        '<span class="mm-ds-count' + (cols.length ? '' : ' is-none') + '">' +
          (cols.length
            ? cols.length + (cols.length === 1 ? ' colour' : ' colours')
            : 'No colours') +
        '</span>' +
      '</button>' +

      // Closed, the colours are still worth seeing: it is how someone
      // recognises a style, and how a finished one is told from a
      // half-finished one without opening it.
      (!isOpen && cols.length
        ? '<div class="mm-ds-strip">' +
            cols.slice(0, 12).map(function (c) {
              var shot = (c.images || [])[0];
              return '<span class="mm-ds-chip" title="' + U.esc(c.name) + '">' +
                (shot
                  ? '<img src="' + U.esc(shot) + '" alt="">'
                  : '<span class="mm-ds-chipsw" style="background:' +
                    U.esc(c.swatch || '#999') + '"></span>') +
                '<span>' + U.esc(c.name) + '</span>' +
              '</span>';
            }).join('') +
            (cols.length > 12
              ? '<span class="mm-ds-chipmore">+' + (cols.length - 12) + '</span>'
              : '') +
          '</div>'
        : '') +

      (isOpen ? '<div class="mm-ds-body">' + styleForm(s.id) + '</div>' : '') +
    '</div>';
  }

  // ---- The form inside one style -------------------------------------------

  function styleForm(id) {
    var d = draftFor(id);
    var isNew = id === '+';

    return '<div class="mm-ds-form" data-form="' + U.esc(id) + '">' +
      (isNew ? '<h3 class="mm-tt-formtitle">New door style</h3>' : '') +

      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Name</span>' +
        '<input class="mm-input mm-ds-f" data-id="' + U.esc(id) + '" ' +
          'data-k="name" placeholder="e.g. Nexus" ' +
          'value="' + U.esc(d.name) + '">' +
      '</div>' +

      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Notes <span class="mm-opt">(optional)</span></span>' +
        '<input class="mm-input mm-ds-f" data-id="' + U.esc(id) + '" ' +
          'data-k="notes" placeholder="e.g. transitional wide shaker" ' +
          'value="' + U.esc(d.notes) + '">' +
      '</div>' +

      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Photos of the door</span>' +
        (d.images.length
          ? '<div class="mm-ds-shots">' +
              d.images.map(function (u, i) {
                return '<span class="mm-ds-shot">' +
                  '<img src="' + U.esc(u) + '" alt="">' +
                  '<button type="button" class="mm-ds-x" ' +
                    'data-rmshot="' + U.esc(id) + '.' + i + '" ' +
                    'aria-label="Remove this photo">&times;</button>' +
                '</span>';
              }).join('') +
            '</div>'
          : '') +
        '<div class="mm-btn-row">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'data-shoot="' + U.esc(id) + '"' + (busy ? ' disabled' : '') + '>' +
            '&#128247; Camera</button>' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'data-upshot="' + U.esc(id) + '"' + (busy ? ' disabled' : '') + '>' +
            '&#128193; Upload</button>' +
        '</div>' +
      '</div>' +

      coloursPart(id, d) +

      '<div class="mm-ds-formfoot">' +
        (isNew
          ? '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'data-cancelnew="1"' + (busy ? ' disabled' : '') + '>Cancel</button>'
          : '<button type="button" class="mm-btn-sm mm-btn-danger" ' +
            'data-delstyle="' + U.esc(id) + '"' + (busy ? ' disabled' : '') +
            '>Delete style</button>') +
        '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
          'data-save="' + U.esc(id) + '"' + (busy ? ' disabled' : '') + '>' +
          (busy ? 'Saving...' : (isNew ? 'Add style' : 'Save')) + '</button>' +
      '</div>' +
    '</div>';
  }

  // ---- The colours on one style --------------------------------------------

  function coloursPart(id, d) {
    return '<div class="mm-mt-f">' +
      '<span class="mm-mt-flab">Colours</span>' +

      (d.colors.length
        ? '<div class="mm-ds-cols">' +
            d.colors.map(function (c, i) { return colourRow(id, c, i); }).join('') +
          '</div>'
        : '') +

      (colourFor === id
        ? colourForm()
        : '<div class="mm-btn-row">' +
            '<button type="button" class="mm-btn-sm mm-btn-secondary mm-ds-addcol" ' +
              'data-addcol="' + U.esc(id) + '"' + (busy ? ' disabled' : '') + '>' +
              '+ Add colour</button>' +
          '</div>') +
    '</div>';
  }

  function colourRow(id, c, i) {
    var shots = c.images || [];
    return '<div class="mm-ds-col">' +
      '<span class="mm-ds-colsw" style="background:' +
        U.esc(c.swatch || '#999') + '" aria-hidden="true"></span>' +
      '<span class="mm-ds-colname">' + U.esc(c.name) + '</span>' +
      '<span class="mm-ds-colshots">' +
        (shots.length
          ? shots.slice(0, 4).map(function (u) {
              return '<img src="' + U.esc(u) + '" alt="">';
            }).join('') +
            (shots.length > 4
              ? '<span class="mm-ds-colmore">+' + (shots.length - 4) + '</span>'
              : '')
          : '<span class="mm-ds-colnone">No photo</span>') +
      '</span>' +
      '<button type="button" class="mm-ds-colx" ' +
        'data-rmcol="' + U.esc(id) + '.' + i + '" ' +
        'aria-label="Remove ' + U.esc(c.name) + '">&times;</button>' +
    '</div>';
  }

  // Adding one colour: a name that has been used before or a new one, then
  // its photographs. The suggestion list is why nothing is typed twice.
  function colourForm() {
    var c = colourDraft;
    var known = knownColours();

    return '<div class="mm-ds-newcol">' +
      '<div class="mm-ds-newrow">' +
        '<label class="mm-mt-f" style="flex:1 1 180px">' +
          '<span class="mm-mt-flab">Colour</span>' +
          '<input class="mm-input" id="mm-ds-colname" list="mm-ds-colopts" ' +
            'placeholder="Pick one, or type a new name" ' +
            'value="' + U.esc(c.name) + '" autocomplete="off">' +
        '</label>' +
        '<label class="mm-mt-f" style="flex:0 0 76px">' +
          '<span class="mm-mt-flab">Swatch</span>' +
          '<input class="mm-input mm-ds-pick" type="color" id="mm-ds-colsw" ' +
            'value="' + U.esc(c.swatch || '#cccccc') + '">' +
        '</label>' +
      '</div>' +

      '<datalist id="mm-ds-colopts">' +
        known.map(function (n) {
          return '<option value="' + U.esc(n) + '"></option>';
        }).join('') +
      '</datalist>' +

      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Photos of this colour</span>' +
        (c.images.length
          ? '<div class="mm-ds-shots">' +
              c.images.map(function (u, i) {
                return '<span class="mm-ds-shot">' +
                  '<img src="' + U.esc(u) + '" alt="">' +
                  '<button type="button" class="mm-ds-x" ' +
                    'data-rmnew="' + i + '" ' +
                    'aria-label="Remove this photo">&times;</button>' +
                '</span>';
              }).join('') +
            '</div>'
          : '') +
        '<div class="mm-btn-row">' +
          '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-ds-colup"' + (busy ? ' disabled' : '') + '>' +
            '&#128193; ' + (c.images.length ? 'Add more' : 'Upload') + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="mm-btn-row">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-ds-colcancel"' + (busy ? ' disabled' : '') + '>Cancel</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
          'id="mm-ds-coladd"' + (busy ? ' disabled' : '') + '>Add colour</button>' +
      '</div>' +
    '</div>';
  }

  function say(m) { err = m || ''; render(); }

  // ---- Uploading -----------------------------------------------------------

  // One at a time, in order. The proxy caps a request at 4.5MB, so a handful
  // of swatches sent together would fail -- and a failure half way through a
  // batch is harder to explain than a slower upload that works.
  function uploadInto(list, into, btnSel) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return Promise.resolve();

    busy = true;
    err = '';
    render();

    var failed = 0;
    return files.reduce(function (chain, file, i) {
      return chain.then(function () {
        var b = document.querySelector(btnSel);
        if (b) {
          b.textContent = files.length > 1
            ? 'Uploading ' + (i + 1) + ' of ' + files.length + '...'
            : 'Uploading...';
        }
        return api.uploadMediaFile(file)
          .then(function (url) { into.push(url); })
          // One bad file does not stop the rest.
          .catch(function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      busy = false;
      say(failed
        ? failed + (failed === 1 ? ' photo' : ' photos') +
          ' could not be uploaded. The rest were added.'
        : '');
    });
  }

  function pickFiles(onPicked) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', function () { onPicked(input.files); });
    input.click();
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    el.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-toggle');
        open[id] = !open[id];
        // Closing a style puts away any colour form it had open.
        if (!open[id] && colourFor === id) { colourFor = null; colourDraft = null; }
        render();
      });
    });

    // Typing is written straight into the draft, so a redraw after an upload
    // cannot lose a half-typed name.
    el.querySelectorAll('.mm-ds-f').forEach(function (inp) {
      inp.addEventListener('input', function () {
        draftFor(inp.getAttribute('data-id'))[inp.getAttribute('data-k')] = inp.value;
      });
    });

    el.querySelectorAll('[data-shoot]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-shoot');
        var input = U.cameraInput(document.createElement('input'));
        input.addEventListener('change', function () {
          uploadInto(input.files, draftFor(id).images,
                     '[data-shoot="' + id + '"]');
        });
        input.click();
      });
    });

    el.querySelectorAll('[data-upshot]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-upshot');
        pickFiles(function (files) {
          uploadInto(files, draftFor(id).images, '[data-upshot="' + id + '"]');
        });
      });
    });

    el.querySelectorAll('[data-rmshot]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-rmshot').split('.');
        draftFor(p[0]).images.splice(+p[1], 1);
        render();
      });
    });

    // ---- Colours ----

    el.querySelectorAll('[data-addcol]').forEach(function (b) {
      b.addEventListener('click', function () {
        colourFor = b.getAttribute('data-addcol');
        colourDraft = { name: '', swatch: '#cccccc', images: [] };
        render();
        var f = document.getElementById('mm-ds-colname');
        if (f) f.focus();
      });
    });

    var cname = el.querySelector('#mm-ds-colname');
    if (cname) cname.addEventListener('input', function () {
      if (colourDraft) colourDraft.name = this.value;
    });

    var csw = el.querySelector('#mm-ds-colsw');
    if (csw) csw.addEventListener('input', function () {
      if (colourDraft) colourDraft.swatch = this.value;
    });

    var cup = el.querySelector('#mm-ds-colup');
    if (cup) cup.addEventListener('click', function () {
      pickFiles(function (files) {
        uploadInto(files, colourDraft.images, '#mm-ds-colup');
      });
    });

    el.querySelectorAll('[data-rmnew]').forEach(function (b) {
      b.addEventListener('click', function () {
        colourDraft.images.splice(+b.getAttribute('data-rmnew'), 1);
        render();
      });
    });

    var ccancel = el.querySelector('#mm-ds-colcancel');
    if (ccancel) ccancel.addEventListener('click', function () {
      colourFor = null; colourDraft = null; say('');
    });

    var cadd = el.querySelector('#mm-ds-coladd');
    if (cadd) cadd.addEventListener('click', addColour);

    el.querySelectorAll('[data-rmcol]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-rmcol').split('.');
        draftFor(p[0]).colors.splice(+p[1], 1);
        render();
      });
    });

    // ---- Saving ----

    el.querySelectorAll('[data-save]').forEach(function (b) {
      b.addEventListener('click', function () {
        saveStyle(b.getAttribute('data-save'));
      });
    });

    el.querySelectorAll('[data-delstyle]').forEach(function (b) {
      b.addEventListener('click', function () {
        delStyle(b.getAttribute('data-delstyle'));
      });
    });

    var cancelNew = el.querySelector('[data-cancelnew]');
    if (cancelNew) cancelNew.addEventListener('click', function () {
      adding = false; newDraft = null;
      if (colourFor === '+') { colourFor = null; colourDraft = null; }
      say('');
    });
  }

  function addColour() {
    var name = String(colourDraft.name || '').trim();
    if (!name) {
      say('Pick a colour or type its name.');
      var f = document.getElementById('mm-ds-colname');
      if (f) f.focus();
      return;
    }
    // A colour is its photographs. Without one the AI has only the word,
    // which is not enough for a stain or a gloss.
    if (!colourDraft.images.length) {
      say('Add at least one photo of this colour.');
      return;
    }

    var d = draftFor(colourFor);
    var clash = d.colors.some(function (c) {
      return String(c.name).trim().toLowerCase() === name.toLowerCase();
    });
    if (clash) { say('That colour is already on this style.'); return; }

    d.colors.push({
      name: name,
      swatch: colourDraft.swatch || '',
      images: colourDraft.images.slice(),
    });
    colourFor = null;
    colourDraft = null;
    say('');
  }

  function saveStyle(id) {
    var d = draftFor(id);
    var name = String(d.name || '').trim();
    if (!name) { say('Give the style a name.'); return; }
    if (!d.images.length) { say('Add at least one photo of the door.'); return; }

    var body = {
      name: name,
      notes: String(d.notes || '').trim() || null,
      images: d.images,
      colors: d.colors.map(function (c) {
        return {
          name: String(c.name).trim(),
          swatch: c.swatch || '',
          images: c.images || [],
        };
      }),
    };

    busy = true; err = ''; render();

    var req = id === '+'
      ? db('POST', '/door_styles', body)
      : db('PATCH', '/door_styles?id=eq.' + encodeURIComponent(id), body);

    req.then(function () {
      window.MM.activity.log('list_added',
        (id === '+' ? 'Added door style ' : 'Updated door style ') + name, {});
      busy = false;
      if (id === '+') { adding = false; newDraft = null; }
      else { delete drafts[id]; open[id] = false; }
      return load();
    }).catch(function (e) {
      busy = false;
      say('Could not save: ' + e.message);
    });
  }

  function delStyle(id) {
    var s = rows.find(function (x) { return String(x.id) === String(id); });
    if (!s) return;
    if (!window.confirm('Delete the door style "' + s.name + '"?')) return;

    busy = true; err = ''; render();
    // Marked inactive rather than removed: one deleted by mistake can be
    // brought back in the database.
    db('PATCH', '/door_styles?id=eq.' + encodeURIComponent(id), { active: false })
      .then(function () {
        window.MM.activity.log('list_added', 'Deleted door style ' + s.name, {});
        busy = false;
        delete drafts[id];
        delete open[id];
        return load();
      })
      .catch(function (e) {
        busy = false;
        say('Could not delete: ' + e.message);
      });
  }

  function startAdd() {
    adding = true;
    newDraft = blank();
    say('');
    var f = document.querySelector('[data-form="+"] .mm-ds-f');
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
