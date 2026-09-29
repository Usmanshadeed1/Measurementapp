// js/materials.js
// The materials for one job.
//
// A list loaded from a template (see materialtpl.js) and then made true for
// this particular job: quantities adjusted, extras added, and each item
// ticked as it is ordered and as it arrives.
//
// Loading a template COPIES its items. Nothing done here ever reaches the
// template -- that is the whole point of having one.
//
// Stored on the opportunity, one item per line, so the list is legible in
// GoHighLevel without this app:
//
//   Cabinet hinges|24|each|3.50|Home Depot|ordered|soft close
//
// The six fields before the note are item, quantity, unit, cost each,
// supplier and state. State is one of todo, ordered or received. The note
// runs to the end of the line, so a note containing a pipe survives.
//
// Why a text field rather than a custom object: GoHighLevel caps an account
// at ten custom objects and the measurement tool uses all ten. This is the
// same reason the task list is stored this way.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var FIELD_ID = '57iNonfCZKjRf7uXVBLh';   // Opportunity -> Material List
  var SEP = '|';

  // Built rather than written as a literal, for the same reason as in
  // jobsteps.js: a newline typed into the source is one bad paste away from
  // breaking the file.
  var NEWLINE = String.fromCharCode(10);
  var SPLIT_RE = new RegExp(String.fromCharCode(13) + '?' +
                            String.fromCharCode(10));

  var STATES = ['todo', 'ordered', 'received'];
  var STATE_LABEL = { todo: 'To order', ordered: 'Ordered', received: 'Received' };

  var currentJob = null;
  var items = [];
  var saving = false;
  var adding = false;
  var showFilter = 'all';      // all | todo | ordered | received

  // ---- Reading and writing -------------------------------------------------

  function parse(text) {
    var out = [];
    String(text || '').split(SPLIT_RE).forEach(function (raw) {
      if (!raw.trim()) return;
      var p = raw.split(SEP);
      var st = (p[5] || 'todo').trim();
      out.push({
        item: (p[0] || '').trim(),
        qty: (p[1] || '').trim(),
        unit: (p[2] || '').trim() || 'each',
        cost: (p[3] || '').trim(),
        supplier: (p[4] || '').trim(),
        state: STATES.indexOf(st) > -1 ? st : 'todo',
        // Anything after the sixth pipe is the note, so a note containing a
        // pipe survives instead of being cut in half.
        notes: p.slice(6).join(SEP).trim(),
      });
    });
    return out;
  }

  function serialise(rows) {
    return rows.map(function (r) {
      return [r.item, r.qty, r.unit, r.cost, r.supplier, r.state, r.notes]
        .join(SEP);
    }).join(NEWLINE);
  }

  // A pipe or a line break would break the one-item-per-line format, so both
  // become a space rather than being refused.
  function clean(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[|\r\n]+/g, ' ').trim();
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function money(n) {
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function lineCost(r) { return num(r.cost) * (num(r.qty) || 1); }

  function total(rows) {
    var t = 0, any = false;
    (rows || []).forEach(function (r) {
      if (!num(r.cost)) return;
      any = true;
      t += lineCost(r);
    });
    return any ? t : 0;
  }

  function save(logText) {
    saving = true;
    render();
    var stored = serialise(items);

    return api.setOpportunityField(currentJob.id, FIELD_ID, stored)
      .then(function () {
        saving = false;
        // Written into the job already held rather than read back:
        // GoHighLevel's read runs a moment behind its write.
        var fields = currentJob.customFields || [];
        var found = false;
        for (var i = 0; i < fields.length; i++) {
          if (fields[i].id === FIELD_ID) {
            fields[i].fieldValue = stored;
            fields[i].fieldValueString = stored;
            found = true;
            break;
          }
        }
        if (!found) {
          fields.push({ id: FIELD_ID, fieldValue: stored, fieldValueString: stored });
        }
        currentJob.customFields = fields;

        if (logText) {
          window.MM.activity.log('list_added', logText, {
            jobId: currentJob.id,
            jobName: (currentJob.contact && currentJob.contact.name) || currentJob.name,
          });
        }
        render();
      })
      .catch(function (e) {
        saving = false;
        render();
        showError('Could not save: ' + e.message);
      });
  }

  // ---- Loading -------------------------------------------------------------

  function showForJob(job) {
    currentJob = job;
    items = [];
    adding = false;
    showFilter = 'all';

    var el = document.getElementById('mm-job-materials');
    if (!el) return Promise.resolve();
    el.innerHTML = head() + '<div class="mm-empty">Loading...</div>';

    return api.getOpportunity(job.id)
      .then(function (opp) {
        if (opp) currentJob.customFields = opp.customFields;
        items = parse(opp ? api.oppField(opp, FIELD_ID) : '');
        render();
      })
      .catch(function (e) {
        el.innerHTML = head() +
          '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  function head() {
    var done = items.filter(function (r) { return r.state === 'received'; }).length;
    var sum = total(items);
    return '<div class="mm-steps-head">' +
      '<span class="mm-steps-title">Materials</span>' +
      (items.length
        ? '<span class="mm-steps-badge' +
            (done === items.length ? ' mm-steps-badge-done' : '') + '">' +
            done + ' of ' + items.length + (sum ? ' &middot; ' + money(sum) : '') +
          '</span>'
        : '<span class="mm-steps-badge mm-steps-badge-todo">None yet</span>') +
    '</div>';
  }

  // ---- Rendering -----------------------------------------------------------

  function passes(r) {
    return showFilter === 'all' || r.state === showFilter;
  }

  function render() {
    var el = document.getElementById('mm-job-materials');
    if (!el) return;

    var shown = items.filter(passes);

    el.innerHTML = head() +
      '<div class="mm-ml-body">' +
        toolbar() +
        (adding ? addForm() : '') +
        (items.length
          ? (shown.length
              ? '<div class="mm-ml-list">' +
                  items.map(function (r, i) {
                    return passes(r) ? row(r, i) : '';
                  }).join('') +
                '</div>' +
                (total(shown)
                  ? '<div class="mm-ml-total"><span>Total</span>' +
                    '<span class="mm-ml-totalval">' +
                    U.esc(money(total(shown))) + '</span></div>'
                  : '')
              : '<p class="mm-task-empty">Nothing in that view.</p>')
          : '<p class="mm-task-empty">No materials on this job yet. ' +
            'Load a list, or add items one at a time.</p>') +
        '<p class="mm-task-error" id="mm-ml-error" role="alert"></p>' +
      '</div>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function toolbar() {
    return '<div class="mm-ml-bar">' +
      '<select class="mm-select mm-ml-filter" id="mm-ml-filter" ' +
        'aria-label="Which materials to show">' +
        '<option value="all"' + (showFilter === 'all' ? ' selected' : '') +
          '>All materials</option>' +
        '<option value="todo"' + (showFilter === 'todo' ? ' selected' : '') +
          '>Still to order</option>' +
        '<option value="ordered"' + (showFilter === 'ordered' ? ' selected' : '') +
          '>Ordered</option>' +
        '<option value="received"' + (showFilter === 'received' ? ' selected' : '') +
          '>Received</option>' +
      '</select>' +
      '<div class="mm-ml-baracts">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-ml-load">Load a list</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-ml-export"' + (items.length ? '' : ' disabled') + '>Export</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
          'id="mm-ml-add">+ Item</button>' +
      '</div>' +
    '</div>';
  }

  // One item. The state is a single button that moves forward through
  // to-order, ordered and received: ticking twice is how an item goes from
  // ordered to arrived, and a dropdown per row would be three taps for what
  // is almost always one.
  function row(r, i) {
    var c = lineCost(r);
    return '<div class="mm-ml' + (r.state === 'received' ? ' is-done' : '') +
        (r.state === 'ordered' ? ' is-ordered' : '') + '">' +
      '<button type="button" class="mm-ml-state" data-state="' + i + '" ' +
        'aria-label="' + U.esc(r.item + ' — ' + STATE_LABEL[r.state] +
          '. Tap to move on.') + '">' +
        (r.state === 'received' ? '&#10003;' : (r.state === 'ordered' ? '&#8230;' : '')) +
      '</button>' +

      '<div class="mm-ml-main">' +
        '<div class="mm-ml-name">' + U.esc(r.item) + '</div>' +
        '<div class="mm-ml-meta">' +
          (r.qty
            ? '<span class="mm-ml-qty">' + U.esc(r.qty + ' ' + r.unit) + '</span>'
            : '') +
          '<span class="mm-ml-tag mm-ml-tag-' + U.esc(r.state) + '">' +
            U.esc(STATE_LABEL[r.state]) + '</span>' +
          (r.supplier
            ? '<span class="mm-ml-sup">' + U.esc(r.supplier) + '</span>' : '') +
          (c ? '<span class="mm-ml-cost">' + U.esc(money(c)) + '</span>' : '') +
        '</div>' +
        (r.notes ? '<div class="mm-ml-notes">' + U.esc(r.notes) + '</div>' : '') +
      '</div>' +

      '<div class="mm-ml-side">' +
        '<button type="button" class="mm-ml-icon" data-edit="' + i + '" ' +
          'aria-label="Edit ' + U.esc(r.item) + '">&#9998;</button>' +
        '<button type="button" class="mm-ml-icon mm-ml-del" data-del="' + i + '" ' +
          'aria-label="Remove ' + U.esc(r.item) + '">&times;</button>' +
      '</div>' +
    '</div>';
  }

  // Adding or editing one item. `editing` is the index being changed, or null.
  var editing = null;

  function addForm() {
    var r = editing !== null ? items[editing]
      : { item: '', qty: '', unit: 'each', cost: '', supplier: '', notes: '' };
    var units = (window.MM.materialtpl && window.MM.materialtpl._UNITS) ||
                ['each', 'box', 'ft'];
    var sups = (window.MM.materialtpl && window.MM.materialtpl.suppliers()) || [];

    // Suppliers already on this job as well as the ones on the templates: an
    // extra typed here should be offered on the next item too.
    items.forEach(function (x) {
      if (x.supplier && sups.indexOf(x.supplier) < 0) sups.push(x.supplier);
    });

    return '<div class="mm-ml-form">' +
      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Item</span>' +
        '<input class="mm-input" id="mm-ml-item" placeholder="e.g. Cabinet hinges" ' +
          'value="' + U.esc(r.item) + '">' +
      '</div>' +
      '<div class="mm-mt-sub">' +
        '<label class="mm-mt-f mm-mt-f-qty"><span class="mm-mt-flab">Qty</span>' +
          '<input class="mm-input" type="number" min="0" step="any" ' +
            'inputmode="decimal" id="mm-ml-qty" value="' + U.esc(r.qty) + '">' +
        '</label>' +
        '<label class="mm-mt-f mm-mt-f-unit"><span class="mm-mt-flab">Unit</span>' +
          '<select class="mm-select" id="mm-ml-unit">' +
            units.map(function (u) {
              return '<option value="' + U.esc(u) + '"' +
                (u === (r.unit || 'each') ? ' selected' : '') + '>' +
                U.esc(u) + '</option>';
            }).join('') +
          '</select>' +
        '</label>' +
        '<label class="mm-mt-f mm-mt-f-cost">' +
          '<span class="mm-mt-flab">Cost each <span class="mm-opt">(optional)</span></span>' +
          '<input class="mm-input" type="number" min="0" step="0.01" ' +
            'inputmode="decimal" id="mm-ml-cost" placeholder="0.00" ' +
            'value="' + U.esc(r.cost) + '">' +
        '</label>' +
        '<label class="mm-mt-f mm-mt-f-sup">' +
          '<span class="mm-mt-flab">Supplier <span class="mm-opt">(optional)</span></span>' +
          '<input class="mm-input" id="mm-ml-sup" list="mm-ml-sups" ' +
            'value="' + U.esc(r.supplier) + '">' +
        '</label>' +
      '</div>' +
      '<datalist id="mm-ml-sups">' +
        sups.map(function (s) {
          return '<option value="' + U.esc(s) + '"></option>';
        }).join('') +
      '</datalist>' +
      '<div class="mm-mt-f">' +
        '<span class="mm-mt-flab">Note <span class="mm-opt">(optional)</span></span>' +
        '<input class="mm-input" id="mm-ml-notes" ' +
          'placeholder="Size, colour, anything worth remembering" ' +
          'value="' + U.esc(r.notes) + '">' +
      '</div>' +
      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-ml-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-ml-save"' +
          (saving ? ' disabled' : '') + '>' +
          (saving ? 'Saving...' : (editing !== null ? 'Save changes' : 'Add item')) +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function showError(msg) {
    var el = document.getElementById('mm-ml-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Export --------------------------------------------------------------
  //
  // The list as plain text, to paste into an email or a message to a
  // supplier. Offered per supplier as well as whole: sending a lumber yard a
  // list that includes cabinet hinges wastes their time and invites the wrong
  // order.

  function asText(rows, title) {
    var lines = [title, ''];
    rows.forEach(function (r) {
      var bits = [];
      if (r.qty) bits.push(r.qty + ' ' + r.unit);
      bits.push(r.item);
      var line = '- ' + bits.join('  ');
      if (r.notes) line += '  (' + r.notes + ')';
      lines.push(line);
    });
    var sum = total(rows);
    if (sum) { lines.push(''); lines.push('Estimated total: ' + money(sum)); }
    return lines.join(NEWLINE);
  }

  function exportList() {
    var job = (currentJob.contact && currentJob.contact.name) || currentJob.name || '';
    var sups = [];
    items.forEach(function (r) {
      var s = r.supplier || '';
      if (sups.indexOf(s) < 0) sups.push(s);
    });

    var pick = '';
    if (sups.length > 1) {
      var named = sups.filter(Boolean);
      var msg = 'Export which items?' + NEWLINE + NEWLINE +
        '0 = everything' + NEWLINE +
        named.map(function (s, i) { return (i + 1) + ' = ' + s; }).join(NEWLINE) +
        NEWLINE + NEWLINE + 'Type a number:';
      var ans = window.prompt(msg, '0');
      if (ans === null) return;
      var n = parseInt(ans, 10);
      if (isFinite(n) && n > 0 && named[n - 1]) pick = named[n - 1];
    }

    var rows = pick
      ? items.filter(function (r) { return r.supplier === pick; })
      : items;
    if (!rows.length) { showError('Nothing to export.'); return; }

    var text = asText(rows, 'Materials — ' + job + (pick ? ' — ' + pick : ''));
    openExport(text);
  }

  // Shown in a box rather than copied straight to the clipboard: on a phone a
  // silent copy gives no sign it worked, and the text is often wanted in a
  // message rather than a paste.
  function openExport(text) {
    var wrap = document.getElementById('mm-ml-exportbox');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'mm-ml-exportbox';
      wrap.className = 'mm-modal-overlay';
      document.body.appendChild(wrap);
    }
    wrap.innerHTML =
      '<div class="mm-modal" role="dialog" aria-modal="true" ' +
          'aria-labelledby="mm-ml-extitle">' +
        '<div class="mm-modal-title" id="mm-ml-extitle">Material list</div>' +
        '<textarea class="mm-input mm-ml-exarea" rows="14" readonly>' +
          U.esc(text) + '</textarea>' +
        '<div class="mm-btn-row">' +
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-ml-exclose">Close</button>' +
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-ml-exprint">Print</button>' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-ml-excopy">Copy</button>' +
        '</div>' +
      '</div>';
    wrap.classList.add('open');

    function close() { wrap.classList.remove('open'); wrap.innerHTML = ''; }
    wrap.querySelector('#mm-ml-exclose').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });

    wrap.querySelector('#mm-ml-excopy').addEventListener('click', function () {
      var area = wrap.querySelector('.mm-ml-exarea');
      area.select();
      var btn = this;
      function done() { U.fbk(btn, 'Copy'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          try { document.execCommand('copy'); done(); } catch (e) {}
        });
      } else {
        try { document.execCommand('copy'); done(); } catch (e) {}
      }
    });

    wrap.querySelector('#mm-ml-exprint').addEventListener('click', function () {
      var w = window.open('', '_blank');
      if (!w) return;
      w.document.write('<pre style="font:14px/1.6 system-ui,sans-serif;' +
        'white-space:pre-wrap">' + U.esc(text) + '</pre>');
      w.document.close();
      w.focus();
      w.print();
    });
  }

  // ---- Loading a template --------------------------------------------------

  function loadTemplate() {
    if (!window.MM.materialtpl) return;
    // The lists may not have been read yet: the job screen can be reached
    // without ever opening the Material Lists page.
    showError('Reading your lists...');
    window.MM.materialtpl.ensure()
      .then(function (tpls) {
        showError('');
        if (!tpls.length) {
          showError('No material lists yet. Make one on the Material Lists page.');
          return;
        }
        pickTemplate(tpls);
      })
      .catch(function (e) { showError('Could not read your lists: ' + e.message); });
  }

  function pickTemplate(tpls) {
    var msg = 'Load which list?' + NEWLINE + NEWLINE +
      tpls.map(function (t, i) {
        return (i + 1) + ' = ' + t.name + ' (' + (t.items || []).length + ' items)';
      }).join(NEWLINE) +
      NEWLINE + NEWLINE + 'Type a number:';
    var ans = window.prompt(msg, '1');
    if (ans === null) return;
    var n = parseInt(ans, 10);
    var t = isFinite(n) && n > 0 ? tpls[n - 1] : null;
    if (!t) { showError('No list with that number.'); return; }

    // Added to what is already there rather than replacing it: a job can take
    // a kitchen list and a bathroom list, and someone who has already started
    // adding items should not lose them.
    var added = 0;
    (t.items || []).forEach(function (i) {
      if (!clean(i.item)) return;
      items.push({
        item: clean(i.item), qty: clean(i.qty), unit: clean(i.unit) || 'each',
        cost: clean(i.cost), supplier: clean(i.supplier),
        state: 'todo', notes: clean(i.notes),
      });
      added++;
    });
    if (!added) { showError('That list has no items.'); return; }

    showError('');
    save('Loaded material list ' + t.name + ' (' + added + ' items)');
  }

  // ---- Actions -------------------------------------------------------------

  function readForm() {
    return {
      item: clean(document.getElementById('mm-ml-item').value),
      qty: clean(document.getElementById('mm-ml-qty').value),
      unit: clean(document.getElementById('mm-ml-unit').value) || 'each',
      cost: clean(document.getElementById('mm-ml-cost').value),
      supplier: clean(document.getElementById('mm-ml-sup').value),
      notes: clean(document.getElementById('mm-ml-notes').value),
    };
  }

  function bind(el) {
    var f = el.querySelector('#mm-ml-filter');
    if (f) f.addEventListener('change', function () {
      showFilter = this.value; render();
    });

    var add = el.querySelector('#mm-ml-add');
    if (add) add.addEventListener('click', function () {
      adding = true; editing = null; render();
      var box = document.getElementById('mm-ml-item');
      if (box) box.focus();
    });

    var cancel = el.querySelector('#mm-ml-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null; showError(''); render();
    });

    var saveBtn = el.querySelector('#mm-ml-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var r = readForm();
      if (!r.item) {
        showError('Give the item a name.');
        document.getElementById('mm-ml-item').focus();
        return;
      }
      showError('');
      if (editing !== null && items[editing]) {
        var was = items[editing];
        r.state = was.state;
        items[editing] = r;
        adding = false; editing = null;
        save('Changed material ' + r.item);
      } else {
        r.state = 'todo';
        items.push(r);
        adding = false;
        save('Added material ' + r.item);
      }
    });

    var loadBtn = el.querySelector('#mm-ml-load');
    if (loadBtn) loadBtn.addEventListener('click', loadTemplate);

    var exp = el.querySelector('#mm-ml-export');
    if (exp) exp.addEventListener('click', exportList);

    // One tap moves an item on: to order -> ordered -> received -> to order.
    el.querySelectorAll('[data-state]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = items[+b.getAttribute('data-state')];
        if (!r) return;
        var at = STATES.indexOf(r.state);
        r.state = STATES[(at + 1) % STATES.length];
        save(r.item + ': ' + STATE_LABEL[r.state].toLowerCase());
      });
    });

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editing = +b.getAttribute('data-edit');
        adding = true;
        render();
        var box = document.getElementById('mm-ml-item');
        if (box) { box.focus(); box.selectionStart = box.value.length; }
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-del');
        var r = items[i];
        if (!r) return;
        if (!window.confirm('Remove "' + r.item + '" from this job?')) return;
        items.splice(i, 1);
        save('Removed material ' + r.item);
      });
    });
  }

  window.MM.materials = {
    showForJob: showForJob,
    _parse: parse, _serialise: serialise, _total: total, _money: money,
  };
})();
