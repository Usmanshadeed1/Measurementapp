// js/csv.js
// Minimal dependency-free CSV parser — handles quoted fields, embedded
// commas/newlines inside quotes, and escaped quotes ("" -> "). Good
// enough for the contact-import feature without pulling in a library.
window.MM = window.MM || {};

(function () {
  function parseCSV(text) {
    // Strip a UTF-8 BOM if present (common from Excel exports).
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0, len = text.length;

    function pushField() { row.push(field); field = ''; }
    function pushRow() { pushField(); rows.push(row); row = []; }

    while (i < len) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { pushField(); i++; continue; }
      if (c === '\r') { i++; continue; } // normalize CRLF -> LF
      if (c === '\n') { pushRow(); i++; continue; }
      field += c; i++;
    }
    // Final field/row, if the file didn't end with a newline.
    if (field.length || row.length) pushRow();

    // Drop fully-empty trailing rows (common at end of file).
    while (rows.length && rows[rows.length - 1].every(function (f) { return f === ''; })) rows.pop();

    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows[0].map(function (h) { return h.trim(); });
    var dataRows = rows.slice(1).map(function (r) {
      var obj = {};
      headers.forEach(function (h, idx) { obj[h] = (r[idx] || '').trim(); });
      return obj;
    });
    return { headers: headers, rows: dataRows };
  }

  window.MM.csv = { parseCSV: parseCSV };
})();
