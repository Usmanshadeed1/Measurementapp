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

  // ---- The colours the manufacturer sells ----------------------------------
  //
  // Offered as a list rather than typed, so a name is never mistyped and
  // nobody has to remember what a finish is called. Picking one fills in its
  // name and its swatch together.
  //
  // This is a STARTING LIST, not a limit: anything typed that is not here is
  // accepted and then offered on every style afterwards. A manufacturer who
  // adds a finish next year needs no change here.
  //
  // Grouped as the manufacturer groups them, because that is how someone
  // looking for one expects to find it.
  var PRESETS = [
    // Paints
    { name: 'Frost', swatch: '#f2f0ea', grp: 'Paint' },
    { name: 'Dove', swatch: '#efebe0', grp: 'Paint' },
    { name: 'Linen', swatch: '#e8e3d5', grp: 'Paint' },
    { name: 'Cloud White', swatch: '#eeece5', grp: 'Paint' },
    { name: 'Macadamia Beige', swatch: '#e2d6bd', grp: 'Paint' },
    { name: 'Oyster', swatch: '#c2ab8f', grp: 'Paint' },
    { name: 'Repose Gray', swatch: '#cbc7bd', grp: 'Paint' },
    { name: 'Nickel', swatch: '#b4b5ae', grp: 'Paint' },
    { name: 'Stone', swatch: '#8d8178', grp: 'Paint' },
    { name: 'Mint Green', swatch: '#dde3d9', grp: 'Paint' },
    { name: 'Pistachio Green', swatch: '#b4bda7', grp: 'Paint' },
    { name: 'Sage Green', swatch: '#b3c4b4', grp: 'Paint' },
    { name: 'Pewter Green', swatch: '#5f6355', grp: 'Paint' },
    { name: 'Forest Green', swatch: '#5c6354', grp: 'Paint' },
    { name: 'Hunter Green', swatch: '#3c4634', grp: 'Paint' },
    { name: 'Izel Blue', swatch: '#7fa3bb', grp: 'Paint' },
    { name: 'Denim Blue', swatch: '#4a6e8c', grp: 'Paint' },
    { name: 'Naval', swatch: '#2f3e52', grp: 'Paint' },
    { name: 'Indigo', swatch: '#2b3440', grp: 'Paint' },
    { name: 'Orchid Purple', swatch: '#d9bdd4', grp: 'Paint' },
    { name: 'Cabernet Red', swatch: '#6d1f2a', grp: 'Paint' },
    { name: 'Graphite Black', swatch: '#33352f', grp: 'Paint' },
    { name: 'Pitch Black', swatch: '#1c1c1e', grp: 'Paint' },
    { name: 'Retreat', swatch: '#6d7466', grp: 'Paint' },

    // Gloss
    { name: 'Blanco Gloss', swatch: '#f4f4f2', grp: 'Gloss' },
    { name: 'Cashmere Gloss', swatch: '#cfc4b4', grp: 'Gloss' },
    { name: 'Gris Nube Gloss', swatch: '#bdbdb8', grp: 'Gloss' },
    { name: 'Textil Plata Gloss', swatch: '#cbc3b4', grp: 'Gloss' },
    { name: 'Metallo 1 Gloss', swatch: '#b9bcbe', grp: 'Gloss' },
    { name: 'Metallo 4 Gloss', swatch: '#3a3c3e', grp: 'Gloss' },
    { name: 'Euroline Gloss', swatch: '#4a4c4e', grp: 'Gloss' },
    { name: 'Agua Marina Gloss', swatch: '#a7c6c6', grp: 'Gloss' },
    { name: 'Azul Indigo Gloss', swatch: '#36506e', grp: 'Gloss' },
    { name: 'Azul Marino Gloss', swatch: '#232f4e', grp: 'Gloss' },
    { name: 'Olivo Gloss', swatch: '#7a5230', grp: 'Gloss' },
    { name: 'Guayana Gloss', swatch: '#3c2419', grp: 'Gloss' },
    { name: 'Black Gloss', swatch: '#0a0a0a', grp: 'Gloss' },

    // Matte
    { name: 'Blanco', swatch: '#eceae6', grp: 'Matte' },
    { name: 'Cashmere', swatch: '#cfc6b7', grp: 'Matte' },
    { name: 'Basalto', swatch: '#8b7d73', grp: 'Matte' },
    { name: 'Gris Plomo', swatch: '#4e5052', grp: 'Matte' },
    { name: 'Antracita', swatch: '#3a3836', grp: 'Matte' },
    { name: 'Agua Marina', swatch: '#a9c7c6', grp: 'Matte' },
    { name: 'Azul Indigo', swatch: '#35506d', grp: 'Matte' },
    { name: 'Azul Marino', swatch: '#232f4e', grp: 'Matte' },
    { name: 'Verde Salvia', swatch: '#3e4741', grp: 'Matte' },
    { name: 'Black', swatch: '#131313', grp: 'Matte' },

    // Textured, the wood grains
    { name: 'Como Ash 1', swatch: '#cbbda6', grp: 'Textured' },
    { name: 'Como Ash 2', swatch: '#c6b89f', grp: 'Textured' },
    { name: 'Clubhouse Oak', swatch: '#b8b2ab', grp: 'Textured' },
    { name: 'Ferrara Oak', swatch: '#cfc0a2', grp: 'Textured' },
    { name: 'Hickory Rock', swatch: '#6f5d4e', grp: 'Textured' },
    { name: 'Light Artwood', swatch: '#ded6cb', grp: 'Textured' },
    { name: 'Natural Elm', swatch: '#c9a673', grp: 'Textured' },
    { name: 'Silk Flow', swatch: '#ddd8cf', grp: 'Textured' },
    { name: 'Ice Cream 1', swatch: '#e3dcd2', grp: 'Textured' },
    { name: 'Rosales 1', swatch: '#ded2c4', grp: 'Textured' },
    { name: 'Rosales 2', swatch: '#c89b6d', grp: 'Textured' },
    { name: 'Rosales 3', swatch: '#6b5540', grp: 'Textured' },
    { name: 'Woodline 1', swatch: '#cfc5b6', grp: 'Textured' },
    { name: 'Woodline 3', swatch: '#4a3a2e', grp: 'Textured' },
    { name: 'Woodline 4', swatch: '#c9a87e', grp: 'Textured' },
    { name: 'Frappe 1', swatch: '#cdc6bd', grp: 'Textured' },
    { name: 'Ida 1', swatch: '#d8c6a8', grp: 'Textured' },
    { name: 'Ida 2', swatch: '#c9a26a', grp: 'Textured' },
    { name: 'Nocce 1', swatch: '#c8a173', grp: 'Textured' },
    { name: 'Nocce 3', swatch: '#8a6a4a', grp: 'Textured' },
    { name: 'Olmo 3', swatch: '#a8875f', grp: 'Textured' },
    { name: 'Muratti 1', swatch: '#cfc8bd', grp: 'Textured' },
    { name: 'Muratti 4', swatch: '#4c4a47', grp: 'Textured' },

    // Stains. Real wood, where the grain matters more than the colour --
    // which is exactly why a photograph is asked for alongside the name.
    { name: 'Timber', swatch: '#c89a5c', grp: 'Stain' },
    { name: 'Kona', swatch: '#3b2317', grp: 'Stain' },
    { name: 'Mocha', swatch: '#6b4a33', grp: 'Stain' },
    { name: 'Truffle', swatch: '#4e382a', grp: 'Stain' },
    { name: 'Natural Oak', swatch: '#c9a876', grp: 'Stain' },
    { name: 'Desert Oak', swatch: '#b89468', grp: 'Stain' },
    { name: 'Canyon Oak', swatch: '#a8784a', grp: 'Stain' },

    // Paints on the older ranges, still sold.
    { name: 'Cobblestone', swatch: '#9d9890', grp: 'Paint' },
    { name: 'Horizon', swatch: '#8f9aa3', grp: 'Paint' },

    // Illume and Ovela name the same two finishes differently from the
    // Spanish-named ones above; both are listed because both are ordered.
    { name: 'Bianco Gloss', swatch: '#f5f5f3', grp: 'Gloss' },
    { name: 'Grigio Gloss', swatch: '#b5b5b2', grp: 'Gloss' },
    { name: 'Bianco Matte', swatch: '#eeece8', grp: 'Matte' },
    { name: 'Carbone Matte', swatch: '#3c3c3a', grp: 'Matte' },
  ];

  // Every colour on offer: the presets, plus anything typed before. A name
  // used once is then in the list for every style afterwards.
  function colourOptions() {
    var out = [];
    var seen = {};

    PRESETS.forEach(function (c) {
      seen[c.name.toLowerCase()] = true;
      out.push(c);
    });

    knownColours().forEach(function (c) {
      if (seen[c.name.toLowerCase()]) return;
      seen[c.name.toLowerCase()] = true;
      out.push({ name: c.name, swatch: c.swatch || '#cccccc', grp: 'Yours' });
    });

    return out;
  }

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
      if (n) seen[n.toLowerCase()] = { name: n, swatch: c.swatch || '' };
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

    // The colours on offer, narrowed by whatever has been typed. Shown with
    // their swatches: a name read off a list is one thing, a name next to
    // the colour it means is another.
    var typed = String(c.name || '').trim().toLowerCase();
    var opts = colourOptions().filter(function (o) {
      return !typed || o.name.toLowerCase().indexOf(typed) > -1;
    });
    var exact = colourOptions().some(function (o) {
      return o.name.toLowerCase() === typed;
    });

    return '<div class="mm-ds-newcol">' +
      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Colour</span>' +
        '<div class="mm-ds-search">' +
          (c.name
            ? '<span class="mm-ds-searchsw" style="background:' +
              U.esc(c.swatch || '#cccccc') + '" aria-hidden="true"></span>'
            : '') +
          '<input class="mm-input" id="mm-ds-colname" autocomplete="off" ' +
            'placeholder="Search, or type a new name" ' +
            'value="' + U.esc(c.name) + '">' +
        '</div>' +

        // The list narrows as it is typed into, so twenty-three colours is
        // two keystrokes rather than a scroll.
        (opts.length
          ? '<div class="mm-ds-opts">' +
              opts.slice(0, 40).map(function (o) {
                return '<button type="button" class="mm-ds-opt' +
                    (o.name.toLowerCase() === typed ? ' is-on' : '') + '" ' +
                    'data-opt="' + U.esc(o.name) + '" ' +
                    'data-sw="' + U.esc(o.swatch) + '">' +
                  '<span class="mm-ds-optsw" style="background:' +
                    U.esc(o.swatch) + '"></span>' +
                  '<span class="mm-ds-optname">' + U.esc(o.name) + '</span>' +
                  '<span class="mm-ds-optgrp">' + U.esc(o.grp || '') + '</span>' +
                '</button>';
              }).join('') +
            '</div>'
          : '') +

        // Anything not on the list is accepted and offered from then on: a
        // manufacturer adding a finish next year needs no change here, and
        // a customer's own Benjamin Moore colour is ordered the same way.
        //
        // A new name is the one case that needs a swatch typed, because
        // there is no preset to take one from. Hex, not RGB: it is what a
        // paint chart prints and what anyone can copy.
        (typed && !exact
          ? '<div class="mm-ds-custom">' +
              '<p class="mm-ds-newname">&ldquo;' + U.esc(c.name) +
                '&rdquo; is a new colour. Give it a shade so it can be ' +
                'recognised in a list.</p>' +
              '<div class="mm-ds-hexrow">' +
                '<span class="mm-ds-hexsw" style="background:' +
                  U.esc(c.swatch || '#cccccc') + '" aria-hidden="true"></span>' +
                '<input class="mm-input mm-ds-hex" id="mm-ds-colhex" ' +
                  'placeholder="#8d8178" maxlength="7" autocomplete="off" ' +
                  'value="' + U.esc(c.swatch || '') + '" ' +
                  'aria-label="Colour as a hex code">' +
              '</div>' +
            '</div>'
          : '') +
      '</div>' +

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
        colourDraft = { name: '', swatch: '', images: [] };
        render();
        var f = document.getElementById('mm-ds-colname');
        if (f) f.focus();
      });
    });

    var cname = el.querySelector('#mm-ds-colname');
    if (cname) cname.addEventListener('input', function () {
      if (!colourDraft) return;
      colourDraft.name = this.value;
      // Redrawn so the list narrows while it is typed into. The caret is
      // put back where it was, because a redraw moves it to the end.
      var at = this.selectionStart;
      render();
      var box = document.getElementById('mm-ds-colname');
      if (box) {
        box.focus();
        try { box.setSelectionRange(at, at); } catch (e) { /* not all inputs */ }
      }
    });

    // A typed shade. Only ever needed for a name that is not on the list --
    // every preset brings its own.
    var chex = el.querySelector('#mm-ds-colhex');
    if (chex) chex.addEventListener('input', function () {
      if (!colourDraft) return;
      var v = String(this.value || '').trim();
      if (v && v.charAt(0) !== '#') v = '#' + v;
      colourDraft.swatch = v;
      // Only the swatch beside it is repainted: a full redraw here would
      // take the caret out of the box being typed into.
      var sw = document.querySelector('.mm-ds-hexsw');
      if (sw && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) sw.style.background = v;
    });

    // Picking one from the list fills in its name and its swatch together,
    // so a name is never mistyped and the swatch is never wrong for it.
    el.querySelectorAll('[data-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!colourDraft) return;
        colourDraft.name = b.getAttribute('data-opt');
        colourDraft.swatch = b.getAttribute('data-sw') || '#cccccc';
        render();
        // Back to the photos, which is the only thing left to do.
        var up = document.getElementById('mm-ds-colup');
        if (up) up.focus();
      });
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
