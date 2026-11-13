// js/leadpaste.js
// Paste a lead message into the Add Contact form and have the form filled in.
//
// Lead messages come in any wording -- a lead service's alert, a text, a
// forwarded email -- so the AI reads the message (api/ai.js, read-lead) and
// this file checks what it found before putting it in the boxes.
//
// It only ever FILLS the form. Nothing is saved here: the person reads the
// details and presses Save Contact as they always have, and everything after
// that -- the duplicate check, GoHighLevel, the workflow that makes the job
// -- is unchanged.
window.MM = window.MM || {};

(function () {
  // Where each detail goes in the existing form.
  var TARGET = {
    first_name: 'mm-ct-first',
    last_name: 'mm-ct-last',
    phone: 'mm-ct-phone',
    email: 'mm-ct-email',
    street: 'mm-ct-address',
    city: 'mm-ct-city',
    state: 'mm-ct-state',
    zip: 'mm-ct-postal',
  };

  function el(id) { return document.getElementById(id); }

  function say(text, kind) {
    var m = el('mm-ct-lead-msg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'mm-lead-msg' + (kind ? ' is-' + kind : '');
  }

  // Names and towns typed all in lower case or all in capitals are tidied.
  // Mixed case ("McDonald", "DeLuca") was chosen by someone and is left alone.
  function capitalise(v) {
    v = String(v || '');
    var lower = v.toLowerCase();
    if (!v || (v !== lower && v !== v.toUpperCase())) return v;
    return lower.replace(/(^|[\s\-'])([a-z])/g, function (m, sep, ch) {
      return sep + ch.toUpperCase();
    });
  }

  // The same checks the Google Sheet import makes. The AI does the reading;
  // these catch it being wrong, so a bad detail is pointed out rather than
  // saved without anyone noticing.
  function check(x) {
    var out = {}, problems = [];
    Object.keys(TARGET).forEach(function (k) { out[k] = String(x[k] || '').trim(); });

    out.first_name = capitalise(out.first_name);
    out.last_name = capitalise(out.last_name);
    out.city = capitalise(out.city);
    out.email = out.email.toLowerCase();
    out.state = out.state.toUpperCase();

    var d = out.phone.replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if (d.length === 10) {
      out.phone = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    } else if (out.phone) {
      problems.push('phone');
    }

    if (out.email && (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out.email) ||
        /\.(comk|con|cmo|coom|comm|om|cm)$/i.test(out.email) ||
        /@(gmial|gamil|gmal|gnail|yaho|yahooo|hotmial|hotmal)\./i.test(out.email))) {
      problems.push('email');
    }

    // "07067-1234" is a real zip; the form wants the five digits.
    var z = out.zip.match(/^(\d{5})(?:-\d{4})?$/);
    if (z) out.zip = z[1];
    else if (out.zip) problems.push('zip');

    if (out.state && !/^[A-Z]{2}$/.test(out.state)) problems.push('state');
    if (!out.first_name) problems.push('name');

    return { lead: out, problems: problems };
  }

  function fill() {
    var box = el('mm-ct-lead-text');
    var btn = el('mm-ct-lead-fill');
    var message = (box.value || '').trim();
    if (!message) { say('Paste the message first.', 'bad'); box.focus(); return; }

    btn.disabled = true;
    btn.textContent = 'Reading...';
    say('');

    fetch('/api/ai?action=read-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message }),
    })
      .then(function (r) {
        return r.text().then(function (t) {
          var d;
          try { d = t ? JSON.parse(t) : {}; } catch (e) { d = {}; }
          if (!r.ok) throw new Error(d.error || 'The AI could not read it.');
          return d.lead || {};
        });
      })
      .then(function (raw) {
        var res = check(raw);
        var found = 0;
        // Only what was found is written. A detail missing from the message
        // leaves its box as it was, rather than wiping something typed there.
        Object.keys(TARGET).forEach(function (k) {
          var v = res.lead[k];
          if (!v) return;
          var input = el(TARGET[k]);
          if (!input) return;
          // The street box is behind the address search; setting its value
          // writes straight into the box the person sees (addressauto.js).
          input.value = v;
          found++;
        });

        if (!found) {
          say('No contact details were found in that message.', 'bad');
        } else if (res.problems.length) {
          say('Filled in. Please check the ' + res.problems.join(', ') +
              ' before saving.', 'warn');
        } else {
          say('Filled in. Check the details, then press Save Contact.', 'ok');
        }
      })
      .catch(function (e) {
        say(e.message + ' You can still fill the form in by hand.', 'bad');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Fill in the form';
      });
  }

  // Called when the Add Contact form opens, so a message pasted for the last
  // contact is not still sitting there for the next.
  function reset() {
    var box = el('mm-ct-lead-text');
    if (box) box.value = '';
    say('');
  }

  function init() {
    var btn = el('mm-ct-lead-fill');
    if (btn) btn.addEventListener('click', fill);
  }

  init();
  window.MM.leadpaste = { reset: reset };
})();
