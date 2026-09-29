// js/media.js
// Photo/video thumbnails, upload, and the shared registry that keeps
// a media item in sync across the room/wall/job galleries it appears in.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var mediaThumbRegistry = {};
  function registerThumb(id, thumb, onRemoved) {
    (mediaThumbRegistry[id] = mediaThumbRegistry[id] || []).push({ thumb: thumb, onRemoved: onRemoved });
  }
  function removeThumbEverywhere(id) {
    var entries = mediaThumbRegistry[id] || [];
    entries.forEach(function (entry) { entry.thumb.remove(); if (entry.onRemoved) entry.onRemoved(); });
    delete mediaThumbRegistry[id];
  }

  function makeMediaGrid() {
    var grid = document.createElement('div');
    grid.className = 'mm-media-grid';
    return grid;
  }

  // ---- Looking at a photo --------------------------------------------------
  //
  // Opened from a thumbnail, and able to move to the ones beside it: someone
  // reviewing a room wants the next picture, not to close this one and hunt
  // for the next thumbnail.
  //
  // The neighbours are found by walking the GRID the thumbnail sits in, so a
  // photo opened inside a wall moves through that wall's photos and one
  // opened on the job moves through the job's. Nothing is loaded or stored
  // to do it -- the thumbnails are already on the page.
  //
  // Written directly rather than with a slider library: this is two touch
  // events and a key handler, and the app carries no libraries at all.

  function openViewer(fromThumb) {
    var grid = fromThumb.parentElement;
    var shots = grid
      ? Array.prototype.filter.call(grid.children, function (c) { return c.mmMedia; })
      : [fromThumb];
    var at = shots.indexOf(fromThumb);
    if (at < 0) { shots = [fromThumb]; at = 0; }

    var modal = document.createElement('div');
    modal.className = 'mm-lightbox';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    var close = document.createElement('button');
    close.className = 'mm-lightbox-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', shut);
    modal.appendChild(close);

    var stage = document.createElement('div');
    stage.className = 'mm-lightbox-stage';
    modal.appendChild(stage);

    var cap = document.createElement('div');
    cap.className = 'mm-lightbox-caption';
    modal.appendChild(cap);

    var prev = null, next = null;
    if (shots.length > 1) {
      prev = arrow('‹', 'Previous', 'mm-lightbox-prev', function () { go(-1); });
      next = arrow('›', 'Next', 'mm-lightbox-next', function () { go(1); });
      modal.appendChild(prev);
      modal.appendChild(next);
    }

    function arrow(glyph, label, cls, fn) {
      var b = document.createElement('button');
      b.className = 'mm-lightbox-arrow ' + cls;
      b.textContent = glyph;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      return b;
    }

    function show() {
      var d = shots[at].mmMedia;
      stage.innerHTML = '';

      var big = d.isVid ? document.createElement('video')
                        : document.createElement('img');
      big.src = d.url;
      if (d.isVid) big.controls = true;
      else big.alt = d.label ? ('Photo — ' + d.label) : 'Job photo';
      stage.appendChild(big);

      // The position is worth knowing -- "3 of 9" tells someone whether it
      // is worth carrying on swiping.
      var bits = [];
      if (d.label) bits.push(d.label);
      if (shots.length > 1) bits.push((at + 1) + ' of ' + shots.length);
      cap.textContent = bits.join('  ·  ');

      if (prev) prev.disabled = at === 0;
      if (next) next.disabled = at === shots.length - 1;
    }

    // Stops at both ends rather than wrapping round: on a phone, silently
    // looping back to the first picture reads as the swipe having failed.
    function go(by) {
      var to = at + by;
      if (to < 0 || to >= shots.length) return;
      at = to;
      show();
    }

    function onKey(e) {
      if (e.key === 'Escape') { shut(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    }

    function shut() {
      document.removeEventListener('keydown', onKey);
      modal.remove();
    }

    // Tapping the backdrop closes; tapping the picture itself does not, so a
    // mis-tap while reaching for an arrow does not shut the viewer.
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target === stage) shut();
    });

    // Swiping. Only a clearly horizontal drag counts, so scrolling a tall
    // photo up and down does not skip to the next one.
    var x0 = 0, y0 = 0, tracking = false;
    modal.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    modal.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      go(dx < 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(modal);
    show();
    close.focus();
  }

  function buildMediaThumb(m, isVid, grid, el, wallLabel, onRemovedExtra) {
    var type = isVid ? api.VIDEO : api.PHOTO;
    var thumb = document.createElement('div');
    thumb.className = 'mm-media-thumb';

    var media;
    if (isVid) {
      media = document.createElement('video');
      media.src = U.pv(m, 'file_url');
      media.muted = true;
      media.preload = 'metadata';
    } else {
      media = document.createElement('img');
      media.src = U.pv(m, 'file_url');
      media.alt = wallLabel ? ('Photo — ' + wallLabel) : 'Job photo';
    }
    thumb.appendChild(media);

    if (isVid) {
      var play = document.createElement('div');
      play.className = 'mm-media-play';
      play.setAttribute('aria-hidden', 'true');
      play.textContent = '▶';
      thumb.appendChild(play);
    }

    var del = document.createElement('button');
    del.className = 'mm-media-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Delete ' + (isVid ? 'video' : 'photo'));
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!confirm('Delete?')) return;
      api.deleteMedia(type, m.id).then(function () { removeThumbEverywhere(m.id); }).catch(function (e) { alert(e.message); });
    });
    thumb.appendChild(del);

    if (wallLabel) {
      var tag = document.createElement('div');
      tag.className = 'mm-media-tag';
      tag.textContent = wallLabel;
      thumb.appendChild(tag);
    }

    thumb.setAttribute('role', 'button');
    thumb.setAttribute('tabindex', '0');
    thumb.setAttribute('aria-label', 'View ' + (isVid ? 'video' : 'photo') + (wallLabel ? ' — ' + wallLabel : ''));

    // Hung on the thumbnail so the viewer can read it back when moving to
    // the next picture. The viewer walks the grid it was opened from, and
    // the grid holds thumbnails -- not the records they were built from.
    thumb.mmMedia = { url: U.pv(m, 'file_url'), isVid: isVid, label: wallLabel || '' };
    function openLightbox() { openViewer(thumb); }
    thumb.addEventListener('click', openLightbox);
    thumb.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(); } });

    registerThumb(m.id, thumb, function () {
      if (!grid.children.length) el.innerHTML = '<div class="mm-empty">No photos or videos yet.</div>';
      if (onRemovedExtra) onRemovedExtra();
    });
    return thumb;
  }

  function addMediaThumb(m, isVid, wallLabel) {
    var el = document.getElementById('mm-media-gallery');
    var grid = el.querySelector('.mm-media-grid');
    if (!grid) { el.innerHTML = ''; grid = makeMediaGrid(); el.appendChild(grid); }
    grid.insertBefore(buildMediaThumb(m, isVid, grid, el, wallLabel), grid.firstChild);
  }

  function updateJobGroupCount(el, acc) {
    var grid = acc.querySelector('.mm-media-grid');
    var count = grid ? grid.children.length : 0;
    if (!count) { acc.remove(); if (!el.querySelector('.mm-acc')) el.innerHTML = '<div class="mm-empty">No photos or videos yet.</div>'; return; }
    var subEl = acc.querySelector('.mm-acc-sub');
    if (subEl) subEl.textContent = count + ' item' + (count === 1 ? '' : 's');
  }

  function addJobMediaThumb(m, isVid, roomId, wallLabel, room) {
    var el = document.getElementById('mm-job-media');
    if (!el) return;
    var groupKey = roomId || '__none__';
    var acc = el.querySelector('[data-room-group="' + groupKey + '"]');
    if (!acc) {
      var label = roomId ? (U.pv(room, 'name') || 'Room') : 'Unassigned';
      var body = document.createElement('div'); body.className = 'mm-acc-body';
      var grid = makeMediaGrid(); body.appendChild(grid);
      var built = U.makeAcc(false, true, label, '', body);
      built.acc.setAttribute('data-room-group', groupKey);
      if (!el.querySelector('.mm-acc')) el.innerHTML = '';
      el.appendChild(built.acc);
      acc = built.acc;
    }
    var body = acc.querySelector('.mm-acc-body');
    var grid = body.querySelector('.mm-media-grid');
    grid.insertBefore(buildMediaThumb(m, isVid, grid, body, wallLabel, function () { updateJobGroupCount(el, acc); }), grid.firstChild);
    updateJobGroupCount(el, acc);
  }

  window.MM.media = {
    makeMediaGrid: makeMediaGrid,
    buildMediaThumb: buildMediaThumb,
    addMediaThumb: addMediaThumb,
    addJobMediaThumb: addJobMediaThumb,
    updateJobGroupCount: updateJobGroupCount,
    removeThumbEverywhere: removeThumbEverywhere,
  };
})();
