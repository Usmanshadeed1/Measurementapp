// js/chat.js
// The customer's conversation, on the job.
//
// Read only, on purpose. Every message to and from this customer already
// lives in GoHighLevel, across SMS, email and everything else; replying there
// keeps one thread rather than two. So this shows what has been said and
// hands over to GoHighLevel when there is something to say back.
//
// It is its own tab rather than a panel on Overview: a conversation is long,
// and a year of it would bury the job progress somebody opened Overview to
// read.
window.MM = window.MM || {};

(function () {
  var U = window.MM.utils, api = window.MM.api;

  var currentJob = null;
  // Every thread this customer has, and the page marker for each. A contact
  // can hold more than one conversation in GoHighLevel -- often one per
  // channel -- and all of them are the same history to the person reading it.
  var threads = [];         // [{ id, oldestId, hasMore }]
  var conversationId = '';  // the first thread, for the refresh check
  var messages = [];        // oldest first, which is how a thread reads
  var hasMore = false;
  var loading = false;

  var PAGE = 50;

  // How often to look for new messages while the Chat tab is open. Reading
  // only -- nothing is written, so a check that finds nothing costs one small
  // request and changes nothing.
  var POLL_MS = 60000;
  var pollTimer = null;

  // Only while the tab is actually being looked at. A timer left running
  // would go on asking all day for every job anyone had opened, and a phone
  // in a pocket would keep asking from inside a locked screen.
  function chatIsVisible() {
    var pane = document.querySelector('#screen-job .mm-jobpane[data-pane="chat"]');
    var screen = document.getElementById('screen-job');
    return !!(pane && pane.classList.contains('active') &&
              screen && screen.classList.contains('active') &&
              !document.hidden);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (!conversationId || loading) return;
      if (!chatIsVisible()) return;
      checkNew();
    }, POLL_MS);
  }

  // The newest page only. Anything already held is left alone, so a thread
  // somebody has scrolled back through is not thrown away to add one message
  // at the bottom.
  function checkNew() {
    if (!threads.length) return;
    loading = true;

    Promise.all(threads.map(function (th) {
      return api.messagesIn(th.id, '', PAGE).catch(function () { return null; });
    }))
      .then(function (pages) {
        loading = false;
        var have = {};
        messages.forEach(function (m) { have[m.id] = true; });

        var fresh = [];
        pages.forEach(function (page) {
          if (!page) return;
          (page.messages || []).slice().reverse().forEach(function (m) {
            if (m.id && !have[m.id]) { have[m.id] = true; fresh.push(m); }
          });
        });

        if (!fresh.length) return;

        // Marked so the new ones are findable: a message arriving at the
        // bottom of a long thread lands below the fold, and a conversation
        // that quietly grew is worse than one that says what changed.
        fresh.forEach(function (m) { m.mmNew = true; });
        messages = messages.concat(fresh);
        sortMessages();
        render();

        var last = document.querySelector('#mm-job-chat .mm-msg.is-new:last-of-type');
        if (last && last.scrollIntoView) {
          last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      })
      .catch(function () {
        // A failed check is not worth an error on screen: the next one is a
        // minute away, and the thread already shown is still correct.
        loading = false;
      });
  }

  function contactOf(job) {
    return (job && job.contact) || {};
  }

  // ---- Reading a message ---------------------------------------------------

  // Emails arrive as HTML from whatever wrote them. Only the text is shown:
  // a marketing template dropped into the page would bring its own layout
  // with it, and could carry anything at all.
  // Where a message keeps its text. GoHighLevel puts it in different places
  // depending on the channel -- an email carries its own body fields, and an
  // activity record its own again -- so every one is tried rather than
  // trusting `body` and showing "no text" when it happens to be empty.
  function bodyOf(m) {
    return m.body || m.text || m.message ||
           m.htmlBody || m.html || m.emailBody ||
           (m.meta && (m.meta.body || m.meta.text)) || '';
  }

  function plain(raw) {
    var s = String(raw || '');
    if (/<[a-z][\s\S]*>/i.test(s)) {
      var tmp = document.createElement('div');
      tmp.innerHTML = s;
      s = tmp.textContent || tmp.innerText || '';
    }
    // Collapse the runs of blank lines an email signature leaves behind.
    return s.replace(/\n{3,}/g, '\n\n').trim();
  }

  function typeOf(m) {
    return String(m.messageType || m.type || '').toUpperCase();
  }

  // GoHighLevel returns its own activity records in the same list as real
  // messages -- "Opportunity created", "Opportunity updated". Nobody said
  // them to anybody, and in a conversation they read as noise between the
  // things that were actually said.
  function isActivity(m) {
    return typeOf(m).indexOf('ACTIVITY') > -1;
  }

  // Outbound is anything the business sent. GoHighLevel spells the direction
  // a few ways depending on channel and how the message was created, so the
  // inbound spellings are what is tested -- anything else is treated as ours,
  // which is the safer way round: a business message shown as the customer's
  // is a worse mistake than the reverse.
  function isOutbound(m) {
    var d = String(m.direction || '').toLowerCase();
    if (d === 'inbound' || d === 'in' || d === 'received') return false;
    if (d === 'outbound' || d === 'out' || d === 'sent') return true;
    // No direction at all: a message with a userId was written by a person on
    // this side of the conversation.
    return !!(m.userId || m.user_id);
  }

  // The channel, for the label. Only shown when a thread mixes channels --
  // "SMS" on every bubble of an all-SMS thread says nothing.
  function kindOf(m) {
    var t = typeOf(m);
    if (t.indexOf('EMAIL') > -1) return 'Email';
    if (t.indexOf('SMS') > -1) return 'SMS';
    if (t.indexOf('CALL') > -1) return 'Call';
    if (t.indexOf('VOICEMAIL') > -1) return 'Voicemail';
    if (t.indexOf('FACEBOOK') > -1) return 'Facebook';
    if (t.indexOf('INSTAGRAM') > -1) return 'Instagram';
    if (t.indexOf('WHATSAPP') > -1) return 'WhatsApp';
    if (t.indexOf('GMB') > -1) return 'Google';
    if (t.indexOf('REVIEW') > -1) return 'Review';
    if (t.indexOf('LIVE_CHAT') > -1 || t.indexOf('WEBCHAT') > -1) return 'Web chat';
    return t ? U.titleCase(t.replace(/^TYPE_/, '').replace(/_/g, ' ').toLowerCase()) : '';
  }

  // The time only. The date is already the separator above the message, and
  // repeating it on every bubble crowded out what was actually said.
  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function dayKey(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toDateString();
  }

  function dayLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var today = new Date();
    var t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((d0 - t0) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString(undefined,
      { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---- Rendering -----------------------------------------------------------

  function head(count) {
    var c = contactOf(currentJob);
    var url = c.id ? U.ghlContactUrl(c.id) : '';
    return '<div class="mm-chat-head">' +
      '<div class="mm-chat-headmain">' +
        '<span class="mm-chat-title">Conversation</span>' +
        (count
          ? '<span class="mm-steps-badge mm-steps-badge-done">' + count +
            ' message' + (count === 1 ? '' : 's') + '</span>'
          : '') +
      '</div>' +
      '<div class="mm-chat-actions">' +
        // The thread is read once when the tab opens. Checking for new
        // messages on a timer would mean a request every half minute for
        // every open job, so it is offered as a button instead.
        '<button type="button" class="mm-btn-sm mm-btn-secondary" ' +
          'id="mm-chat-refresh" aria-label="Check for new messages">' +
          '&#8635;</button>' +
        (url
          ? '<a class="mm-btn-sm mm-btn-primary mm-chat-reply" href="' + U.esc(url) + '" ' +
            'target="_blank" rel="noopener">Reply in GoHighLevel</a>'
          : '') +
      '</div>' +
    '</div>';
  }

  function bubble(m, showKind) {
    // An activity record is not a message from either side: GoHighLevel wrote
    // it about the job. Centred, quiet, and never in a speech bubble.
    if (isActivity(m)) {
      return '<div class="mm-msg-activity">' +
        '<span class="mm-msg-activity-text">' + U.esc(plain(bodyOf(m)) || 'Activity') + '</span>' +
        '<span class="mm-msg-activity-when">' + U.esc(fmtWhen(m.dateAdded)) + '</span>' +
      '</div>';
    }

    var out = isOutbound(m);
    var text = plain(bodyOf(m));
    var files = (m.attachments || []).length;
    var kind = showKind ? kindOf(m) : '';

    return '<div class="mm-msg' + (out ? ' is-out' : ' is-in') +
      (m.mmNew ? ' is-new' : '') + '">' +
      '<div class="mm-msg-bubble">' +
        (kind ? '<div class="mm-msg-kind">' + U.esc(kind) + '</div>' : '') +
        (text
          ? '<div class="mm-msg-body">' + U.esc(text) + '</div>'
          : '<div class="mm-msg-body mm-msg-empty">No text in this message</div>') +
        // Named rather than shown: the files live in GoHighLevel, and a
        // broken image would say less than a line of text does.
        (files
          ? '<div class="mm-msg-files">' + files +
            (files === 1 ? ' attachment' : ' attachments') + '</div>'
          : '') +
        '<div class="mm-msg-when">' + U.esc(fmtWhen(m.dateAdded)) + '</div>' +
      '</div>' +
    '</div>';
  }

  function render() {
    var el = document.getElementById('mm-job-chat');
    if (!el) return;

    // Everything, activity records included: GoHighLevel's own conversation
    // shows them inline, and the client asked for the same thing in one
    // place rather than a tidied-up version of it.
    var said = messages;

    if (!said.length) {
      el.innerHTML = head(0) +
        '<p class="mm-task-empty">No messages with this customer yet.</p>';
      return;
    }

    // The channel is worth labelling only when the thread has more than one.
    // On an all-SMS thread "SMS" above every bubble is a word repeated for no
    // reason.
    var kinds = {};
    said.forEach(function (m) { kinds[kindOf(m)] = true; });
    var mixed = Object.keys(kinds).length > 1;

    // A date between messages, the way a phone shows one. Without it a long
    // thread is a wall of times with no sense of when anything happened.
    var out = '', lastDay = '';
    said.forEach(function (m) {
      var k = dayKey(m.dateAdded);
      if (k && k !== lastDay) {
        lastDay = k;
        out += '<div class="mm-chat-day">' +
          U.esc(dayLabel(m.dateAdded)) + '</div>';
      }
      out += bubble(m, mixed);
    });

    el.innerHTML = head(said.length) +
      (hasMore
        ? '<button type="button" class="mm-chat-more" id="mm-chat-more">' +
          'Load earlier messages</button>'
        : '') +
      '<div class="mm-chat-list">' + out + '</div>' +
      '<p class="mm-task-error" id="mm-chat-error" role="alert"></p>';

    var more = document.getElementById('mm-chat-more');
    if (more) more.addEventListener('click', loadMore);

    var refresh = document.getElementById('mm-chat-refresh');
    if (refresh) refresh.addEventListener('click', function () {
      showForJob(currentJob);
    });
  }

  function showError(msg) {
    var el = document.getElementById('mm-chat-error');
    if (el) { el.textContent = msg || ''; return; }
    var box = document.getElementById('mm-job-chat');
    if (box) box.innerHTML = head(0) + '<div class="mm-empty">' + U.esc(msg) + '</div>';
  }

  // ---- Loading -------------------------------------------------------------

  // GoHighLevel returns newest first; a thread reads oldest first, so each
  // page is flipped and put in front of what is already there.
  function absorb(page, thread) {
    var rows = (page.messages || []).slice().reverse();
    messages = rows.concat(messages);

    if (thread) {
      thread.hasMore = !!page.nextPage;
      thread.oldestId = page.lastMessageId ||
        (rows.length ? rows[0].id : thread.oldestId);
    }
    // Earlier messages exist while ANY thread still has some.
    hasMore = threads.some(function (t) { return t.hasMore; });
  }

  // Threads are read separately but read as one conversation, so everything
  // is ordered by when it was actually said.
  function sortMessages() {
    messages.sort(function (a, b) {
      return new Date(a.dateAdded) - new Date(b.dateAdded);
    });
  }

  function loadMore() {
    if (loading || !hasMore) return;
    loading = true;

    var btn = document.getElementById('mm-chat-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

    // A page from every thread that still has one, so the history goes back
    // evenly rather than exhausting one thread before starting the next.
    var more = threads.filter(function (t) { return t.hasMore; });

    Promise.all(more.map(function (th) {
      return api.messagesIn(th.id, th.oldestId, PAGE)
        .then(function (page) { return { th: th, page: page }; })
        .catch(function () { return null; });
    }))
      .then(function (results) {
        results.forEach(function (r) {
          if (!r) return;
          absorb(r.page, r.th);
        });
        sortMessages();
        loading = false;
        render();
      })
      .catch(function (e) {
        loading = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Load earlier messages'; }
        showError('Could not load more: ' + e.message);
      });
  }

  function showForJob(job) {
    stopPolling();
    currentJob = job;
    threads = [];
    conversationId = '';
    messages = [];
    hasMore = false;
    loading = false;

    var el = document.getElementById('mm-job-chat');
    if (!el) return Promise.resolve();

    var c = contactOf(job);
    if (!c.id) {
      el.innerHTML = head(0) +
        '<p class="mm-task-empty">This job has no customer attached.</p>';
      return Promise.resolve();
    }

    el.innerHTML = head(0) + '<div class="mm-loading">' +
      '<span class="mm-spinner" aria-hidden="true"></span>' +
      '<span>Loading the conversation&hellip;</span></div>';

    return api.conversationsForContact(c.id)
      .then(function (convs) {
        var rows = (convs || []).filter(function (x) { return x && x.id; });
        if (!rows.length) {
          el.innerHTML = head(0) +
            '<p class="mm-task-empty">No messages with this customer yet.</p>';
          return null;
        }

        threads = rows.map(function (x) {
          return { id: x.id, oldestId: '', hasMore: false };
        });
        conversationId = threads[0].id;

        // All of them at once: a customer with a text thread and an email
        // thread has one history, and reading them one after another would
        // show the second only once the first ran out.
        return Promise.all(threads.map(function (th) {
          return api.messagesIn(th.id, '', PAGE)
            .then(function (page) { return { th: th, page: page }; })
            .catch(function () { return null; });
        }));
      })
      .then(function (results) {
        if (!results) return;
        results.forEach(function (r) {
          if (!r) return;
          absorb(r.page, r.th);
        });
        sortMessages();
        render();
        startPolling();
      })
      .catch(function (e) {
        el.innerHTML = head(0) +
          '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  window.MM.chat = { showForJob: showForJob };
})();
