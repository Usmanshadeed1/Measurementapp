// js/jobdocs.js
// Documents and photos held against a whole job.
//
// The measurement tool files a photo under a room and a wall. Plenty of what
// a job accumulates has no room: the signed contract, the permit, the survey.
// Those are stored with a job_id and no room_id, which the upload code
// already allowed for — this screen is what finally uses it.
//
// Everything lands in the same GoHighLevel photo/video objects the
// measurement tool uses. A tenth custom object for documents is not
// available: the account is at GoHighLevel's cap of 10, all in use by the
// measurement tool. Storing a PDF as a "photo" record is invisible to the
// user, and its file_url works the same either way.
//
// Who sees what:
//   Photos    — everyone on the job. The crew took them.
//   Documents — admins only. Contracts and invoices carry prices that are
//               not the crew's business.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api, auth = window.MM.auth;

  var currentJob = null;
  var items = [];

  // The paperwork a remodelling job actually collects. "Photo" is here so a
  // picture taken outside the measurement flow still has somewhere to go.
  var TYPES = [
    'Contract', 'Quote', 'Estimate', 'Invoice', 'Receipt',
    'Change Order', 'Permit', 'Inspection', 'Plan', 'Drawing',
    'Warranty', 'Insurance', 'Material List', 'Site Photo', 'Other',
  ];

  // Types that are not paperwork. Everything else is admin-only.
  var PHOTO_TYPES = ['Site Photo'];

  // The type is stored at the front of the record name, because a photo
  // record has no field of its own to put it in. Reading it back is a plain
  // prefix match, and a file saved before this existed simply has no type.
  var SEP = ' — ';

  function typeOf(rec) {
    var n = U.pv(rec, 'name') || '';
    var i = n.indexOf(SEP);
    if (i < 0) return '';
    var t = n.slice(0, i).trim();
    return TYPES.indexOf(t) > -1 ? t : '';
  }
  function labelOf(rec) {
    var n = U.pv(rec, 'name') || 'Untitled';
    var i = n.indexOf(SEP);
    return i < 0 ? n : n.slice(i + SEP.length).trim() || n;
  }

  // A record counts as a photo if it is an image — either by its declared
  // type or by the file itself. Anything else is paperwork.
  function isPhoto(rec) {
    var t = typeOf(rec);
    if (t) return PHOTO_TYPES.indexOf(t) > -1;
    if (rec.__isVideo) return true;
    var url = (U.pv(rec, 'file_url') || '').toLowerCase().split('?')[0];
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg)$/.test(url);
  }

  function canSeeDocs() { return auth.isAdmin(); }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? ''
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---- Loading -------------------------------------------------------------

  function load() {
    if (!currentJob) return Promise.resolve();
    return Promise.all([
      api.queryMediaByField(api.PHOTO, 'job_id', currentJob.id),
      api.queryMediaByField(api.VIDEO, 'job_id', currentJob.id),
    ]).then(function (res) {
      var photos = (res[0] || []);
      var videos = (res[1] || []).map(function (v) { v.__isVideo = true; return v; });
      items = photos.concat(videos).sort(function (a, b) {
        return String(U.pv(b, 'date_taken')).localeCompare(String(U.pv(a, 'date_taken')));
      });
      render();
    }).catch(function (e) {
      items = [];
      render(e.message);
    });
  }

  // ---- Rendering -----------------------------------------------------------

  function render(errMsg) {
    var el = document.getElementById('mm-job-docs');
    if (!el) return;

    var docs = items.filter(function (r) { return !isPhoto(r); });
    var pics = items.filter(isPhoto);
    var showDocs = canSeeDocs();

    // A worker is never told how many documents they cannot see.
    var visible = (showDocs ? docs.length : 0) + pics.length;

    el.innerHTML =
      '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Documents &amp; Photos</span>' +
        (visible
          ? '<span class="mm-steps-badge mm-steps-badge-done">' + visible + '</span>'
          : '<span class="mm-steps-badge mm-steps-badge-todo">None yet</span>') +
      '</div>' +
      (showDocs ? uploadBox() : '') +
      (errMsg ? '<p class="mm-task-error">' + U.esc(errMsg) + '</p>' : '') +
      (showDocs ? group('Documents', docs, 'No documents yet.') : '') +
      group('Photos', pics, 'No photos on this job yet.') +
      '<p class="mm-crew-note">Photos taken while measuring a room also appear here. ' +
      'They stay on their room as well.</p>' +
      '<p class="mm-task-error" id="mm-docs-error" role="alert"></p>';

    bind(el);
    if (window.MM.wireJobPanels) window.MM.wireJobPanels();
  }

  function group(title, rows, emptyText) {
    return '<div class="mm-docgroup">' +
      '<div class="mm-docgroup-head">' + U.esc(title) +
        '<span class="mm-docgroup-count">' + rows.length + '</span></div>' +
      (rows.length
        ? '<div class="mm-doclist">' + rows.map(row).join('') + '</div>'
        : '<p class="mm-task-empty">' + U.esc(emptyText) + '</p>') +
    '</div>';
  }

  function row(rec) {
    var url = U.pv(rec, 'file_url');
    var t = typeOf(rec);
    var when = fmtDate(U.pv(rec, 'date_taken'));
    var pic = isPhoto(rec) && !rec.__isVideo;

    return '<div class="mm-doc">' +
      '<a class="mm-doc-main" href="' + U.esc(url) + '" target="_blank" rel="noopener">' +
        (pic
          ? '<img class="mm-doc-thumb" src="' + U.esc(url) + '" alt="" loading="lazy">'
          : '<span class="mm-doc-icon" aria-hidden="true">' +
            (rec.__isVideo ? '&#127909;' : '&#128196;') + '</span>') +
        '<span class="mm-doc-text">' +
          '<span class="mm-doc-name">' + U.esc(labelOf(rec)) + '</span>' +
          '<span class="mm-doc-sub">' +
            (t ? U.esc(t) : 'File') + (when ? ' · ' + U.esc(when) : '') +
          '</span>' +
        '</span>' +
      '</a>' +
      (auth.isAdmin()
        ? '<button type="button" class="mm-doc-del" data-del="' + U.esc(rec.id) + '" ' +
          'data-vid="' + (rec.__isVideo ? '1' : '') + '" aria-label="Delete this file">&times;</button>'
        : '') +
    '</div>';
  }

  function uploadBox() {
    return '<div class="mm-docadd">' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-doc-type">Type</label>' +
        '<select class="mm-select" id="mm-doc-type">' +
          TYPES.map(function (t) {
            return '<option value="' + U.esc(t) + '">' + U.esc(t) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-doc-name">Description <span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-doc-name" placeholder="e.g. signed by customer">' +
      '</div>' +
      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-doc-file">File</label>' +
        '<input class="mm-input" type="file" id="mm-doc-file">' +
      '</div>' +
      '<button class="mm-btn-sm mm-btn-primary" id="mm-doc-upload">Upload</button>' +
    '</div>';
  }

  // ---- Actions -------------------------------------------------------------

  function docError(msg) {
    var el = document.getElementById('mm-docs-error');
    if (el) el.textContent = msg || '';
  }

  function bind(el) {
    var up = el.querySelector('#mm-doc-upload');
    if (up) up.addEventListener('click', upload);

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        remove(b.getAttribute('data-del'), b.getAttribute('data-vid') === '1', b);
      });
    });
  }

  function upload() {
    var fileEl = document.getElementById('mm-doc-file');
    var btn = document.getElementById('mm-doc-upload');
    var file = fileEl.files && fileEl.files[0];
    if (!file) { docError('Choose a file first.'); return; }

    var type = document.getElementById('mm-doc-type').value;
    var note = (document.getElementById('mm-doc-name').value || '').trim();
    // Falling back to the file's own name keeps the list readable when nobody
    // typed a description.
    var label = note || file.name;

    docError('');
    btn.disabled = true; btn.textContent = 'Uploading...';

    var isVid = /^video\//.test(file.type);
    api.uploadMediaFile(file)
      .then(function (url) {
        return api.createPhotoOrVideo(
          isVid ? api.VIDEO : api.PHOTO,
          type + SEP + label,
          url,
          currentJob.id,     // job only: no room, no wall
          null, null
        );
      })
      .then(function () {
        window.MM.activity.log('doc_added', 'Added ' + type.toLowerCase() + ' to this job', {
          jobId: currentJob.id,
          jobName: jobLabel(currentJob),
          detail: label,
        });
        fileEl.value = '';
        document.getElementById('mm-doc-name').value = '';
        return load();
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Upload';
        docError('Could not upload: ' + e.message);
      });
  }

  function remove(id, isVid, btn) {
    btn.disabled = true;
    docError('');
    api.deleteMedia(isVid ? api.VIDEO : api.PHOTO, id)
      .then(function () {
        window.MM.activity.log('doc_removed', 'Removed a file from this job', {
          jobId: currentJob.id, jobName: jobLabel(currentJob),
        });
        return load();
      })
      .catch(function (e) {
        btn.disabled = false;
        docError('Could not delete: ' + e.message);
      });
  }

  function jobLabel(o) {
    if (o.contact && o.contact.name) return U.titleCase(o.contact.name);
    var n = o.name || '';
    return U.titleCase(n.indexOf(' - ') > -1 ? n.split(' - ')[0] : n);
  }

  function showForJob(job) {
    currentJob = job;
    items = [];
    var el = document.getElementById('mm-job-docs');
    if (el) {
      el.innerHTML = '<div class="mm-steps-head">' +
        '<span class="mm-steps-title">Documents &amp; Photos</span></div>' +
        '<div class="mm-empty">Loading...</div>';
    }
    return load();
  }

  window.MM.jobdocs = { showForJob: showForJob };
})();
