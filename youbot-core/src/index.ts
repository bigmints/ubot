import http from 'http';
import fs from 'fs';
import path from 'path';

import { handleApiRoute, initializeApi } from './api/index.js';
import { setSessionValidator } from './api/middleware/auth.js';
import { metricsCollector } from './metrics/index.js';
import { log } from './logger/ring-buffer.js';
import { createConnection, createDefaultConfig } from './data/database/connection.js';
import { createConversationStore } from './memory/conversation.js';
import { createMemoryStore } from './memory/memory-store.js';
import { createFollowUpStore } from './memory/followups.js';
import { initPromptExperiments } from './engine/prompt-experiment.js';
import { initMetering } from './engine/metering.js';
import { createSoul } from './memory/soul.js';
import { createAgentOrchestrator } from './engine/orchestrator.js';
import { DEFAULT_AGENT_CONFIG } from './engine/types.js';
import { loadYoubotConfig, saveYoubotConfig, resolveAuthConfig, type YoubotConfig } from './data/config.js';
import { FEATURES, MODE, RAW_MODE } from './lib/features.js';
import { getHooks } from './hooks/extensions.js';
import { loadCustomApps, getCustomToolModules } from './lib/app-loader.js';
import { LocalWorkspaceProvider } from './data/local-workspace.js';
import type { WorkspaceProvider } from './data/workspace-provider.js';
import crypto from 'crypto';

// ─── YOUBOT_HOME resolution ──────────────────────────────────────────────────────
const YOUBOT_HOME = process.env.YOUBOT_HOME || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!YOUBOT_HOME;

const youbotConfig = loadYoubotConfig();

// ── Ensure auth is always configured ────────────────────────
// Resolve auth from config (supports both new server.auth and deprecated flat fields)
const resolvedAuth = resolveAuthConfig(youbotConfig);

if (resolvedAuth.mode === 'local' && !resolvedAuth.password) {
  // Local mode with no password — auto-generate one
  const generated = crypto.randomBytes(12).toString('base64url');

  // Write to the new auth section
  if (!youbotConfig.server) youbotConfig.server = {};
  if (!youbotConfig.server.auth) youbotConfig.server.auth = {};
  youbotConfig.server.auth.mode = 'local';
  youbotConfig.server.auth.username = resolvedAuth.username;
  youbotConfig.server.auth.password = generated;
  // Clean up deprecated flat fields if present
  delete youbotConfig.server.access_username;
  delete youbotConfig.server.access_password;
  saveYoubotConfig(youbotConfig);

  resolvedAuth.password = generated;

  console.log('');
  console.log('┌─────────────────────────────────────────────────┐');
  console.log('│  🔐 Auth credentials auto-generated             │');
  console.log('│  Username: saved in protected config.json.         │');
  console.log('│  Password: saved in protected config.json.         │');
  console.log('│  Saved to config.json — change anytime.         │');
  console.log('└─────────────────────────────────────────────────┘');
  console.log('');
} else if (resolvedAuth.mode === 'sso') {
  console.log(`[Auth] SSO mode — provider: ${resolvedAuth.provider ?? 'extension'}, auth_url: ${resolvedAuth.auth_url ?? 'n/a'}`);
}

const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
const PORT = envPort || youbotConfig.server?.port || 11490;

function resolveServerHost(configuredHost?: string, environment = process.env): string {
  return environment.YOUBOT_HOST || configuredHost || '127.0.0.1';
}

const HOST = resolveServerHost(youbotConfig.server?.host);

// In-memory application state
interface AppState {
  name: string;
  version: string;
  startedAt: Date;
  requestCount: number;
}

const appState: AppState = {
  name: 'Youbot Core',
  version: '1.0.0',
  startedAt: new Date(),
  requestCount: 0,
};

// Initialize database
const db = createConnection({
  config: Object.assign({}, createDefaultConfig(), youbotConfig.database || {})
});

initPromptExperiments(db);

// Initialize LLM usage metering
initMetering(db);

// Initialize persistent tool metrics
metricsCollector.setDatabase(db as any);


// Initialize agent — read workspace path from config
const configWsPath = youbotConfig.workspace?.path;
const WORKSPACE_PATH = configWsPath
  ? (path.isAbsolute(configWsPath) ? configWsPath : path.join(YOUBOT_HOME || process.cwd(), configWsPath))
  : YOUBOT_HOME
    ? path.join(YOUBOT_HOME, 'workspace')
    : path.join(process.cwd(), 'workspace');

