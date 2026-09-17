/**
 * Webchat API Routes
 * Public endpoints for the embeddable chat widget.
 * These endpoints use connection_token for auth (not owner auth).
 */

import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { parseBody, json, error, type ApiContext } from '../context.js';
import { handleIncomingMessage, type UnifiedMessage, type UnifiedDeps } from '../../engine/handler.js';
import { loadYoubotConfig, saveYoubotConfig, type YoubotConfig } from '../../data/config.js';

// ─── Token Validation ────────────────────────────────────

function getConnectionToken(): string | null {
  const cfg = loadYoubotConfig();
  return cfg.channels?.webchat?.connection_token || null;
}

function validateToken(req: http.IncomingMessage, url: string, body?: any): boolean {
  const token = getConnectionToken();
  if (!token) return false;

  // Check query param
  const urlObj = new URL(url, 'http://localhost');
  const queryToken = urlObj.searchParams.get('token');
  if (queryToken === token) return true;

  // Check body
  if (body?.token === token) return true;

  // Check header
  const headerToken = req.headers['x-webchat-token'];
  if (headerToken === token) return true;

  return false;
}

// ─── Route Handler ───────────────────────────────────────

export async function handleWebchatRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {

  // ── Widget Config ──────────────────────────────────────
  // GET /api/webchat/config?token=xxx
  if (url.startsWith('/api/webchat/config') && method === 'GET') {
    if (!validateToken(req, url)) {
      error(res, 'Invalid or missing connection token', 401);
      return true;
    }

    const cfg = loadYoubotConfig();
    const webchat = cfg.channels?.webchat || {};

    json(res, {
      enabled: webchat.enabled !== false,
      title: webchat.widget_title || 'Chat with us',
      color: webchat.widget_color || '#6366f1',
      welcomeMessage: webchat.welcome_message || 'Hi there! How can I help you today?',
    });
    return true;
  }

  // ── Send Message ───────────────────────────────────────
  // POST /api/webchat/message
  if (url === '/api/webchat/message' && method === 'POST') {
    const body = await parseBody(req) as any;

    if (!validateToken(req, url, body)) {
      error(res, 'Invalid or missing connection token', 401);
      return true;
    }

    if (!ctx.agentOrchestrator) {
      error(res, 'Agent not initialized', 503);
      return true;
    }

    const cfg = loadYoubotConfig();
    if (cfg.channels?.webchat?.enabled === false) {
      error(res, 'Webchat channel is disabled', 403);
      return true;
    }

    const message = body.message || '';
    const session = body.session || uuidv4();
    const name = body.name || 'Website Visitor';

    if (!message.trim()) {
      error(res, 'Message is required');
      return true;
    }

    // Collect the response via a promise-based replyFn
    let responseText = '';

    const unified: UnifiedMessage = {
      channel: 'webchat',
      senderId: session,
      senderName: name,
      body: message,
      timestamp: new Date(),
      replyFn: async (text: string) => {
        responseText = text;
      },
    };

    const deps: UnifiedDeps = {
      orchestrator: ctx.agentOrchestrator,
      approvalStore: ctx.approvalStore || null,
      followUpStore: null,
      eventBus: ctx.eventBus || null,
      skillEngine: ctx.skillEngine || null,
      saveConfigValue: ctx.saveConfigValue || (() => {}),
      relayMessage: ctx.relayMessage,
    };

    try {
      const result = await handleIncomingMessage(unified, deps);

      json(res, {
        response: responseText || result.response || '',
        sessionId: result.sessionId,
        handled: result.handled,
      });
    } catch (err: any) {
      console.error('[Webchat] Message error:', err.message);
      error(res, 'Failed to process message', 500);
    }
    return true;
  }

  // ── Conversation History ───────────────────────────────
  // GET /api/webchat/history?token=xxx&session=yyy
  if (url.startsWith('/api/webchat/history') && method === 'GET') {
    if (!validateToken(req, url)) {
      error(res, 'Invalid or missing connection token', 401);
      return true;
    }

    if (!ctx.agentOrchestrator) {
      json(res, { messages: [] });
      return true;
    }

    const urlObj = new URL(url, 'http://localhost');
    const session = urlObj.searchParams.get('session');
    if (!session) {
      error(res, 'session parameter is required');
      return true;
    }

    const sessionId = `webchat:${session}`;
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const store = ctx.agentOrchestrator.getConversationStore();
    const messages = await store.getHistory(sessionId, limit);

    // Filter to only return user and assistant messages (not system/tool)
    const filtered = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));

    json(res, { messages: filtered, sessionId });
    return true;
  }

  return false;
}

// ─── Token Auto-Generation ───────────────────────────────

/**
 * Ensures a webchat connection_token exists in config.
 * Called during server initialization.
 */
export function ensureWebchatToken(options: {
  loadConfig?: () => YoubotConfig;
  saveConfig?: (config: YoubotConfig) => void;
  createToken?: () => string;
} = {}): string {
  const load = options.loadConfig || loadYoubotConfig;
  const save = options.saveConfig || saveYoubotConfig;
  const cfg = load();
  if (cfg.channels?.webchat?.enabled === false) return '';
  if (!cfg.channels) cfg.channels = {};
  if (!cfg.channels.webchat) cfg.channels.webchat = {};

  if (!cfg.channels.webchat.connection_token) {
    const token = options.createToken?.() || uuidv4();
    cfg.channels.webchat.connection_token = token;
    // Default to enabled with auto-reply on
    if (cfg.channels.webchat.enabled === undefined) cfg.channels.webchat.enabled = true;
    if (cfg.channels.webchat.auto_reply === undefined) cfg.channels.webchat.auto_reply = true;
    save(cfg);
    console.log('[Webchat] Generated a new connection token');
    return token;
  }

  return cfg.channels.webchat.connection_token;
}
