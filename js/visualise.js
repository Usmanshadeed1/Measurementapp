// js/visualise.js
// Showing a customer their own kitchen with the doors this business sells.
//
// At the consultation: photograph the room, pick a door style, and in under a
// minute the customer sees that same room with those doors in it. People
// cannot picture a finished kitchen from a sample board, and a rendering of
// their OWN room collapses that gap in a way a brochure never does.
//
// The doors are the point. They come from the saved styles (doorstyles.js),
// so the picture shows a door that can actually be ordered -- not something
// an image model invented.
//
// WHAT THIS DOES NOT TOUCH. The photo is uploaded here, on this tab. It does
// not read the measurement, the rooms, the walls or the job's own photos: on
// a live job that data is the record of real work, and a new feature has no
// business reaching into it. A render is saved only when someone presses
// Save, and then it is saved as a job photo like any other.
//
// NOTHING IS A PROMISE. Every render is a concept, not a construction
// drawing, and is labelled as one -- on the picture itself, not only in the
// email. A customer who signs after seeing a render they cannot have is a
// problem no disclaimer in an email solves.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var currentJob = null;
  var ready = null;        // null = not asked yet; is the AI set up
  var styles = [];
  var roomShot = '';       // data URL of the photo being worked from
  var roomName = '';
  var styleId = '';
  var extra = '';
  var results = [];        // data URLs that came back
  var busy = false;
  var msg = '';
  var isErr = false;

  // Each render costs real money, so the number is said out loud rather than
  // discovered on a bill. Roughly $0.13 at 2K on the Pro model.
  var COST_EACH = 0.14;

  // ---- Reading a file ------------------------------------------------------

  // Straight to a data URL in the browser. The photo never goes to
  // GoHighLevel unless a render is saved, so a consultation that produces
  // nothing worth keeping leaves nothing behind.
  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('Could not read that photo.')); };
      fr.readAsDataURL(file);
    });
  }

  // Sent at a sensible size rather than whatever the camera wrote. This is
  // the copy that goes to the AI -- it is not stored, and nothing the
  // customer keeps is reduced by it.
  var SEND_EDGE = 1600;

  function downscale(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, SEND_EDGE / Math.max(w || 1, h || 1));
        if (scale === 1) { resolve(dataUrl); return; }
        var c = document.createElement('canvas');
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        var ctx = c.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL('image/jpeg', 0.9)); }
        catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  // ---- Loading -------------------------------------------------------------

  function showForJob(job) {
    currentJob = job;
    roomShot = ''; roomName = ''; styleId = ''; extra = '';
    results = []; busy = false; msg = ''; isErr = false;

    render();

    // Both checked before the first draw, so the tab does not rearrange
    // itself under whoever is reading it.
    return Promise.all([
      checkReady(),
      window.MM.doorstyles ? window.MM.doorstyles.ensure().catch(function () { return []; })
                           : Promise.resolve([]),
    ]).then(function (r) {
      styles = r[1] || [];
      if (styles.length === 1) styleId = String(styles[0].id);
      render();
    });
  }

  // Visualising has its own key, separate from the suggestions: it needs
  // Gemini, and the suggestions can run on anything.
  function checkReady() {
    if (ready !== null) return Promise.resolve(ready);
    return fetch('/api/ai?action=image-status')
      .then(function (r) { return r.json(); })
      .then(function (d) { ready = !!(d && d.configured); return ready; })
      .catch(function () { ready = false; return false; });
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-job-visualise');
    if (!el) return;

    if (ready === false) {
      el.innerHTML =
        '<div class="mm-vz-off">' +
          '<p class="mm-vz-offtitle">Visualising is not set up yet</p>' +
          '<p class="mm-vz-offsub">It needs a Google Gemini key, added on ' +
            'the Settings page under <strong>Visualising a room</strong>.</p>' +
        '</div>';
      return;
    }

    el.innerHTML =
      stepPhoto() +
      stepStyle() +
      stepGo() +
      (results.length ? stepResults() : '') +
      (msg ? '<p class="mm-vz-msg' + (isErr ? ' is-bad' : '') + '" role="alert">' +
        U.esc(msg) + '</p>' : '');

    bind(el);
  }

  function stepPhoto() {
    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">1</span>' +
        '<span class="mm-vz-title">The room</span></div>' +
      (roomShot
        ? '<div class="mm-vz-shot">' +
            '<img src="' + U.esc(roomShot) + '" alt="The room photo">' +
            '<button type="button" class="mm-vz-rm" id="mm-vz-clear" ' +
              'aria-label="Remove this photo">&times;</button>' +
          '</div>'
        : '<p class="mm-vz-hint">Photograph the kitchen straight on, with as ' +
          'much of the cabinets in frame as you can. Good light and a steady ' +
          'shot make a far better picture than a clever angle.</p>') +
      '<div class="mm-btn-row">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-vz-shoot"' + (busy ? ' disabled' : '') + '>' +
          '&#128247; ' + (roomShot ? 'Retake' : 'Camera') + '</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-vz-pick"' + (busy ? ' disabled' : '') + '>' +
          '&#128193; ' + (roomShot ? 'Choose another' : 'Upload') + '</button>' +
      '</div>' +
    '</div>';
  }

  function stepStyle() {
    if (!styles.length) {
      return '<div class="mm-vz-step">' +
        '<div class="mm-vz-head"><span class="mm-vz-n">2</span>' +
          '<span class="mm-vz-title">The doors</span></div>' +
        '<p class="mm-vz-hint">No door styles saved yet. Add them on the ' +
          '<strong>Door Styles</strong> page &mdash; they are what gets put ' +
          'into the picture.</p>' +
      '</div>';
    }

    // Chosen by sight. Someone picks a door because they recognise it, not
    // because they read its name in a list.
    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">2</span>' +
        '<span class="mm-vz-title">The doors</span></div>' +
      '<div class="mm-vz-styles">' +
        styles.map(function (s) {
          var shot = (s.images || [])[0] || '';
          return '<button type="button" class="mm-vz-style' +
              (String(s.id) === styleId ? ' is-on' : '') + '" ' +
              'data-style="' + U.esc(s.id) + '"' + (busy ? ' disabled' : '') + '>' +
            (shot ? '<img src="' + U.esc(shot) + '" alt="">'
                  : '<span class="mm-vz-nostyle"></span>') +
            '<span class="mm-vz-styname">' + U.esc(s.name) + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function stepGo() {
    var can = !!(roomShot && styleId) && !busy;
    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">3</span>' +
        '<span class="mm-vz-title">Anything else ' +
        '<span class="mm-opt">(optional)</span></span></div>' +
      '<input class="mm-input" id="mm-vz-extra" ' +
        'placeholder="e.g. white quartz countertop, remove the island" ' +
        'value="' + U.esc(extra) + '"' + (busy ? ' disabled' : '') + '>' +
      '<div class="mm-btn-row">' +
        '<button type="button" class="mm-btn mm-btn-primary mm-vz-go" ' +
          'id="mm-vz-go"' + (can ? '' : ' disabled') + '>' +
          (busy ? 'Working on it...' : 'Visualise this room') + '</button>' +
      '</div>' +
      '<p class="mm-vz-hint">One picture, about ' +
        U.esc('$' + COST_EACH.toFixed(2)) + '. It takes up to a minute.</p>' +
    '</div>';
  }

  function stepResults() {
    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">&#10003;</span>' +
        '<span class="mm-vz-title">The result</span></div>' +
      '<div class="mm-vz-outs">' +
        results.map(function (r, i) {
          return '<div class="mm-vz-out">' +
            '<img src="' + U.esc(r.url) + '" alt="The room visualised">' +
            '<div class="mm-vz-outbar">' +
              (r.saved
                ? '<span class="mm-vz-saved">&#10003; Saved to the job</span>'
                : '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
                  'data-save="' + i + '"' + (busy ? ' disabled' : '') +
                  '>Save to job</button>') +
              '<a class="mm-btn-sm mm-btn-secondary" download="visualisation.png" ' +
                'href="' + U.esc(r.url) + '">Download</a>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      // Said here, and burned into the picture itself when it is saved.
      '<p class="mm-vz-warn">A concept to show the customer &mdash; not a ' +
        'construction drawing. Check it against what you can actually build ' +
        'before you send it.</p>' +
    '</div>';
  }

  function say(m, bad) { msg = m || ''; isErr = !!bad; render(); }

  // ---- The disclaimer ------------------------------------------------------

  // Written onto the picture before it is saved. An email can be forwarded
  // without its text, and a rendering with no mark on it is one screenshot
  // away from looking like a promise.
  function stamp(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        var ctx = c.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0);

        var pad = Math.max(10, Math.round(c.width * 0.012));
        var size = Math.max(13, Math.round(c.width * 0.022));
        var text = 'Concept illustration — not a construction drawing';

        ctx.font = '600 ' + size + 'px system-ui, -apple-system, sans-serif';
        var w = ctx.measureText(text).width;
        var barH = size + pad * 1.4;

        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(0, c.height - barH, c.width, barH);
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, Math.max(pad, (c.width - w) / 2),
                     c.height - barH / 2);

        try { resolve(c.toDataURL('image/jpeg', 0.92)); }
        catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  // ---- Actions -------------------------------------------------------------

  function takePhoto(files) {
    var file = files && files[0];
    if (!file) return;
    busy = true; say('Reading the photo...');
    readAsDataUrl(file)
      .then(downscale)
      .then(function (url) {
        roomShot = url;
        roomName = file.name || '';
        results = [];
        busy = false;
        say('');
      })
      .catch(function (e) { busy = false; say(e.message, true); });
  }

  function go() {
    var s = styles.find(function (x) { return String(x.id) === styleId; });
    if (!roomShot || !s) return;

    var refs = (s.images || []).slice(0, 4);
    if (!refs.length) { say('That door style has no photos.', true); return; }

    busy = true;
    say('Working on it — this takes up to a minute.');

    // The door photos are URLs on the record; they are fetched here and sent
    // as data, so the server never fetches a URL it was handed.
    Promise.all(refs.map(toDataUrl))
      .then(function (list) {
        var usable = list.filter(Boolean);
        if (!usable.length) throw new Error('Could not read the door photos.');
        return fetch('/api/ai?action=visualise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room: roomShot,
            refs: usable,
            style: s.name,
            notes: s.notes || '',
            extra: extra,
          }),
        });
      })
      .then(function (r) {
        return r.text().then(function (t) {
          var d;
          try { d = t ? JSON.parse(t) : {}; } catch (e) { d = {}; }
          if (!r.ok) throw new Error(d.error || 'The AI did not answer.');
          return d;
        });
      })
      .then(function (d) {
        results = (d.images || []).map(function (u) {
          return { url: u, saved: false };
        });
        busy = false;
        say(results.length ? '' : 'No picture came back. Try another photo.',
            !results.length);
      })
      .catch(function (e) {
        busy = false;
        say(e.message, true);
      });
  }

  // A door photo, as data. Stored as a GoHighLevel URL when the style was
  // saved, so it is read back here rather than handed to the server as a
  // link to go and fetch.
  function toDataUrl(url) {
    if (/^data:/.test(url)) return Promise.resolve(url);
    return fetch(url)
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) {
        if (!b) return null;
        return new Promise(function (resolve) {
          var fr = new FileReader();
          fr.onload = function () { resolve(String(fr.result || '')); };
          fr.onerror = function () { resolve(null); };
          fr.readAsDataURL(b);
        });
      })
      .catch(function () { return null; });
  }

  function saveResult(i) {
    var r = results[i];
    if (!r || r.saved || !currentJob) return;

    busy = true;
    say('Saving...');

    stamp(r.url)
      .then(function (marked) {
        return fetch(marked).then(function (res) { return res.blob(); });
      })
      .then(function (blob) {
        var name = 'Visualisation - ' +
          new Date().toISOString().split('T')[0] + '.jpg';
        var file;
        try {
          file = new File([blob], name, { type: 'image/jpeg' });
        } catch (e) {
          blob.name = name;
          file = blob;
        }
        return api.uploadMediaFile(file);
      })
      .then(function (url) {
        // Filed against the job with no room, like any other job photo.
        return api.createPhotoOrVideo(
          api.PHOTO,
          'Visualisation – ' + new Date().toISOString().split('T')[0],
          url, currentJob.id, null
        );
      })
      .then(function () {
        r.saved = true;
        busy = false;
        window.MM.activity.log('list_added', 'Saved a visualisation', {
          jobId: currentJob.id,
          jobName: (currentJob.contact && currentJob.contact.name) || currentJob.name,
        });
        say('Saved to the job’s photos.');
      })
      .catch(function (e) {
        busy = false;
        say('Could not save: ' + e.message, true);
      });
  }

  function bind(el) {
    var shoot = el.querySelector('#mm-vz-shoot');
    if (shoot) shoot.addEventListener('click', function () {
      var input = U.cameraInput(document.createElement('input'));
      input.addEventListener('change', function () { takePhoto(input.files); });
      input.click();
    });

    var pick = el.querySelector('#mm-vz-pick');
    if (pick) pick.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () { takePhoto(input.files); });
      input.click();
    });

    var clear = el.querySelector('#mm-vz-clear');
    if (clear) clear.addEventListener('click', function () {
      roomShot = ''; results = []; say('');
    });

    el.querySelectorAll('[data-style]').forEach(function (b) {
      b.addEventListener('click', function () {
        styleId = b.getAttribute('data-style');
        render();
      });
    });

    var ex = el.querySelector('#mm-vz-extra');
    if (ex) ex.addEventListener('input', function () { extra = this.value; });

    var goBtn = el.querySelector('#mm-vz-go');
    if (goBtn) goBtn.addEventListener('click', go);

    el.querySelectorAll('[data-save]').forEach(function (b) {
      b.addEventListener('click', function () {
        saveResult(+b.getAttribute('data-save'));
      });
    });
  }

  window.MM.visualise = { showForJob: showForJob };
})();
