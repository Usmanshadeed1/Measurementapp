// js/drive.js
// The browser's side of the Google Drive link.
//
// Everything here is optional by design. Drive is the *extra* copy: the job
// is already created and the photo is already safe in GoHighLevel before any
// of this runs. So every call swallows its own failure and reports it quietly
// -- a Drive problem must never cost someone a photo or block a job.
//
// The token lives on the server. Nothing here can see it.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  // The opportunity field holding the job's folder link, shared with
  // drivefolder.js so a folder made here and one pasted by hand are the
  // same thing to the rest of the app.
  var FIELD_ID = 'kCABMlFG0RfzmOAM7vYN';

  var connected = null;   // null = not asked yet

  function call(path, method, body) {
    return fetch('/api/drive/' + path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var data;
        try { data = t ? JSON.parse(t) : {}; } catch (e) { data = {}; }
        if (!r.ok) throw new Error(data.error || 'Drive request failed.');
        return data;
      });
    });
  }

  // Asked once per page load. A "no" means every other function here becomes
  // a no-op rather than a series of failing requests.
  function isConnected() {
    if (connected !== null) return Promise.resolve(connected);
    return call('status')
      .then(function (s) { connected = !!s.connected; return connected; })
      .catch(function () { connected = false; return false; });
  }

  // ---- The customer's name, as the folder is named -------------------------
  //
  // "Lastname Firstname", which is how the client keeps them. No comma: he
  // asked for none, and a comma in a folder name reads badly in Drive.

  function folderName(contact, job) {
    var last = (contact && contact.lastName) || '';
    var first = (contact && contact.firstName) || '';

    if (!last && !first) {
      // Falling back to the job title's customer half, which is how jobs made
      // by the GoHighLevel workflow carry the name.
      var n = String((job && job.name) || '').split(' - ')[0].trim();
      var bits = n.split(/\s+/);
      first = bits.shift() || '';
      last = bits.join(' ');
    }

    var name = [last, first].filter(Boolean).join(' ').trim();
    // Drive rejects a slash in a name, and a stray one would otherwise read
    // as a folder inside a folder.
    return U.titleCase(name).replace(/[\\/]/g, '-');
  }

  // ---- Making a job's folder -----------------------------------------------

  // Called after a job is created. Makes the folder tree and writes the link
  // onto the opportunity, so it shows in the Drive Folder panel like any
  // other. Never throws: a job without a Drive folder is a job that still
  // works, and the folder can be linked by hand later.
  function createForJob(job, contact) {
    if (!job || !job.id) return Promise.resolve(null);

    return isConnected().then(function (on) {
      if (!on) return null;

      var name = folderName(contact, job);
      if (!name) return null;

      return call('job-folder', 'POST', { name: name, unique: true })
        .then(function (f) {
          if (!f || !f.link) return null;
          return api.setOpportunityField(job.id, FIELD_ID, f.link)
            .then(function () { return f; })
            // The folder exists even if the link could not be stored; saying
            // so beats pretending it failed entirely.
            .catch(function () { return f; });
        })
        .catch(function () { return null; });
    });
  }

  // ---- Copying a photo or video --------------------------------------------

  // Called after a photo is safely in GoHighLevel. Reads the job's folder
  // link, then asks the server to copy the file into Photos or Videos.
  //
  // Quiet on every failure: not connected, no folder linked, Drive down. The
  // photo is already saved -- this is the second copy, and a second copy that
  // did not happen must not look like a lost photo.
  function copyMedia(jobId, fileUrl, name, isVideo) {
    if (!jobId || !fileUrl) return Promise.resolve(null);

    return isConnected().then(function (on) {
      if (!on) return null;

      return api.getOpportunity(jobId)
        .then(function (opp) {
          var link = opp ? String(api.oppField(opp, FIELD_ID) || '').trim() : '';
          if (!link) return null;   // no folder on this job, nothing to do
          return call('upload', 'POST', {
            fileUrl: fileUrl,
            folderLink: link,
            name: name,
            isVideo: !!isVideo,
          });
        })
        .catch(function () { return null; });
    });
  }

  // ---- Picking an existing folder ------------------------------------------

  // The folders sitting in the parent folder, for a job that already had one
  // made by hand. Throws, unlike the rest of this file: the person asked to
  // see a list, so an empty panel with no explanation would be worse.
  function listFolders() {
    return call('folders').then(function (d) { return d.folders || []; });
  }

  window.MM.drive = {
    isConnected: isConnected,
    createForJob: createForJob,
    copyMedia: copyMedia,
    listFolders: listFolders,
    folderName: folderName,
    FIELD_ID: FIELD_ID,
  };
})();
