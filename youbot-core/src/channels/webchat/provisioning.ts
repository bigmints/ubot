import crypto from 'node:crypto';
import { loadYoubotConfig, saveYoubotConfig, type YoubotConfig } from '../../data/config.js';

export const DEFAULT_MANAGED_RELAY_ORIGIN = 'https://youbot.live';
const RELAY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

export interface RelayRegistration {
  status: 'ready';
  tenantId: string;
  slug: string;
  relayUrl: string;
  tenantRelayUrl?: string;
  botSecret: string;
  ownerKey: string;
}

export interface RelayProvisionResult extends RelayRegistration {
  created: boolean;
}

export interface ProvisionOptions {
  fetchFn?: typeof fetch;
  loadConfig?: () => YoubotConfig;
  saveConfig?: (config: YoubotConfig) => void;
  relayOrigin?: string;
  requestedSlug?: string;
}

export type AutoProvisionResult =
  | { status: 'disabled' | 'configured' }
  | { status: 'provisioned'; relay: RelayProvisionResult };

export function normalizeRelaySlug(value: string): string {
  return value.trim().toLowerCase();
}

export function relaySlugError(value: string): string {
  return RELAY_SLUG_PATTERN.test(normalizeRelaySlug(value))
    ? ''
    : 'Use 3–40 lowercase letters, numbers, or single hyphens.';
}

function normalizedOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('Managed relay must use HTTPS');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function isCompleteRelay(config: YoubotConfig): boolean {
  const webchat = config.channels?.webchat;
  return Boolean(webchat?.relay_url && webchat?.bot_secret);
}

/**
 * Startup-only managed relay provisioning. A deliberately disabled channel is
 * a hard no-side-effect boundary: do not create an installation ID, write
 * configuration, or make a network request. Explicit owner provisioning still
 * calls ensureManagedWebchatRelay directly.
 */
export async function autoProvisionManagedWebchatRelay(
  options: ProvisionOptions = {},
): Promise<AutoProvisionResult> {
  const read = options.loadConfig || loadYoubotConfig;
  const config = read();
  const webchat = config.channels?.webchat;

  if (webchat?.enabled === false) return { status: 'disabled' };
  if (webchat?.relay_url || webchat?.bot_secret) return { status: 'configured' };

  return {
    status: 'provisioned',
    relay: await ensureManagedWebchatRelay(options),
  };
}

export async function ensureManagedWebchatRelay(options: ProvisionOptions = {}): Promise<RelayProvisionResult> {
  const read = options.loadConfig || loadYoubotConfig;
  const write = options.saveConfig || saveYoubotConfig;
  const fetchFn = options.fetchFn || fetch;
  const config = read();
  const existing = config.channels?.webchat;
  const requestedSlug = options.requestedSlug ? normalizeRelaySlug(options.requestedSlug) : '';

  if (requestedSlug) {
    const localError = relaySlugError(requestedSlug);
    if (localError) throw new Error(localError);
  }

  if (isCompleteRelay(config) && (!requestedSlug || existing?.relay_slug === requestedSlug)) {
    return {
      status: 'ready',
      tenantId: existing?.relay_tenant_id || '',
      slug: existing?.relay_slug || '',
      relayUrl: existing?.relay_url || '',
      tenantRelayUrl: existing?.relay_tenant_url || undefined,
      botSecret: existing?.bot_secret || '',
      ownerKey: existing?.owner_key || '',
      created: false,
    };
  }

  if (Boolean(existing?.relay_url) !== Boolean(existing?.bot_secret)) {
    throw new Error('Existing relay configuration is incomplete');
  }

  const origin = normalizedOrigin(
    options.relayOrigin
      || process.env.YOUBOT_RELAY_ORIGIN
      || existing?.managed_relay_origin
      || DEFAULT_MANAGED_RELAY_ORIGIN,
  );
  const installationId = existing?.relay_installation_id || crypto.randomUUID();

  if (!config.channels) config.channels = {};
  if (!config.channels.webchat) config.channels.webchat = {};
  config.channels.webchat.relay_installation_id = installationId;
  config.channels.webchat.managed_relay_origin = origin;
  write(config);

  const response = await fetchFn(`${origin}/api/tenants/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId, ...(requestedSlug ? { requestedSlug } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let message = `Free relay registration failed (${response.status})`;
    try {
      const failure = await response.json() as { error?: string };
      if (failure.error) message = failure.error;
    } catch { /* Keep the status-based message. */ }
    throw Object.assign(new Error(message), { statusCode: response.status });
  }

  const registration = await response.json() as Partial<RelayRegistration>;
  if (
    registration.status !== 'ready'
    || typeof registration.tenantId !== 'string'
    || typeof registration.relayUrl !== 'string'
    || typeof registration.botSecret !== 'string'
    || typeof registration.ownerKey !== 'string'
  ) {
    throw new Error('Free relay returned an invalid registration');
  }

  const relayUrl = new URL(registration.relayUrl);
  if (relayUrl.protocol !== 'https:' && relayUrl.hostname !== '127.0.0.1' && relayUrl.hostname !== 'localhost') {
    throw new Error('Free relay returned an insecure URL');
  }

  const latest = read();
  if (!latest.channels) latest.channels = {};
  if (!latest.channels.webchat) latest.channels.webchat = {};
  Object.assign(latest.channels.webchat, {
    enabled: true,
    auto_reply: latest.channels.webchat.auto_reply ?? true,
    managed_relay: true,
    managed_relay_origin: origin,
    relay_installation_id: installationId,
    relay_tenant_id: registration.tenantId,
    relay_slug: registration.slug || requestedSlug || undefined,
    relay_url: registration.relayUrl.replace(/\/$/, ''),
    relay_tenant_url: registration.tenantRelayUrl?.replace(/\/$/, ''),
    bot_secret: registration.botSecret,
    owner_key: latest.channels.webchat.owner_key || registration.ownerKey,
  });
  write(latest);

  const persisted = read().channels?.webchat;
  if (
    persisted?.relay_url !== registration.relayUrl.replace(/\/$/, '')
    || persisted?.bot_secret !== registration.botSecret
    || (requestedSlug && persisted?.relay_slug !== requestedSlug)
  ) {
    throw new Error('Free relay settings were not saved');
  }

  return {
    ...(registration as RelayRegistration),
    slug: registration.slug || requestedSlug,
    relayUrl: registration.relayUrl.replace(/\/$/, ''),
    tenantRelayUrl: registration.tenantRelayUrl?.replace(/\/$/, ''),
    created: true,
  };
}
