'use strict';

const crypto = require('node:crypto');

const EVENTS = new Set([
  'relay_request', 'relay_registration', 'relay_slug_check', 'relay_message',
  'relay_bot_poll', 'relay_bot_reply', 'relay_config_update',
]);
const OUTCOMES = new Set([
  'accepted', 'available', 'taken', 'invalid', 'rate_limited', 'replied',
  'timeout', 'empty', 'message', 'updated', 'not_found', 'success', 'client_error',
  'server_error',
]);
const MEDIA_KINDS = new Set(['text', 'voice', 'image', 'image_with_text']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const SURFACES = new Set(['site', 'relay_ui', 'relay_server']);
const KNOWN_SITE_ROUTES = new Set([
  '/', '/404', '/docs', '/docs/installation', '/docs/first-concierge',
  '/docs/ai-providers', '/docs/connections', '/docs/relay', '/docs/privacy',
  '/docs/troubleshooting', '/health', '/api/slugs/availability',
  '/api/tenants/register', '/telemetry/config', '/telemetry.js', '/widget.js',
  '/sw.js', '/icon-192.svg', '/icon-512.svg', '/robots.txt', '/sitemap.xml',
]);
const TENANT_ROUTES = new Set([
  '/', '/manifest.json', '/health', '/api/config', '/api/history', '/api/message',
  '/api/bot/poll', '/api/bot/typing', '/api/bot/reply', '/api/bot/config', '/widget.js',
]);

function sanitizeRelayRoute(pathname) {
  const normalized = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/{2,}/g, '/');
  const route = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  if (KNOWN_SITE_ROUTES.has(route)) return route;
  if (route.startsWith('/assets/')) return '/assets/:asset';
  if (route.startsWith('/docs/')) return '/docs/:missing';
  const parts = route.split('/').filter(Boolean);
  if (!parts.length) return '/';
  if (parts[1] === 'k') return '/:relay/k/:owner';
  const tenantRoute = `/${parts.slice(1).join('/')}` || '/';
  return TENANT_ROUTES.has(tenantRoute) ? `/:relay${tenantRoute === '/' ? '' : tenantRoute}` : '/:relay/:unknown';
}

function surfaceForRoute(route) {
  if (route.startsWith('/:relay')) return route.includes('/api/') || route.endsWith('/health') ? 'relay_server' : 'relay_ui';
  if (route.startsWith('/api/') || route === '/health') return 'relay_server';
  return 'site';
}

function durationBand(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'unknown';
  if (durationMs < 100) return 'under_100ms';
  if (durationMs < 500) return '100_499ms';
  if (durationMs < 2_000) return '500_1999ms';
  if (durationMs < 10_000) return '2_9s';
  if (durationMs < 60_000) return '10_59s';
  return '60s_plus';
}

function statusClass(status) {
  const value = Number(status);
  return value >= 100 && value <= 599 ? `${Math.floor(value / 100)}xx` : 'unknown';
}

function outcomeForStatus(status) {
  const value = Number(status);
  if (value >= 200 && value < 400) return 'success';
  if (value >= 400 && value < 500) return 'client_error';
  return 'server_error';
}

function cleanParams(params) {
  const clean = {};
  if (SURFACES.has(params.surface)) clean.surface = params.surface;
  if (typeof params.route === 'string') clean.route = sanitizeRelayRoute(params.route);
  if (METHODS.has(params.method)) clean.method = params.method.toLowerCase();
  if (/^[1-5]xx$/.test(params.status_class || '')) clean.status_class = params.status_class;
  if (['unknown', 'under_100ms', '100_499ms', '500_1999ms', '2_9s', '10_59s', '60s_plus'].includes(params.duration_band)) clean.duration_band = params.duration_band;
  if (OUTCOMES.has(params.outcome)) clean.outcome = params.outcome;
  if (MEDIA_KINDS.has(params.media_kind)) clean.media_kind = params.media_kind;
  return clean;
}

function anonymousClientId(salt, seed) {
  const day = new Date().toISOString().slice(0, 10);
  const digest = crypto.createHmac('sha256', salt).update(`${day}:${seed || 'relay'}`).digest('hex');
  return `${BigInt(`0x${digest.slice(0, 15)}`).toString()}.${BigInt(`0x${digest.slice(15, 30)}`).toString()}`;
}

function createRelayTelemetry(options = {}) {
  const measurementId = String(options.measurementId || process.env.GA_MEASUREMENT_ID || '');
  const apiSecret = String(options.apiSecret || process.env.GA_API_SECRET || '');
  const salt = String(options.salt || process.env.RELAY_SIGNING_SECRET || 'telemetry-disabled');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const enabled = /^G-[A-Z0-9]+$/.test(measurementId) && apiSecret.length >= 8 && typeof fetchImpl === 'function';

  function emit(name, params = {}, seed = 'relay') {
    if (!enabled || !EVENTS.has(name)) return;
    const body = {
      client_id: anonymousClientId(salt, seed),
      non_personalized_ads: true,
      events: [{ name, params: { ...cleanParams(params), engagement_time_msec: 1 } }],
    };
    const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    Promise.resolve(fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(2_500) : undefined,
    })).catch(() => {});
  }

  function request(method, pathname, status, elapsedMs) {
    const route = sanitizeRelayRoute(pathname);
    emit('relay_request', {
      surface: surfaceForRoute(route),
      route,
      method: String(method || 'GET').toUpperCase(),
      status_class: statusClass(status),
      duration_band: durationBand(elapsedMs),
      outcome: outcomeForStatus(status),
    });
  }

  return { enabled, emit, request };
}

module.exports = { createRelayTelemetry, durationBand, sanitizeRelayRoute };
