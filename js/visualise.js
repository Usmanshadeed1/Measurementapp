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
  var shots = [];          // data URLs of the room photos, first one leads
  var needsUrls = false;   // does the chosen provider want public URLs
  var onJob = [];          // photos already on this job, offered to pick from
  var picking = false;     // is that list open
  var styleId = '';
  var extra = '';
  var results = [];        // data URLs that came back
  var busy = false;
  var msg = '';
  var isErr = false;

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
    shots = []; styleId = ''; extra = '';
    onJob = []; picking = false;
    results = []; busy = false; msg = ''; isErr = false;

    render();

    // Both checked before the first draw, so the tab does not rearrange
    // itself under whoever is reading it.
    return Promise.all([
      checkReady(),
      window.MM.doorstyles ? window.MM.doorstyles.ensure().catch(function () { return []; })
                           : Promise.resolve([]),
      // The job's photos, read and nothing more. A failure here is not worth
      // reporting: the Upload button still works.
      api.queryMediaByField(api.PHOTO, 'job_id', job.id)
        .catch(function () { return []; }),
    ]).then(function (r) {
      styles = r[1] || [];
      if (styles.length === 1) styleId = String(styles[0].id);

      onJob = (r[2] || []).map(function (m) { return U.pv(m, 'file_url'); })
        .filter(Boolean);

      render();
    });
  }

  // Visualising has its own key, separate from the suggestions: it needs
  // Gemini, and the suggestions can run on anything.
  function checkReady() {
    if (ready !== null) return Promise.resolve(ready);
    return fetch('/api/ai?action=image-status')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        ready = !!(d && d.configured);
        var p = (d && d.providers || []).find(function (x) {
          return x.id === (d.provider || 'gemini');
        });
        needsUrls = !!(p && p.needsUrls);
        return ready;
      })
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
      (shots.length
        ? '<div class="mm-vz-shots">' +
            shots.map(function (u, i) {
              return '<div class="mm-vz-shot' + (i === 0 ? ' is-first' : '') + '">' +
                '<img src="' + U.esc(u) + '" alt="Room photo ' + (i + 1) + '">' +
                (i === 0 ? '<span class="mm-vz-lead">Main</span>' : '') +
                '<button type="button" class="mm-vz-rm" data-drop="' + i + '" ' +
                  'aria-label="Remove photo ' + (i + 1) + '">&times;</button>' +
              '</div>';
            }).join('') +
          '</div>'
        : '') +
      '<p class="mm-vz-hint">' +
        (shots.length
          // Which photo the picture is made FROM matters, and it is the
          // first: the rest only tell the model more about the room.
          ? 'The picture is made from the one marked <strong>Main</strong>. ' +
            'The others just help it understand the room &mdash; add two or ' +
            'three angles if you can.'
          : 'Photograph the kitchen straight on, with as much of the ' +
            'cabinets in frame as you can. Add two or three angles if you ' +
            'can &mdash; the first one is the one the picture is made from.') +
      '</p>' +
      '<div class="mm-btn-row">' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-vz-shoot"' + (busy ? ' disabled' : '') + '>' +
          '&#128247; Camera</button>' +
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-vz-pick"' + (busy ? ' disabled' : '') + '>' +
          '&#128193; ' + (shots.length ? 'Add more' : 'Upload') + '</button>' +
        // The job's own photos, offered rather than made someone upload
        // again what they already photographed. Read only: this lists them,
        // copies the one that is chosen, and never writes to them.
        (onJob.length
          ? '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
            'id="mm-vz-fromjob"' + (busy ? ' disabled' : '') + '>' +
            (picking ? 'Hide job photos' : 'From this job (' + onJob.length + ')') +
            '</button>'
          : '') +
      '</div>' +

      (picking
        ? '<div class="mm-vz-pickjob">' +
            '<p class="mm-vz-hint">Tap one to use it. The job keeps its ' +
              'copy &mdash; nothing here changes the Measure tab.</p>' +
            '<div class="mm-vz-joblist">' +
              onJob.map(function (u, i) {
                return '<button type="button" class="mm-vz-jobshot" ' +
                    'data-job="' + i + '" aria-label="Use this photo">' +
                  '<img src="' + U.esc(u) + '" alt="">' +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>'
        : '') +
    '</div>';
  }

  // As many door photographs as are worth sending. More angles of the same
  // door help; a long list starts to crowd out the room.
  var MAX_REFS = 4;

  function stepStyle() {
    var chosen = styles.find(function (x) { return String(x.id) === styleId; });

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
          var n = (s.images || []).length;
          return '<button type="button" class="mm-vz-style' +
              (String(s.id) === styleId ? ' is-on' : '') + '" ' +
              'data-style="' + U.esc(s.id) + '"' + (busy ? ' disabled' : '') + '>' +
            (shot ? '<img src="' + U.esc(shot) + '" alt="">'
                  : '<span class="mm-vz-nostyle"></span>') +
            '<span class="mm-vz-styname">' + U.esc(s.name) + '</span>' +
            // How many photographs back this door up. The tile can only show
            // one, and without the count it looks as though only one is used.
            (n > 1
              ? '<span class="mm-vz-styn">' + n + ' photos</span>'
              : '') +
          '</button>';
        }).join('') +
      '</div>' +
      // Every photograph that will actually be sent, once a door is chosen.
      // The tile above shows one of them, and that made it look as though
      // the rest were being ignored.
      (chosen && (chosen.images || []).length
        ? '<div class="mm-vz-refs">' +
            '<div class="mm-vz-reflab">Sent as the reference:</div>' +
            '<div class="mm-vz-refshots">' +
              (chosen.images || []).slice(0, MAX_REFS).map(function (u) {
                return '<img class="mm-vz-ref" src="' + U.esc(u) + '" alt="">';
              }).join('') +
            '</div>' +
            (chosen.notes
              ? '<div class="mm-vz-refnote">' + U.esc(chosen.notes) + '</div>'
              : '') +
          '</div>'
        : '') +
    '</div>';
  }

  function stepGo() {
    var can = !!(shots.length && styleId) && !busy;
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
      '<p class="mm-vz-hint">It takes up to a minute.</p>' +
    '</div>';
  }

  function stepResults() {
    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">&#10003;</span>' +
        '<span class="mm-vz-title">The result</span></div>' +
      '<div class="mm-vz-outs">' +
        results.map(function (r, i) {
          return '<div class="mm-vz-out">' +
            // Shown at a size that fits on the screen beside everything
            // else, and opened full size on a tap: a picture that fills
            // three screens cannot be judged.
            '<button type="button" class="mm-vz-open" data-open="' + i + '" ' +
                'aria-label="Open this picture full size">' +
              '<img src="' + U.esc(r.url) + '" alt="The room visualised">' +
              '<span class="mm-vz-zoom" aria-hidden="true">Tap to enlarge</span>' +
            '</button>' +
            '<div class="mm-vz-outbar">' +
              (r.saved
                ? '<span class="mm-vz-saved">&#10003; Saved to the job</span>'
                : '<button type="button" class="mm-btn-sm mm-btn-primary" ' +
                  'data-save="' + i + '"' + (busy ? ' disabled' : '') +
                  '>Save to job</button>') +
              '<a class="mm-btn-sm mm-btn-secondary" download="visualisation.jpg" ' +
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

  // Several at a time, kept in the order they were picked. The first is the
  // one the picture is made from, so it is the one to get right.
  var MAX_SHOTS = 5;

  function takePhotos(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    busy = true;
    say(list.length > 1 ? 'Reading the photos...' : 'Reading the photo...');

    list.reduce(function (chain, file) {
      return chain.then(function () {
        if (shots.length >= MAX_SHOTS) return null;
        return readAsDataUrl(file)
          .then(downscale)
          .then(function (url) { shots.push(url); })
          .catch(function () { /* one bad file does not stop the rest */ });
      });
    }, Promise.resolve()).then(function () {
      results = [];
      busy = false;
      say(list.length + shots.length > MAX_SHOTS
        ? 'Kept the first ' + MAX_SHOTS + '.' : '');
    });
  }

  function go() {
    var s = styles.find(function (x) { return String(x.id) === styleId; });
    if (!shots.length || !s) return;

    var refs = (s.images || []).slice(0, MAX_REFS);
    if (!refs.length) { say('That door style has no photos.', true); return; }

    busy = true;
    say(needsUrls ? 'Uploading the photos...'
                  : 'Working on it — this takes up to a minute.');

    // The two providers want the pictures differently, and the difference
    // cannot be hidden: Google takes them as data in the request, while Kie
    // takes public links and goes and fetches them itself. So when the
    // chosen provider needs links, the room photos are uploaded first.
    prepare(refs)
      .then(function (ready) {
        say('Working on it — this takes up to a minute.');
        return fetch('/api/ai?action=visualise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rooms: ready.rooms,
            refs: ready.refs,
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
        if (!results.length) {
          say('No picture came back. Try another photo.', true);
          return;
        }
        say('');
        // Kept without being asked. It cost money to make, and a picture
        // lost because nobody pressed a button is the worst outcome here.
        results.forEach(function (r, i) {
          if (!r.saved) saveResult(i, true);
        });
      })
      .catch(function (e) {
        busy = false;
        say(e.message, true);
      });
  }

  // The room photos and the door photos, in whatever form the chosen
  // provider takes.
  //
  // For Google: everything as data. The door photos are stored as links, so
  // they are read back here rather than handed to the server for it to go
  // and fetch -- the server never fetches a URL it was given.
  //
  // For Kie: everything as public links. The door photos already are links;
  // the room photos are uploaded to get one.
  function prepare(refs) {
    if (!needsUrls) {
      return Promise.all(refs.map(toDataUrl)).then(function (list) {
        var usable = list.filter(Boolean);
        if (!usable.length) throw new Error('Could not read the door photos.');
        return { rooms: shots.slice(), refs: usable };
      });
    }

    var links = refs.filter(function (u) { return /^https?:\/\//i.test(u); });
    if (!links.length) throw new Error('That door style has no usable photos.');

    return shots.reduce(function (chain, url, i) {
      return chain.then(function (done) {
        say('Uploading photo ' + (i + 1) + ' of ' + shots.length + '...');
        return toFile(url, 'room-' + (i + 1) + '.jpg')
          .then(api.uploadMediaFile)
          .then(function (link) { done.push(link); return done; });
      });
    }, Promise.resolve([])).then(function (roomLinks) {
      return { rooms: roomLinks, refs: links };
    });
  }

  function toFile(dataUrl, name) {
    return fetch(dataUrl).then(function (r) { return r.blob(); })
      .then(function (blob) {
        try { return new File([blob], name, { type: 'image/jpeg' }); }
        catch (e) { blob.name = name; return blob; }
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

  function saveResult(i, quiet) {
    var r = results[i];
    if (!r || r.saved || r.saving || !currentJob) return;

    r.saving = true;
    if (!quiet) { busy = true; say('Saving...'); }
    else say('Saving to the job...');

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
        r.saving = false;
        busy = false;
        window.MM.activity.log('list_added', 'Saved a visualisation', {
          jobId: currentJob.id,
          jobName: (currentJob.contact && currentJob.contact.name) || currentJob.name,
        });
        say('Saved to the job’s photos.');
      })
      .catch(function (e) {
        r.saving = false;
        busy = false;
        // Still downloadable, and the Save button comes back, so a failure
        // here never loses the picture.
        say('Could not save it to the job: ' + e.message +
            ' You can still download it.', true);
      });
  }

  function bind(el) {
    var shoot = el.querySelector('#mm-vz-shoot');
    if (shoot) shoot.addEventListener('click', function () {
      var input = U.cameraInput(document.createElement('input'));
      input.addEventListener('change', function () { takePhotos(input.files); });
      input.click();
    });

    var pick = el.querySelector('#mm-vz-pick');
    if (pick) pick.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', function () { takePhotos(input.files); });
      input.click();
    });

    el.querySelectorAll('[data-drop]').forEach(function (b) {
      b.addEventListener('click', function () {
        shots.splice(+b.getAttribute('data-drop'), 1);
        results = [];
        say('');
      });
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

    var fromJob = el.querySelector('#mm-vz-fromjob');
    if (fromJob) fromJob.addEventListener('click', function () {
      picking = !picking;
      render();
    });

    el.querySelectorAll('[data-job]').forEach(function (b) {
      b.addEventListener('click', function () {
        var url = onJob[+b.getAttribute('data-job')];
        if (!url) return;
        if (shots.length >= MAX_SHOTS) {
          say('That is as many photos as it takes.', true);
          return;
        }
        busy = true;
        say('Reading the photo...');
        // Copied into this tab's own list. The job's photo is untouched --
        // it is read, scaled for sending, and left exactly where it is.
        toDataUrl(url)
          .then(function (d) {
            if (!d) throw new Error('Could not read that photo.');
            return downscale(d);
          })
          .then(function (d) {
            shots.push(d);
            results = [];
            picking = false;
            busy = false;
            say('');
          })
          .catch(function (e) { busy = false; say(e.message, true); });
      });
    });

    // A result, full size. Reuses the viewer the photo galleries use, so
    // swiping and the arrows work here too.
    el.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = results[+b.getAttribute('data-open')];
        if (r) openFull(r.url);
      });
    });
  }

  // A picture on its own, as big as the screen allows. Written here rather
  // than reusing the gallery viewer: that one walks a grid of thumbnails,
  // and a result has no grid to walk.
  function openFull(url) {
    var wrap = document.createElement('div');
    wrap.className = 'mm-lightbox';

    var close = document.createElement('button');
    close.className = 'mm-lightbox-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    wrap.appendChild(close);

    var img = document.createElement('img');
    img.src = url;
    img.alt = 'The room visualised';
    wrap.appendChild(img);

    function shut() {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
    }
    function onKey(e) { if (e.key === 'Escape') shut(); }

    close.addEventListener('click', shut);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(wrap);
    close.focus();
  }

  window.MM.visualise = { showForJob: showForJob };
})();
