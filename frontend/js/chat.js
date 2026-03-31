/**
 * js/chat.js — Aqualence AI Product Assistant (Aria)
 * ─────────────────────────────────────────────────────────────────────────────
 * Floating chat widget for the storefront. Communicates with /api/ai/chat.
 *
 * Security:
 *   • All Gemini calls happen server-side — this file never touches the API key
 *   • Session ID (UUID) stored in sessionStorage (cleared on tab close)
 *   • Conversation history capped at 12 turns before sending to server
 *   • No PII stored — history is in-memory only, lost on refresh
 *   • Rate limit responses (429) are handled gracefully with countdown UI
 *   • All server responses rendered via textContent (XSS-safe)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

(function () {

  /* ── Constants ─────────────────────────────────────────────────────────── */
  const API_URL       = '/api/v1/ai/chat';
  const MAX_HISTORY   = 12;   // turns to keep in memory (matches server cap)
  const MIN_INTERVAL  = 2100; // ms — slightly above server's 2s cooldown
  const SUGGESTED_QS  = [
    'What helps with dry skin?',
    'Best shampoo for hair fall?',
    'Recommend a face wash for acne.',
    'What\'s on sale today?',
    'Moisturiser for oily skin?',
  ];

  /* ── Session ID ─────────────────────────────────────────────────────────── */
  // UUID stored in sessionStorage — expires when the tab closes.
  // Sent as X-Session-ID header so the server's per-session daily limiter works.
  function getSessionId() {
    let id = sessionStorage.getItem('aq_chat_session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('aq_chat_session', id);
    }
    return id;
  }

  /* ── State ─────────────────────────────────────────────────────────────── */
  let history       = [];    // [{ role: 'user'|'model', parts: [{ text }] }]
  let isOpen        = false;
  let isTyping      = false;
  let lastSentAt    = 0;
  let cooldownTimer = null;

  /* ── DOM helpers ────────────────────────────────────────────────────────── */
  const $  = (id) => document.getElementById(id);
  const esc = (str) => {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str != null ? String(str) : ''));
    return d.innerHTML;
  };

  /* ── Build widget DOM ───────────────────────────────────────────────────── */
  function buildWidget() {
    const style = document.createElement('style');
    style.textContent = `
      /* ── Chat widget ── */
      #aq-chat-fab {
        position: fixed;
        bottom: calc(var(--bottom-nav-h, 68px) + 16px);
        right: 18px;
        z-index: 1200;
        width: 54px; height: 54px;
        background: var(--brand, #1565a8);
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 20px rgba(21,101,168,.35), 0 1px 4px rgba(0,0,0,.15);
        transition: transform .2s var(--ease,.4s cubic-bezier(.4,0,.2,1)),
                    box-shadow .2s;
        outline: none;
      }
      #aq-chat-fab:hover  { transform: scale(1.08); box-shadow: 0 6px 28px rgba(21,101,168,.45); }
      #aq-chat-fab:active { transform: scale(.95); }
      #aq-chat-fab svg { width: 26px; height: 26px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

      /* Pulse ring when closed */
      #aq-chat-fab::after {
        content: '';
        position: absolute; inset: -4px;
        border-radius: 50%;
        border: 2px solid var(--brand, #1565a8);
        opacity: 0;
        animation: chat-pulse 3s ease-out 2s infinite;
      }
      @keyframes chat-pulse {
        0%   { transform: scale(1);   opacity: .6; }
        100% { transform: scale(1.6); opacity: 0; }
      }
      #aq-chat-fab.open::after { animation: none; }

      /* Notification dot */
      #aq-chat-dot {
        position: absolute; top: -2px; right: -2px;
        width: 13px; height: 13px;
        background: var(--gold, #c8932a);
        border-radius: 50%;
        border: 2px solid #fff;
        display: none;
        animation: dot-bounce .6s ease both;
      }
      @keyframes dot-bounce {
        0%  { transform: scale(0); }
        60% { transform: scale(1.25); }
        100%{ transform: scale(1); }
      }

      /* ── Chat panel ── */
      #aq-chat-panel {
        position: fixed;
        bottom: calc(var(--bottom-nav-h, 68px) + 78px);
        right: 18px;
        z-index: 1199;
        width: min(380px, calc(100vw - 28px));
        height: min(560px, calc(100vh - var(--bottom-nav-h, 68px) - 100px));
        background: var(--surface, #fff);
        border-radius: var(--r-lg, 22px);
        box-shadow: var(--sh-lg, 0 20px 60px rgba(13,42,69,.18));
        display: flex; flex-direction: column;
        overflow: hidden;
        transform: scale(.92) translateY(12px);
        opacity: 0;
        pointer-events: none;
        transition: transform .25s var(--ease), opacity .25s;
      }
      #aq-chat-panel.open {
        transform: scale(1) translateY(0);
        opacity: 1;
        pointer-events: auto;
      }

      /* Header */
      #aq-chat-header {
        background: var(--brand, #1565a8);
        padding: 14px 16px;
        display: flex; align-items: center; gap: 10px;
        flex-shrink: 0;
      }
      #aq-chat-avatar {
        width: 36px; height: 36px;
        background: rgba(255,255,255,.2);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; flex-shrink: 0;
      }
      #aq-chat-title { flex: 1; }
      #aq-chat-title strong { display: block; color: #fff; font-size: .9rem; font-weight: 700; line-height: 1.2; }
      #aq-chat-title span   { color: rgba(255,255,255,.7); font-size: .72rem; }
      #aq-chat-close {
        background: none; border: none; cursor: pointer;
        color: rgba(255,255,255,.8); font-size: 1.2rem; line-height: 1;
        padding: 4px; border-radius: 50%;
        transition: color .15s, background .15s;
      }
      #aq-chat-close:hover { color: #fff; background: rgba(255,255,255,.15); }

      /* Messages */
      #aq-chat-messages {
        flex: 1; overflow-y: auto;
        padding: 14px 14px 8px;
        display: flex; flex-direction: column; gap: 10px;
        scroll-behavior: smooth;
      }
      #aq-chat-messages::-webkit-scrollbar { width: 4px; }
      #aq-chat-messages::-webkit-scrollbar-thumb { background: var(--border, #e3e8dc); border-radius: 4px; }

      .aq-msg {
        max-width: 86%;
        padding: 9px 13px;
        border-radius: 16px;
        font-size: .83rem;
        line-height: 1.5;
        animation: msg-in .2s ease both;
        word-break: break-word;
      }
      @keyframes msg-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .aq-msg.user {
        align-self: flex-end;
        background: var(--brand, #1565a8);
        color: #fff;
        border-bottom-right-radius: 4px;
      }
      .aq-msg.assistant {
        align-self: flex-start;
        background: var(--brand-pale, #e3f0ff);
        color: var(--ink, #1c2116);
        border-bottom-left-radius: 4px;
      }
      .aq-msg.error-msg {
        align-self: flex-start;
        background: var(--error-pale, #fde8e6);
        color: var(--error, #c0392b);
        border-bottom-left-radius: 4px;
        font-size: .78rem;
      }
      .aq-msg.system-msg {
        align-self: center;
        background: var(--surface-2, #f2f4ef);
        color: var(--ink-soft, #6b7a5c);
        font-size: .72rem;
        padding: 5px 10px;
        border-radius: var(--r-full, 9999px);
        max-width: 96%;
        text-align: center;
      }

      /* Typing indicator */
      #aq-typing {
        align-self: flex-start;
        display: none;
        gap: 4px;
        padding: 10px 14px;
        background: var(--brand-pale, #e3f0ff);
        border-radius: 16px;
        border-bottom-left-radius: 4px;
        animation: msg-in .2s ease both;
      }
      #aq-typing.show { display: flex; }
      #aq-typing span {
        width: 7px; height: 7px;
        background: var(--brand-mid, #0d4a7a);
        border-radius: 50%;
        animation: typing-dot 1.2s ease-in-out infinite;
      }
      #aq-typing span:nth-child(2) { animation-delay: .2s; }
      #aq-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes typing-dot {
        0%, 60%, 100% { transform: translateY(0); opacity: .5; }
        30%           { transform: translateY(-5px); opacity: 1; }
      }

      /* Suggestions */
      #aq-chat-suggestions {
        padding: 0 14px 10px;
        display: flex; flex-wrap: wrap; gap: 6px;
        flex-shrink: 0;
      }
      .aq-suggestion {
        background: var(--brand-pale, #e3f0ff);
        color: var(--brand, #1565a8);
        border: 1.5px solid var(--brand-light, #2e8ecf);
        border-radius: var(--r-full, 9999px);
        font-size: .72rem; font-weight: 600;
        padding: 5px 11px;
        cursor: pointer;
        transition: background .15s, color .15s;
        white-space: nowrap;
      }
      .aq-suggestion:hover { background: var(--brand, #1565a8); color: #fff; }

      /* Input bar */
      #aq-chat-form {
        display: flex; align-items: flex-end; gap: 8px;
        padding: 10px 14px;
        border-top: 1px solid var(--border, #e3e8dc);
        background: var(--surface, #fff);
        flex-shrink: 0;
      }
      #aq-chat-input {
        flex: 1;
        background: var(--surface-2, #f2f4ef);
        border: 1.5px solid var(--border, #e3e8dc);
        border-radius: 12px;
        padding: 9px 12px;
        font-family: var(--font-body, system-ui);
        font-size: .83rem;
        color: var(--ink, #1c2116);
        resize: none;
        min-height: 40px; max-height: 110px;
        line-height: 1.4;
        outline: none;
        transition: border-color .15s;
        overflow-y: auto;
      }
      #aq-chat-input:focus { border-color: var(--brand, #1565a8); }
      #aq-chat-input::placeholder { color: var(--ink-faint, #9aab88); }
      #aq-chat-send {
        width: 38px; height: 38px; flex-shrink: 0;
        background: var(--brand, #1565a8);
        border: none; border-radius: 10px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: background .15s, transform .1s;
      }
      #aq-chat-send:hover  { background: var(--brand-mid, #0d4a7a); }
      #aq-chat-send:active { transform: scale(.93); }
      #aq-chat-send:disabled { background: var(--border-dark, #c8d4bc); cursor: not-allowed; }
      #aq-chat-send svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

      /* Cooldown overlay on input */
      #aq-cooldown-bar {
        height: 2px;
        background: var(--gold, #c8932a);
        border-radius: 2px;
        width: 0%;
        transition: width .1s linear;
        position: absolute;
        bottom: 0; left: 0;
      }

      /* Token remaining pill */
      #aq-remaining-pill {
        font-size: .65rem;
        color: var(--ink-faint, #9aab88);
        text-align: right;
        padding: 0 14px 4px;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.innerHTML = `
      <!-- FAB button -->
      <button id="aq-chat-fab" aria-label="Chat with Aria, our AI wellness assistant" aria-expanded="false">
        <div id="aq-chat-dot"></div>
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>

      <!-- Chat panel -->
      <div id="aq-chat-panel" role="dialog" aria-label="Aria — iKrish Product Assistant" aria-modal="true">
        <div id="aq-chat-header">
          <div id="aq-chat-avatar">🌿</div>
          <div id="aq-chat-title">
            <strong>Aria</strong>
            <span>iKrish Wellness Assistant</span>
          </div>
          <button id="aq-chat-close" aria-label="Close chat">✕</button>
        </div>

        <div id="aq-chat-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>
        <div id="aq-typing" aria-label="Aria is typing" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>

        <div id="aq-chat-suggestions" aria-label="Suggested questions"></div>
        <div id="aq-remaining-pill"></div>

        <form id="aq-chat-form" autocomplete="off">
          <textarea
            id="aq-chat-input"
            placeholder="Ask about any iKrish product…"
            rows="1"
            maxlength="500"
            aria-label="Type your message"
          ></textarea>
          <button type="submit" id="aq-chat-send" aria-label="Send message">
            <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(container);
  }

  /* ── Append a message bubble ────────────────────────────────────────────── */
  function appendMessage(role, text) {
    const msgs = $('aq-chat-messages');
    if (!msgs) return;

    const div = document.createElement('div');
    div.className = 'aq-msg ' + (
      role === 'user'      ? 'user'       :
      role === 'error'     ? 'error-msg'  :
      role === 'system'    ? 'system-msg' :
      'assistant'
    );
    div.textContent = text; // always textContent — never innerHTML
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  /* ── Show / hide typing indicator ──────────────────────────────────────── */
  function setTyping(on) {
    isTyping = on;
    const t   = $('aq-typing');
    const btn = $('aq-chat-send');
    const inp = $('aq-chat-input');
    if (!t) return;
    if (on) {
      t.classList.add('show');
      t.setAttribute('aria-hidden', 'false');
      $('aq-chat-messages').scrollTop = $('aq-chat-messages').scrollHeight;
    } else {
      t.classList.remove('show');
      t.setAttribute('aria-hidden', 'true');
    }
    if (btn) btn.disabled = on;
    if (inp) inp.disabled = on;
  }

  /* ── Show suggestion chips ──────────────────────────────────────────────── */
  function showSuggestions(questions) {
    const el = $('aq-chat-suggestions');
    if (!el) return;
    el.innerHTML = '';
    questions.forEach((q) => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'aq-suggestion';
      btn.textContent = q;
      btn.addEventListener('click', () => {
        el.innerHTML = '';
        sendMessage(q);
      });
      el.appendChild(btn);
    });
  }

  /* ── Cooldown countdown ─────────────────────────────────────────────────── */
  function startCooldown(seconds) {
    const btn = $('aq-chat-send');
    const inp = $('aq-chat-input');
    if (btn) btn.disabled = true;
    if (inp) inp.disabled = true;

    let remaining = seconds;
    updateRemainingPill(`⏳ Wait ${remaining}s…`);

    cooldownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        if (btn) btn.disabled = false;
        if (inp) { inp.disabled = false; inp.focus(); }
        updateRemainingPill('');
      } else {
        updateRemainingPill(`⏳ Wait ${remaining}s…`);
      }
    }, 1000);
  }

  function updateRemainingPill(text) {
    const el = $('aq-remaining-pill');
    if (el) el.textContent = text;
  }

  /* ── Core send function ─────────────────────────────────────────────────── */
  async function sendMessage(text) {
    const message = (text || '').trim();
    if (!message || isTyping) return;

    // Client-side minimum interval guard (mirrors server's Layer 5)
    const now     = Date.now();
    const elapsed = now - lastSentAt;
    if (elapsed < MIN_INTERVAL) {
      const waitSec = Math.ceil((MIN_INTERVAL - elapsed) / 1000);
      appendMessage('system', `Please wait ${waitSec}s before sending another message.`);
      return;
    }
    lastSentAt = now;

    // Hide suggestion chips after first interaction
    const suggestEl = $('aq-chat-suggestions');
    if (suggestEl) suggestEl.innerHTML = '';

    // Render user bubble immediately
    appendMessage('user', message);

    // Add to history
    history.push({ role: 'user', parts: [{ text: message }] });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

    // Clear input
    const inp = $('aq-chat-input');
    if (inp) { inp.value = ''; inp.style.height = 'auto'; }

    setTyping(true);

    try {
      const res = await fetch(API_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'X-Session-ID':  getSessionId(),
        },
        body: JSON.stringify({
          message,
          history: history.slice(0, -1), // send all but the message we just added
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Rate limit and known error codes
        const code       = data.errorCode || '';
        const retryAfter = data.retryAfter || 0;

        if (res.status === 429) {
          setTyping(false);
          const errMsg = data.message || 'Too many messages. Please wait.';
          appendMessage('error', errMsg);
          if (retryAfter > 0) startCooldown(Math.min(retryAfter, 60));
          // Pop the user message from history since it wasn't processed
          history.pop();
          return;
        }

        if (res.status === 503) {
          setTyping(false);
          appendMessage('error', data.message || 'The assistant is temporarily unavailable.');
          history.pop();
          return;
        }

        if (code === 'AI_PROMPT_BLOCKED') {
          // Server blocked a jailbreak attempt — show Aria's redirect message naturally
          setTyping(false);
          appendMessage('assistant', data.message);
          history.push({ role: 'model', parts: [{ text: data.message }] });
          return;
        }

        throw new Error(data.message || `HTTP ${res.status}`);
      }

      setTyping(false);
      const reply = data.reply || "Sorry, I couldn't process that. Please try again.";
      appendMessage('assistant', reply);
      history.push({ role: 'model', parts: [{ text: reply }] });

      // Update remaining messages indicator from server header
      const remaining = res.headers.get('X-AI-Session-Remaining');
      if (remaining !== null) {
        const n = parseInt(remaining, 10);
        if (n <= 10) updateRemainingPill(`${n} messages remaining today`);
      }

    } catch (err) {
      setTyping(false);
      appendMessage('error', 'Something went wrong. Please try again.');
      console.error('[chat.js] send error:', err.message);
      // Pop the failed message from history
      if (history.length && history[history.length - 1].role === 'user') {
        history.pop();
      }
    }
  }

  /* ── Toggle panel open/closed ───────────────────────────────────────────── */
  function openChat() {
    isOpen = true;
    const panel = $('aq-chat-panel');
    const fab   = $('aq-chat-fab');
    const dot   = $('aq-chat-dot');
    if (panel) panel.classList.add('open');
    if (fab)   { fab.classList.add('open'); fab.setAttribute('aria-expanded', 'true'); }
    if (dot)   dot.style.display = 'none';

    // Show welcome + suggestions on first open
    const msgs = $('aq-chat-messages');
    if (msgs && msgs.children.length === 0) {
      appendMessage('assistant', "Hi! I'm Aria 🌿 I can help you find the perfect iKrish wellness product. What are you looking for today?");
      showSuggestions(SUGGESTED_QS.slice(0, 3));
    }

    // Focus input
    setTimeout(() => {
      const inp = $('aq-chat-input');
      if (inp) inp.focus();
    }, 280);
  }

  function closeChat() {
    isOpen = false;
    const panel = $('aq-chat-panel');
    const fab   = $('aq-chat-fab');
    if (panel) panel.classList.remove('open');
    if (fab)   { fab.classList.remove('open'); fab.setAttribute('aria-expanded', 'false'); }
  }

  /* ── Auto-resize textarea ───────────────────────────────────────────────── */
  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 110) + 'px';
  }

  /* ── Initialise ─────────────────────────────────────────────────────────── */
  function init() {
    buildWidget();

    // FAB click
    $('aq-chat-fab').addEventListener('click', () => {
      isOpen ? closeChat() : openChat();
    });

    // Close button
    $('aq-chat-close').addEventListener('click', closeChat);

    // Dismiss on outside click
    document.addEventListener('click', (e) => {
      if (!isOpen) return;
      const panel = $('aq-chat-panel');
      const fab   = $('aq-chat-fab');
      if (panel && !panel.contains(e.target) && !fab.contains(e.target)) {
        closeChat();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) closeChat();
    });

    // Form submit
    $('aq-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('aq-chat-input').value.trim();
      if (val) sendMessage(val);
    });

    // Send on Enter (Shift+Enter = newline)
    $('aq-chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) sendMessage(val);
      }
    });

    // Auto-resize textarea
    $('aq-chat-input').addEventListener('input', (e) => {
      autoResize(e.target);
    });

    // Show notification dot after 8 seconds (nudge engagement)
    setTimeout(() => {
      if (!isOpen) {
        const dot = $('aq-chat-dot');
        if (dot) dot.style.display = 'block';
      }
    }, 8000);
  }

  /* ── Run after DOM ready ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
