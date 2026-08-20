// js/api.js
// All GHL API access. Calls go to our own Netlify Function proxy
// (/api/*) instead of GHL directly — no API key lives in this file
// or anywhere else in the browser bundle.
window.MM = window.MM || {};

(function () {
  var LOC = 'Ga7nrS4d8EFtep9LkHS3';
  var ADDR_FIELD_ID = 'np5Bh2jzG5zvdz3qukWV';

  // The sales pipeline the dashboard reports on. Opportunities in other
  // pipelines (e.g. the older Marketing Pipeline) are ignored there.
  var SALES_PIPELINE_ID = 'VILXN1neZNHhQYTo2rf9';

  // Opportunity custom fields come back as { id, fieldValueString } — by id,
  // never by name — so the three status fields are looked up by id here.
  var STATUS_FIELD_IDS = {
    design: 'qoDcsKKATQVI4zKpdFC3',
    pricing: 'Ixc1x6jfSn9FbzxgrOyr',
    meeting: 'NJxO5j5YATiusGdRBlZD',
  };

  // Association IDs — one per relationship type in GHL's custom-object schema.
  var A = {
    rO: '6a788d417912156545df96f3',   // Room <-> Opportunity(Job)
    wR: '6a788d41c064e4e58b0ec2d7',   // Wall <-> Room
    oW: '6a788d411f41bd1b135165ca',   // Opening <-> Wall
    aW: '6a788dfa5db050ab47852732',   // Appliance <-> Wall
    eW: '6a788e9c8a5853853c4ad83f',   // Electrical <-> Wall
    pW: '6a7890665db050ab4785f922',   // Plumbing <-> Wall
    iR: '6a7890277912156545e08d22',   // Island <-> Room
    plI: '6a7890665db050ab4785f955',  // Plumbing <-> Island
    lR: '6a7890d58a5853853c4b98a8',   // Lighting Fixture <-> Room
  };

  var PHOTO = 'custom_objects.photo';
  var VIDEO = 'custom_objects.video';

  function apiFetch(method, path, body) {
    var headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    return fetch('/api' + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      try { return r.json(); } catch (e) { return {}; }
    });
  }

  function rels(id, aId) {
    return apiFetch('GET', '/associations/relations/' + id + '?locationId=' + LOC + '&skip=0&limit=100&associationIds[]=' + aId)
      .then(function (d) {
        return (d.relations || [])
          .filter(function (r) { return r.associationId === aId; })
          .map(function (r) { return r.firstRecordId === id ? r.secondRecordId : r.firstRecordId; });
      });
  }

  function getRec(sk, id) {
    return apiFetch('GET', '/objects/' + sk + '/records/' + id + '?locationId=' + LOC).then(function (d) { return d.record; });
  }
  function makeRec(sk, p) {
    return apiFetch('POST', '/objects/' + sk + '/records', { properties: p, locationId: LOC }).then(function (d) { return d.record; });
  }
  function updateRec(sk, id, p) {
    return apiFetch('PUT', '/objects/' + sk + '/records/' + id + '?locationId=' + LOC, { properties: p }).then(function (d) { return d.record; });
  }
  function deleteRec(sk, id) {
    return apiFetch('DELETE', '/objects/' + sk + '/records/' + id);
  }
  function makeRel(aId, f, s) {
    return apiFetch('POST', '/associations/relations', { locationId: LOC, associationId: aId, firstRecordId: f, secondRecordId: s });
  }

  function uploadMediaFile(file) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('locationId', LOC);
    return fetch('/api/medias/upload-file', { method: 'POST', body: fd })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
        return r.json();
      })
      .then(function (d) {
        var url = d.url || d.fileUrl || (d.file && d.file.url) || (d.data && (d.data.url || d.data.fileUrl));
        if (!url) { console.log('Upload response (no url field found):', d); throw new Error('Upload succeeded but no URL found in response — check console.'); }
        return url;
      });
  }

  function createPhotoOrVideo(type, name, fileUrl, jobId, roomId, wallId) {
    var isVideo = type.indexOf('video') >= 0;
    var safeName = (name && name.trim()) || (isVideo ? 'Video' : 'Photo') + ' – ' + new Date().toISOString().split('T')[0];
    var p = { name: safeName, file_url: fileUrl, date_taken: new Date().toISOString().split('T')[0] };
    if (jobId) p.job_id = jobId;
    if (roomId) p.room_id = roomId;
    if (wallId) p.wall_id = wallId;
    return makeRec(type, p);
  }

  function queryMediaByField(type, fieldKey, fieldValue) {
    return apiFetch('POST', '/objects/' + type + '/records/search', { locationId: LOC, page: 1, pageLimit: 100 })
      .then(function (d) {
        var recs = d.records || d.data || [];
        if (!Array.isArray(recs) || !recs.length) console.log('Search response for ' + type + ' (no records array found or empty):', d);
        return recs.filter(function (r) { return r.properties[fieldKey] === fieldValue; });
      })
      .catch(function (e) { console.log('Search failed for ' + type + ':', e.message); return []; });
  }

  function deleteMedia(type, id) { return deleteRec(type, id); }

  // Jobs the field crew can measure: the sales pipeline only. Other
  // pipelines (and GHL's sample records) are not remodeling jobs and would
  // only be noise on a screen used at the property.
  function searchJobs(query) {
    // The search endpoint rejects pipelineId in the body (422), so the
    // pipeline is filtered client-side on the way out.
    var body = { locationId: LOC, limit: 100 };
    if (query) body.query = query;
    return apiFetch('POST', '/opportunities/search', body).then(function (d) {
      return (d.opportunities || []).filter(function (o) { return o.pipelineId === SALES_PIPELINE_ID; });
    });
  }

  // Reads one custom field off an opportunity by field id. GHL returns the
  // dropdown's visible label (e.g. "Pending") in fieldValueString, not an
  // internal option id — so the value can be compared/displayed directly.
  function oppField(o, fieldId) {
    var f = (o.customFields || []).find(function (x) { return x.id === fieldId; });
    if (!f) return '';
    return f.fieldValueString || f.fieldValue || '';
  }

  // Every opportunity, following pagination past the 100-per-request cap.
  // The dashboard has to count the whole pipeline or its totals would
  // silently be wrong once the business passes 100 jobs.
  function fetchAllOpportunities() {
    var all = [];
    function page(n) {
      return apiFetch('POST', '/opportunities/search', { locationId: LOC, limit: 100, page: n })
        .then(function (d) {
          var batch = d.opportunities || [];
          all = all.concat(batch);
          // Stop on a short page, or if the API ignores `page` and hands back
          // the same first page forever (guard against an infinite loop).
          if (batch.length < 100 || n >= 50) return all;
          return page(n + 1);
        });
    }
    return page(1);
  }

  // Staff in the location, so an opportunity's assignedTo id can be shown as
  // a real name. Needs the users.readonly scope on the token.
  function getUsers() {
    return apiFetch('GET', '/users/?locationId=' + LOC).then(function (d) { return d.users || []; });
  }

  // Sets the opportunity's owner. Pass null to clear it. GHL returns the
  // updated opportunity, so the caller can trust the echoed value.
  function assignOpportunity(oppId, userId) {
    return apiFetch('PUT', '/opportunities/' + oppId, { assignedTo: userId || null })
      .then(function (d) { return d.opportunity; });
  }

  // Moves a job to another pipeline stage. Verified to fire the same GHL
  // workflows as dragging the card in GHL's own board, so all the stage
  // automation keeps working when the move is made from this app.
  function setOpportunityStage(oppId, stageId) {
    return apiFetch('PUT', '/opportunities/' + oppId, { pipelineStageId: stageId })
      .then(function (d) { return d.opportunity; });
  }

  function getPipelines() {
    return apiFetch('GET', '/opportunities/pipelines?locationId=' + LOC).then(function (d) { return d.pipelines || []; });
  }

  function searchContacts(query) {
    var qs = 'locationId=' + LOC + '&limit=50';
    if (query) qs += '&query=' + encodeURIComponent(query);
    return apiFetch('GET', '/contacts/?' + qs).then(function (d) { return d.contacts || []; });
  }
  function getContact(id) {
    return apiFetch('GET', '/contacts/' + id).then(function (d) { return d.contact; });
  }
  function createContact(p) {
    p.locationId = LOC;
    return apiFetch('POST', '/contacts/', p).then(function (d) { return d.contact; });
  }
  function getTags() {
    return apiFetch('GET', '/locations/' + LOC + '/tags').then(function (d) { return d.tags || []; });
  }
  // Checks whether a contact already exists matching this email/phone.
  // Returns the existing contact, or null if no match. Used by CSV import
  // to skip rows instead of silently overwriting an existing contact.
  function findDuplicateContact(email, phone) {
    var qs = 'locationId=' + LOC;
    if (email) qs += '&email=' + encodeURIComponent(email);
    if (phone) qs += '&number=' + encodeURIComponent(phone);
    if (!email && !phone) return Promise.resolve(null);
    return apiFetch('GET', '/contacts/search/duplicate?' + qs)
      .then(function (d) { return d.contact || null; })
      .catch(function () { return null; }); // treat a failed check as "no match found" rather than blocking the row
  }
  function enrollContactInWorkflow(contactId, workflowId) {
    return apiFetch('POST', '/contacts/' + contactId + '/workflow/' + workflowId, {});
  }
  function getWorkflows() {
    return apiFetch('GET', '/workflows/?locationId=' + LOC).then(function (d) { return d.workflows || []; });
  }

  window.MM.api = {
    LOC: LOC, ADDR_FIELD_ID: ADDR_FIELD_ID, A: A, PHOTO: PHOTO, VIDEO: VIDEO,
    SALES_PIPELINE_ID: SALES_PIPELINE_ID, STATUS_FIELD_IDS: STATUS_FIELD_IDS,
    oppField: oppField, fetchAllOpportunities: fetchAllOpportunities, getPipelines: getPipelines, getUsers: getUsers, assignOpportunity: assignOpportunity, setOpportunityStage: setOpportunityStage,
    rels: rels, getRec: getRec, makeRec: makeRec, updateRec: updateRec, deleteRec: deleteRec, makeRel: makeRel,
    uploadMediaFile: uploadMediaFile, createPhotoOrVideo: createPhotoOrVideo, queryMediaByField: queryMediaByField,
    deleteMedia: deleteMedia, searchJobs: searchJobs, searchContacts: searchContacts, getContact: getContact, createContact: createContact,
    getTags: getTags, findDuplicateContact: findDuplicateContact, enrollContactInWorkflow: enrollContactInWorkflow, getWorkflows: getWorkflows,
  };
})();
