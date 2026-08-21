// js/tasklists.js
// The Task Lists page — where the standard runs of work are defined.
//
// A construction business repeats the same sequence on most jobs: order the
// materials, demolish, rough in, build, finish, hand over. Rather than typing
// twenty tasks per job, the admin defines each sequence once here and applies
// it to a job in one click.
//
// A list holds stages; a stage holds tasks; each task carries how many days
// it takes, which is what turns a flat list into a real schedule when it is
// applied to a job.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var lists = [];
  var activeListId = null;
  var items = [];              // templates in the active list
  var openStages = {};         // which stages are expanded
  var pendingDelete = null;    // what the confirm box is about to remove

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function err(msg) {
    var el = document.getElementById('mm-tl-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Loading ------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-tl-body');
    if (!lists.length) el.innerHTML = '<div class="mm-empty">Loading...</div>';
    return db('GET', '/task_lists?select=*,task_templates(count)&order=position')
      .then(function (rows) {
        lists = rows || [];
        if (lists.length && !lists.some(function (l) { return l.id === activeListId; })) {
          activeListId = lists[0].id;
        }
        return activeListId ? loadItems() : null;
      })
      .then(render)
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  function loadItems() {
    return db('GET', '/task_templates?list_id=eq.' + activeListId + '&select=*&order=position')
      .then(function (rows) {
        items = rows || [];
        // First look at a list: open the first stage so the page is not a
        // row of closed bars with nothing to read.
        var stages = stageNames();
        if (stages.length && !Object.keys(openStages).length) openStages[stages[0]] = true;
      });
  }

  function stageNames() {
    var seen = [], has = {};
    items.forEach(function (t) {
      var g = t.group_name || 'Ungrouped';
      if (!has[g]) { has[g] = true; seen.push(g); }
    });
    return seen;
  }

  // ---- Rendering ----------------------------------------------------------

  function render() {
    renderTabs();
    renderBody();
  }

  function renderTabs() {
    var el = document.getElementById('mm-tl-tabs');
    if (!lists.length) { el.innerHTML = ''; return; }
    el.innerHTML = lists.map(function (l) {
      var n = (l.task_templates && l.task_templates[0] && l.task_templates[0].count) || 0;
      return '<button type="button" class="mm-filter' + (l.id === activeListId ? ' active' : '') + '"' +
        ' data-list="' + U.esc(l.id) + '">' + U.esc(l.name) +
        '<span class="mm-filter-count">' + n + '</span></button>';
    }).join('');
    el.querySelectorAll('[data-list]').forEach(function (b) {
      b.addEventListener('click', function () {
        activeListId = b.getAttribute('data-list');
        openStages = {};
        loadItems().then(render);
      });
    });
  }

  function renderBody() {
    var el = document.getElementById('mm-tl-body');

    if (!lists.length) {
      el.innerHTML =
        '<div class="mm-tl-empty">' +
          '<h2>No task lists yet</h2>' +
          '<p>A task list is the standard run of work for a type of job — a kitchen ' +
          'remodel, a bathroom, a whole house. Build it once, then add it to any job ' +
          'in one click and every task is scheduled for you.</p>' +
          '<button class="mm-btn mm-btn-primary" id="mm-tl-first">Create your first list</button>' +
        '</div>';
      document.getElementById('mm-tl-first').addEventListener('click', openNewList);
      return;
    }

    var list = lists.find(function (l) { return l.id === activeListId; });
    var stages = stageNames();
    var byStage = {};
    items.forEach(function (t) {
      var g = t.group_name || 'Ungrouped';
      (byStage[g] = byStage[g] || []).push(t);
    });

    var total = items.length;
    var days = items.reduce(function (n, t) { return n + (t.days || 1); }, 0);

    el.innerHTML =
      '<div class="mm-tl-head">' +
        '<div class="mm-tl-headmain">' +
          '<h2 class="mm-tl-name">' + U.esc(list.name) + '</h2>' +
          (list.description ? '<p class="mm-tl-desc">' + U.esc(list.description) + '</p>' : '') +
          '<div class="mm-tl-stats">' +
            '<span><strong>' + total + '</strong> task' + (total === 1 ? '' : 's') + '</span>' +
            '<span><strong>' + stages.length + '</strong> stage' + (stages.length === 1 ? '' : 's') + '</span>' +
            '<span><strong>' + days + '</strong> day' + (days === 1 ? '' : 's') + ' of work</span>' +
          '</div>' +
        '</div>' +
        '<div class="mm-tl-headbtns">' +
          '<button class="mm-btn-sm mm-btn-secondary" id="mm-tl-rename">Rename</button>' +
          '<button class="mm-btn-sm mm-btn-secondary mm-tl-dangerbtn" id="mm-tl-dellist">Delete list</button>' +
        '</div>' +
      '</div>' +

      (total
        ? '<div class="mm-acclist">' + stages.map(function (g) {
            var open = !!openStages[g];
            var rows = byStage[g];
            var gd = rows.reduce(function (n, t) { return n + (t.days || 1); }, 0);
            return '<section class="mm-agroup' + (open ? ' is-open' : '') + '">' +
              '<button type="button" class="mm-agroup-head" data-stage="' + U.esc(g) + '"' +
                ' aria-expanded="' + (open ? 'true' : 'false') + '">' +
                '<span class="mm-agroup-arrow" aria-hidden="true">&#9662;</span>' +
                '<span class="mm-agroup-text">' +
                  '<span class="mm-agroup-title">' + U.esc(g) + '</span>' +
                  '<span class="mm-agroup-hint">' + gd + ' day' + (gd === 1 ? '' : 's') + ' of work</span>' +
                '</span>' +
                '<span class="mm-agroup-count">' + rows.length + '</span>' +
              '</button>' +
              '<div class="mm-agroup-body">' + rows.map(itemRow).join('') + '</div>' +
            '</section>';
          }).join('') + '</div>'
        : '<p class="mm-task-empty">This list has no tasks yet. Add the first one below.</p>') +

      '<section class="mm-tl-add">' +
        '<h3 class="mm-tl-addtitle">Add a task to this list</h3>' +
        '<div class="mm-tl-addrow">' +
          '<input class="mm-input" id="mm-tl-new-title" placeholder="What needs doing? e.g. Install cabinets">' +
          '<input class="mm-input" id="mm-tl-new-group" list="mm-tl-stagelist" placeholder="Stage, e.g. Build">' +
          '<datalist id="mm-tl-stagelist">' +
            stages.map(function (g) { return '<option value="' + U.esc(g) + '">'; }).join('') +
          '</datalist>' +
          '<div class="mm-tl-days-wrap">' +
            '<input class="mm-input" id="mm-tl-new-days" type="number" min="1" value="1" aria-label="How many days">' +
            '<span class="mm-tl-days-label">days</span>' +
          '</div>' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-tl-add">Add task</button>' +
        '</div>' +
      '</section>';

    bindBody(el);
  }

  function itemRow(t) {
    return '<div class="mm-tl-row" data-item="' + U.esc(t.id) + '">' +
      '<input class="mm-input mm-tl-title" value="' + U.esc(t.title) + '" aria-label="Task name">' +
      '<div class="mm-tl-days-wrap">' +
        '<input class="mm-input mm-tl-days" type="number" min="1" value="' + (t.days || 1) + '" aria-label="How many days">' +
        '<span class="mm-tl-days-label">days</span>' +
      '</div>' +
      '<button type="button" class="mm-tl-del" data-del="' + U.esc(t.id) + '" ' +
        'aria-label="Remove ' + U.esc(t.title) + '">Remove</button>' +
    '</div>';
  }

  function bindBody(el) {
    el.querySelectorAll('[data-stage]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = b.getAttribute('data-stage');
        openStages[g] = !openStages[g];
        renderBody();
      });
    });

    var rn = el.querySelector('#mm-tl-rename');
    if (rn) rn.addEventListener('click', openRenameList);
    var dl = el.querySelector('#mm-tl-dellist');
    if (dl) dl.addEventListener('click', confirmDeleteList);
    var add = el.querySelector('#mm-tl-add');
    if (add) add.addEventListener('click', addItem);

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { confirmDeleteItem(b.getAttribute('data-del')); });
    });

    // Saved on blur: the admin edits a few cells and moves on, rather than
    // hunting for a save button on every row.
    el.querySelectorAll('.mm-tl-row').forEach(function (row) {
      var id = row.getAttribute('data-item');
      var title = row.querySelector('.mm-tl-title');
      var days = row.querySelector('.mm-tl-days');
      title.addEventListener('blur', function () {
        var v = title.value.trim();
        if (!v) { title.value = itemById(id).title || ''; return; }
        if (v === itemById(id).title) return;
        patchItem(id, { title: v });
      });
      days.addEventListener('blur', function () {
        var v = Math.max(1, parseInt(days.value, 10) || 1);
        days.value = v;
        if (v === (itemById(id).days || 1)) return;
        patchItem(id, { days: v });
      });
    });

    var newTitle = el.querySelector('#mm-tl-new-title');
    if (newTitle) newTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addItem(); }
    });
  }

  function itemById(id) { return items.find(function (t) { return t.id === id; }) || {}; }

  // ---- Changes ------------------------------------------------------------

  function patchItem(id, body) {
    err('');
    db('PATCH', '/task_templates?id=eq.' + id, body)
      .then(function (rows) {
        var i = items.findIndex(function (t) { return t.id === id; });
        if (i > -1 && rows && rows[0]) items[i] = rows[0];
        flash('Saved');
      })
      .catch(function (e) { err('Could not save: ' + e.message); });
  }

  function addItem() {
    var titleEl = document.getElementById('mm-tl-new-title');
    var groupEl = document.getElementById('mm-tl-new-group');
    var title = titleEl.value.trim();
    var group = groupEl.value.trim();
    var days = Math.max(1, parseInt(document.getElementById('mm-tl-new-days').value, 10) || 1);
    if (!title) { err('Give the task a name.'); titleEl.focus(); return; }
    err('');

    var pos = items.reduce(function (m, t) { return Math.max(m, t.position || 0); }, 0) + 1;
    db('POST', '/task_templates', {
      list_id: activeListId, title: title,
      group_name: group || null, days: days, position: pos,
    })
      .then(function () {
        // Keep the stage open so the new task is visible where it landed.
        if (group) openStages[group] = true;
        return load();
      })
      .then(function () {
        // The stage is kept so a run of tasks in one stage is quick to type.
        var g = document.getElementById('mm-tl-new-group');
        if (g) g.value = group;
        var t = document.getElementById('mm-tl-new-title');
        if (t) { t.value = ''; t.focus(); }
        flash('Task added');
      })
      .catch(function (e) { err('Could not add: ' + e.message); });
  }

  // ---- Dialogs ------------------------------------------------------------
  //
  // Browser prompt() and confirm() were used first and looked out of place
  // against the rest of the app. These are the same flows in the app's own
  // styling, and they can carry more than one field.

  function openNewList() {
    showListDialog({
      heading: 'New task list',
      name: '', description: '',
      save: function (name, desc) {
        var pos = lists.reduce(function (m, l) { return Math.max(m, l.position || 0); }, 0) + 1;
        return db('POST', '/task_lists', { name: name, description: desc || null, position: pos })
          .then(function (rows) {
            activeListId = rows[0].id;
            items = []; openStages = {};
            return load();
          });
      },
    });
  }

  function openRenameList() {
    var list = lists.find(function (l) { return l.id === activeListId; });
    if (!list) return;
    showListDialog({
      heading: 'Rename list',
      name: list.name, description: list.description || '',
      save: function (name, desc) {
        return db('PATCH', '/task_lists?id=eq.' + activeListId,
                  { name: name, description: desc || null }).then(load);
      },
    });
  }

  function showListDialog(opts) {
    document.getElementById('mm-ld-heading').textContent = opts.heading;
    var nameEl = document.getElementById('mm-ld-name');
    var descEl = document.getElementById('mm-ld-desc');
    nameEl.value = opts.name;
    descEl.value = opts.description;
    document.getElementById('mm-ld-error').textContent = '';

    var save = document.getElementById('mm-ld-save');
    save.disabled = false;
    save.textContent = 'Save';
    // Replace the handler rather than stacking one per open.
    save.onclick = function () {
      var name = nameEl.value.trim();
      if (!name) {
        document.getElementById('mm-ld-error').textContent = 'Give the list a name.';
        nameEl.focus();
        return;
      }
      save.disabled = true; save.textContent = 'Saving...';
      opts.save(name, descEl.value.trim())
        .then(function () {
          document.getElementById('mm-modal-listedit').classList.remove('open');
          flash('Saved');
        })
        .catch(function (e) {
          save.disabled = false; save.textContent = 'Save';
          document.getElementById('mm-ld-error').textContent = 'Could not save: ' + e.message;
        });
    };

    document.getElementById('mm-modal-listedit').classList.add('open');
    nameEl.focus();
  }

  function confirmDeleteList() {
    var list = lists.find(function (l) { return l.id === activeListId; });
    if (!list) return;
    showConfirm({
      heading: 'Delete this list?',
      // Spelled out because deleting a list takes its tasks with it, and the
      // reassurance about existing jobs is the thing people worry about.
      body: 'This removes "' + list.name + '" and its ' + items.length +
            ' task' + (items.length === 1 ? '' : 's') +
            '. Jobs that already use it keep the tasks they were given.',
      confirmLabel: 'Delete list',
      run: function () {
        return db('DELETE', '/task_lists?id=eq.' + activeListId)
          .then(function () { activeListId = null; items = []; openStages = {}; return load(); });
      },
    });
  }

  function confirmDeleteItem(id) {
    var t = itemById(id);
    showConfirm({
      heading: 'Remove this task?',
      body: '"' + (t.title || 'This task') + '" will be removed from the list.',
      confirmLabel: 'Remove',
      run: function () {
        return db('DELETE', '/task_templates?id=eq.' + id).then(load);
      },
    });
  }

  function showConfirm(opts) {
    pendingDelete = opts;
    document.getElementById('mm-cf-heading').textContent = opts.heading;
    document.getElementById('mm-cf-body').textContent = opts.body;
    var go = document.getElementById('mm-cf-go');
    go.textContent = opts.confirmLabel;
    go.disabled = false;
    document.getElementById('mm-cf-error').textContent = '';
    document.getElementById('mm-modal-confirm').classList.add('open');
    go.focus();
  }

  function runConfirm() {
    if (!pendingDelete) return;
    var go = document.getElementById('mm-cf-go');
    go.disabled = true; go.textContent = 'Working...';
    pendingDelete.run()
      .then(function () {
        document.getElementById('mm-modal-confirm').classList.remove('open');
        pendingDelete = null;
        flash('Done');
      })
      .catch(function (e) {
        go.disabled = false; go.textContent = 'Try again';
        document.getElementById('mm-cf-error').textContent = e.message;
      });
  }

  // A quiet confirmation that a blur-save landed, since there is no button
  // press to acknowledge it.
  var flashTimer = null;
  function flash(msg) {
    var el = document.getElementById('mm-tl-saved');
    if (!el) return;
    el.textContent = msg || 'Saved';
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('show'); }, 1500);
  }

  function init() {
    document.getElementById('mm-tl-newlist').addEventListener('click', openNewList);

    document.getElementById('mm-ld-cancel').addEventListener('click', function () {
      document.getElementById('mm-modal-listedit').classList.remove('open');
    });
    document.getElementById('mm-modal-listedit').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.getElementById('mm-ld-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('mm-ld-save').click();
    });

    document.getElementById('mm-cf-go').addEventListener('click', runConfirm);
    document.getElementById('mm-cf-cancel').addEventListener('click', function () {
      document.getElementById('mm-modal-confirm').classList.remove('open');
      pendingDelete = null;
    });
    document.getElementById('mm-modal-confirm').addEventListener('click', function (e) {
      if (e.target === this) { this.classList.remove('open'); pendingDelete = null; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.getElementById('mm-modal-listedit').classList.remove('open');
      document.getElementById('mm-modal-confirm').classList.remove('open');
      pendingDelete = null;
    });
  }

  window.MM.tasklists = { init: init, load: load };
})();
