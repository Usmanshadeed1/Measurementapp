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
    // A counter left running from the last job would keep writing into a
    // page that has moved on.
    stopTicking();
    currentJob = job;
    shots = []; styleId = ''; extra = ''; colour = '';
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
      stepColour() +
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

  // ONE door photograph: the first one of the chosen colour. A colour can
  // hold several, but one clear picture of the door in that finish is all
  // the model needs, and every extra one is more for it to read before it
  // starts drawing.
  var MAX_REFS = 1;

  // ---- The colour --------------------------------------------------------
  //
  // The colours of the STYLE that was chosen, not one shared palette:
  // Catalina comes in Black Gloss and Clubhouse Oak, Fusion in Dove and
  // Pitch Black. They are set up per style on the Door Styles page.
  //
  // Each one carries its own photographs, and those go to the AI alongside
  // the door's. A name alone cannot describe a gloss or a wood grain; the
  // picture can.

  // Which colour is chosen, by name. Empty means "as the door photos show",
  // which is a real answer rather than an absence of one.
  var colour = '';

  function colourList() {
    var s = styles.find(function (x) { return String(x.id) === styleId; });
    return (s && s.colors) || [];
  }

  function stepColour() {
    var cols = colourList();

    // Nothing to choose from until a style is picked, and nothing worth
    // showing for a style that has none.
    if (!styleId) return '';
    if (!cols.length) {
      return '<div class="mm-vz-step">' +
        '<div class="mm-vz-head"><span class="mm-vz-n">3</span>' +
          '<span class="mm-vz-title">Colour</span></div>' +
        '<p class="mm-vz-hint">This style has no colours yet. Add them on ' +
          'the <strong>Door Styles</strong> page.</p>' +
      '</div>';
    }

    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">3</span>' +
        '<span class="mm-vz-title">Colour</span></div>' +
      '<div class="mm-vz-cols">' +
        cols.map(function (c) {
          var shot = (c.images || [])[0];
          return '<button type="button" class="mm-vz-col' +
              (c.name === colour ? ' is-on' : '') + '" ' +
              'data-col="' + U.esc(c.name) + '"' +
              (busy ? ' disabled' : '') + '>' +
            (shot
              ? '<img class="mm-vz-colshot" src="' + U.esc(shot) + '" alt="">'
              : '<span class="mm-vz-colsw" style="background:' +
                U.esc(c.swatch || '#999') + '" aria-hidden="true"></span>') +
            '<span class="mm-vz-colname">' + U.esc(c.name) + '</span>' +
          '</button>';
        }).join('') +
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
    var can = !!(shots.length && styleId) && !busy;
    return '<div class="mm-vz-step">' +
      '<div class="mm-vz-head"><span class="mm-vz-n">4</span>' +
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

  // A count of the seconds while the picture is being drawn. Some models
  // take ten seconds and some take two minutes, and a message that never
  // changes is indistinguishable from one that has stopped.
  var tick = null;

  function startTicking() {
    stopTicking();
    var from = Date.now();
    function show() {
      var secs = Math.round((Date.now() - from) / 1000);
      msg = 'Drawing the picture — ' + secs + 's so far.' +
            (secs > 60 ? ' Some models take a couple of minutes.' : '');
      isErr = false;
      // Only the message is redrawn: a full render every second would take
      // the focus out of whatever is being typed.
      var el = document.querySelector('.mm-vz-msg');
      if (el) el.textContent = msg; else render();
    }
    show();
    tick = setInterval(show, 1000);
  }

  function stopTicking() {
    if (tick) { clearInterval(tick); tick = null; }
  }

  // ---- The disclaimer ------------------------------------------------------

  // Written onto the picture before it is saved. An email can be forwarded
  // without its text, and a rendering with no mark on it is one screenshot
  // away from looking like a promise.
  // The finished picture arrives as a link to the provider's own server, and
  // a canvas that draws an image from another site refuses to be read back.
  // That made the stamp below fail SILENTLY: the disclaimer was never added,
  // and the provider's original file -- uncompressed, nearly 5MB -- was sent
  // to be saved and refused for being too large.
  //
  // So the picture is fetched as data first. A canvas drawing local data can
  // be read, the stamp goes on, and the result is sized to fit.
  function asLocal(src) {
    if (/^(data|blob):/.test(src)) return Promise.resolve(src);
    return fetch(src)
      .then(function (r) {
        if (!r.ok) throw new Error('Could not fetch the picture.');
        return r.blob();
      })
      .then(function (b) { return URL.createObjectURL(b); });
  }

  // Saving has a 4.4MB limit. A render is 2000-odd pixels across, and that
  // fits easily as a good JPEG -- this is the long edge it is kept to, and
  // nothing is shrunk that does not need to be.
  var SAVE_EDGE = 2400;
  var SAVE_MAX = 4 * 1024 * 1024;

  function stamp(src) {
    return asLocal(src).then(function (local) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { draw(img, local, resolve, reject); };
        img.onerror = function () { reject(new Error('Could not read the picture.')); };
        img.src = local;
      });
    });
  }

  function draw(img, local, resolve, reject) {
    var scale = Math.min(1, SAVE_EDGE /
      Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    var ctx = c.getContext('2d');
    if (!ctx) { reject(new Error('Could not prepare the picture.')); return; }
    ctx.drawImage(img, 0, 0, c.width, c.height);

    var pad = Math.max(10, Math.round(c.width * 0.012));
    var size = Math.max(13, Math.round(c.width * 0.022));
    var text = 'Concept illustration \u2014 not a construction drawing';

    ctx.font = '600 ' + size + 'px system-ui, -apple-system, sans-serif';
    var w = ctx.measureText(text).width;
    var barH = size + pad * 1.4;

    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, c.height - barH, c.width, barH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.max(pad, (c.width - w) / 2), c.height - barH / 2);

    if (/^blob:/.test(local)) URL.revokeObjectURL(local);

    // High quality first, lower only if the file is still over the limit.
    var qualities = [0.9, 0.82, 0.74];
    (function next(i) {
      c.toBlob(function (blob) {
        if (!blob) { reject(new Error('Could not prepare the picture.')); return; }
        if (blob.size <= SAVE_MAX || i === qualities.length - 1) {
          resolve(blob);
          return;
        }
        next(i + 1);
      }, 'image/jpeg', qualities[i]);
    })(0);
  }

  // ---- Actions -------------------------------------------------------------

  // Several at a time, kept in the order they were picked. The first is the
  // one the picture is made from, so it is the one to get right.
  // Three angles is plenty to show one room, and every extra picture is
  // read by the model before it draws anything.
  var MAX_SHOTS = 3;

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

    // A colour's photograph shows the door in the finish being sold -- the
    // shape AND the colour in one picture. So when a colour is chosen, that
    // is the reference, and the style's plain photos are left out: sending
    // both gave the model four references to reconcile and a render that
    // took four minutes and timed out.
    //
    // Two at most either way. More angles of the same door do not make it
    // more faithful, they just make it slower.
    var chosen = colourList().find(function (c) { return c.name === colour; });
    var picked = (chosen && chosen.images) || [];
    var refs = (picked.length ? picked : (s.images || [])).slice(0, MAX_REFS);
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
        startTicking();
        return fetch('/api/ai?action=visualise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rooms: ready.rooms,
            refs: ready.refs,
            style: s.name,
            notes: s.notes || '',
            colour: colour,
            extra: extra,
          }),
        });
      })
      .then(readAnswer)
      // A provider that queues the work answers with a job number rather
      // than a picture; wait for it here. Google answers with the picture,
      // and that passes straight through.
      .then(function (d) { return d.taskId ? waitFor(d.taskId) : d; })
      .then(function (d) {
        results = (d.images || []).map(function (u) {
          return { url: u, saved: false };
        });
        stopTicking();
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
        stopTicking();
        busy = false;
        say(e.message, true);
      });
  }

  function readAnswer(r) {
    return r.text().then(function (t) {
      var d;
      try { d = t ? JSON.parse(t) : {}; } catch (e) { d = {}; }
      if (!r.ok) throw new Error(d.error || 'The AI did not answer.');
      return d;
    });
  }

  // Waiting for a queued picture, a few seconds at a time.
  //
  // This used to happen on the server, inside the one request that started
  // the work -- and Vercel ends any request at five minutes. A render that
  // ran long was thrown away there, AFTER the provider had already charged
  // for it. Asking from here, each check is over in a moment, so there is
  // no ceiling to hit and nothing paid for is ever lost.
  //
  // The limit below is about people, not machines: past ten minutes it is
  // fair to say something has gone wrong.
  var GIVE_UP_AFTER = 10 * 60 * 1000;

  function waitFor(taskId) {
    var until = Date.now() + GIVE_UP_AFTER;
    var gap = 2000;

    function look() {
      if (Date.now() > until) {
        throw new Error('This one is taking far longer than usual. It may ' +
          'still finish — check the provider’s logs before trying again, ' +
          'so it is not paid for twice.');
      }
      return new Promise(function (done) { setTimeout(done, gap); })
        .then(function () {
          // Quick at first, when a fast model is likely to be done, then
          // easing off so a slow one is not asked a hundred times.
          if (gap < 5000) gap += 500;
          return fetch('/api/ai?action=visualise-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: taskId }),
          });
        })
        .then(readAnswer)
        .then(function (d) { return d.working ? look() : d; });
    }

    return look();
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

    // stamp() hands back the finished file -- disclaimer on, sized to fit.
    stamp(r.url)
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

    el.querySelectorAll('[data-col]').forEach(function (b) {
      b.addEventListener('click', function () {
        colour = b.getAttribute('data-col');
        render();
      });
    });

    el.querySelectorAll('[data-style]').forEach(function (b) {
      b.addEventListener('click', function () {
        styleId = b.getAttribute('data-style');
        // Each style has its own colours, so one chosen for another style
        // means nothing here.
        colour = '';
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