// Create workspace provider — hooks can override this (e.g. GCS for cloud-shared)
let workspace: WorkspaceProvider = new LocalWorkspaceProvider(WORKSPACE_PATH);
const wsHook = getHooks().workspace;
if (wsHook) {
  const custom = wsHook.createWorkspaceProvider({ defaultPath: WORKSPACE_PATH, youbotHome: YOUBOT_HOME });
  if (custom) {
    workspace = custom;
    console.log(`[Workspace] Using custom provider: ${workspace.rootPath}`);
  }
}
// Make workspace accessible via globalThis for extensions
(globalThis as any).__workspaceProvider = workspace;

const conversationStore = createConversationStore(db);
const memoryStore = createMemoryStore(db);
const followUpStore = createFollowUpStore(db);
const soul = createSoul(memoryStore, WORKSPACE_PATH, workspace);

// Initial sync of soul documents to filesystem
soul.syncToFilesystem();
// Initialize API first to get skillRepo/skillEngine
const { skillRepo, skillEngine } = initializeApi(db as any, undefined, WORKSPACE_PATH, followUpStore, workspace);

const agent = createAgentOrchestrator(
  {
    ...DEFAULT_AGENT_CONFIG,
    llmBaseUrl: youbotConfig.llm?.base_url || DEFAULT_AGENT_CONFIG.llmBaseUrl,
    llmModel: youbotConfig.llm?.model || DEFAULT_AGENT_CONFIG.llmModel,
    llmApiKey: youbotConfig.llm?.api_key || youbotConfig.llm?.google_api_key || DEFAULT_AGENT_CONFIG.llmApiKey,
    ownerName: youbotConfig.ownerName || DEFAULT_AGENT_CONFIG.ownerName,
    ownerPhone: youbotConfig.owner?.phone || DEFAULT_AGENT_CONFIG.ownerPhone,
    ownerTelegramId: youbotConfig.owner?.telegram_id || DEFAULT_AGENT_CONFIG.ownerTelegramId,
    ownerTelegramUsername: youbotConfig.owner?.telegram_username || DEFAULT_AGENT_CONFIG.ownerTelegramUsername,
    autoReplyWhatsApp: youbotConfig.channels?.whatsapp?.auto_reply ?? DEFAULT_AGENT_CONFIG.autoReplyWhatsApp,
    autoReplyTelegram: youbotConfig.channels?.telegram?.auto_reply ?? DEFAULT_AGENT_CONFIG.autoReplyTelegram,
    autoReplyWebchat: youbotConfig.channels?.webchat?.auto_reply ?? DEFAULT_AGENT_CONFIG.autoReplyWebchat,
    ownerWebchatKey: youbotConfig.channels?.webchat?.owner_key || DEFAULT_AGENT_CONFIG.ownerWebchatKey,
    maxHistoryMessages: youbotConfig.agent?.max_history_messages ?? DEFAULT_AGENT_CONFIG.maxHistoryMessages,
    systemPrompt: youbotConfig.agent?.system_prompt || DEFAULT_AGENT_CONFIG.systemPrompt,
  },
  conversationStore,
  memoryStore,
  followUpStore,
  soul,
  db as any,
  WORKSPACE_PATH,
  skillRepo as any,
  skillEngine as any,
);

// Re-initialize API with the agent now that it's created
const { skillEngine: liveSkillEngine } = initializeApi(db as any, agent, WORKSPACE_PATH, followUpStore, workspace);

// Inject the live skill engine into the orchestrator (it was null on the first init)
if (liveSkillEngine) {
  agent.setSkillEngine(liveSkillEngine);
}

// Initialize integrations from config.json
const serperCfg = youbotConfig.capabilities?.search?.providers?.serper;

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// In production, serve the static Next.js export from YOUBOT_HOME/web-ui/
// In development, serve from ./public
const STATIC_DIRS = IS_PRODUCTION
  ? [path.join(process.cwd(), 'web')]
  : [path.join(process.cwd(), 'public')];

function serveStatic(filePath: string): Promise<{ content: Buffer; contentType: string } | null> {
  return new Promise((resolve) => {
    // Try each static directory in order
    const tryDir = (dirs: string[]) => {
      if (dirs.length === 0) { resolve(null); return; }
      const fullPath = path.join(dirs[0], filePath);
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          tryDir(dirs.slice(1));
        } else {
          resolve({ content: data, contentType: getMimeType(filePath) });
        }
      });
    };
    tryDir([...STATIC_DIRS]);
  });
}

