/**
 * YOUBOT Webchat Widget
 * Embeddable chat widget for external websites.
 *
 * Usage:
 *   <script src="https://youbot.live/widget.js"
 *           data-server="https://youbot.live/your-relay-id"></script>
 *
 * The widget talks to the cloud relay, which bridges to the local YOUBOT.
 */
(function () {
  "use strict";

  const script = document.currentScript;
  const configuredServer = script?.getAttribute("data-server");
  const BASE_URL = (configuredServer
    || (script?.src ? new URL(script.src).origin : window.location.origin)).replace(/\/$/, "");

  if (!window.youbotTelemetry && !document.querySelector('script[data-youbot-telemetry="relay_ui"]')) {
    const telemetryScript = document.createElement("script");
    telemetryScript.src = new URL("/telemetry.js", BASE_URL).href;
    telemetryScript.dataset.youbotTelemetry = "relay_ui";
    telemetryScript.referrerPolicy = "no-referrer";
    document.head.appendChild(telemetryScript);
  }

  // ── State ───────────────────────────────────────────────

  let isOpen = false;
  let messages = [];
  let sessionId = "";
  let widgetConfig = {
    title: "Chat with us",
    color: "#6366f1",
    welcomeMessage: "Hi there! How can I help you today?",
  };
  let isLoading = false;

  // Session persistence
  const STORAGE_KEY = "youbot_webchat_session_" + BASE_URL;
  try { sessionId = localStorage.getItem(STORAGE_KEY) || ""; } catch {}
  if (!sessionId) {
    sessionId = "wc_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
    try { localStorage.setItem(STORAGE_KEY, sessionId); } catch {}
  }

  // ── Styles ──────────────────────────────────────────────

  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

    #youbot-widget-root {
      --youbot-color: ${widgetConfig.color};
      --youbot-radius: 12px;
      --youbot-bg: #0a0a0a;
      --youbot-card: #141414;
      --youbot-border: #262626;
      --youbot-text: #fafafa;
      --youbot-muted: #a1a1aa;
      --youbot-input-bg: #1c1c1c;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      line-height: 1.5;
    }

    #youbot-widget-root * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .youbot-bubble {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--youbot-color);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 0 0 0 rgba(99,102,241,0.3);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      position: relative;
      animation: youbot-pulse 2s ease-in-out infinite;
    }

    @keyframes youbot-pulse {
      0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 0 0 0 rgba(99,102,241,0.3); }
      50% { box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 0 0 8px rgba(99,102,241,0); }
    }

    .youbot-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.4); }

    .youbot-bubble svg { width: 24px; height: 24px; fill: white; transition: transform 0.3s ease; }
    .youbot-bubble.youbot-open svg { transform: rotate(90deg); }

    .youbot-panel {
      position: absolute;
      bottom: 72px;
      right: 0;
      width: 380px;
      max-height: 560px;
      background: var(--youbot-bg);
      border: 1px solid var(--youbot-border);
      border-radius: var(--youbot-radius);
      box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(12px) scale(0.96);
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }

    .youbot-panel.youbot-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: all;
    }

    .youbot-header {
      padding: 16px 20px;
      background: linear-gradient(135deg, var(--youbot-color), color-mix(in srgb, var(--youbot-color) 80%, #000));
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .youbot-header-dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); }
    .youbot-header-title { color: white; font-weight: 600; font-size: 14px; flex: 1; }
    .youbot-header-subtitle { color: rgba(255,255,255,0.7); font-size: 11px; }

    .youbot-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 280px;
      max-height: 380px;
      scrollbar-width: thin;
      scrollbar-color: var(--youbot-border) transparent;
    }

    .youbot-messages::-webkit-scrollbar { width: 4px; }
    .youbot-messages::-webkit-scrollbar-thumb { background: var(--youbot-border); border-radius: 4px; }

    .youbot-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
      animation: youbot-fadeIn 0.25s ease;
    }

    @keyframes youbot-fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .youbot-msg-user { align-self: flex-end; background: var(--youbot-color); color: white; border-bottom-right-radius: 4px; }
    .youbot-msg-bot { align-self: flex-start; background: var(--youbot-card); color: var(--youbot-text); border: 1px solid var(--youbot-border); border-bottom-left-radius: 4px; }
    .youbot-msg-welcome { text-align: center; max-width: 100%; background: transparent; border: none; color: var(--youbot-muted); font-size: 12px; padding: 8px 0; align-self: center; }
    .youbot-msg-time { font-size: 10px; color: var(--youbot-muted); margin-top: 4px; opacity: 0.7; }
    .youbot-msg-user .youbot-msg-time { text-align: right; color: rgba(255,255,255,0.6); }

    .youbot-typing { display: flex; gap: 4px; padding: 12px 16px; align-self: flex-start; background: var(--youbot-card); border: 1px solid var(--youbot-border); border-radius: 16px; border-bottom-left-radius: 4px; }
    .youbot-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--youbot-muted); animation: youbot-typing-bounce 1.4s ease-in-out infinite; }
    .youbot-typing-dot:nth-child(2) { animation-delay: 0.16s; }
    .youbot-typing-dot:nth-child(3) { animation-delay: 0.32s; }
    @keyframes youbot-typing-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

    .youbot-input-area { padding: 12px 16px; border-top: 1px solid var(--youbot-border); display: flex; gap: 8px; flex-shrink: 0; background: var(--youbot-bg); }
    .youbot-input { flex: 1; background: var(--youbot-input-bg); border: 1px solid var(--youbot-border); border-radius: 8px; padding: 10px 14px; color: var(--youbot-text); font-size: 13px; font-family: inherit; outline: none; transition: border-color 0.2s; resize: none; }
    .youbot-input:focus { border-color: var(--youbot-color); }
    .youbot-input::placeholder { color: var(--youbot-muted); }

    .youbot-send-btn { width: 40px; height: 40px; border-radius: 8px; background: var(--youbot-color); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: opacity 0.2s, transform 0.1s; flex-shrink: 0; }
    .youbot-send-btn:hover { opacity: 0.9; }
    .youbot-send-btn:active { transform: scale(0.95); }
    .youbot-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .youbot-send-btn svg { width: 18px; height: 18px; fill: white; }

    .youbot-powered { text-align: center; padding: 6px; font-size: 10px; color: var(--youbot-muted); opacity: 0.6; border-top: 1px solid var(--youbot-border); }

    @media (max-width: 480px) {
      #youbot-widget-root { bottom: 12px; right: 12px; }
      .youbot-panel { width: calc(100vw - 24px); max-height: calc(100dvh - 100px); right: 0; bottom: 68px; }
    }
  `;

  const ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  // ── API ─────────────────────────────────────────────────

  async function fetchConfig() {
    try {
      const r = await fetch(`${BASE_URL}/api/config`);
      if (r.ok) {
        const d = await r.json();
        widgetConfig.title = d.title || widgetConfig.title;
        widgetConfig.color = d.color || widgetConfig.color;
        widgetConfig.welcomeMessage = d.welcomeMessage || widgetConfig.welcomeMessage;
        const root = document.getElementById("youbot-widget-root");
        if (root) root.style.setProperty("--youbot-color", widgetConfig.color);
        const bubble = root?.querySelector(".youbot-bubble");
        if (bubble) bubble.style.background = widgetConfig.color;
        const title = root?.querySelector(".youbot-header-title");
        if (title) title.textContent = widgetConfig.title;
      }
    } catch {}
  }

  async function fetchHistory() {
    if (isLoading) return;
    try {
      const r = await fetch(`${BASE_URL}/api/history?session=${sessionId}`);
      if (r.ok) {
        const d = await r.json();
        if (d.messages?.length && !isLoading) {
          messages = d.messages.map(m => ({
            id: m.id,
            role: m.role === "user" ? "user" : "bot",
            text: m.content,
            time: new Date(m.timestamp),
          }));
          renderMessages();
        }
      }
    } catch {}
  }

  let checkingReplies = false;
  async function receiveReplies() {
    if (!isOpen || document.hidden || checkingReplies) return;
    checkingReplies = true;
    try {
      const response = await fetch(`${BASE_URL}/api/history?session=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      let changed = false;
      for (const event of data.messages || []) {
        if (event.delivery !== 'session' || !event.id || messages.some(message => message.id === event.id)) continue;
        messages.push({ id: event.id, role: 'bot', text: event.content, time: new Date(event.timestamp) });
        changed = true;
      }
      if (changed) renderMessages();
    } catch { /* Retry when the visitor reconnects. */ }
    finally { checkingReplies = false; }
  }
  setInterval(receiveReplies, 3000);
  document.addEventListener('visibilitychange', receiveReplies);
  window.addEventListener('online', receiveReplies);

  async function sendMessage(text) {
    window.youbotTelemetry?.event('relay_message', { outcome: 'accepted', media_kind: 'text' });
    messages.push({ role: "user", text, time: new Date() });
    isLoading = true;
    renderMessages();

    try {
      const r = await fetch(`${BASE_URL}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionId, message: text }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.response) messages.push({ role: "bot", text: d.response, time: new Date() });
        window.youbotTelemetry?.event('relay_message', { outcome: d.timeout ? 'timeout' : 'replied', media_kind: 'text' });
      } else {
        window.youbotTelemetry?.event('relay_message', { outcome: 'client_error', media_kind: 'text' });
        messages.push({ role: "bot", text: "Sorry, something went wrong.", time: new Date() });
      }
    } catch {
      window.youbotTelemetry?.event('relay_message', { outcome: 'client_error', media_kind: 'text' });
      messages.push({ role: "bot", text: "Connection error. Please try again.", time: new Date() });
    }

    isLoading = false;
    renderMessages();
  }

  function escapeHtml(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
  function formatTime(d) { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

  function renderMessages() {
    const container = document.querySelector(".youbot-messages");
    if (!container) return;
    let html = "";
    if (messages.length === 0) html += `<div class="youbot-msg youbot-msg-welcome">${escapeHtml(widgetConfig.welcomeMessage)}</div>`;
    for (const msg of messages) {
      const cls = msg.role === "user" ? "youbot-msg-user" : "youbot-msg-bot";
      html += `<div class="youbot-msg ${cls}">${escapeHtml(msg.text)}<div class="youbot-msg-time">${formatTime(msg.time)}</div></div>`;
    }
    if (isLoading) html += `<div class="youbot-typing"><div class="youbot-typing-dot"></div><div class="youbot-typing-dot"></div><div class="youbot-typing-dot"></div></div>`;
    container.innerHTML = html;
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  // ── Mount ───────────────────────────────────────────────

  function mount() {
    const style = document.createElement("style");
    style.textContent = STYLES;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "youbot-widget-root";
    root.innerHTML = `
      <div class="youbot-panel" id="youbot-panel">
        <div class="youbot-header">
          <div class="youbot-header-dot"></div>
          <div><div class="youbot-header-title">${escapeHtml(widgetConfig.title)}</div><div class="youbot-header-subtitle">Typically replies instantly</div></div>
        </div>
        <div class="youbot-messages"></div>
        <div class="youbot-input-area">
          <input class="youbot-input" placeholder="Type a message..." id="youbot-input" autocomplete="off" />
          <button class="youbot-send-btn" id="youbot-send">${ICON_SEND}</button>
        </div>
        <div class="youbot-powered">Powered by YOUBOT</div>
      </div>
      <button class="youbot-bubble" id="youbot-bubble">${ICON_CHAT}</button>
    `;
    document.body.appendChild(root);

    const bubble = document.getElementById("youbot-bubble");
    const panel = document.getElementById("youbot-panel");
    const input = document.getElementById("youbot-input");
    const sendBtn = document.getElementById("youbot-send");

    bubble.addEventListener("click", () => {
      isOpen = !isOpen;
      window.youbotTelemetry?.event('ui_interaction', { interaction: 'click', control: 'button', action: isOpen ? 'widget_open' : 'widget_close' });
      bubble.innerHTML = isOpen ? ICON_CLOSE : ICON_CHAT;
      bubble.classList.toggle("youbot-open", isOpen);
      panel.classList.toggle("youbot-visible", isOpen);
      if (isOpen) {
        fetchConfig();
        if (messages.length === 0) fetchHistory();
        renderMessages();
        setTimeout(() => input.focus(), 300);
      }
    });

    const handleSend = () => {
      const text = input.value.trim();
      if (!text || isLoading) return;
      input.value = "";
      sendMessage(text);
    };

    sendBtn.addEventListener("click", handleSend);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    renderMessages();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
