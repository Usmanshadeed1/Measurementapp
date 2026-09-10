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

    // The library arrives some time after the script tag does, and exactly
    // when varies: onload can fire before Places exists, or -- if the script
    // was already cached -- not fire for us at all. So rather than trust a
    // single moment, watch for the class itself and start as soon as it is
    // really there.
    s.onload = poll;
    // A bad key, no network, or a blocked request all land here. The app
    // carries on without suggestions.
    s.onerror = function () {
      loadState = 'failed';
      waiting.length = 0;
    };

    document.head.appendChild(s);
    poll();
  }

  // Checks whether Places has actually arrived, and keeps checking until it
  // has. Waiting on a single event proved unreliable -- the script can be
  // cached and load before the handler is attached, or fire before the
  // library it pulls in exists -- and the symptom either way was suggestions
  // silently never appearing.
  var polls = 0;
  function poll() {
    if (loadState === 'ready' || loadState === 'failed') return;
    if (ready()) {
      loadState = 'ready';
      flush();
      return;
    }
    // Roughly ten seconds, then give up so this is not looping forever on a
    // page where Google is never going to answer.
    if (++polls > 100) {
      loadState = 'failed';
      waiting.length = 0;
      return;
    }
    setTimeout(poll, 100);
  }

  // Only ever called once Places is ready. The queue is left alone otherwise:
  // emptying it while still loading was throwing away the very boxes that
  // were waiting to be wired.
  function flush() {
    if (loadState !== 'ready') return;
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
  // Writes one of the app's own boxes and tells the page it changed, so
  // anything listening -- the live job-name preview, say -- reacts exactly as
  // it does to typing.
  //
  // An empty value is written, not skipped. Picking a new address has to
  // replace the old one outright: leaving a field alone because the new
  // address has nothing for it is what produced addresses like
  // "3535 Market Street, Islamabad, Pakistan 44000" -- a Philadelphia street
  // wearing the previous address's city, state and postcode.
  function put(id, value) {
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- Wiring one box ------------------------------------------------------

  function wire(id) {
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

          // The street is the one field that is never blanked: an answer with
          // no road in it is a bad answer, and wiping what someone typed on
          // the strength of it would be worse than leaving it be.
          var st = street(comps);
          if (!st) return;

          put(id, st);

          if (cfg.mode !== 'full') return;

          // From here every field is written, including the ones this address
          // has nothing for. That is the point: the whole address is replaced
          // rather than merged with whatever was there before.

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

  // Reports what actually happened, for when suggestions do not appear and
  // the reason is not obvious from the outside.
  function diag() {
    var g = window.google && window.google.maps;
    var p = g && g.places;
    return {
      loadState: loadState,
      keySet: !!GOOGLE_KEY,
      scriptTag: !!document.querySelector('script[src*="maps.googleapis.com"]'),
      googleMaps: !!g,
      importLibrary: !!(g && g.importLibrary),
      places: !!p,
      placeAutocompleteElement: !!(p && p.PlaceAutocompleteElement),
      placesKeys: p ? Object.keys(p) : [],
      waiting: waiting.slice(),
      attachedCount: attached.length,
      boxesInPage: Object.keys(FIELDS).filter(function (id) {
        return !!document.getElementById(id);
      }),
    };
  }

  window.MM.addressauto = {
    init: init,
    attach: attach,
    attachAll: attachAll,
    diag: diag,
    isOn: function () { return loadState === 'ready'; },
  };
})();
