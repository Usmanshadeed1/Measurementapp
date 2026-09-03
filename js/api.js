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

  // Date fields that drive the job's progress. Entering one is what moves
  // the work forward, so they are read and written the same way as the
  // status dropdowns.
  var DATE_FIELD_IDS = {
    appointment: 'MIs9bBh66P2gsXjDNfOQ',   // when the visit is booked for
    measured: 'iM2aDumKi2NctsUP80bd',      // when measuring was finished
    design: 'nZtlNKXw54QNcDFZLUhc',        // when the design was finished
    pricing: 'ZwMwQt4rCYOvxzYfTdPu',       // when pricing was finished
    proposalSent: 'wwLRthpRhQLmMcSOLnaH',  // when the proposal went to the customer
    cabinets: 'IPuLmeNR8jrtQ41gO3RF',      // after the sale: cabinets ordered
    completed: 'rrzfNKhLCYfDVq5v0ZLq',     // the job is finished and archived
  };

  // Stage a job moves to once measuring is done. WF-2 fires on arrival here
  // and creates the design / pricing / meeting tasks.
  // Each progress step moves the job to its matching stage, so the stage
  // name and the step name are always the same thing. Renaming a stage in
  // GHL keeps its id, so these stay valid — only adding or deleting a stage
  // needs a change here.
  var STAGE = {
    newLead:      '388a6d1b-15dd-4146-ac7d-caa1c3e07deb',
    apptBooked:   'f7bb3e4e-82e9-4617-96a9-d6a8bb52d7e3',  // Measurement Appointment
    measured:     '4c348bc2-30b5-4b41-a7aa-c6e299f4b062',  // Measurement Complete
    design:       '5abda84b-8753-436f-8d4d-34d93620f5f0',  // Design Complete
    pricing:      'ba83959c-dd8e-47bc-8cb0-a1e78944ef13',  // Pricing Complete
    designMeeting:'eb7eca8c-db5c-4df7-a766-2366d240d469',
    revision:     'c1d6ee95-7275-4f50-b3a0-be4744923131',
    proposalSent: 'a3e8f945-415a-442f-bf60-050a62d4dc54',
    won:          '846384b2-f083-4189-9736-4a9de34ba4d0',  // Hired Maximus
    dead:         'a94ddd00-0d94-4eab-9c86-f52b1be45157',
    materials:    'c0c28c4a-599c-4f38-86cc-9accd2a6f199',  // Material Ordering
    completed:    '0c1d4f66-c120-4e1a-9b51-e886bdd69d0e',  // Job Completed
  };

  // Kept as named exports because several modules read them directly.
  var STAGE_AFTER_MEASURED = STAGE.measured;
  var STAGE_AFTER_PRICING = STAGE.pricing;
  var STAGE_PROPOSAL_SENT = STAGE.proposalSent;
  var STAGE_MATERIAL_ORDERING = STAGE.materials;
  var STAGE_WON = STAGE.won;
  var STAGE_DEAD = STAGE.dead;
  var STAGE_COMPLETED = STAGE.completed;

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

  // Vercel refuses any request body over 4.5MB, and every upload goes through
  // the proxy so the API token stays server-side. The platform returns a raw
  // FUNCTION_PAYLOAD_TOO_LARGE page for those, which told the user nothing, so
  // the size is checked here and explained in plain words instead.
  var MAX_UPLOAD_MB = 4.4;

  function uploadMediaFile(file) {
    if (file && file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      var mb = (file.size / (1024 * 1024)).toFixed(1);
      return Promise.reject(new Error(
        'This file is ' + mb + 'MB. The largest that can be uploaded is ' +
        MAX_UPLOAD_MB + 'MB.' + String.fromCharCode(10, 10) +
        'For a video, record a shorter clip or use your ' +
        'phone’s lower quality setting, then try again.'
      ));
    }
    var fd = new FormData();
    fd.append('file', file);
    fd.append('locationId', LOC);
    return fetch('/api/medias/upload-file', { method: 'POST', body: fd })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            // The platform's own rejection, if a file slips past the check above.
            if (r.status === 413 || /PAYLOAD_TOO_LARGE/i.test(t)) {
              throw new Error('That file is too large to upload. The limit is ' +
                MAX_UPLOAD_MB + 'MB.');
            }
            throw new Error(t);
          });
        }
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

  // GHL's record search has no server-side filter for these custom fields, so
  // every record is fetched and matched here. It pages through rather than
  // reading the first 100: once the account passes that many photos, a plain
  // single-page read would silently drop the older ones.
  function queryMediaByField(type, fieldKey, fieldValue) {
    var out = [];

    function page(n) {
      return apiFetch('POST', '/objects/' + type + '/records/search',
                      { locationId: LOC, page: n, pageLimit: 100 })
        .then(function (d) {
          var recs = d.records || d.data || [];
          if (!Array.isArray(recs)) return out;
          recs.forEach(function (r) {
            if (r.properties && r.properties[fieldKey] === fieldValue) out.push(r);
          });
          // A short page means the end; the cap stops a runaway loop if the
          // API ever keeps returning full pages.
          if (recs.length < 100 || n >= 20) return out;
          return page(n + 1);
        });
    }

    return page(1)
      .catch(function (e) { console.log('Search failed for ' + type + ':', e.message); return out; });
  }

  function deleteMedia(type, id) { return deleteRec(type, id); }

  // Reads one custom field off an opportunity by field id. GHL returns the
  // dropdown's visible label (e.g. "Pending") in fieldValueString, not an
  // internal option id — so the value can be compared/displayed directly.
  // GHL names the value differently depending on the endpoint AND the field
  // type — dropdowns come back as fieldValueString from search but fieldValue
  // from a direct GET, and dates come back as fieldValueDate (epoch millis)
  // from search but an ISO string from GET. All four shapes are normalised
  // here to a plain string so callers never have to care which call produced
  // the record.
  function oppField(o, fieldId) {
    var f = (o.customFields || []).find(function (x) { return x.id === fieldId; });
    if (!f) return '';
    if (f.fieldValueDate !== undefined && f.fieldValueDate !== null && f.fieldValueDate !== '') {
      var d = new Date(typeof f.fieldValueDate === 'number' ? f.fieldValueDate : String(f.fieldValueDate));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    var v = f.fieldValueString;
    if (v === undefined || v === null || v === '') v = f.fieldValue;
    return (v === undefined || v === null) ? '' : String(v);
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

  // Creates a job in New Lead with its Property Address already filled — the
  // field most existing jobs are missing, because they predate the workflow
  // action that sets it.
  function createOpportunity(fields) {
    var body = {
      locationId: LOC,
      pipelineId: SALES_PIPELINE_ID,
      pipelineStageId: STAGE.newLead,
      status: 'open',
      name: fields.name,
      contactId: fields.contactId,
    };
    return apiFetch('POST', '/opportunities/', body)
      .then(function (d) {
        var opp = d.opportunity;
        if (!fields.address || !opp) return opp;
        // The address is a custom field, so it is a second call — but doing
        // it here means every job made in the app has one from the start.
        return setOpportunityField(opp.id, ADDR_FIELD_ID, fields.address)
          .then(function () { return opp; })
          .catch(function () { return opp; });
      });
  }

  // Moves a job to another pipeline stage. Verified to fire the same GHL
  // workflows as dragging the card in GHL's own board, so all the stage
  // automation keeps working when the move is made from this app.
  function setOpportunityStage(oppId, stageId) {
    return apiFetch('PUT', '/opportunities/' + oppId, { pipelineStageId: stageId })
      .then(function (d) { return d.opportunity; });
  }

  // Renames an opportunity. A job is titled "Customer - Address", so this is
  // needed whenever either half is corrected.
  function renameOpportunity(oppId, name) {
    return apiFetch('PUT', '/opportunities/' + oppId, { name: name })
      .then(function (d) { return d.opportunity; });
  }

  // Writes one custom field on an opportunity. GHL expects customFields as an
  // array of { id, value }; other fields on the record are left untouched.
  // Note the asymmetry: writes take `value`, but reads come back as
  // `fieldValue` (dates) or `fieldValueString` (dropdowns) — oppField()
  // handles both.
  function setOpportunityField(oppId, fieldId, value) {
    return apiFetch('PUT', '/opportunities/' + oppId, {
      customFields: [{ id: fieldId, value: value || '' }],
    }).then(function (d) { return d.opportunity; });
  }

  // A single opportunity, read directly. Unlike /opportunities/search this
  // is not behind an index, so it reflects a write immediately.
  function getOpportunity(oppId) {
    return apiFetch('GET', '/opportunities/' + oppId).then(function (d) { return d.opportunity; });
  }

  // Notes are created through the contact endpoint, but a `relations` array
  // ties each one to a specific opportunity — so two jobs for the same
  // customer keep their own notes. There is no /opportunities/{id}/notes
  // endpoint; this array is how GHL itself links them.
  function getNotes(contactId, oppId) {
    return apiFetch('GET', '/contacts/' + contactId + '/notes')
      .then(function (d) {
        var all = d.notes || [];
        if (!oppId) return all;
        return all.filter(function (n) {
          return (n.relations || []).some(function (r) {
            return r.objectKey === 'opportunity' && r.recordId === oppId;
          });
        });
      });
  }
  function addNote(contactId, body, oppId) {
    var payload = { body: body };
    if (oppId) payload.relations = [{ objectKey: 'opportunity', recordId: oppId }];
    return apiFetch('POST', '/contacts/' + contactId + '/notes', payload)
      .then(function (d) { return d.note; });
  }
  function deleteNote(contactId, noteId) {
    return apiFetch('DELETE', '/contacts/' + contactId + '/notes/' + noteId);
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
  // Updates a contact in GHL. Only the fields passed are changed — anything
  // omitted is left as it was, so a partial edit cannot wipe other details.
  function updateContact(contactId, fields) {
    return apiFetch('PUT', '/contacts/' + contactId, fields)
      .then(function (d) { return d.contact; });
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
    DATE_FIELD_IDS: DATE_FIELD_IDS, STAGE_AFTER_MEASURED: STAGE_AFTER_MEASURED,
    STAGE_AFTER_PRICING: STAGE_AFTER_PRICING, STAGE_PROPOSAL_SENT: STAGE_PROPOSAL_SENT,
    STAGE_MATERIAL_ORDERING: STAGE_MATERIAL_ORDERING, STAGE_WON: STAGE_WON, STAGE_DEAD: STAGE_DEAD,
    STAGE_COMPLETED: STAGE_COMPLETED, STAGE: STAGE,
    oppField: oppField, fetchAllOpportunities: fetchAllOpportunities, getPipelines: getPipelines, getUsers: getUsers, assignOpportunity: assignOpportunity, setOpportunityStage: setOpportunityStage, createOpportunity: createOpportunity, setOpportunityField: setOpportunityField, renameOpportunity: renameOpportunity, getOpportunity: getOpportunity, getNotes: getNotes, addNote: addNote, deleteNote: deleteNote,
    rels: rels, getRec: getRec, makeRec: makeRec, updateRec: updateRec, deleteRec: deleteRec, makeRel: makeRel,
    uploadMediaFile: uploadMediaFile, createPhotoOrVideo: createPhotoOrVideo, queryMediaByField: queryMediaByField,
    deleteMedia: deleteMedia, searchContacts: searchContacts, getContact: getContact, createContact: createContact, updateContact: updateContact,
    getTags: getTags, findDuplicateContact: findDuplicateContact, enrollContactInWorkflow: enrollContactInWorkflow, getWorkflows: getWorkflows,
  };
})();
