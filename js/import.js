// js/import.js
// CSV contact import: Upload -> Map columns -> Review -> Import (with
// progress) -> Summary. Mirrors GHL's own native Import flow, but talks
// to the Contacts API directly from this app.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, CSV = window.MM.csv;

  // Target fields we can map CSV columns onto.
  var TARGET_FIELDS = [
    { key: '', label: '— Do not import —' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'companyName', label: 'Business Name' },
    { key: 'address1', label: 'Street Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'postalCode', label: 'Postal Code' },
    { key: 'country', label: 'Country' },
    { key: 'type', label: 'Contact Type' },
    { key: 'tags', label: 'Tags' },
  ];
  // Auto-guess a target field from a CSV header name, same spirit as GHL's own mapper.
  var HEADER_GUESSES = {
    'first name': 'firstName', firstname: 'firstName', 'first': 'firstName',
    'last name': 'lastName', lastname: 'lastName', 'last': 'lastName',
    'email': 'email', 'email address': 'email',
    'phone': 'phone', 'phone number': 'phone', 'mobile': 'phone',
    'business name': 'companyName', 'company': 'companyName', 'company name': 'companyName',
    'address': 'address1', 'address1': 'address1', 'street address': 'address1', 'address line 1': 'address1',
    'city': 'city',
    'state': 'state', 'province': 'state',
    'postal code': 'postalCode', 'zip': 'postalCode', 'zip code': 'postalCode', 'postalcode': 'postalCode',
    'country': 'country',
    'contact type': 'type', 'type': 'type',
    'tags': 'tags', 'tag': 'tags',
  };

  // ---- Module state (reset each time the wizard opens) --------------------
  var state = null;
  function resetState() {
    state = {
      step: 1,
      headers: [],
      rows: [],
      mapping: {},        // header -> target field key
      skipEmptyValues: {}, // header -> bool, mirrors GHL's "skip empty values" per column
      results: null,      // filled in after import runs
      cancelled: false,
    };
  }

  // ---- Validation / normalization helpers ----------------------------------
  function normalizePhone(raw) {
    if (!raw) return '';
    var digits = raw.replace(/[^\d+]/g, '');
    if (!digits) return '';
    if (digits[0] !== '+') digits = digits.length === 10 ? '+1' + digits : '+' + digits;
    return digits;
  }
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Turn one CSV row + the column mapping into a contact payload, or null
  // if the row has nothing usable (no name at all).
  function rowToContactPayload(row) {
    var p = {};
    Object.keys(state.mapping).forEach(function (header) {
      var target = state.mapping[header];
      if (!target) return;
      var raw = (row[header] || '').trim();
      if (!raw) return; // "skip empty values" behavior — never overwrite with blank
      if (target === 'phone') raw = normalizePhone(raw);
      if (target === 'state' || target === 'country') raw = raw.toUpperCase();
      if (target === 'tags') { p.tags = raw.split(',').map(function (t) { return t.trim(); }).filter(Boolean); return; }
      p[target] = raw;
    });
    if (!p.firstName && !p.lastName) return null;
    return p;
  }

  function validateRow(p) {
    var errors = [];
    if (p.email && !isValidEmail(p.email)) errors.push('Invalid email format');
    if (p.phone && p.phone.length < 8) errors.push('Invalid phone number');
    return errors;
  }

  // ---- Chunked, rate-limited import loop -----------------------------------
  // GHL's stated ceiling is ~100 req/10s (~10/s). We stay well under that,
  // and each row can cost up to 2 calls (duplicate-check + create), so we
  // pace at ~4 rows/sec to be safe.
  var ROWS_PER_SECOND = 4;

  function runImport(payloads, onProgress) {
    var results = { created: 0, skipped: 0, failed: 0, details: [] };
    var i = 0;

    function processNext() {
      if (state.cancelled) return Promise.resolve();
      if (i >= payloads.length) return Promise.resolve();
      var item = payloads[i]; i++;

      var step;
      if (item.errors.length) {
        results.failed++;
        results.details.push({ row: item.rowNum, status: 'failed', message: item.errors.join('; ') });
        step = Promise.resolve();
      } else {
        step = api.findDuplicateContact(item.payload.email, item.payload.phone).then(function (dup) {
          if (dup) {
            results.skipped++;
            results.details.push({ row: item.rowNum, status: 'skipped', message: 'Already exists (' + (dup.email || dup.phone || dup.id) + ')' });
            return;
          }
          return api.createContact(item.payload).then(function () {
            results.created++;
            results.details.push({ row: item.rowNum, status: 'created', message: (item.payload.firstName || '') + ' ' + (item.payload.lastName || '') });
          }).catch(function (e) {
            results.failed++;
            results.details.push({ row: item.rowNum, status: 'failed', message: e.message });
          });
        });
      }

      return step.then(function () {
        onProgress(i, payloads.length, results);
        return new Promise(function (resolve) { setTimeout(resolve, 1000 / ROWS_PER_SECOND); });
      }).then(processNext);
    }

    return processNext().then(function () { return results; });
  }

  // ---- Public API: mounted into a modal by app.js -------------------------
  // build(container) renders the whole wizard into `container` and wires it up.
  // Returns { open(), reset() }.
  function build(container) {
    function render() {
      container.innerHTML = '';
      if (state.step === 1) renderUpload();
      else if (state.step === 2) renderMap();
      else if (state.step === 3) renderReview();
      else if (state.step === 4) renderRunning();
      else if (state.step === 5) renderSummary();
    }

    function stepLabel() {
      var wrap = document.createElement('div');
      wrap.className = 'mm-import-steps';
      var labels = ['Upload', 'Map', 'Review', 'Import'];
      labels.forEach(function (l, idx) {
        var n = idx + 1;
        var pill = document.createElement('span');
        pill.className = 'mm-import-step' + (state.step >= n ? ' active' : '') + (state.step === 5 && n === 4 ? ' active' : '');
        pill.textContent = n + '. ' + l;
        wrap.appendChild(pill);
      });
      return wrap;
    }

    function renderUpload() {
      container.appendChild(stepLabel());
      var body = document.createElement('div');
      body.innerHTML =
        '<p class="mm-hint">Upload a CSV file with a header row. Columns are mapped to contact fields in the next step.</p>' +
        U.fld('CSV File', '<input type="file" accept=".csv,text/csv" class="mm-input" id="mm-imp-file">');
      container.appendChild(body);

      var fileInput = body.querySelector('#mm-imp-file');
      fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = CSV.parseCSV(String(reader.result));
          if (!parsed.headers.length || !parsed.rows.length) {
            alert('Could not read any rows from that file. Make sure it\'s a CSV with a header row.');
            return;
          }
          state.headers = parsed.headers;
          state.rows = parsed.rows;
          state.mapping = {};
          parsed.headers.forEach(function (h) {
            var guess = HEADER_GUESSES[h.toLowerCase().trim()];
            state.mapping[h] = guess || '';
          });
          state.step = 2;
          render();
        };
        reader.readAsText(file);
      });

      var actions = document.createElement('div');
      actions.className = 'mm-import-actions';
      actions.innerHTML = '<button class="mm-btn mm-btn-secondary" id="mm-imp-cancel">Cancel</button>';
      container.appendChild(actions);
      actions.querySelector('#mm-imp-cancel').addEventListener('click', function () { closeFn(false); });
    }

    function renderMap() {
      container.appendChild(stepLabel());
      var table = document.createElement('div');
      table.className = 'mm-import-map';
      var sampleRows = state.rows.slice(0, 3);

      state.headers.forEach(function (h) {
        var row = document.createElement('div');
        row.className = 'mm-import-map-row';
        var samples = sampleRows.map(function (r) { return r[h]; }).filter(Boolean).join(', ');
        row.innerHTML =
          '<div class="mm-import-map-col"><div class="mm-import-map-header">' + U.esc(h) + '</div>' +
          '<div class="mm-import-map-sample">' + U.esc(samples || '(empty)') + '</div></div>';
        var selWrap = document.createElement('div');
        var sel = document.createElement('select');
        sel.className = 'mm-select';
        sel.style.marginBottom = '0';
        TARGET_FIELDS.forEach(function (f) {
          var opt = document.createElement('option');
          opt.value = f.key; opt.textContent = f.label;
          if (state.mapping[h] === f.key) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function () { state.mapping[h] = sel.value; });
        selWrap.appendChild(sel);
        row.appendChild(selWrap);
        table.appendChild(row);
      });
      container.appendChild(table);

      var actions = document.createElement('div');
      actions.className = 'mm-import-actions';
      actions.innerHTML =
        '<button class="mm-btn mm-btn-secondary" id="mm-imp-back">Back</button>' +
        '<button class="mm-btn mm-btn-primary" id="mm-imp-next">Next</button>';
      container.appendChild(actions);
      actions.querySelector('#mm-imp-back').addEventListener('click', function () { state.step = 1; render(); });
      actions.querySelector('#mm-imp-next').addEventListener('click', function () {
        var mappedAny = Object.keys(state.mapping).some(function (h) { return state.mapping[h] === 'firstName' || state.mapping[h] === 'lastName'; });
        if (!mappedAny) { alert('Map at least First Name or Last Name to continue.'); return; }
        state.step = 3;
        render();
      });
    }

    function buildPayloads() {
      return state.rows.map(function (row, idx) {
        var payload = rowToContactPayload(row);
        var errors = payload ? validateRow(payload) : ['No name found in this row'];
        return { rowNum: idx + 2, payload: payload || {}, errors: errors }; // +2: header row + 1-index
      });
    }

    function renderReview() {
      container.appendChild(stepLabel());
      var payloads = buildPayloads();
      var invalidCount = payloads.filter(function (p) { return p.errors.length; }).length;

      var body = document.createElement('div');
      body.innerHTML =
        '<div class="mm-import-summary-box">' +
          '<div><strong>' + payloads.length + '</strong> rows total</div>' +
          '<div><strong>' + (payloads.length - invalidCount) + '</strong> ready to import</div>' +
          (invalidCount ? '<div class="mm-import-warn"><strong>' + invalidCount + '</strong> rows have errors and will be skipped</div>' : '') +
        '</div>' +
        '<p class="mm-hint mm-import-warn">⚠️ Any workflow in GHL set to trigger on "Contact Created" will run once for every new contact created by this import. If that could cause unwanted emails/texts, pause that workflow in GHL before continuing.</p>' +
        '<p class="mm-hint">Rows matching an existing contact\'s email or phone will be skipped automatically — this import never overwrites an existing contact.</p>' +
        '<label class="mm-import-consent"><input type="checkbox" id="mm-imp-consent"> I confirm these contacts have consented to be contacted and this list is not from a third party.</label>';
      container.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'mm-import-actions';
      actions.innerHTML =
        '<button class="mm-btn mm-btn-secondary" id="mm-imp-back">Back</button>' +
        '<button class="mm-btn mm-btn-primary" id="mm-imp-start" disabled>Start Import</button>';
      container.appendChild(actions);

      var consentCb = body.querySelector('#mm-imp-consent');
      var startBtn = actions.querySelector('#mm-imp-start');
      consentCb.addEventListener('change', function () { startBtn.disabled = !consentCb.checked; });
      actions.querySelector('#mm-imp-back').addEventListener('click', function () { state.step = 2; render(); });
      startBtn.addEventListener('click', function () {
        state.cancelled = false;
        state.step = 4;
        state._payloads = payloads;
        render();
      });
    }

    function renderRunning() {
      container.appendChild(stepLabel());
      var body = document.createElement('div');
      body.innerHTML =
        '<div class="mm-import-progress-wrap">' +
          '<div class="mm-import-progress-bar"><div class="mm-import-progress-fill" id="mm-imp-fill" style="width:0%"></div></div>' +
          '<div class="mm-import-progress-label" id="mm-imp-label">Starting…</div>' +
        '</div>';
      container.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'mm-import-actions';
      actions.innerHTML = '<button class="mm-btn mm-btn-secondary" id="mm-imp-stop">Stop Import</button>';
      container.appendChild(actions);
      actions.querySelector('#mm-imp-stop').addEventListener('click', function () { state.cancelled = true; });

      var fill = body.querySelector('#mm-imp-fill');
      var label = body.querySelector('#mm-imp-label');

      runImport(state._payloads, function (done, total, results) {
        var pct = Math.round((done / total) * 100);
        fill.style.width = pct + '%';
        label.textContent = done + ' of ' + total + ' processed — ' + results.created + ' created, ' + results.skipped + ' skipped, ' + results.failed + ' failed';
      }).then(function (results) {
        state.results = results;
        state.step = 5;
        render();
      });
    }

    function renderSummary() {
      container.appendChild(stepLabel());
      var r = state.results;
      var body = document.createElement('div');
      body.innerHTML =
        '<div class="mm-import-summary-box">' +
          '<div><strong>' + r.created + '</strong> created</div>' +
          '<div><strong>' + r.skipped + '</strong> skipped (already existed)</div>' +
          '<div><strong>' + r.failed + '</strong> failed</div>' +
        '</div>';
      var list = document.createElement('div');
      list.className = 'mm-import-detail-list';
      r.details.forEach(function (d) {
        var row = document.createElement('div');
        row.className = 'mm-import-detail-row mm-import-detail-' + d.status;
        row.textContent = 'Row ' + d.row + ': ' + d.status + ' — ' + d.message;
        list.appendChild(row);
      });
      body.appendChild(list);
      container.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'mm-import-actions';
      actions.innerHTML = '<button class="mm-btn mm-btn-primary" id="mm-imp-done">Done</button>';
      container.appendChild(actions);
      actions.querySelector('#mm-imp-done').addEventListener('click', function () { closeFn(true); });
    }

    var closeFn = function () {};
    return {
      setCloseHandler: function (fn) { closeFn = fn; },
      open: function () { resetState(); render(); },
      // Stops an in-progress import loop if the modal gets closed while
      // step 4 (running) is active, so it doesn't keep firing requests
      // into a hidden/closed modal.
      cancelIfRunning: function () { if (state && state.step === 4) state.cancelled = true; },
    };
  }

  window.MM.importer = { build: build };
})();
