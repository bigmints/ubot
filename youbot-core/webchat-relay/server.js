/**
 * Youbot multi-tenant webchat relay.
 *
 * Every local Youbot installation receives an opaque, stable tenant URL and a
 * tenant-scoped bot credential. Tenant identity is stateless; configuration
 * and visitor history are durable when Firestore storage is enabled. Active
 * requests remain on one Cloud Run instance until the bot replies.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { serveWebsite, RESERVED_PATH_SEGMENTS } = require('./website/serve.cjs');
const { createPersistence } = require('./persistence.js');
const { createRelayTelemetry } = require('./telemetry.js');

const VERSION = '2.3.0';
const PORT = Number(process.env.PORT || 8080);
const SIGNING_SECRET = process.env.RELAY_SIGNING_SECRET
  || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-32-chars');
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 25_000);
const MESSAGE_TIMEOUT_MS = Number(process.env.MESSAGE_TIMEOUT_MS || 180_000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES
  || (process.env.RELAY_STORAGE === 'firestore' ? 700 * 1024 : 3 * 1024 * 1024));
const MAX_ACTIVE_TENANTS = Number(process.env.MAX_ACTIVE_TENANTS || 5_000);
const MAX_PENDING_PER_TENANT = Number(process.env.MAX_PENDING_PER_TENANT || 50);
const MAX_SESSIONS_PER_TENANT = Number(process.env.MAX_SESSIONS_PER_TENANT || 1_000);
const MAX_HISTORY = 100;
const relayTelemetry = createRelayTelemetry({ salt: SIGNING_SECRET });
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  ...RESERVED_PATH_SEGMENTS,
  'api', 'health', 'widget', 'manifest', 'admin', 'account', 'auth', 'login',
  'signup', 'support', 'status', 'www', 'mail', 'static', 'public', 'relay', 'telemetry',
]);

const DEFAULT_WIDGET_CONFIG = Object.freeze({
  title: 'Chat with us',
  color: '#274e3d',
  welcomeMessage: 'Hello. How can I help?',
  avatarUrl: '',
});

const persistence = createPersistence(DEFAULT_WIDGET_CONFIG);

const tenants = new Map();
const rateLimits = new Map();
const slugCache = new Map();

function sign(value) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(value).digest('base64url');
}

function safeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function tenantIdFor(installationId) {
  const payload = sign(`installation:${installationId}`).slice(0, 18);
  const signature = sign(`tenant:${payload}`).slice(0, 10);
  return `${payload}.${signature}`;
}

function isValidTenantId(tenantId) {
  if (!/^[A-Za-z0-9_-]{18}\.[A-Za-z0-9_-]{10}$/.test(tenantId || '')) return false;
  const payload = tenantId.slice(0, 18);
  return safeEqual(tenantId.slice(19), sign(`tenant:${payload}`).slice(0, 10));
}

function botSecretFor(tenantId) {
  return sign(`bot:${tenantId}`);
}

function ownerKeyFor(tenantId) {
  return sign(`owner:${tenantId}`).slice(0, 32);
}

function normalizeSlug(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateSlug(value) {
  const slug = normalizeSlug(value);
  if (!SLUG_PATTERN.test(slug)) {
    return { valid: false, slug, reason: 'Use 3–40 lowercase letters, numbers, or single hyphens.' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { valid: false, slug, reason: 'This address is reserved by Youbot.' };
  }
  return { valid: true, slug, reason: '' };
}

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function takeRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(key);
  }
}

function cacheSlug(slug, tenantId) {
  if (slugCache.size >= 10_000) slugCache.delete(slugCache.keys().next().value);
  slugCache.set(slug, { tenantId, expiresAt: Date.now() + 5 * 60_000 });
}

async function resolveSlug(slug) {
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.tenantId;
  const tenantId = await persistence.getSlugOwner(slug);
  cacheSlug(slug, tenantId);
  return tenantId;
}

function createTenantState() {
  const tenant = {
    config: { ...DEFAULT_WIDGET_CONFIG },
    pending: new Map(),
    history: new Map(),
    pollWaiters: new Set(),
    lastActiveAt: Date.now(),
  };
  return tenant;
}

function evictInactiveTenant() {
  let candidate;
  for (const entry of tenants) {
    const tenant = entry[1];
    if (tenant.pending.size || tenant.pollWaiters.size) continue;
    if (!candidate || tenant.lastActiveAt < candidate[1].lastActiveAt) candidate = entry;
  }
  if (candidate) tenants.delete(candidate[0]);
}

function getTenant(tenantId, create = true) {
  if (!isValidTenantId(tenantId)) return null;
  let tenant = tenants.get(tenantId);
  if (!tenant && create) {
    if (tenants.size >= MAX_ACTIVE_TENANTS) evictInactiveTenant();
    if (tenants.size >= MAX_ACTIVE_TENANTS) return null;
    tenant = createTenantState();
    tenant.id = tenantId;
    tenant.ready = persistence.ensureTenant(tenantId).then(async () => {
      tenant.config = await persistence.getConfig(tenantId);
    });
    tenants.set(tenantId, tenant);
  }
  if (tenant) tenant.lastActiveAt = Date.now();
  return tenant || null;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function commonHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
  };
}

function jsonResponse(res, data, status = 200, extraHeaders = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    ...commonHeaders(),
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

function textResponse(res, body, status = 200, contentType = 'text/plain; charset=utf-8') {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { ...commonHeaders(), 'Content-Type': contentType });
  res.end(body);
}

function servePublicFile(res, filename, contentType, cache = false) {
  try {
    const content = fs.readFileSync(path.join(__dirname, 'public', filename));
    res.writeHead(200, {
      ...commonHeaders(),
      'Content-Type': contentType,
      'Cache-Control': cache ? 'public, max-age=300' : 'no-cache',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function addToHistory(tenantId, tenant, sessionId, role, content) {
  if (!tenant.history.has(sessionId)) {
    if (tenant.history.size >= MAX_SESSIONS_PER_TENANT) {
      tenant.history.delete(tenant.history.keys().next().value);
    }
    tenant.history.set(sessionId, []);
  }
  const history = tenant.history.get(sessionId);
  const event = { role, content, timestamp: new Date().toISOString() };
  history.push(event);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  await persistence.appendHistory(tenantId, sessionId, event);
}

function publicMessage(message) {
  return {
    id: message.id,
    session: message.session,
    name: message.name,
    message: message.message,
    ownerKey: message.ownerKey || '',
    audio: message.audio || '',
    image: message.image || '',
  };
}

function claimNextMessage(tenant) {
  const now = Date.now();
  for (const message of tenant.pending.values()) {
    if (!message.claimedUntil || message.claimedUntil <= now) {
      message.claimedUntil = now + 60_000;
      return publicMessage(message);
    }
  }
  return null;
}

function notifyPollWaiter(tenant, message) {
  const waiter = tenant.pollWaiters.values().next().value;
  if (!waiter) return;
  clearTimeout(waiter.timer);
  tenant.pollWaiters.delete(waiter);
  message.claimedUntil = Date.now() + 60_000;
  waiter.resolve(publicMessage(message));
}

function validateBot(req, tenantId) {
  const header = req.headers['x-bot-secret'];
  const url = new URL(req.url, 'http://localhost');
  const provided = typeof header === 'string' ? header : url.searchParams.get('secret');
  return safeEqual(provided, botSecretFor(tenantId));
}

function tenantBaseUrl(req, publicId) {
  if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL}/${encodeURIComponent(publicId)}`;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host}/${encodeURIComponent(publicId)}`;
}

async function parseTenantPath(pathname, req) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (isValidTenantId(parts[0])) {
    return { tenantId: parts[0], publicId: parts[0], route: `/${parts.slice(1).join('/')}` };
  }
  const candidate = validateSlug(parts[0]);
  if (!candidate.valid) return null;
  if (!takeRateLimit(`slug-route:${clientAddress(req)}`, 240, 60_000)) return null;
  const tenantId = await resolveSlug(candidate.slug);
  if (!tenantId || !isValidTenantId(tenantId)) return null;
  return { tenantId, publicId: candidate.slug, route: `/${parts.slice(1).join('/')}` };
}

async function handleTenantRequest(req, res, tenantId, publicId, route, url) {
  const method = req.method || 'GET';
  const tenant = getTenant(tenantId);
  if (!tenant) {
    jsonResponse(res, { error: 'Relay URL is unavailable' }, 404);
    return;
  }
  await tenant.ready;

  if ((route === '/' || route.startsWith('/k/')) && method === 'GET') {
    if (servePublicFile(res, 'index.html', 'text/html; charset=utf-8')) return;
  }

  if (route === '/widget.js' && method === 'GET') {
    if (servePublicFile(res, 'widget.js', 'application/javascript; charset=utf-8', true)) return;
  }

  if (route === '/manifest.json' && method === 'GET') {
    const key = url.searchParams.get('key') || '';
    const startUrl = key
      ? `/${encodeURIComponent(publicId)}/k/${encodeURIComponent(key)}`
      : `/${encodeURIComponent(publicId)}`;
    const title = tenant.config.title || 'Youbot Chat';
    jsonResponse(res, {
      name: title,
      short_name: title.slice(0, 12),
      description: `Chat with ${title}`,
      start_url: startUrl,
      scope: `/${encodeURIComponent(publicId)}/`,
      display: 'standalone',
      background_color: '#f6f4ee',
      theme_color: '#274e3d',
      orientation: 'portrait',
      icons: [
        { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
      ],
    });
    return;
  }

  if (route === '/health' && method === 'GET') {
    const connected = Date.now() - (tenant.lastBotPollAt || 0) < Math.max(60_000, POLL_TIMEOUT_MS * 2);
    jsonResponse(res, {
      status: 'ok', version: VERSION, tenant: tenantId, connected,
      capabilities: { sessionReplies: true },
      ...(publicId !== tenantId ? { slug: publicId } : {}),
    });
    return;
  }

  if (route === '/api/config' && method === 'GET') {
    jsonResponse(res, tenant.config);
    return;
  }

  if (route === '/api/history' && method === 'GET') {
    const session = String(url.searchParams.get('session') || '').slice(0, 160);
    if (!session) {
      jsonResponse(res, { error: 'session parameter is required' }, 400);
      return;
    }
    const messages = await persistence.getHistory(tenantId, session);
    jsonResponse(res, { messages, sessionId: session });
    return;
  }

  if (route === '/api/message' && method === 'POST') {
    const rateKey = `message:${tenantId}:${clientAddress(req)}`;
    if (!takeRateLimit(rateKey, 30, 60_000)) {
      jsonResponse(res, { error: 'Too many messages. Please wait a moment.' }, 429, { 'Retry-After': '60' });
      return;
    }
    if (await persistence.countPending(tenantId, MAX_PENDING_PER_TENANT) >= MAX_PENDING_PER_TENANT) {
      jsonResponse(res, { error: 'This concierge is busy. Please try again shortly.' }, 503, { 'Retry-After': '15' });
      return;
    }
    const body = await parseBody(req);
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 20_000) : '';
    const session = typeof body.session === 'string' ? body.session.slice(0, 160) : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 160) : 'Website Visitor';
    const ownerKey = typeof body.ownerKey === 'string' ? body.ownerKey.slice(0, 256) : '';
    const audio = typeof body.audio === 'string' ? body.audio : '';
    const image = typeof body.image === 'string' ? body.image : '';
    if (!message && !audio && !image) {
      jsonResponse(res, { error: 'A message, voice note, or image is required' }, 400);
      return;
    }
    if (!session) {
      jsonResponse(res, { error: 'session is required' }, 400);
      return;
    }

    const mediaKind = audio ? 'voice' : image ? (message ? 'image_with_text' : 'image') : 'text';
    relayTelemetry.emit('relay_message', {
      surface: 'relay_server', route: '/:relay/api/message', outcome: 'accepted', media_kind: mediaKind,
    }, `${tenantId}:${session}`);

    await addToHistory(tenantId, tenant, session, 'user', message || (audio ? '[Voice message]' : '[Image]'));
    const messageId = crypto.randomUUID();
    await persistence.createPending(tenantId, {
      id: messageId,
      session,
      name: name || 'Website Visitor',
      message,
      ownerKey,
      audio,
      image,
    });
    const result = await persistence.waitForReply(tenantId, messageId, MESSAGE_TIMEOUT_MS);
    if (result.response) await addToHistory(tenantId, tenant, session, 'assistant', result.response);
    relayTelemetry.emit('relay_message', {
      surface: 'relay_server', route: '/:relay/api/message',
      outcome: result.timeout ? 'timeout' : 'replied', media_kind: mediaKind,
    }, `${tenantId}:${session}`);
    jsonResponse(res, { response: result.response || '', sessionId: session, timeout: Boolean(result.timeout) });
    return;
  }

  if (route === '/api/bot/poll' && method === 'GET') {
    if (!validateBot(req, tenantId)) {
      jsonResponse(res, { error: 'Invalid bot credential' }, 401);
      return;
    }
    tenant.lastBotPollAt = Date.now();
    const pending = await persistence.pollNext(tenantId, POLL_TIMEOUT_MS);
    relayTelemetry.emit('relay_bot_poll', {
      surface: 'relay_server', route: '/:relay/api/bot/poll', outcome: pending ? 'message' : 'empty',
    }, tenantId);
    jsonResponse(res, { messages: pending ? [publicMessage(pending)] : [], capabilities: { sessionReplies: true } });
    return;
  }

  if (route === '/api/bot/typing' && method === 'POST') {
    if (!validateBot(req, tenantId)) {
      jsonResponse(res, { error: 'Invalid bot credential' }, 401);
      return;
    }
    const body = await parseBody(req);
    const touched = await persistence.touchPending(tenantId, body.messageId);
    if (!touched) {
      jsonResponse(res, { ok: true, status: 'already_resolved' });
      return;
    }
    jsonResponse(res, { ok: true });
    return;
  }

  if (route === '/api/bot/send' && method === 'POST') {
    if (!validateBot(req, tenantId)) {
      jsonResponse(res, { error: 'Invalid bot credential' }, 401);
      return;
    }
    const body = await parseBody(req);
    const { session, response, requestId } = body;
    if (typeof session !== 'string' || !session.trim() || session.length > 160 ||
        typeof response !== 'string' || !response.trim() || response.length > 50_000 ||
        typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) {
      jsonResponse(res, { error: 'A session, reply and valid requestId are required' }, 400);
      return;
    }
    const status = await persistence.sendToSession(tenantId, session, response, requestId);
    if (status === 'not_found' || status === 'conflict') {
      jsonResponse(res, { error: status === 'not_found' ? 'Visitor session was not found' : 'Request ID already used for a different reply' }, status === 'not_found' ? 404 : 409);
      return;
    }
    jsonResponse(res, { ok: true, requestId, status });
    return;
  }

  if (route === '/api/bot/reply' && method === 'POST') {
    if (!validateBot(req, tenantId)) {
      jsonResponse(res, { error: 'Invalid bot credential' }, 401);
      return;
    }
    const body = await parseBody(req);
    const response = typeof body.response === 'string' ? body.response.slice(0, 50_000) : '';
    const resolved = await persistence.resolvePending(tenantId, body.messageId, response);
    if (!resolved) {
      relayTelemetry.emit('relay_bot_reply', {
        surface: 'relay_server', route: '/:relay/api/bot/reply', outcome: 'not_found',
      }, tenantId);
      jsonResponse(res, { error: 'Message was not found or was already answered' }, 404);
      return;
    }
    relayTelemetry.emit('relay_bot_reply', {
      surface: 'relay_server', route: '/:relay/api/bot/reply', outcome: 'replied',
    }, tenantId);
    jsonResponse(res, { ok: true });
    return;
  }

  if (route === '/api/bot/config' && method === 'POST') {
    if (!validateBot(req, tenantId)) {
      jsonResponse(res, { error: 'Invalid bot credential' }, 401);
      return;
    }
    const body = await parseBody(req);
    if (typeof body.title === 'string' && body.title.trim()) tenant.config.title = body.title.trim().slice(0, 100);
    if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) tenant.config.color = body.color;
    if (typeof body.welcomeMessage === 'string') tenant.config.welcomeMessage = body.welcomeMessage.slice(0, 1_000);
    if (typeof body.avatarUrl === 'string') tenant.config.avatarUrl = body.avatarUrl.slice(0, 2_000);
    await persistence.updateConfig(tenantId, tenant.config);
    relayTelemetry.emit('relay_config_update', {
      surface: 'relay_server', route: '/:relay/api/bot/config', outcome: 'updated',
    }, tenantId);
    jsonResponse(res, { ok: true, config: tenant.config });
    return;
  }

  jsonResponse(res, { error: 'Not found' }, 404);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/{2,}/g, '/');
  const method = req.method || 'GET';

  if (serveWebsite(req, res, pathname)) return;

  if (pathname === '/telemetry/config' && method === 'GET') {
    const measurementId = /^G-[A-Z0-9]+$/.test(process.env.GA_MEASUREMENT_ID || '')
      ? process.env.GA_MEASUREMENT_ID
      : '';
    jsonResponse(res, { measurementId });
    return;
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, { ...commonHeaders(), 'Access-Control-Max-Age': '86400' });
    res.end();
    return;
  }

  if (pathname === '/health' && method === 'GET') {
    try {
      await persistence.health();
      const stats = await persistence.stats();
      jsonResponse(res, {
        status: 'ok',
        version: VERSION,
        storage: process.env.RELAY_STORAGE || 'memory',
        activeTenants: stats.activeTenants,
        pending: stats.pending,
      });
    } catch {
      jsonResponse(res, {
        status: 'unhealthy',
        version: VERSION,
        storage: process.env.RELAY_STORAGE || 'memory',
      }, 503);
    }
    return;
  }

  if (pathname === '/api/slugs/availability' && method === 'GET') {
    const rateKey = `slug-check:${clientAddress(req)}`;
    if (!takeRateLimit(rateKey, 120, 60 * 60_000)) {
      relayTelemetry.emit('relay_slug_check', {
        surface: 'relay_server', route: '/api/slugs/availability', outcome: 'rate_limited',
      });
      jsonResponse(res, { error: 'Too many availability checks. Please try again later.' }, 429, { 'Retry-After': '3600' });
      return;
    }
    const validation = validateSlug(url.searchParams.get('slug') || '');
    if (!validation.valid) {
      relayTelemetry.emit('relay_slug_check', {
        surface: 'relay_server', route: '/api/slugs/availability', outcome: 'invalid',
      });
      jsonResponse(res, { slug: validation.slug, available: false, reason: validation.reason });
      return;
    }
    const owner = await persistence.getSlugOwner(validation.slug);
    relayTelemetry.emit('relay_slug_check', {
      surface: 'relay_server', route: '/api/slugs/availability', outcome: owner ? 'taken' : 'available',
    });
    jsonResponse(res, {
      slug: validation.slug,
      available: !owner,
      reason: owner ? 'This address is already in use.' : '',
    });
    return;
  }

  if (pathname === '/api/tenants/register' && method === 'POST') {
    const rateKey = `register:${clientAddress(req)}`;
    if (!takeRateLimit(rateKey, 20, 60 * 60_000)) {
      relayTelemetry.emit('relay_registration', {
        surface: 'relay_server', route: '/api/tenants/register', outcome: 'rate_limited',
      });
      jsonResponse(res, { error: 'Too many relay registrations. Please try again later.' }, 429, { 'Retry-After': '3600' });
      return;
    }
    const body = await parseBody(req);
    const installationId = typeof body.installationId === 'string' ? body.installationId.trim() : '';
    if (!/^[A-Za-z0-9._:-]{16,200}$/.test(installationId)) {
      relayTelemetry.emit('relay_registration', {
        surface: 'relay_server', route: '/api/tenants/register', outcome: 'invalid',
      });
      jsonResponse(res, { error: 'A valid installation ID is required' }, 400);
      return;
    }
    const tenantId = tenantIdFor(installationId);
    const tenant = getTenant(tenantId);
    await tenant.ready;
    let slug = await persistence.getSlugForTenant(tenantId);
    if (body.requestedSlug !== undefined) {
      const validation = validateSlug(body.requestedSlug);
      if (!validation.valid) {
        jsonResponse(res, { error: validation.reason, slug: validation.slug }, 400);
        return;
      }
      const claim = await persistence.claimSlug(tenantId, validation.slug);
      if (claim.status === 'taken') {
        jsonResponse(res, { error: 'This relay address is already in use.', slug: validation.slug }, 409);
        return;
      }
      if (claim.status === 'tenant_has_slug') {
        jsonResponse(res, {
          error: `This installation already uses youbot.live/${claim.slug}.`,
          slug: claim.slug,
        }, 409);
        return;
      }
      slug = validation.slug;
      cacheSlug(slug, tenantId);
    }
    relayTelemetry.emit('relay_registration', {
      surface: 'relay_server', route: '/api/tenants/register', outcome: 'accepted',
    }, tenantId);
    jsonResponse(res, {
      status: 'ready',
      tenantId,
      slug: slug || '',
      relayUrl: tenantBaseUrl(req, slug || tenantId),
      tenantRelayUrl: tenantBaseUrl(req, tenantId),
      botSecret: botSecretFor(tenantId),
      ownerKey: ownerKeyFor(tenantId),
    }, 201);
    return;
  }

  if (pathname === '/widget.js' && method === 'GET') {
    if (servePublicFile(res, 'widget.js', 'application/javascript; charset=utf-8', true)) return;
  }
  if (pathname === '/telemetry.js' && method === 'GET') {
    if (servePublicFile(res, 'telemetry.js', 'application/javascript; charset=utf-8', true)) return;
  }
  if (pathname === '/sw.js' && method === 'GET') {
    if (servePublicFile(res, 'sw.js', 'application/javascript; charset=utf-8')) return;
  }
  if (pathname === '/icon-192.svg' && method === 'GET') {
    if (servePublicFile(res, 'icon-192.svg', 'image/svg+xml', true)) return;
  }
  if (pathname === '/icon-512.svg' && method === 'GET') {
    if (servePublicFile(res, 'icon-512.svg', 'image/svg+xml', true)) return;
  }

  const tenantPath = await parseTenantPath(pathname, req);
  if (tenantPath) {
    await handleTenantRequest(req, res, tenantPath.tenantId, tenantPath.publicId, tenantPath.route, url);
    return;
  }

  jsonResponse(res, { error: 'Not found' }, 404);
}

function createServer() {
  if (!SIGNING_SECRET || SIGNING_SECRET.length < 32) {
    throw new Error('RELAY_SIGNING_SECRET must be at least 32 characters');
  }
  return http.createServer((req, res) => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      relayTelemetry.request(req.method, req.url, res.statusCode, elapsedMs);
    });
    handleRequest(req, res).catch((error) => {
      console.error('Relay request failed:', error instanceof Error ? error.message : 'unknown error');
      const status = error && Number(error.statusCode) >= 400 ? Number(error.statusCode) : 500;
      jsonResponse(res, { error: status === 500 ? 'Internal server error' : error.message }, status);
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Youbot multi-tenant relay v${VERSION} listening on ${PORT}`);
  });
  const cleanup = setInterval(cleanupRateLimits, 10 * 60_000);
  cleanup.unref();
}

module.exports = {
  VERSION,
  createServer,
  tenantIdFor,
  isValidTenantId,
  botSecretFor,
  ownerKeyFor,
  validateSlug,
};