function failResponse(res: http.ServerResponse, statusCode: number, body: string, error?: Error): void {
  if (res.writableEnded || res.destroyed) return;

  if (res.headersSent) {
    res.destroy(error);
    return;
  }

  res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
  res.end(body);
}

// ─── Session store for access gate ────────────────────────────────────────────
const activeSessions = new Map<string, { createdAt: number }>();
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_COOKIE_NAME = 'youbot_session';
const MAX_ACTIVE_SESSIONS = 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function applySecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
    "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
  );
  if (isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function isSecureRequest(req: http.IncomingMessage): boolean {
  const headers = req.headers || {};
  const forwardedProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true
    || forwardedProto === 'https'
    || process.env.YOUBOT_COOKIE_SECURE === 'true';
}

function secureEquals(actual: unknown, expected: string | undefined): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualDigest = crypto.createHash('sha256').update(actual).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function loginClientId(req: http.IncomingMessage): string {
  return req.socket?.remoteAddress || 'unknown';
}

function loginRetryAfter(req: http.IncomingMessage): number {
  const key = loginClientId(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.delete(key);
    return 0;
  }
  return entry.count >= MAX_LOGIN_ATTEMPTS ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

function recordLoginFailure(req: http.IncomingMessage): void {
  const key = loginClientId(req);
  const now = Date.now();
  const current = loginAttempts.get(key);
  loginAttempts.set(key, !current || current.resetAt <= now
    ? { count: 1, resetAt: now + LOGIN_WINDOW_MS }
    : { ...current, count: current.count + 1 });
}

function readRequestBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (size > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!settled) resolve(body);
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function createSession(): string {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) activeSessions.delete(token);
  }
  while (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldest = activeSessions.keys().next().value;
    if (!oldest) break;
    activeSessions.delete(oldest);
  }
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, { createdAt: now });
  return token;
}

