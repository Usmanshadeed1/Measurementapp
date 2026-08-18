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
    function openLightbox() {
      var modal = document.createElement('div');
      modal.className = 'mm-lightbox';
      var close = document.createElement('button');
      close.className = 'mm-lightbox-close';
      close.textContent = '✕';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', function () { modal.remove(); });
      modal.appendChild(close);
      var big = isVid ? document.createElement('video') : document.createElement('img');
      big.src = U.pv(m, 'file_url');
      if (isVid) big.controls = true;
      modal.appendChild(big);
      if (wallLabel) {
        var cap = document.createElement('div');
        cap.className = 'mm-lightbox-caption';
        cap.textContent = wallLabel;
        modal.appendChild(cap);
      }
      document.body.appendChild(modal);
    }
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
