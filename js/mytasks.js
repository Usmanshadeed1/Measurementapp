// js/mytasks.js
// The Tasks page: every task, grouped by job and then by date.
//
// Grouped by job because that is how the client reads the work -- "what is
// left on this job" -- with the dates inside, earliest first, so each job
// still reads in the order it will happen.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, auth = window.MM.auth;

  var rows = [];
  var jobsById = {};   // every job the tasks came from, for opening one

  // What is narrowing the list. Unfinished work is the default view -- what
  // the client asked to land on; finished tasks are one filter away.
  var filters = { worker: '', job: '', show: 'open', search: '', when: '' };
  var workerDefaulted = false;   // a worker is filtered to themselves once

  function db(method, path, body) { return auth.dbFetch(method, path, body); }

  function todayStr() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function daysTo(dateStr) {
    if (!dateStr) return null;
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date(todayStr() + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }
  // The date a task is judged by: its finish date, or its start date when it
  // has no finish. Many tasks here carry only a start -- judging those by the
  // finish alone put a task starting today under "No date set", which is both
  // wrong and invisible to the Today filter.
  //
  // One definition, used by the groups and the filter alike, so the two can
  // never disagree about what "today" means.
  function taskDay(t) {
    return t.end || t.start || '';
  }

  function fmt(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }


  var myJobs = [];

  function load() {
    var el = document.getElementById('mm-my-body');
    el.innerHTML = '<div class="mm-empty">Loading tasks...</div>';
    var me = auth.user();
    if (!me) return Promise.resolve();

    // Every job is fetched once and used for both halves of this screen. It
    // used to be fetched twice in parallel — once for the tasks, once for the
    // job list — which doubled the wait for no benefit.
    return Promise.all([
      window.MM.api.fetchAllOpportunities(),
      window.MM.jobaccess.loadMine(),
      // Names for the worker filter. A failure here must not cost the page
      // its tasks, so it resolves either way.
      window.MM.workerlist.load().catch(function () { return null; }),
    ])
      .then(function (res) {
        var ops = (res[0] || []).filter(function (o) {
          return o.pipelineId === window.MM.api.SALES_PIPELINE_ID;
        });

        jobsById = {};
        ops.forEach(function (o) { jobsById[o.id] = o; });

        // Every task on every job. This page used to show only your own,
        // which left an admin -- who assigns work rather than doing it --
        // looking at an empty screen while the work sat elsewhere.
        //
        // A worker still opens on their own tasks: the worker filter is set
        // to their name the first time they arrive. They can clear it and see
        // everyone's, which is what the client asked for.
        rows = window.MM.ghltasks.tasksFromJobs(ops);

        if (!auth.isAdmin() && !workerDefaulted) {
          filters.worker = me.name || '';
          workerDefaulted = true;
        }

        // Not built for an admin at all: the list is not shown to them, and
        // filtering every job for nothing is wasted work.
        myJobs = auth.isAdmin() ? [] : window.MM.jobaccess.mineOnly(ops);

        fillFilterOptions();
        render();
        renderJobs();
      })
      .catch(function (e) { el.innerHTML = '<div class="mm-empty">' + U.esc(e.message) + '</div>'; });
  }

  // The jobs themselves come from GHL, filtered to the ones this worker is
  // allowed to open.
  function renderJobs() {
    var el = document.getElementById('mm-my-jobs');
    if (!el) return;
    // Workers only. This list is a worker's only route into a job — they are
    // sent to measure a property before any task exists. An admin reaches
    // every job from the dashboard, so here it is just the same list twice.
    if (auth.isAdmin()) { el.innerHTML = ''; return; }
    if (!myJobs.length) { el.innerHTML = ''; return; }

    el.innerHTML =
      '<section class="mm-mygroup">' +
        '<div class="mm-mygroup-head">' +
          '<h3 class="mm-mygroup-title">My jobs</h3>' +
          '<span class="mm-mygroup-count">' + myJobs.length + '</span>' +
        '</div>' +
        '<p class="mm-crew-note">Open a job to take measurements or record a date.</p>' +
        myJobs.map(function (o) {
          var name = (o.contact && o.contact.name) || o.name || 'Job';
          var addr = window.MM.api.jobAddressLine(o);
          return '<button type="button" class="mm-myjob" data-job="' + U.esc(o.id) + '">' +
            '<span class="mm-myjob-main">' +
              '<span class="mm-myjob-name">' + U.esc(name) + '</span>' +
              '<span class="mm-myjob-addr">' + U.esc(addr || 'No address on file') + '</span>' +
            '</span>' +
            '<span class="mm-jcard-arrow" aria-hidden="true">&#8250;</span>' +
          '</button>';
        }).join('') +
      '</section>';

    el.querySelectorAll('[data-job]').forEach(function (b) {
      b.addEventListener('click', function () {
        var o = myJobs.find(function (j) { return j.id === b.getAttribute('data-job'); });
        if (o && onOpenJob) onOpenJob(o);
      });
    });
  }

  var onOpenJob = null;

  // A task survives every filter that is set. Search looks at the task, its
  // job and whoever it is assigned to, because any of the three is what
  // someone has in mind when they type.
  function passes(t) {
    if (filters.worker &&
        !window.MM.ghltasks.isAssignedTo(t.who, filters.worker)) return false;
    if (filters.job && t.jobId !== filters.job) return false;

    var done = t.status === 'done';
    if (filters.show === 'open' && done) return false;
    if (filters.show === 'done' && !done) return false;

    // The date window. Measured against the finish date, which is the one a
    // task is judged by -- "due today" means due today, not started today.
    if (filters.when) {
      var d = daysTo(taskDay(t));
      if (filters.when === 'none' && d !== null) return false;
      if (filters.when === 'today' && d !== 0) return false;
      if (filters.when === 'tomorrow' && d !== 1) return false;
      if (filters.when === 'week' && (d === null || d < 0 || d > 7)) return false;
      // Overdue counts only work still outstanding: a task finished late is
      // finished, and listing it as overdue would be asking for it twice.
      if (filters.when === 'late' &&
          (d === null || d >= 0 || t.status === 'done')) return false;
    }

    if (filters.search) {
      var hay = [t.title, t.jobName, t.who].join(' ').toLowerCase();
      var words = filters.search.toLowerCase().split(/\s+/);
      // Every word has to appear, so a second word narrows rather than widens.
      for (var i = 0; i < words.length; i++) {
        if (words[i] && hay.indexOf(words[i]) === -1) return false;
      }
    }
    return true;
  }

  function activeFilterCount() {
    var n = 0;
    if (filters.worker) n++;
    if (filters.job) n++;
    if (filters.search) n++;
    if (filters.when) n++;
    // Not done yet is the resting state, not a choice someone made.
    if (filters.show !== 'open') n++;
    return n;
  }

  function render() {
    var el = document.getElementById('mm-my-body');

    updateFilterCount();

    var shown = rows.filter(passes);

    if (!shown.length) {
      el.innerHTML = '<div class="mm-my-clear">' +
        '<div class="mm-my-clear-tick" aria-hidden="true">&#10003;</div>' +
        '<h2>' + (rows.length ? 'Nothing matches those filters'
                              : 'Nothing to do right now') + '</h2>' +
        '<p>' + (rows.length ? 'Clear a filter to see more.'
                             : 'Tasks show up here as soon as they are added.') +
        '</p></div>';
      return;
    }

    el.innerHTML = groupByJob(shown).map(jobGroup).join('');
    bindGroups(el);
    bind(el);
  }

  // ---- Grouped by job, then by date -------------------------------------
  //
  // The client's ask: each job is a section, and inside it the tasks sit
  // under their dates, earliest first. Both levels open and close. They
  // start closed, so the page opens as a short list of jobs.
  //
  // What is open is remembered while the page is up: ticking a task redraws
  // the list, and that must not snap every section shut.
  var openJobs = {}, openDates = {};

  // A drawn chevron rather than a text triangle, which rendered too small to
  // see. Points down when open; the stylesheet turns it right when closed.
  var ARROW = '<span class="mm-tj-arrow" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="6 9 12 15 18 9"></polyline></svg></span>';

  function groupByJob(list) {
    var byJob = {}, order = [];
    list.forEach(function (t) {
      var k = t.jobId || 'none';
      if (!byJob[k]) { byJob[k] = { id: k, name: t.jobName || 'No job', tasks: [] }; order.push(byJob[k]); }
      byJob[k].tasks.push(t);
    });
    // The job needing attention soonest comes first: the earliest date among
    // its unfinished tasks. Jobs with nothing dated go last, then by name.
    order.forEach(function (g) {
      var open = g.tasks.filter(function (t) { return t.status !== 'done' && taskDay(t); });
      g.first = open.map(taskDay).sort()[0] || '';
    });
    order.sort(function (a, b) {
      if (a.first !== b.first) {
        if (!a.first) return 1;
        if (!b.first) return -1;
        return a.first < b.first ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return order;
  }

  function jobGroup(g) {
    var o = jobsById[g.id];
    var street = o ? window.MM.api.jobStreet(o) : '';
    var late = g.tasks.some(function (t) {
      var d = daysTo(taskDay(t)); return t.status !== 'done' && d !== null && d < 0;
    });

    // Dates in order, earliest first; tasks with no date at the end.
    var byDate = {}, dates = [];
    g.tasks.forEach(function (t) {
      var d = String(taskDay(t) || '').slice(0, 10);
      if (!byDate[d]) { byDate[d] = []; dates.push(d); }
      byDate[d].push(t);
    });
    dates.sort(function (a, b) {
      if (!a) return 1;
      if (!b) return -1;
      return a < b ? -1 : 1;
    });

    var canOpen = o && window.MM.jobaccess.canOpen(g.id);
    return '<details class="mm-tj' + (late ? ' is-late' : '') + '" data-job="' + U.esc(g.id) + '"' +
        (openJobs[g.id] ? ' open' : '') + '>' +
      '<summary class="mm-tj-head">' +
        ARROW +
        '<span class="mm-tj-name">' + U.esc(g.name) +
          (street ? '<span class="mm-tj-street">' + U.esc(street) + '</span>' : '') +
        '</span>' +
        '<span class="mm-mygroup-count">' + g.tasks.length + '</span>' +
      '</summary>' +
      '<div class="mm-tj-body">' +
        (canOpen
          ? '<button type="button" class="mm-tj-open" data-openjob="' + U.esc(g.id) + '">Open job &rsaquo;</button>'
          : '') +
        dates.map(function (d) { return dateGroup(g.id, d, byDate[d]); }).join('') +
      '</div>' +
    '</details>';
  }

  function dateGroup(jobId, d, list) {
    var k = jobId + '|' + d;
    var n = daysTo(d);
    var rel = n === null ? ''
      : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday'
      : n < 0 ? Math.abs(n) + ' days ago' : 'In ' + n + ' days';
    var late = n !== null && n < 0 && list.some(function (t) { return t.status !== 'done'; });
    return '<details class="mm-td' + (late ? ' is-late' : '') + '" data-date="' + U.esc(k) + '"' +
        (openDates[k] ? ' open' : '') + '>' +
      '<summary class="mm-td-head">' +
        ARROW +
        '<span class="mm-td-date">' + U.esc(d ? fmt(d) : 'No date set') + '</span>' +
        (rel ? '<span class="mm-td-rel">' + U.esc(rel) + '</span>' : '') +
        '<span class="mm-mygroup-count">' + list.length + '</span>' +
      '</summary>' +
      '<div class="mm-td-body">' + list.map(taskCard).join('') + '</div>' +
    '</details>';
  }

  function bindGroups(el) {
    el.querySelectorAll('details.mm-tj').forEach(function (x) {
      x.addEventListener('toggle', function () { openJobs[x.getAttribute('data-job')] = x.open; });
    });
    el.querySelectorAll('details.mm-td').forEach(function (x) {
      x.addEventListener('toggle', function () { openDates[x.getAttribute('data-date')] = x.open; });
    });
  }

  // The number of filters narrowing the list, shown on the button. A closed
  // panel must never leave someone wondering why the list looks short.
  function updateFilterCount() {
    var el = document.getElementById('mm-my-filtercount');
    if (!el) return;
    var n = activeFilterCount();
    el.textContent = n ? String(n) : '';
    el.classList.toggle('is-on', n > 0);
  }

  function checklist(t) {
    var done = t.items.filter(function (x) { return x.done; }).length;
    return '<div class="mm-mytask-items">' +
      '<div class="mm-mytask-itemhead">' + done + ' of ' + t.items.length + '</div>' +
      t.items.map(function (it, j) {
        return '<button type="button" class="mm-mytask-item' +
            (it.done ? ' is-done' : '') + '" data-sub="' + U.esc(t.id) + '.' + j + '">' +
          '<span class="mm-mytask-tick">' + (it.done ? '&#10003;' : '') + '</span>' +
          U.esc(it.title) + '</button>';
      }).join('') +
    '</div>';
  }

  // Without the weekday: used where two dates share one badge and the day
  // name would push it onto a second line.
  function fmtShort(v) {
    if (!v) return '';
    var p = String(v).split('-');
    if (p.length !== 3) return v;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? v
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function taskCard(t) {
    // Both dates live in the badge, which is where someone looks for "when".
    // A start date on its own line below the job read as a second, competing
    // answer -- "From Aug 26" beside a badge saying "No date".
    // The same date the groups and the filter use: the finish date, or the
    // start date when there is no finish. A task starting today showed as
    // "From Mon, Sep 21" while sitting under a heading saying it had no date.
    var day = taskDay(t);
    var d = daysTo(day);
    var flag = d === null ? ''
      : d < 0 ? Math.abs(d) + 'd late'
      : d === 0 ? 'Due today'
      : d === 1 ? 'Due tomorrow'
      : 'Due ' + fmtShort(day);
    var cls = d !== null && d < 0 ? 'urgent' : d === 0 ? 'soon' : '';

    // Short enough to stay on one line. The weekday is dropped once both
    // dates are shown -- "Aug 26 - Sep 12" is the span, and the day name is
    // decoration that costs the badge a second line.
    // Only when the two differ: a task judged by its start date would
    // otherwise read "Sep 21 -> today", which says one thing twice.
    var from = (t.start && t.end && t.start !== t.end) ? fmt(t.start) : '';
    if (!flag) flag = 'No dates';
    else if (from) flag = fmtShort(t.start) + ' \u2192 ' + flag.replace(/^Due /, '');


    return '<div class="mm-mytask' + ((t.status === 'done') ? ' is-done' : '') + '">' +
      '<button type="button" class="mm-task-tick" data-tick="' + U.esc(t.id) + '" ' +
        'aria-label="' + ((t.status === 'done') ? 'Reopen ' : 'Mark ') + U.esc(t.title) +
        ((t.status === 'done') ? '' : ' done') + '">' + ((t.status === 'done') ? '&#10003;' : '') + '</button>' +
      '<div class="mm-mytask-main">' +
        (auth.isAdmin()
          ? '<button type="button" class="mm-mytask-title mm-mytask-edit" ' +
              'data-edit="' + U.esc(t.id) + '" ' +
              'aria-label="Edit ' + U.esc(t.title) + '">' + U.esc(t.title) + '</button>'
          : '<div class="mm-mytask-title">' + U.esc(t.title) + '</div>') +
        '<div class="mm-mytask-jobrow">' +
          '<span class="mm-mytask-joblabel">Job</span>' +
          // A link only where it will actually open. Task assignment and job
          // access are separate checks, so a worker can hold a task on a job
          // they are not crewed to -- there the name stays plain text rather
          // than becoming a link that silently does nothing.
          (t.jobId && jobsById[t.jobId] && window.MM.jobaccess.canOpen(t.jobId)
            ? '<button type="button" class="mm-mytask-jobname mm-mytask-joblink" ' +
                'data-openjob="' + U.esc(t.jobId) + '" ' +
                'aria-label="Open the job ' + U.esc(t.jobName || '') + '">' +
                U.esc(t.jobName || 'Not recorded') + '</button>'
            : '<span class="mm-mytask-jobname">' +
                U.esc(t.jobName || 'Not recorded') + '</span>') +
        '</div>' +
        ((t.items || []).length ? checklist(t) : '') +
      '</div>' +
      '<div class="mm-mytask-side">' +
        '<span class="mm-jflag mm-jflag-' + cls + '">' + U.esc(flag) + '</span>' +
        // A visible pencil rather than relying on someone discovering that
        // the title is tappable.
        (auth.isAdmin()
          ? '<button type="button" class="mm-mytask-pencil" data-edit="' +
              U.esc(t.id) + '" aria-label="Edit ' + U.esc(t.title) + '">&#9998;</button>'
          : '') +
      '</div>' +
    '</div>';
  }

  var editing = null;
  // Set when another screen opens this editor (the Calendar), so that screen
  // redraws itself after a save instead of this page.
  var afterSave = null;

  function openEdit(t, after) {
    editing = t;
    afterSave = after || null;
    document.getElementById('mm-mte-job').textContent = t.jobName || '';
    document.getElementById('mm-mte-title').value = t.title || '';
    document.getElementById('mm-mte-start').value = t.start || '';
    document.getElementById('mm-mte-end').value = t.end || '';
    document.getElementById('mm-mte-error').textContent = '';
    var btn = document.getElementById('mm-mte-save');
    btn.disabled = false;
    btn.textContent = 'Save changes';
    document.getElementById('mm-modal-mytaskedit').classList.add('open');
    document.getElementById('mm-mte-title').focus();
  }

  function closeEdit() {
    document.getElementById('mm-modal-mytaskedit').classList.remove('open');
    editing = null;
    afterSave = null;
  }

  function saveEdit() {
    if (!editing) return;
    var t = editing;
    var btn = document.getElementById('mm-mte-save');
    var err = document.getElementById('mm-mte-error');
    var title = (document.getElementById('mm-mte-title').value || '').trim();
    if (!title) {
      err.textContent = 'Give the task a name.';
      document.getElementById('mm-mte-title').focus();
      return;
    }

    var start = document.getElementById('mm-mte-start').value;
    var end = document.getElementById('mm-mte-end').value;
    if (start && end && end < start) {
      err.textContent = 'The due date cannot be before the start date.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';
    err.textContent = '';

    var id = String(t.id).split(':');
    // Only these three are sent, so the assignees, notes and checklist this
    // form never showed cannot be wiped by saving it.
    window.MM.ghltasks.setFieldsOnJob(id[0], +id[1], {
      title: title, start: start, end: end,
    })
      .then(function () {
        window.MM.activity.log('note', 'Edited task "' + title + '"',
          { jobId: t.jobId, jobName: t.jobName });
        t.title = title; t.start = start; t.end = end;
        var done = afterSave;
        closeEdit();
        if (done) done(); else render();
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Save changes';
        err.textContent = 'Could not save: ' + e.message;
      });
  }

  function bind(el) {
    el.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var t = rows.find(function (x) { return x.id === b.getAttribute('data-edit'); });
        if (t) openEdit(t);
      });
    });

    el.querySelectorAll('[data-openjob]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        // The card carries its own controls, so this keeps its tap to itself.
        e.stopPropagation();
        var o = jobsById[b.getAttribute('data-openjob')];
        if (o && onOpenJob) onOpenJob(o);
      });
    });

    el.querySelectorAll('[data-sub]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-sub').split('.');
        var t = rows.find(function (x) { return x.id === parts[0]; });
        if (!t) return;
        var j = +parts[1];
        var id = String(t.id).split(':');
        b.disabled = true;
        var want = !t.items[j].done;
        window.MM.ghltasks.setItemOnJob(id[0], +id[1], j, want)
          .then(function () {
            window.MM.activity.log(want ? 'task_done' : 'task_undone',
              (want ? 'Ticked off "' : 'Reopened "') + t.items[j].title +
              '" in ' + t.title, { jobId: t.jobId, jobName: t.jobName });
            t.items[j].done = want;
            render();
          })
          .catch(function (e) {
            b.disabled = false;
            var err = document.getElementById('mm-my-error');
            if (err) err.textContent = 'Could not save: ' + e.message;
          });
      });
    });

    el.querySelectorAll('[data-tick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-tick');
        var t = rows.find(function (x) { return x.id === id; });
        if (!t) return;
        var undo = t.status === 'done';
        b.disabled = true;
        // The id carries the job and the task's position in that job's list,
        // which is what the writer needs to change the right line.
        var parts = String(id).split(':');
        window.MM.ghltasks.setStatusOnJob(parts[0], +parts[1], undo ? 'todo' : 'done')
          .then(function () {
            window.MM.activity.log(undo ? 'task_undone' : 'task_done',
              (undo ? 'Reopened "' : 'Finished "') + t.title + '"', {
                jobId: t.jobId, jobName: t.jobName,
              });
            // Redraw from what is already in memory. Reloading would re-read
            // every job in the account for a change we already know about.
            t.status = undo ? 'todo' : 'done';
            render();
          })
          .catch(function (e) {
            b.disabled = false;
            var err = document.getElementById('mm-my-error');
            if (err) err.textContent = 'Could not save: ' + e.message;
          });
      });
    });
  }

  // The editor lives outside the list, so its buttons are wired once rather
  // than on every render.
  // The job and worker lists are built from what is actually on screen, so
  // the dropdowns never offer a name or a job with no tasks behind it.
  function fillFilterOptions() {
    var jobSel = document.getElementById('mm-my-job');
    if (jobSel) {
      var seen = {}, jobOpts = [];
      rows.forEach(function (t) {
        if (!t.jobId || seen[t.jobId]) return;
        seen[t.jobId] = true;
        jobOpts.push({ id: t.jobId, name: t.jobName || 'Untitled job' });
      });
      jobOpts.sort(function (a, b) { return a.name.localeCompare(b.name); });
      jobSel.innerHTML = '<option value="">All jobs</option>' +
        jobOpts.map(function (j) {
          return '<option value="' + U.esc(j.id) + '">' + U.esc(j.name) + '</option>';
        }).join('');
      jobSel.value = filters.job;
    }

    var whoSel = document.getElementById('mm-my-worker');
    if (whoSel) {
      // assignableNames returns { name, hasLogin } objects, not strings --
      // putting them straight into an option gave a list of [object Object].
      var names = window.MM.workerlist && window.MM.workerlist.assignableNames
        ? window.MM.workerlist.assignableNames() : [];
      whoSel.innerHTML = '<option value="">Everyone</option>' +
        names.map(function (w) {
          var n = (w && w.name) || String(w || '');
          return '<option value="' + U.esc(n) + '">' + U.esc(n) + '</option>';
        }).join('');
      whoSel.value = filters.worker;
    }

    var showSel = document.getElementById('mm-my-show');
    if (showSel) showSel.value = filters.show;

    var whenSel = document.getElementById('mm-my-when');
    if (whenSel) whenSel.value = filters.when;
  }

  function initFilters() {
    var btn = document.getElementById('mm-my-filterbtn');
    var panel = document.getElementById('mm-my-filters');
    if (btn && panel) {
      btn.addEventListener('click', function () {
        var open = !panel.classList.contains('is-open');
        panel.classList.toggle('is-open', open);
        btn.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    var search = document.getElementById('mm-my-search');
    if (search) {
      var timer = null;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        // Waits for a pause in typing: redrawing on every keystroke makes a
        // long list feel sluggish.
        timer = setTimeout(function () {
          filters.search = search.value.trim();
          render();
        }, 200);
      });
    }

    [['mm-my-worker', 'worker'], ['mm-my-job', 'job'], ['mm-my-show', 'show'],
     ['mm-my-when', 'when']]
      .forEach(function (pair) {
        var sel = document.getElementById(pair[0]);
        if (!sel) return;
        sel.addEventListener('change', function () {
          filters[pair[1]] = sel.value;
          render();
        });
      });

    var clear = document.getElementById('mm-my-clear');
    if (clear) clear.addEventListener('click', function () {
      filters = { worker: '', job: '', show: 'open', search: '', when: '' };
      if (search) search.value = '';
      fillFilterOptions();
      render();
    });
  }

  function init() {
    initFilters();

    var cancel = document.getElementById('mm-mte-cancel');
    if (cancel) cancel.addEventListener('click', closeEdit);
    var save = document.getElementById('mm-mte-save');
    if (save) save.addEventListener('click', saveEdit);
    var overlay = document.getElementById('mm-modal-mytaskedit');
    if (overlay) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeEdit();
    });
  }

  window.MM.mytasks = {
    init: init,
    load: load,
    onOpenJob: function (fn) { onOpenJob = fn; },
    // The same task editor, for the Calendar's list.
    editTask: openEdit,
  };
})();
