/* Shared event transport. Only legacy relays use periodic HTTP history checks. */
(function (global) {
  'use strict';
  function create(options) {
    let stopped = false, socket, socketTimer, heartbeatTimer, pongTimer, timer, legacyTimer, mode = null, attempt = 0, discovering = false;
    const requests = new Set();
    let fetching = false, refreshAgain = false, refreshTimer, refreshAttempt = 0;
    const base = options.base.replace(/\/$/, '');
    async function readJson(url) {
      const controller = new AbortController();
      requests.add(controller);
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Relay unavailable');
        return await response.json();
      } finally {
        clearTimeout(deadline);
        requests.delete(controller);
      }
    }
    async function refresh() {
      if (stopped) return;
      if (fetching) { refreshAgain = true; return; }
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
      fetching = true;
      try {
        const data = await readJson(base + '/api/history?session=' + encodeURIComponent(options.session));
        if (!stopped) options.onHistory(data, mode === 'push');
        refreshAttempt = 0;
      } catch {
        // Retry an unsuccessful reconciliation, never poll a healthy push relay.
        if (!stopped) refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, Math.min(30000, 1000 * Math.pow(2, Math.min(refreshAttempt++, 5))));
      }
      finally {
        fetching = false;
        if (refreshAgain) { refreshAgain = false; refresh(); }
      }
    }
    function retry(fn) {
      if (stopped || timer) return;
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt++, 5))) + Math.floor(Math.random() * 500);
      timer = setTimeout(() => { timer = null; fn(); }, delay);
    }
    function clearSocketTimers() {
      clearTimeout(socketTimer); clearTimeout(heartbeatTimer); clearTimeout(pongTimer);
      socketTimer = heartbeatTimer = pongTimer = null;
    }
    function connect() {
      if (stopped || socket) return;
      try {
        const url = new URL(base + '/api/events');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('session', options.session);
        const current = socket = new WebSocket(url.href);
        const retire = () => {
          if (socket !== current) return;
          socket = null;
          clearSocketTimers();
          try { current.close(); } catch {}
          retry(connect);
        };
        const heartbeat = () => {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = setTimeout(() => {
            if (socket !== current || stopped) return;
            pongTimer = setTimeout(retire, 10000);
            try { current.send('ping'); } catch { retire(); }
          }, 60000);
        };
        // A failed handshake may never emit close; require the relay's ready
        // event before treating this socket as usable.
        socketTimer = setTimeout(retire, 10000);
        current.onmessage = event => {
          if (socket !== current || stopped) return;
          if (event.data === 'pong') { clearTimeout(pongTimer); pongTimer = null; heartbeat(); return; }
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'ready') { clearTimeout(socketTimer); socketTimer = null; attempt = 0; heartbeat(); refresh(); }
            else if (data.type === 'history_changed' || data.type === 'message_completed') refresh();
          } catch { /* Ignore malformed notifications. */ }
        };
        current.onclose = retire;
        current.onerror = retire;
      } catch { socket = null; retry(connect); }
    }
    async function discover() {
      if (stopped || discovering) return;
      discovering = true;
      try {
        const health = await readJson(base + '/health');
        if (stopped) return;
        mode = health.capabilities?.asyncMessages ? 'push' : 'legacy';
        options.onMode?.(mode);
        if (mode === 'push') connect();
        else {
          refresh();
          legacyTimer = setInterval(() => { if (!document.hidden && (!options.active || options.active())) refresh(); }, 3000);
        }
      } catch { retry(discover); }
      finally { discovering = false; }
    }
    function resume() {
      if (stopped || document.hidden) return;
      refresh();
      if (mode === 'push') {
        if (socket) { const old = socket; socket = null; clearSocketTimers(); old.close(); }
        if (timer) { clearTimeout(timer); timer = null; }
        connect();
      } else if (mode === null && !timer) discover();
    }
    document.addEventListener('visibilitychange', resume);
    global.addEventListener('online', resume);
    discover();
    return {
      refresh,
      stop() {
        stopped = true;
        clearTimeout(timer); clearSocketTimers(); clearTimeout(refreshTimer); clearInterval(legacyTimer);
        for (const controller of requests) controller.abort();
        requests.clear();
        document.removeEventListener('visibilitychange', resume);
        global.removeEventListener('online', resume);
        if (socket) { const old = socket; socket = null; old.close(); }
      },
    };
  }
  function id() {
    if (global.crypto.randomUUID) return global.crypto.randomUUID();
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  global.YoubotSessionTransport = { create, id };
})(window);
