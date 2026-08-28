// js/templates.js
// Task templates: a list of tasks saved once and loaded into any job.
//
// A remodel runs through the same twenty stages every time — demo, framing,
// rough plumbing, drywall, paint. Typing those into every job is the work this
// removes.
//
// Loading a template COPIES its tasks onto the job. Editing them there — new
// dates, a different worker, an extra step — never touches the template, so
// the saved list stays clean for the next job.
//
// Templates live in Supabase rather than GoHighLevel: they belong to the
// business, not to any one customer, so there is no opportunity to attach
// them to.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var rows = [];
  var editing = null;    // template being edited, or null
  var adding = false;

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  // ---- Loading -------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-tt-body');
    if (!el) return Promise.resolve();
    el.innerHTML = '<div class="mm-empty">Loading...</div>';

    return db('GET', '/task_templates_v2?select=*&active=eq.true&order=position,name')
      .then(function (r) {
        rows = r || [];
        render();
      })
      .catch(function (e) {
        el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  // Read once and handed to the job screen, which does the copying.
  function all() { return rows.slice(); }

  // ---- The text format -----------------------------------------------------
  //
  // A template is written as plain lines, because that is how someone actually
  // thinks about a job: one stage per line, indented lines for the steps
  // inside a stage.
  //
  //   Demo
  //     - Kitchen
  //     - Bathroom
  //   Framing

  function parseTasks(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var isSub = /^[\s]+/.test(raw) || /^-/.test(raw.trim());
      var clean = raw.trim().replace(/^-\s*/, '');
      if (!clean) return;
      if (isSub && out.length) out[out.length - 1].items.push(clean);
      else out.push({ title: clean, items: [] });
    });
    return out;
  }

  function tasksToText(tasks) {
    return (tasks || []).map(function (t) {
      var line = t.title;
      (t.items || []).forEach(function (i) { line += '\n  - ' + i; });
      return line;
    }).join('\n');
  }

  function countTasks(t) {
    var tasks = t.tasks || [];
    var items = 0;
    tasks.forEach(function (x) { items += (x.items || []).length; });
    return tasks.length + (tasks.length === 1 ? ' task' : ' tasks') +
      (items ? ', ' + items + ' step' + (items === 1 ? '' : 's') : '');
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var el = document.getElementById('mm-tt-body');
    if (!el) return;

    el.innerHTML =
      (adding || editing ? formBox() : '') +
      (rows.length
        ? '<div class="mm-tt-list">' + rows.map(card).join('') + '</div>'
        : (adding ? '' : emptyState())) +
      '<p class="mm-task-error" id="mm-tt-error" role="alert"></p>';

    bind(el);
  }

  function emptyState() {
    return '<div class="mm-tt-empty">' +
      '<p class="mm-tt-empty-title">No templates yet</p>' +
      '<p class="mm-tt-empty-sub">Build a list once — the stages of a remodel, ' +
      'say — then load it onto any job in one tap.</p></div>';
  }

  function card(t) {
    var tasks = t.tasks || [];
    return '<div class="mm-tt">' +
      '<div class="mm-tt-head">' +
        '<div class="mm-tt-main">' +
          '<div class="mm-tt-name">' + U.esc(t.name) + '</div>' +
          '<div class="mm-tt-count">' + U.esc(countTasks(t)) + '</div>' +
          (t.description
            ? '<div class="mm-tt-desc">' + U.esc(t.description) + '</div>' : '') +
        '</div>' +
        '<div class="mm-tt-side">' +
          '<button type="button" class="mm-tt-icon" data-edit="' + U.esc(t.id) + '" ' +
            'aria-label="Edit ' + U.esc(t.name) + '">&#9998;</button>' +
          '<button type="button" class="mm-tt-icon mm-tt-del" data-del="' + U.esc(t.id) + '" ' +
            'aria-label="Delete ' + U.esc(t.name) + '">&times;</button>' +
        '</div>' +
      '</div>' +
      (tasks.length
        ? '<ol class="mm-tt-tasks">' +
            tasks.map(function (x) {
              return '<li>' + U.esc(x.title) +
                ((x.items || []).length
                  ? '<span class="mm-tt-steps">' +
                    (x.items || []).map(function (i) {
                      return '<span class="mm-tt-step">' + U.esc(i) + '</span>';
                    }).join('') + '</span>'
                  : '') +
              '</li>';
            }).join('') +
          '</ol>'
        : '') +
    '</div>';
  }

  function formBox() {
    var t = editing || { name: '', description: '', tasks: [] };
    return '<div class="mm-tt-form">' +
      '<h3 class="mm-tt-formtitle">' +
        (editing ? 'Edit template' : 'New template') + '</h3>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-tt-name">Name</label>' +
        '<input class="mm-input" id="mm-tt-name" placeholder="e.g. Kitchen Remodel" ' +
          'value="' + U.esc(t.name || '') + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-tt-desc">Description ' +
          '<span class="mm-opt">(optional)</span></label>' +
        '<input class="mm-input" id="mm-tt-desc" ' +
          'placeholder="When to use this one" ' +
          'value="' + U.esc(t.description || '') + '">' +
      '</div>' +

      '<div class="mm-field-group">' +
        '<label class="mm-label" for="mm-tt-tasks">Tasks ' +
          '<span class="mm-opt">(one per line)</span></label>' +
        '<textarea class="mm-input mm-tt-area" id="mm-tt-tasks" rows="12" ' +
          'placeholder="Demo&#10;Framing&#10;Rough Plumbing">' +
          U.esc(tasksToText(t.tasks)) +
        '</textarea>' +
        '<p class="mm-tt-hint">Indent a line to make it a step inside the task ' +
          'above it:<br><code>Demo</code><br><code>&nbsp;&nbsp;- Kitchen</code>' +
          '<br><code>&nbsp;&nbsp;- Bathroom</code></p>' +
      '</div>' +

      '<div class="mm-btn-row">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-tt-cancel">Cancel</button>' +
        '<button class="mm-btn-sm mm-btn-primary" id="mm-tt-save">' +
          (editing ? 'Save changes' : 'Create template') + '</button>' +
      '</div>' +
    '</div>';
  }

  function showError(msg) {
    var el = document.getElementById('mm-tt-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Actions -------------------------------------------------------------

  function bind(el) {
    var cancel = el.querySelector('#mm-tt-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      adding = false; editing = null; render();
    });

    var save = el.querySelector('#mm-tt-save');
    if (save) save.addEventListener('click', saveTemplate);

    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        editing = rows.find(function (r) { return r.id === b.getAttribute('data-edit'); });
        adding = false;
        render();
      });
    });

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { removeTemplate(b.getAttribute('data-del'), b); });
    });
  }

  function saveTemplate() {
    var btn = document.getElementById('mm-tt-save');
    var name = (document.getElementById('mm-tt-name').value || '').trim();
    if (!name) {
      showError('Give the template a name.');
      document.getElementById('mm-tt-name').focus();
      return;
    }

    var tasks = parseTasks(document.getElementById('mm-tt-tasks').value);
    if (!tasks.length) {
      showError('Add at least one task.');
      document.getElementById('mm-tt-tasks').focus();
      return;
    }

    var body = {
      name: name,
      description: (document.getElementById('mm-tt-desc').value || '').trim() || null,
      tasks: tasks,
    };

    showError('');
    btn.disabled = true; btn.textContent = 'Saving...';

    var req = editing
      ? db('PATCH', '/task_templates_v2?id=eq.' + encodeURIComponent(editing.id), body)
      : db('POST', '/task_templates_v2', body);

    req.then(function () {
      window.MM.activity.log('list_added',
        (editing ? 'Updated template ' : 'Created template ') + name, {});
      adding = false; editing = null;
      return load();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = editing ? 'Save changes' : 'Create template';
      showError('Could not save: ' + e.message);
    });
  }

  // Marked inactive rather than deleted, so a template can be brought back
  // and nothing referencing it breaks.
  function removeTemplate(id, btn) {
    var t = rows.find(function (r) { return r.id === id; });
    btn.disabled = true;
    showError('');
    db('PATCH', '/task_templates_v2?id=eq.' + encodeURIComponent(id), { active: false })
      .then(function () {
        window.MM.activity.log('list_added', 'Deleted template ' + (t ? t.name : ''), {});
        return load();
      })
      .catch(function (e) {
        btn.disabled = false;
        showError('Could not delete: ' + e.message);
      });
  }

  function init() {
    var add = document.getElementById('mm-tt-add');
    if (add) add.addEventListener('click', function () {
      adding = true; editing = null; render();
      var f = document.getElementById('mm-tt-name');
      if (f) f.focus();
    });
  }

  window.MM.templates = { init: init, load: load, all: all };
})();
