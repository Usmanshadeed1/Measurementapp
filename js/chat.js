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
  var conversationId = '';
  var messages = [];        // oldest first, which is how a thread reads
  var oldestId = '';        // the page marker for "load earlier"
  var hasMore = false;
  var loading = false;

  var PAGE = 50;

  function contactOf(job) {
    return (job && job.contact) || {};
  }

  // ---- Reading a message ---------------------------------------------------

  // Emails arrive as HTML from whatever wrote them. Only the text is shown:
  // a marketing template dropped into the page would bring its own layout
  // with it, and could carry anything at all.
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

  // Outbound is anything the business sent; everything else came from the
  // customer. GoHighLevel spells it a couple of ways depending on channel.
  function isOutbound(m) {
    return String(m.direction || '').toLowerCase() === 'outbound';
  }

  function kindOf(m) {
    var t = String(m.messageType || m.type || '').toUpperCase();
    if (t.indexOf('EMAIL') > -1) return 'Email';
    if (t.indexOf('SMS') > -1) return 'SMS';
    if (t.indexOf('CALL') > -1) return 'Call';
    if (t.indexOf('VOICEMAIL') > -1) return 'Voicemail';
    if (t.indexOf('FACEBOOK') > -1) return 'Facebook';
    if (t.indexOf('INSTAGRAM') > -1) return 'Instagram';
    if (t.indexOf('WHATSAPP') > -1) return 'WhatsApp';
    if (t.indexOf('GMB') > -1) return 'Google';
    return t ? U.titleCase(t.replace(/_/g, ' ').toLowerCase()) : 'Message';
  }

  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined,
      { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
      (url
        ? '<a class="mm-btn-sm mm-btn-primary mm-chat-reply" href="' + U.esc(url) + '" ' +
          'target="_blank" rel="noopener">Reply in GoHighLevel</a>'
        : '') +
    '</div>';
  }

  function bubble(m) {
    var out = isOutbound(m);
    var text = plain(m.body);
    var files = (m.attachments || []).length;

    return '<div class="mm-msg' + (out ? ' is-out' : ' is-in') + '">' +
      '<div class="mm-msg-bubble">' +
        '<div class="mm-msg-meta">' +
          '<span class="mm-msg-kind">' + U.esc(kindOf(m)) + '</span>' +
          '<span class="mm-msg-when">' + U.esc(fmtWhen(m.dateAdded)) + '</span>' +
        '</div>' +
        (text
          ? '<div class="mm-msg-body">' + U.esc(text) + '</div>'
          : '<div class="mm-msg-body mm-msg-empty">No text in this message</div>') +
        // Named rather than shown: the files live in GoHighLevel, and a
        // broken image would say less than a line of text does.
        (files
          ? '<div class="mm-msg-files">' + files +
            (files === 1 ? ' attachment' : ' attachments') + '</div>'
          : '') +
      '</div>' +
    '</div>';
  }

  function render() {
    var el = document.getElementById('mm-job-chat');
    if (!el) return;

    if (!messages.length) {
      el.innerHTML = head(0) +
        '<p class="mm-task-empty">No messages with this customer yet.</p>';
      return;
    }

    // A date between messages, the way a phone shows one. Without it a long
    // thread is a wall of times with no sense of when anything happened.
    var out = '', lastDay = '';
    messages.forEach(function (m) {
      var k = dayKey(m.dateAdded);
      if (k && k !== lastDay) {
        lastDay = k;
        out += '<div class="mm-chat-day">' +
          U.esc(dayLabel(m.dateAdded)) + '</div>';
      }
      out += bubble(m);
    });

    el.innerHTML = head(messages.length) +
      (hasMore
        ? '<button type="button" class="mm-chat-more" id="mm-chat-more">' +
          'Load earlier messages</button>'
        : '') +
      '<div class="mm-chat-list">' + out + '</div>' +
      '<p class="mm-task-error" id="mm-chat-error" role="alert"></p>';

    var more = document.getElementById('mm-chat-more');
    if (more) more.addEventListener('click', loadMore);
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
  function absorb(page) {
    var rows = (page.messages || []).slice().reverse();
    messages = rows.concat(messages);
    hasMore = !!page.nextPage;
    oldestId = page.lastMessageId ||
      (rows.length ? rows[0].id : oldestId);
  }

  function loadMore() {
    if (loading || !hasMore) return;
    loading = true;

    var btn = document.getElementById('mm-chat-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

    api.messagesIn(conversationId, oldestId, PAGE)
      .then(function (page) {
        absorb(page);
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
    currentJob = job;
    conversationId = '';
    messages = [];
    oldestId = '';
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

    return api.conversationForContact(c.id)
      .then(function (conv) {
        if (!conv || !conv.id) {
          el.innerHTML = head(0) +
            '<p class="mm-task-empty">No messages with this customer yet.</p>';
          return null;
        }
        conversationId = conv.id;
        return api.messagesIn(conversationId, '', PAGE);
      })
      .then(function (page) {
        if (!page) return;
        absorb(page);
        render();
      })
      .catch(function (e) {
        el.innerHTML = head(0) +
          '<div class="mm-empty">' + U.esc(e.message) + '</div>';
      });
  }

  window.MM.chat = { showForJob: showForJob };
})();
