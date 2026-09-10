// js/addressauto.js
// Google address suggestions on the address boxes.
//
// This is an add-on and behaves like one. If no key is saved, or Google's
// script fails to load, or Google answers with nothing useful, every address
// box stays exactly the ordinary typing box it is today. Nothing here reads
// or rewrites an address that is already stored -- suggestions only ever act
// on what someone is typing right now.
//
// Two kinds of box, because the app wants two different things:
//
//   street  -- the job's property address. The job title is built as
//              "Customer - Street", so only the street belongs in it.
//   full    -- a contact's address, which has its own city, state and
//              postal code boxes beside it waiting to be filled in.
window.MM = window.MM || {};

(function () {
  var loadState = 'idle';    // idle | loading | ready | failed
  var waiting = [];          // attach calls made before the script arrived
  var attached = [];         // inputs already wired, so we never double-wire

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
    return !!(window.google && window.google.maps && window.google.maps.places);
  }

  // Called once, after the key is known. Everything downstream waits on this
  // resolving one way or the other.
  function loadScript(key) {
    if (loadState === 'ready' || loadState === 'failed') return;
    if (loadState === 'loading') return;
    if (!key) { loadState = 'failed'; return; }

    loadState = 'loading';

    var s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.src = 'https://maps.googleapis.com/maps/api/js' +
      '?key=' + encodeURIComponent(key) + '&libraries=places';

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
    if (loadState !== 'ready') return;
    var pending = waiting.slice();
    waiting.length = 0;
    pending.forEach(function (id) { wire(id); });
  }

  // ---- Reading Google's answer ---------------------------------------------

  function part(place, type, useShort) {
    var comps = (place && place.address_components) || [];
    for (var i = 0; i < comps.length; i++) {
      if (comps[i].types.indexOf(type) > -1) {
        return (useShort ? comps[i].short_name : comps[i].long_name) || '';
      }
    }
    return '';
  }

  // "3535 1st St N" -- the number and the road, nothing after it.
  function street(place) {
    var num = part(place, 'street_number');
    var road = part(place, 'route');
    var s = (num ? num + ' ' : '') + road;
    return s.trim();
  }

  // Only fills a box that exists and is currently empty of the right thing:
  // writing into a box the user already typed in would be rude.
  function put(id, value) {
    if (!id || !value) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    // Anything listening for typing -- a live job-name preview, say -- should
    // see this the same way it sees a keystroke.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- Wiring one box ------------------------------------------------------

  function wire(id) {
    if (loadState !== 'ready') {
      if (waiting.indexOf(id) === -1) waiting.push(id);
      return;
    }

    var cfg = FIELDS[id];
    var el = document.getElementById(id);
    if (!cfg || !el) return;

    // A modal that reopens builds a fresh input, so the old wiring goes with
    // it. Comparing the element itself, not the id, is what makes that safe.
    if (attached.indexOf(el) > -1) return;
    attached.push(el);

    var ac;
    try {
      ac = new window.google.maps.places.Autocomplete(el, {
        types: ['address'],
        componentRestrictions: { country: ['us'] },
        fields: ['address_components'],
      });
    } catch (e) {
      return;   // Suggestions are optional; typing is not.
    }

    // Browsers offer their own saved-address dropdown over Google's list.
    el.setAttribute('autocomplete', 'off');

    ac.addListener('place_changed', function () {
      var place = ac.getPlace();
      if (!place || !place.address_components) return;   // free text, left alone

      var st = street(place);
      if (!st) return;   // no road in the answer, so nothing worth replacing

      el.value = st;
      el.dispatchEvent(new Event('input', { bubbles: true }));

      if (cfg.mode !== 'full') return;

      put(cfg.city, part(place, 'locality') ||
        part(place, 'sublocality') || part(place, 'postal_town'));
      put(cfg.state, part(place, 'administrative_area_level_1', true));
      put(cfg.postal, part(place, 'postal_code'));
      put(cfg.country, part(place, 'country', true));
    });

    // Enter on a highlighted suggestion would otherwise submit the form
    // before the address has been filled in.
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && document.querySelector('.pac-container:not([style*="display: none"])')) {
        ev.preventDefault();
      }
    });
  }

  // Called by whatever opens a form. Safe to call as often as you like, and
  // safe to call when there is no key: it simply does nothing.
  function attach(id) {
    if (loadState === 'failed') return;
    wire(id);
  }

  // Wire whichever of the four are already in the page, and remember the rest
  // for when their form opens.
  function attachAll() {
    Object.keys(FIELDS).forEach(function (id) {
      if (document.getElementById(id)) attach(id);
    });
  }

  // ---- Start ---------------------------------------------------------------

  // Reads the saved key, then loads Google if there is one. Called once at
  // sign-in, when the database is reachable.
  function init() {
    var settings = window.MM.settings;
    if (!settings) return Promise.resolve();

    return settings.loadKey()
      .then(function (key) {
        if (!key) { loadState = 'failed'; return; }
        loadScript(key);
        // The boxes in the page markup can be queued now; the ones built by
        // JS get attached when their form opens.
        attachAll();
      })
      .catch(function () { loadState = 'failed'; });
  }

  window.MM.addressauto = {
    init: init,
    attach: attach,
    attachAll: attachAll,
    isOn: function () { return loadState === 'ready'; },
  };
})();
