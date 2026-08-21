// js/tasklists.js
// The Task Lists page — where the standard runs of work are defined.
//
// A construction business repeats the same sequence on most jobs: order the
// materials, demolish, rough in, build, finish, hand over. Rather than typing
// twenty tasks per job, the admin defines each sequence once here and applies
// it to a job in one click.
//
// A list holds groups (stages of work); a group holds tasks; each task
// carries how many days it takes, which is what turns the list into a real
// schedule when it is applied.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var lists = [];
  var activeListId = null;
  var items = [];        // templates in the active list

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function err(msg) {
    var el = document.getElementById('mm-tl-error');
    if (el) el.textContent = msg || '';
  }

  // ---- Loading ------------------------------------------------------------

  function load() {
    var el = document.getElementById('mm-tl-body');
    el.innerHTML = '<div class="mm-empty">Loading...</div>';
    return db('GET', '/task_lists?select=*,task_templates(count)&order=position')
      .then(function (rows) {
        lists = rows || [];
        if (!activeListId && lists.length) activeListId = lists[0].id;
        return activeListId ? loadItems() : null;
      })
      .then(render)
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  function loadItems() {
    return db('GET', '/task_templates?list_id=eq.' + activeListId + '&select=*&order=position')
      .then(function (rows) { items = rows || []; });
  }

  // ---- Rendering ----------------------------------------------------------

  function render() {
    renderTabs();
    renderItems();
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
        loadItems().then(render);
      });
    });
  }

  function renderItems() {
    var el = document.getElementById('mm-tl-body');
    var list = lists.find(function (l) { return l.id === activeListId; });

    if (!lists.length) {
      el.innerHTML = '<div class="mm-tl-empty">' +
        '<h2>No task lists yet</h2>' +
        '<p>A task list is the standard run of work for a type of job — a kitchen remodel, a bathroom, a whole house. Create one, add the stages and tasks, then apply it to any job in one click.</p>' +
        '<button class="mm-btn mm-btn-primary" id="mm-tl-first">Create your first list</button></div>';
      var b = document.getElementById('mm-tl-first');
      if (b) b.addEventListener('click', newList);
      return;
    }

    // Group the tasks under their stage headings, in list order.
    var groups = [], byName = {};
    items.forEach(function (t) {
      var g = t.group_name || 'Ungrouped';
      if (!byName[g]) { byName[g] = []; groups.push(g); }
      byName[g].push(t);
    });

    var total = items.length;
    var days = items.reduce(function (n, t) { return n + (t.days || 1); }, 0);

    el.innerHTML =
      '<div class="mm-tl-head">' +
        '<div>' +
          '<h2 class="mm-tl-name">' + U.esc(list.name) + '</h2>' +
          (list.description ? '<p class="mm-tl-desc">' + U.esc(list.description) + '</p>' : '') +
        '</div>' +
        '<div class="mm-tl-stats">' +
          '<span><strong>' + total + '</strong> task' + (total === 1 ? '' : 's') + '</span>' +
          '<span><strong>' + days + '</strong> day' + (days === 1 ? '' : 's') + ' of work</span>' +
        '</div>' +
      '</div>' +
      '<div class="mm-tl-toolbar">' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-tl-rename">Rename this list</button>' +
        '<button class="mm-btn-sm mm-btn-secondary" id="mm-tl-dellist">Delete this list</button>' +
      '</div>' +
      (total
        ? groups.map(function (g) {
            return '<section class="mm-tl-group">' +
              '<div class="mm-tl-group-head">' +
                '<h3 class="mm-tl-group-name">' + U.esc(g) + '</h3>' +
                '<span class="mm-tl-group-count">' + byName[g].length + '</span>' +
              '</div>' +
              byName[g].map(itemRow).join('') +
            '</section>';
          }).join('')
        : '<p class="mm-task-empty">This list has no tasks yet. Add the first one below.</p>') +
      '<section class="mm-tl-add">' +
        '<h3 class="mm-tl-group-name">Add a task</h3>' +
        '<div class="mm-tl-addrow">' +
          '<input class="mm-input" id="mm-tl-new-title" placeholder="What needs doing? e.g. Install cabinets">' +
          '<input class="mm-input" id="mm-tl-new-group" list="mm-tl-groups" placeholder="Stage, e.g. Build">' +
          '<datalist id="mm-tl-groups">' +
            groups.map(function (g) { return '<option value="' + U.esc(g) + '">'; }).join('') +
          '</datalist>' +
          '<div class="mm-tl-days-wrap">' +
            '<input class="mm-input" id="mm-tl-new-days" type="number" min="1" value="1" aria-label="How many days">' +
            '<span class="mm-tl-days-label">days</span>' +
          '</div>' +
          '<button class="mm-btn-sm mm-btn-primary" id="mm-tl-add">Add task</button>' +
        '</div>' +
      '</section>';

    bindItems(el);
  }

  function itemRow(t) {
    return '<div class="mm-tl-row" data-item="' + U.esc(t.id) + '">' +
      '<span class="mm-tl-grip" aria-hidden="true">&#8942;&#8942;</span>' +
      '<input class="mm-input mm-tl-title" value="' + U.esc(t.title) + '" aria-label="Task name">' +
      '<div class="mm-tl-days-wrap">' +
        '<input class="mm-input mm-tl-days" type="number" min="1" value="' + (t.days || 1) + '" aria-label="How many days">' +
        '<span class="mm-tl-days-label">days</span>' +
      '</div>' +
      '<button type="button" class="mm-tl-del" data-del="' + U.esc(t.id) + '" ' +
        'aria-label="Remove ' + U.esc(t.title) + '">Remove</button>' +
    '</div>';
  }

  function bindItems(el) {
    var rn = el.querySelector('#mm-tl-rename');
    if (rn) rn.addEventListener('click', renameList);
    var dl = el.querySelector('#mm-tl-dellist');
    if (dl) dl.addEventListener('click', deleteList);
    var add = el.querySelector('#mm-tl-add');
    if (add) add.addEventListener('click', addItem);

    el.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { deleteItem(b.getAttribute('data-del')); });
    });

    // Saved on blur: the admin edits a few cells and moves on, rather than
    // hunting for a save button per row.
    el.querySelectorAll('.mm-tl-row').forEach(function (row) {
      var id = row.getAttribute('data-item');
      var title = row.querySelector('.mm-tl-title');
      var days = row.querySelector('.mm-tl-days');
      title.addEventListener('blur', function () {
        var v = title.value.trim();
        if (!v) { title.value = itemById(id).title; return; }
        patchItem(id, { title: v });
      });
      days.addEventListener('blur', function () {
        patchItem(id, { days: Math.max(1, parseInt(days.value, 10) || 1) });
      });
    });

    var newTitle = el.querySelector('#mm-tl-new-title');
    if (newTitle) newTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addItem();
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
        flash();
      })
      .catch(function (e) { err('Could not save: ' + e.message); });
  }

  function addItem() {
    var title = document.getElementById('mm-tl-new-title').value.trim();
    var group = document.getElementById('mm-tl-new-group').value.trim();
    var days = Math.max(1, parseInt(document.getElementById('mm-tl-new-days').value, 10) || 1);
    if (!title) { err('Give the task a name.'); return; }
    err('');
    var pos = items.reduce(function (m, t) { return Math.max(m, t.position || 0); }, 0) + 1;
    db('POST', '/task_templates', {
      list_id: activeListId, title: title,
      group_name: group || null, days: days, position: pos,
    })
      .then(function () { return load(); })
      .then(function () {
        // Keep the stage so a run of tasks in the same stage is quick to type.
        var g = document.getElementById('mm-tl-new-group');
        if (g) g.value = group;
        var t = document.getElementById('mm-tl-new-title');
        if (t) t.focus();
      })
      .catch(function (e) { err('Could not add: ' + e.message); });
  }

  function deleteItem(id) {
    err('');
    db('DELETE', '/task_templates?id=eq.' + id)
      .then(function () {
        items = items.filter(function (t) { return t.id !== id; });
        return load();
      })
      .catch(function (e) { err('Could not remove: ' + e.message); });
  }

  function newList() {
    var name = prompt('What is this list for? e.g. Kitchen remodel');
    if (!name || !name.trim()) return;
    err('');
    var pos = lists.reduce(function (m, l) { return Math.max(m, l.position || 0); }, 0) + 1;
    db('POST', '/task_lists', { name: name.trim(), position: pos })
      .then(function (rows) { activeListId = rows[0].id; items = []; return load(); })
      .catch(function (e) { err('Could not create the list: ' + e.message); });
  }

  function renameList() {
    var list = lists.find(function (l) { return l.id === activeListId; });
    if (!list) return;
    var name = prompt('Name for this list', list.name);
    if (!name || !name.trim()) return;
    db('PATCH', '/task_lists?id=eq.' + activeListId, { name: name.trim() })
      .then(load)
      .catch(function (e) { err('Could not rename: ' + e.message); });
  }

  function deleteList() {
    var list = lists.find(function (l) { return l.id === activeListId; });
    if (!list) return;
    // Deleting a list takes its tasks with it, so the count is spelled out.
    if (!confirm('Delete "' + list.name + '" and its ' + items.length +
                 ' task' + (items.length === 1 ? '' : 's') +
                 '?\n\nJobs already using it keep their tasks.')) return;
    db('DELETE', '/task_lists?id=eq.' + activeListId)
      .then(function () { activeListId = null; items = []; return load(); })
      .catch(function (e) { err('Could not delete: ' + e.message); });
  }

  // A quiet confirmation that a blur-save landed, since there is no button
  // press to acknowledge.
  var flashTimer = null;
  function flash() {
    var el = document.getElementById('mm-tl-saved');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('show'); }, 1400);
  }

  function init() {
    document.getElementById('mm-tl-newlist').addEventListener('click', newList);
  }

  window.MM.tasklists = { init: init, load: load };
})();
