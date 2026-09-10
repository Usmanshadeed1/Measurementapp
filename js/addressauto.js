// js/addressauto.js
// Google address suggestions on the address boxes.
//
// This is an add-on and behaves like one. If the key is missing, or Google's
// script fails to load, every address box stays exactly the ordinary typing
// box it is today. Nothing here reads or rewrites an address that is already
// stored -- suggestions only ever act on what someone is typing right now,
// and only a Save button writes anything anywhere.
//
// How it is wired
// ---------------
// Google's current widget (PlaceAutocompleteElement) renders its own input;
// it cannot be attached to one of ours. The old class that could --
// places.Autocomplete -- was closed to new accounts in March 2025, so it is
// not an option here.
//
// So each address box keeps its place in the form and its id, and is hidden.
// Google's element is inserted next to it, and whatever the person picks is
// written back into the hidden box. Every save path -- newjob, jobedit,
// contacts -- goes on reading the same id it always read, and none of them
// needed changing.
//
// Two kinds of box, because the app wants two different things:
//
//   street  -- the job's property address. The job title is built as
//              "Customer - Street", so only the street belongs in it.
//   full    -- a contact's address, which has its own city, state and
//              postal code boxes beside it waiting to be filled in.
window.MM = window.MM || {};

(function () {
  // The Google Places key. A browser key is visible in the page source
  // whatever we do with it, so keeping it here rather than in the database
  // gives away nothing extra -- what actually protects it is the restriction
  // in Google Cloud: this domain only, Places API only.
  //
  // To change it: edit this line and deploy.
  var GOOGLE_KEY = 'AIzaSyBZyOzRVyZPTXTPsHSPxUEOW4TXb0ch8As';

  var loadState = 'idle';    // idle | loading | ready | failed
  var waiting = [];          // attach calls made before the script arrived
  var attached = [];         // boxes already wired, so we never double-wire

  // Which boxes get which treatment, and for the full ones, where the rest of
  // the address should land.
  var FIELDS = {
    'mm-nj-address': { mode: 'street' },
    'mm-je-addr': { mode: 'street' },
    'mm-ct-address': {
      mode: 'full',
      city: 'mm-ct-city', state: 'mm-ct-state',
      postal: 'mm-ct-postal', country: 'mm-ct-country',
    },
    'mm-ce-address': {
      mode: 'full',
      city: 'mm-ce-city', state: 'mm-ce-state', postal: 'mm-ce-postal',
    },
  };

  // ---- Loading Google's script ---------------------------------------------

  function ready() {
    return !!(window.google && window.google.maps && window.google.maps.places &&
      window.google.maps.places.PlaceAutocompleteElement);
  }

  function loadScript(key) {
    if (loadState !== 'idle') return;
    if (!key) { loadState = 'failed'; return; }

    loadState = 'loading';

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://maps.googleapis.com/maps/api/js' +
      '?key=' + encodeURIComponent(key) + '&libraries=places&loading=async';

    s.onload = function () {
      loadState = ready() ? 'ready' : 'failed';
      flush();
    };
    // A bad key, no network, or a blocked request all land here. The app
    // carries on without suggestions.
    s.onerror = function () {
      loadState = 'failed';
      waiting.length = 0;
    };

    document.head.appendChild(s);
  }

  function flush() {
    if (loadState !== 'ready') { waiting.length = 0; return; }
    var pending = waiting.slice();
    waiting.length = 0;
    pending.forEach(function (id) { wire(id); });
  }

  // ---- Reading Google's answer ---------------------------------------------

  // Google returns each part as { types: [...], longText, shortText }.
  function part(components, type, useShort) {
    for (var i = 0; i < components.length; i++) {
      var c = components[i];
      if (c.types && c.types.indexOf(type) > -1) {
        return (useShort ? c.shortText : c.longText) || '';
      }
    }
    return '';
  }

  // "3535 1st St N" -- the number and the road, nothing after it.
  function street(components) {
    var num = part(components, 'street_number');
    var road = part(components, 'route');
    return ((num ? num + ' ' : '') + road).trim();
  }

  // Writes into one of the app's own boxes and tells the page it changed, so
  // anything listening -- the live job-name preview, say -- reacts exactly as
  // it does to typing.
  function put(id, value) {
    if (!id || !value) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- Wiring one box ------------------------------------------------------

  function wire(id) {
    if (loadState === 'failed') return;
    if (loadState !== 'ready') {
      if (waiting.indexOf(id) === -1) waiting.push(id);
      return;
    }

    var cfg = FIELDS[id];
    var input = document.getElementById(id);
    if (!cfg || !input) return;

    // A modal that reopens builds a fresh box, so the old wiring goes with it.
    // Comparing the element itself, not the id, is what makes that safe.
    if (attached.indexOf(input) > -1) return;
    attached.push(input);

    var ac;
    try {
      ac = new window.google.maps.places.PlaceAutocompleteElement({
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
        includedRegionCodes: ['us'],
      });
    } catch (e) {
      return;   // Suggestions are optional; typing is not.
    }

    ac.className = 'mm-gplace';

    // Whatever is already stored shows as the starting text, so opening an
    // edit box looks the way it always has.
    if (input.value) {
      try { ac.value = input.value; } catch (e) { /* older builds ignore this */ }
    }
    if (input.placeholder) {
      try { ac.placeholder = input.placeholder; } catch (e) { /* optional */ }
    }

    // The app's own box stays in the form, holding the value every save path
    // already reads. Google's element sits in its place visually.
    input.type = 'hidden';
    input.parentNode.insertBefore(ac, input.nextSibling);

    // Two things the rest of the app does to a visible box, which a hidden
    // one cannot answer on its own. Handling them here keeps newjob.js,
    // jobedit.js and contacts.js exactly as they were.
    //
    // focus() -- "you forgot the address" puts the cursor in the box. On a
    // hidden input that goes nowhere, so it is sent to Google's instead.
    input.focus = function () {
      var box = ac.querySelector('input');
      if (box) box.focus(); else if (ac.focus) ac.focus();
    };

    // Clearing -- reopening the New Job form sets .value = '' to empty the
    // box. Google's element keeps its own text, so the old address would
    // still be on screen while the real value was empty. Watching the
    // property keeps the two in step.
    var raw = input.value;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: function () { return raw; },
      set: function (v) {
        raw = v == null ? '' : String(v);
        try { ac.value = raw; } catch (e) { /* older builds ignore this */ }
      },
    });

    ac.addEventListener('gmp-select', function (ev) {
      var prediction = ev && ev.placePrediction;
      if (!prediction) return;

      var place = prediction.toPlace();
      place.fetchFields({ fields: ['addressComponents'] })
        .then(function () {
          var comps = place.addressComponents || [];
          if (!comps.length) return;

          var st = street(comps);
          if (!st) return;   // no road in the answer, nothing worth writing

          put(id, st);

          if (cfg.mode !== 'full') return;

          put(cfg.city, part(comps, 'locality') ||
            part(comps, 'sublocality') || part(comps, 'postal_town'));
          put(cfg.state, part(comps, 'administrative_area_level_1', true));
          put(cfg.postal, part(comps, 'postal_code'));
          put(cfg.country, part(comps, 'country', true));
        })
        // A lookup that fails leaves whatever was typed alone.
        .catch(function () { });
    });
  }

  // Called by whatever opens a form. Safe to call as often as you like, and
  // safe to call when there is no key: it simply does nothing.
  function attach(id) { wire(id); }

  // Wire whichever of the four are already in the page; the rest are attached
  // when their form opens.
  function attachAll() {
    Object.keys(FIELDS).forEach(function (id) {
      if (document.getElementById(id)) attach(id);
    });
  }

  // ---- Start ---------------------------------------------------------------

  function init() {
    if (!GOOGLE_KEY) { loadState = 'failed'; return; }
    loadScript(GOOGLE_KEY);
    attachAll();
  }

  window.MM.addressauto = {
    init: init,
    attach: attach,
    attachAll: attachAll,
    isOn: function () { return loadState === 'ready'; },
  };
})();