function validateSession(token: string): boolean {
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function getSessionFromCookie(req: http.IncomingMessage): string | null {
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match ? match.split('=')[1] : null;
}

function setSessionCookie(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
  const maxAge = SESSION_MAX_AGE_MS / 1000;
  const secure = isSecureRequest(req);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function safeExternalAuthUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function authenticateSsoRequest(req: http.IncomingMessage): Promise<boolean> {
  const authHook = getHooks().auth;
  if (!authHook) return false;
  try {
    const result = await authHook.authenticate(req);
    return result?.authenticated === true;
  } catch (error: any) {
    log.warn('Auth', `SSO validation failed: ${error?.message || 'unknown error'}`);
    return false;
  }
}

async function getReadinessReport(): Promise<{
  status: 'ok' | 'unhealthy';
  version: string;
  checks: { database: boolean; dashboard: boolean };
  timestamp: string;
}> {
  let database = false;
  try {
    const result = await db.get<{ ok: number }>('SELECT 1 AS ok');
    database = result?.ok === 1;
  } catch {
    database = false;
  }

  let dashboard = true;
  if (IS_PRODUCTION) {
    try {
      dashboard = Boolean(await serveStatic('/index.html'));
    } catch {
      dashboard = false;
    }
  }

  return {
    status: database && dashboard ? 'ok' : 'unhealthy',
    version: appState.version,
    checks: { database, dashboard },
    timestamp: new Date().toISOString(),
  };
}

function shouldApplyServerAccessGate(
  mode: 'local' | 'sso',
  password: string | undefined,
  method: string,
  url: string,
): boolean {
  if (method === 'OPTIONS' || !url.startsWith('/api/')) return false;
  const isPublic = url === '/api/health'
    || url.startsWith('/api/webchat/')
    || url === '/api/auth/status'
    || url === '/api/auth/login';
  if (isPublic) return false;
  return mode === 'sso' || Boolean(password);
}

// Wire session validation into API auth middleware so dashboard cookie auth works
setSessionValidator(validateSession);

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const fullUrl = req.url || '/';
  const url = fullUrl.split('?')[0];
  const method = req.method || 'GET';
  applySecurityHeaders(req, res);

  // Security: prevent directory traversal
  if (url.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  appState.requestCount++;
  // ── Extension middleware hook — runs before all routing ──
  const hooks = getHooks();
  if (hooks.middleware?.onRequest) {
    const handled = await hooks.middleware.onRequest(req, res, url, method);
    if (handled) return;
  }

  // ── Server-level access gate ──────────────────────────────
  // Protect API endpoints before any direct route handler executes. The API
  // router also authorizes its routes; this outer gate covers profile,
  // password and shutdown routes implemented in this file.
  if (method !== 'OPTIONS' && process.env.NODE_ENV !== 'test') {
    // Only gate API endpoints — frontend pages/assets must always load
    // so the AuthGate component can render the login form
    const shouldGate = shouldApplyServerAccessGate(
      resolvedAuth.mode,
      resolvedAuth.password,
      method,
      url,
    );

    if (shouldGate) {
      const authHeader = req.headers?.['authorization'] || '';
      let authorized = false;

      // Check 1: Valid session cookie
      const sessionToken = getSessionFromCookie(req);
      if (sessionToken && validateSession(sessionToken)) {
        authorized = true;
      }

      // Check 2: Valid Bearer API key (for programmatic access)
      if (!authorized && authHeader.startsWith('Bearer ')) {
        const { authenticate: apiAuth } = await import('./api/middleware/auth.js');
        const result = apiAuth(req);
        if (result.authenticated && result.clientName !== 'default (no keys configured)') {
          authorized = true;
        }
      }

      // SSO auth is fail-closed when the plugin is absent, rejects the
      // session, or encounters an error.
      if (!authorized && resolvedAuth.mode === 'sso') {
        authorized = await authenticateSsoRequest(req);
      }

      if (!authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }
  }

  // ── Auth endpoints (login / logout / status) ──────────────
  if (url === '/api/auth/status' && method === 'GET') {
    if (resolvedAuth.mode === 'sso') {
      const authHook = getHooks().auth;
      const authenticated = await authenticateSsoRequest(req);
      const authUrl = safeExternalAuthUrl(authHook?.getLoginUrl?.(fullUrl) || resolvedAuth.auth_url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        authenticated,
        authRequired: true,
        authMode: 'sso',
        authUrl,
      }));
      return;
    }

    // Local mode
    const requiresAuth = !!resolvedAuth.password;
    if (!requiresAuth) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: true, authRequired: false, authMode: 'local' }));
      return;
    }
    const token = getSessionFromCookie(req);
    const valid = token ? validateSession(token) : false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: valid, authRequired: true, authMode: 'local' }));
    return;
  }

  if (url === '/api/auth/login' && method === 'POST') {
    if (resolvedAuth.mode === 'sso') {
      const authHook = getHooks().auth;
      const authUrl = safeExternalAuthUrl(authHook?.getLoginUrl?.('/') || resolvedAuth.auth_url);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Local login is disabled in SSO mode', authUrl }));
      return;
    }
    if (!resolvedAuth.password) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'No local auth required' }));
      return;
    }

    try {
      const retryAfter = loginRetryAfter(req);
      if (retryAfter > 0) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
        res.end(JSON.stringify({ success: false, error: 'Too many login attempts. Try again later.' }));
        return;
      }
      const body = await readRequestBody(req);
      const { username, password } = JSON.parse(body);
      if (secureEquals(username, resolvedAuth.username) && secureEquals(password, resolvedAuth.password)) {
        loginAttempts.delete(loginClientId(req));
        const token = createSession();
        setSessionCookie(req, res, token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        recordLoginFailure(req);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid username or password' }));
      }
    } catch (error: any) {
      const status = error?.statusCode === 413 ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: status === 413 ? 'Payload too large' : 'Invalid request body' }));
    }
    return;
  }

  if (url === '/api/auth/logout' && method === 'POST') {
    const token = getSessionFromCookie(req);
    if (token) activeSessions.delete(token);
    clearSessionCookie(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ── User profile endpoint ─────────────────────────────────
  if (url === '/api/auth/profile' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      username: resolvedAuth.username,
      authMode: resolvedAuth.mode,
    }));
    return;
  }

  // ── Change password endpoint ──────────────────────────────
  if (url === '/api/auth/password' && method === 'PUT') {
    if (resolvedAuth.mode !== 'local') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Password change is not supported in SSO mode' }));
      return;
    }

    try {
      const body = await readRequestBody(req);
      const { currentPassword, newPassword } = JSON.parse(body);

      if (!currentPassword || !newPassword) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Both current and new password are required' }));
        return;
      }

      if (!secureEquals(currentPassword, resolvedAuth.password)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Current password is incorrect' }));
        return;
      }

      if (typeof newPassword !== 'string' || newPassword.length < 12) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'New password must be at least 12 characters' }));
        return;
      }

      // Update in-memory and persist to config
      resolvedAuth.password = newPassword;
      if (!youbotConfig.server) youbotConfig.server = {};
      if (!youbotConfig.server.auth) youbotConfig.server.auth = {};
      youbotConfig.server.auth.password = newPassword;
      saveYoubotConfig(youbotConfig);

      // Revoke every existing session and issue a fresh one to the caller.
      activeSessions.clear();
      const token = createSession();
      setSessionCookie(req, res, token);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error: any) {
      const status = error?.statusCode === 413 ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: status === 413 ? 'Payload too large' : 'Invalid request body' }));
    }
    return;
  }

  // Health check endpoint
  if (url === '/health' && method === 'GET') {
    const report = await getReadinessReport();
    res.writeHead(report.status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
    return;
  }

  // Graceful shutdown endpoint (authenticated — after login check above)
  if (url === '/api/shutdown' && method === 'POST') {
    (async () => {
      try {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'shutting-down', message: 'Graceful shutdown in progress...' }));
        const { gracefulShutdown } = await import('./api/index.js');
        await gracefulShutdown();
        // Exit after cleanup
        setTimeout(() => process.exit(0), 2000);
      } catch (err: any) {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    })();
    return;
  }

  // Feature flags endpoint — used by frontend to know available features
  if (url === '/api/features' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode: RAW_MODE, features: FEATURES }));
    return;
  }

  // API endpoint for app state
  if (url === '/api/state' && method === 'GET') {
    const metrics = metricsCollector.getSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...appState,
      uptime: Date.now() - appState.startedAt.getTime(),
      metrics: {
        channels: metrics.channels,
        totals: metrics.totals,
      },
    }));
    return;
  }

  // Full metrics endpoint
  if (url === '/api/metrics' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metricsCollector.getSummary()));
    return;
  }

  // Live logs endpoint (cursor-based polling)
  if (url.startsWith('/api/logs') && method === 'GET') {
    const params = new URL(url, `http://localhost`).searchParams;
    const since = params.has('since') ? Number(params.get('since')) : -1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(log.getEntries(since)));
    return;
  }

  // Route all /api/* to the API router
  if (url.startsWith('/api/')) {
    const handled = await handleApiRoute(req, res, url, method);
    if (handled) return;

    // Extension route hook — handle fork-specific API routes
    if (hooks.routes?.handleRoute) {
      const extHandled = await hooks.routes.handleRoute(req, res, url, method);
      if (extHandled) return;
    }
  }

  // Serve frontend pages
  if (!IS_PRODUCTION) {
    // ── Dev mode: proxy to Next.js dev server for hot reload ──────────
    const DEV_FRONTEND_PORT = youbotConfig.server?.frontend_port ?? parseInt(process.env.DEV_FRONTEND_PORT || '3015', 10);
    const proxyReq = http.request(
      {
        hostname: 'localhost',
        port: DEV_FRONTEND_PORT,
        path: url,
        method: method,
        headers: { ...req.headers, host: `localhost:${DEV_FRONTEND_PORT}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );
    proxyReq.on('error', (error) => {
      failResponse(
        res,
        502,
        `Frontend dev server not ready (port ${DEV_FRONTEND_PORT}). Run: cd web-ui && npm run dev`,
        error instanceof Error ? error : undefined
      );
    });
    req.pipe(proxyReq, { end: true });
    return;
  }

  // ── Production: serve static files (Next.js static export) ─────────
  let filePath = url === '/' ? '/index.html' : url;

  // Try exact path, then .html suffix, then /index.html (Next.js static export routes)
  let file = await serveStatic(filePath);
  if (!file && !path.extname(filePath)) {
    file = await serveStatic(filePath + '.html');
    if (!file) file = await serveStatic(filePath + '/index.html');
  }

  if (file) {
    // Cache static assets, no-cache for HTML
    const cacheControl = file.contentType === 'text/html'
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': file.contentType, 'Cache-Control': cacheControl });
    res.end(file.content);
  } else {
    // SPA fallback: serve index.html for non-API, non-static routes
    if (!url.startsWith('/api/') && !url.startsWith('/health')) {
      const indexFile = await serveStatic('/index.html');
      if (indexFile) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexFile.content);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

function createServer(): http.Server {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('Request handler error:', error);
      failResponse(res, 500, 'Internal Server Error', error instanceof Error ? error : undefined);
    });
  });

  // In dev mode, proxy WebSocket upgrades to Next.js dev server for HMR
  if (!IS_PRODUCTION) {
    const net = require('net');
    const DEV_FRONTEND_PORT = youbotConfig.server?.frontend_port ?? parseInt(process.env.DEV_FRONTEND_PORT || '3015', 10);
    server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
      const proxySocket = net.connect(DEV_FRONTEND_PORT, 'localhost', () => {
        proxySocket.write(
          `${req.method} ${req.url} HTTP/1.1\r\n` +
          Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n') +
          '\r\n\r\n'
        );
        if (head.length) proxySocket.write(head);
        socket.pipe(proxySocket).pipe(socket);
      });
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    });
  }

  // Extension server start hook
  const hooks = getHooks();
  if (hooks.middleware?.onServerStart) {
    hooks.middleware.onServerStart(server);
  }

  return server;
}

function getAppState(): AppState {
  return { ...appState };
}

function resetState(): void {
  appState.requestCount = 0;
  appState.startedAt = new Date();
  activeSessions.clear();
  loginAttempts.clear();
}

// Load extensions if available
async function loadExtensions(): Promise<void> {
  // ── Load Custom Apps first (engine hooks, auth, theme, tools) ──
  // Must run before createServer() so hooks are available at first request.
  // The orchestrator was already created above, but auth/theme/tool hooks are
  // read lazily (per-request for auth, at startup for tools), so late registration is fine.
  await loadCustomApps();

  // Register custom tool modules onto globalThis for the API to pick up
  const customToolModules = getCustomToolModules();
  if (customToolModules.length > 0) {
    (globalThis as any).__customToolModules = customToolModules;
  }

  // Try to load youbot.extensions.ts/js from YOUBOT_HOME or current directory
  const searchDirs = YOUBOT_HOME ? [YOUBOT_HOME, process.cwd()] : [process.cwd()];
  for (const dir of searchDirs) {
    for (const ext of ['youbot.extensions.js', 'youbot.extensions.ts']) {
      const extPath = path.join(dir, ext);
      if (fs.existsSync(extPath)) {
        try {
          const mod = await import(extPath);
          if (mod.default && typeof mod.default === 'function') {
            await mod.default();
          } else if (mod.register && typeof mod.register === 'function') {
            await mod.register();
          }
          console.log(`[Extensions] Loaded: ${extPath}`);
          return;
        } catch (err: any) {
          console.error(`[Extensions] Failed to load ${extPath}:`, err.message);
        }
      }
    }
  }
}

// Only start server if this is the main module (not during tests)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  // Load extensions first, then start
  loadExtensions().then(() => {
    const server = createServer();
    server.listen(PORT, HOST, () => {
      const displayHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
      console.log(`🚀 ${appState.name} v${appState.version} running at http://${displayHost}:${PORT}`);
      console.log(`📊 Health check: http://${displayHost}:${PORT}/health`);
      console.log(`📈 State API: http://${displayHost}:${PORT}/api/state`);
      console.log(`[YOUBOT] Mode: ${MODE.toUpperCase()} | Features: WA=${FEATURES.whatsapp} TG=${FEATURES.telegram} CLI=${FEATURES.cli}`);

      // Resume active plans in the background
      agent?.resumeActivePlans().catch((err: any) => {
        console.error('[Main] Error resuming active plans:', err.message);
      });
    });

    // ── Graceful Shutdown Signal Handlers ─────────────────────
    async function handleShutdown(signal: string) {
      console.log(`\n[${signal}] Received — shutting down gracefully...`);
      try {
        const { gracefulShutdown } = await import('./api/index.js');
        await gracefulShutdown();
      } catch (err: any) {
        console.error('[Shutdown] Error:', err.message);
      } finally {
        server.close(() => {
          console.log('[Shutdown] HTTP server closed.');
          process.exit(0);
        });
        // Force exit after 10s if server.close hangs
        setTimeout(() => {
          console.warn('[Shutdown] Force-exiting after timeout.');
          process.exit(1);
        }, 10_000).unref();
      }
    }

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  });
}

export {
  createServer,
  getAppState,
  AppState,
  handleRequest,
  resetState,
  resolveServerHost,
  applySecurityHeaders,
  readRequestBody,
  safeExternalAuthUrl,
  shouldApplyServerAccessGate,
};
// trigger restart
