// js/materialtpl.js
// Material templates: a list of materials saved once and loaded onto any job.
//
// Every kitchen needs roughly the same things. Writing that list out on each
// new job is the work this removes -- the same reason task templates exist,
// for a different kind of list.
//
// A material is not a task. A task is "do this by Friday"; a material is "24
// of these, this size, from this supplier, at this price". So this is its own
// thing rather than a shape forced onto tasks: quantities that get edited per
// job, ticks for ordered and received, and a total that means something.
//
// Loading a template COPIES its items onto the job. Editing them there -- a
// different quantity, one more box of screws -- never touches the template,
// so the saved list stays clean for the next job.
//
// Templates live in Supabase rather than GoHighLevel: they belong to the
// business, not to any one customer, so there is no opportunity to attach
// them to. The JOB's own list is stored on the opportunity -- see
// materials.js.
//
// An item is an object rather than a line of text, because it carries six
// things and a pipe-separated line of six fields is unreadable the moment one
// of them is empty:
//
//   { item, qty, unit, cost, supplier, notes }
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var rows = [];
  var editing = null;    // template being edited, or null
  var adding = false;
  var draft = [];        // the items in the form, while it is open
  var open = {};         // template id -> is its item list expanded

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  // Units offered by name. Free text would give "ea", "each", "EA" and "Each"
  // as four different units inside a month.
  var UNITS = ['each', 'box', 'sheet', 'ft', 'sq ft', 'yd', 'gal', 'lb',
               'roll', 'bag', 'tube', 'set'];

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-mt-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading...</div>';

    return db('GET', '/material_templates?select=*&active=eq.true&order=position,name')
      .then(function (r) {
        rows = r || [];
        render();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  // Read once and handed to the job screen, which does the copying.
  function all() { return rows.slice(); }

  // Every supplier named on any template, for the dropdowns. Collected from
  // the templates themselves rather than kept in a table of their own: a
  // supplier typed once is then offered forever, and there is no second list
  // to maintain or go stale.
  function suppliers() {
    var seen = {};
    rows.forEach(function (t) {
      (t.items || []).forEach(function (i) {
        var s = String(i.supplier || '').trim();
        if (s) seen[s.toLowerCase()] = s;
      });
    });
    return Object.keys(seen).sort().map(function (k) { return seen[k]; });
  }

  // ---- Items ---------------------------------------------------------------

  function blank() {
    return { item: '', qty: '', unit: 'each', cost: '', supplier: '', notes: '' };
  }

  function clean(v) { return String(v === undefined || v === null ? '' : v).trim(); }

  // An item with no name is a row someone started and thought better of, so
  // it is dropped rather than refused.
  function tidy(list) {
    return (list || []).map(function (r) {
      return {
        item: clean(r.item), qty: clean(r.qty), unit: clean(r.unit) || 'each',
        cost: clean(r.cost), supplier: clean(r.supplier), notes: clean(r.notes),
      };
    }).filter(function (r) { return !!r.item; });
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // What the items add up to, when costs have been entered. Cost is optional,
  // so this is shown only once something has a price on it.
  function total(list) {
    var t = 0, any = false;
    (list || []).forEach(function (r) {
      var c = num(r.cost);
      if (!c) return;
      any = true;
      t += c * (num(r.qty) || 1);
    });
    return any ? t : 0;
  }

  function money(n) {
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function countItems(t) {
    var n = (t.items || []).length;
    return n + (n === 1 ? ' item' : ' items');
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-mt-body');
    if (!el) return;

    el.innerHTML =
      (adding || editing ? formBox() : '') +
      (rows.length
        ? '<div class="mm-tt-list">' + rows.map(card).join('') + '</div>'
        : (adding ? '' : emptyState())) +
      '<p class="mm-task-error" id="mm-mt-error" role="alert"></p>';

    bind(el);
  }

  function emptyState() {
    return '<div class="mm-tt-empty">' +
      '<p class="mm-tt-empty-title">No material lists yet</p>' +
      '<p class="mm-tt-empty-sub">Write out what a kitchen needs once — ' +
      'then load it onto any kitchen job and adjust the quantities.</p></div>';
  }

  function card(t) {
    var items = t.items || [];
    var isOpen = !!open[t.id];
    var sum = total(items);

    return '<div class="mm-tt' + (isOpen ? ' is-open' : '') + '">' +
      '<div class="mm-tt-head">' +
        '<button type="button" class="mm-tt-toggle" data-toggle="' + U.esc(t.id) + '" ' +
            'aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
          '<span class="mm-tt-arrow" aria-hidden="true">&#9662;</span>' +
          '<span class="mm-tt-main">' +
            '<span class="mm-tt-name">' + U.esc(t.name) + '</span>' +
            '<span class="mm-tt-count">' + U.esc(countItems(t)) +
              (sum ? ' &middot; ' + U.esc(money(sum)) : '') + '</span>' +
            (t.description
              ? '<span class="mm-tt-desc">' + U.esc(t.description) + '</span>' : '') +
          '</span>' +
        '</button>' +
        '<div class="mm-tt-side">' +
          '<button type="button" class="mm-tt-icon" data-edit="' + U.esc(t.id) + '" ' +
            'aria-label="Edit ' + U.esc(t.name) + '">&#9998;</button>' +
          '<button type="button" class="mm-tt-icon mm-tt-del" data-del="' + U.esc(t.id) + '" ' +
            'aria-label="Delete ' + U.esc(t.name) + '">&times;</button>' +
        '</div>' +
      '</div>' +
      (items.length && isOpen
        ? '<div class="mm-mt-items">' +
            items.map(function (i) {
              var line = [i.qty, i.qty ? i.unit : ''].filter(Boolean).join(' ');
              return '<div class="mm-mt-item">' +
                '<span class="mm-mt-qty">' + U.esc(line) + '</span>' +
                '<span class="mm-mt-name">' + U.esc(i.item) + '</span>' +
                (i.supplier
                  ? '<span class="mm-mt-sup">' + U.esc(i.supplier) + '</span>' : '') +
                (num(i.cost)
                  ? '<span class="mm-mt-cost">' + U.esc(money(num(i.cost))) +
                    '</span>' : '') +
              '</div>';
            }).join('') +
          '</div>'
        : '') +
    '</div>';
  }

  // ---- The form ------------------------------------------------------------

  function supplierList() {
    // A datalist rather than a select: the point is to offer what has been
    // typed before WITHOUT stopping a new supplier being typed.
    return '<datalist id="mm-mt-sups">' +
      suppliers().map(function (s) {
        return '<option value="' + U.esc(s) + '"></option>';
      }).join('') +
    '</datalist>';
  }

  function itemRow(r, i) {
    return '<div class="mm-mt-row">' +
      '<span class="mm-mt-n">' + (i + 1) + '</span>' +

      '<div class="mm-mt-fields">' +
        '<label class="mm-mt-f">' +
          '<span class="mm-mt-flab">Item</span>' +
          '<input class="mm-input mm-mt-in mm-mt-item-in" data-i="' + i + '" ' +
            'data-k="item" placeholder="e.g. Cabinet hinges" ' +
            'value="' + U.esc(r.item) + '">' +
        '</label>' +

        // Each box labelled above it. A placeholder vanishes the moment
        // something is typed, which leaves four filled boxes and no way to
        // tell which number was the cost and which was the quantity.
        '<div class="mm-mt-sub">' +
          '<label class="mm-mt-f mm-mt-f-qty">' +
            '<span class="mm-mt-flab">Qty</span>' +
            '<input class="mm-input mm-mt-in" type="number" min="0" ' +
              'step="any" inputmode="decimal" data-i="' + i + '" data-k="qty" ' +
              'value="' + U.esc(r.qty) + '">' +
          '</label>' +

          '<label class="mm-mt-f mm-mt-f-unit">' +
            '<span class="mm-mt-flab">Unit</span>' +
            '<select class="mm-select mm-mt-in" data-i="' + i + '" ' +
              'data-k="unit">' +
              UNITS.map(function (u) {
                return '<option value="' + U.esc(u) + '"' +
                  (u === (r.unit || 'each') ? ' selected' : '') + '>' +
                  U.esc(u) + '</option>';
              }).join('') +
            '</select>' +
          '</label>' +

          '<label class="mm-mt-f mm-mt-f-cost">' +
            '<span class="mm-mt-flab">Cost each <span class="mm-opt">(optional)</span></span>' +
            '<input class="mm-input mm-mt-in" type="number" min="0" ' +
              'step="0.01" inputmode="decimal" data-i="' + i + '" data-k="cost" ' +
              'placeholder="0.00" value="' + U.esc(r.cost) + '">' +
          '</label>' +

          '<label class="mm-mt-f mm-mt-f-sup">' +
            '<span class="mm-mt-flab">Supplier <span class="mm-opt">(optional)</span></span>' +
            '<input class="mm-input mm-mt-in" list="mm-mt-sups" ' +
              'data-i="' + i + '" data-k="supplier" ' +
              'value="' + U.esc(r.supplier) + '">' +
          '</label>' +
        '</div>' +
      '</div>' +

      '<button type="button" class="mm-mt-del" data-delrow="' + i + '" ' +
        'aria-label="Remove item ' + (i + 1) + '">&times;</button>' +
    '</div>';
  }

  function formBox() {
    var t = editing || { name: '', description: '' };
    var sum = total(draft);

    return '<div class="mm-tt-form">' +
      '<h3 class="mm-tt-formtitle">' +
        (editing ? 'Edit material list' : 'New material list') + '</h3>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-mt-name">Name</label>' +
        '<input class="mm-input" id="mm-mt-name" placeholder="e.g. Kitchen" ' +
          'value="' + U.esc(t.name || '') + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-mt-desc">Description ' +
          '<span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-mt-desc" ' +
          'placeholder="When to use this one" ' +
          'value="' + U.esc(t.description || '') + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<span class="mm-label">Items</span>' +
        (draft.length
          ? '<div class="mm-mt-rows">' + draft.map(itemRow).join('') + '</div>'
          : '<p class="mm-tt-hint">No items yet. Add the first one below.</p>') +
        (sum
          ? '<div class="mm-mt-total"><span>Estimated total</span>' +
            '<span class="mm-mt-totalval">' + U.esc(money(sum)) + '</span></div>'
          : '') +
        '<button type="button" class="mm-btn-sm mm-btn-secondary mm-mt-add" ' +
          'id="mm-mt-additem">+ Add item</button>' +
        '<p class="mm-tt-hint">Cost and supplier are optional — fill them in ' +
          'when you know them.</p>' +
      '</div>' +

      supplierList() +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-mt-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-mt-save">' +
          (editing ? 'Save changes' : 'Create list') + '</button>' +
      '</div>' +
    '</div>';
  }

  function showError(msg) {
    var el = document.getElementById('mm-mt-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var cancel = el.querySelector('#mm-mt-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null; draft = []; render();
    });

    var save = el.querySelector('#mm-mt-save');
    if (save) save.addEventListener('click', saveTemplate);

    var addItem = el.querySelector('#mm-mt-additem');
    if (addItem) addItem.addEventListener('click', function () {
      draft.push(blank());
      render();
      // Into the new row's name box: the next thing anyone does is type it.
      var boxes = document.querySelectorAll('.mm-mt-item-in');
      if (boxes.length) boxes[boxes.length - 1].focus();
    });

    // Typing is written straight into the draft, so a redraw for any other
    // reason cannot lose what is half-entered.
    el.querySelectorAll('.mm-mt-in').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var r = draft[+inp.getAttribute('data-i')];
        if (r) r[inp.getAttribute('data-k')] = inp.value;
      });
      inp.addEventListener('change', function () {
        var r = draft[+inp.getAttribute('data-i')];
        if (r) r[inp.getAttribute('data-k')] = inp.value;
      });
    });

    el.querySelectorAll('[data-delrow]').forEach(function (b) {
      b.addEventListener('click', function () {
        draft.splice(+b.getAttribute('data-delrow'), 1);
        render();
      });
    });

    el.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-toggle');
        open[id] = !open[id];
        render();
      });
    });

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-edit');
        var t = rows.find(function (x) { return String(x.id) === String(id); });
        if (!t) return;
        editing = t;
        adding = false;
        // A copy, so cancelling leaves the saved list exactly as it was.
        draft = (t.items || []).map(function (i) {
          return {
            item: clean(i.item), qty: clean(i.qty),
            unit: clean(i.unit) || 'each', cost: clean(i.cost),
            supplier: clean(i.supplier), notes: clean(i.notes),
          };
        });
        render();
        var el2 = document.getElementById('mm-mt-name');
        if (el2) el2.focus();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        var t = rows.find(function (x) { return String(x.id) === String(id); });
        if (!t) return;
        if (!window.confirm('Delete the material list "' + t.name + '"?\n\n' +
                            'Jobs that already loaded it keep their items.')) return;

        b.disabled = true;
        showError('');
        // Marked inactive rather than removed, matching task templates: a
        // list deleted by mistake can be brought back in the database.
        db('PATCH', '/material_templates?id=eq.' + encodeURIComponent(id),
           { active: false })
          .then(function () {
            window.MM.activity.log('list_added', 'Deleted material list ' + t.name, {});
            return load();
          })
          .catch(function (e) {
            b.disabled = false;
            showError('Could not delete: ' + e.message);
          });
      });
    });
  }

  function saveTemplate() {
    var btn = document.getElementById('mm-mt-save');
    var name = (document.getElementById('mm-mt-name').value || '').trim();
    if (!name) {
      showError('Give the list a name.');
      document.getElementById('mm-mt-name').focus();
      return;
    }

    var items = tidy(draft);
    if (!items.length) {
      showError('Add at least one item.');
      return;
    }

    var body = {
      name: name,
      description: (document.getElementById('mm-mt-desc').value || '').trim() || null,
      items: items,
    };

    showError('');
    btn.disabled = true; btn.textContent = 'Saving...';

    var req = editing
      ? db('PATCH', '/material_templates?id=eq.' + encodeURIComponent(editing.id), body)
      : db('POST', '/material_templates', body);

    req.then(function () {
      window.MM.activity.log('list_added',
        (editing ? 'Updated material list ' : 'Created material list ') + name, {});
      adding = false; editing = null; draft = [];
      return load();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = editing ? 'Save changes' : 'Create list';
      showError('Could not save: ' + e.message);
    });
  }

  function startAdd() {
    adding = true; editing = null;
    draft = [blank()];
    render();
    var el = document.getElementById('mm-mt-name');
    if (el) el.focus();
  }

  function init() {
    var add = document.getElementById('mm-mt-add');
    if (add) add.addEventListener('click', startAdd);
  }

  window.MM.materialtpl = {
    init: init,
    load: load,
    all: all,
    suppliers: suppliers,
    startAdd: startAdd,
    _tidy: tidy, _total: total, _money: money, _num: num, _UNITS: UNITS,
  };
})();
