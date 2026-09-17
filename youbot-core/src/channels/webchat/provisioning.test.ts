import { describe, expect, it, vi } from 'vitest';
import type { YoubotConfig } from '../../data/config.js';
import { autoProvisionManagedWebchatRelay, ensureManagedWebchatRelay } from './provisioning.js';
import { ensureWebchatToken } from '../../api/routes/webchat.js';

function memoryConfig(initial: YoubotConfig = {}) {
  let value = structuredClone(initial);
  return {
    load: () => structuredClone(value),
    save: (next: YoubotConfig) => { value = structuredClone(next); },
    current: () => value,
  };
}

describe('managed webchat relay provisioning', () => {
  it('performs no startup provisioning side effects when Webchat is disabled', async () => {
    const state = memoryConfig({ channels: { webchat: { enabled: false } } });
    const fetchFn = vi.fn();
    const saveConfig = vi.fn(state.save);

    const result = await autoProvisionManagedWebchatRelay({
      loadConfig: state.load,
      saveConfig,
      fetchFn,
    });

    expect(result).toEqual({ status: 'disabled' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(state.current()).toEqual({ channels: { webchat: { enabled: false } } });
  });

  it('does not create or save a connection token when Webchat is disabled', () => {
    const state = memoryConfig({ channels: { webchat: { enabled: false } } });
    const saveConfig = vi.fn(state.save);
    const createToken = vi.fn(() => 'must-not-be-created');

    expect(ensureWebchatToken({ loadConfig: state.load, saveConfig, createToken })).toBe('');
    expect(createToken).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(state.current()).toEqual({ channels: { webchat: { enabled: false } } });
  });

  it('keeps an existing complete relay configuration', async () => {
    const state = memoryConfig({
      channels: { webchat: { relay_url: 'https://relay.example/tenant', bot_secret: 'secret' } },
    });
    const fetchFn = vi.fn();
    const result = await ensureManagedWebchatRelay({
      loadConfig: state.load,
      saveConfig: state.save,
      fetchFn,
    });
    expect(result.created).toBe(false);
    expect(result.relayUrl).toBe('https://relay.example/tenant');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('persists a stable installation ID before registering and stores the returned tenant', async () => {
    const state = memoryConfig();
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.installationId).toBe(state.current().channels?.webchat?.relay_installation_id);
      expect(request.requestedSlug).toBe('north-star');
      return new Response(JSON.stringify({
        status: 'ready',
        tenantId: 'abcdefghijklmnopqr.abcdefghij',
        slug: 'north-star',
        relayUrl: 'https://youbot.live/north-star',
        tenantRelayUrl: 'https://youbot.live/abcdefghijklmnopqr.abcdefghij',
        botSecret: 'tenant-secret',
        ownerKey: 'owner-key',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const result = await ensureManagedWebchatRelay({
      loadConfig: state.load,
      saveConfig: state.save,
      fetchFn: fetchFn as typeof fetch,
      relayOrigin: 'https://youbot.live',
      requestedSlug: 'North-Star',
    });

    expect(result.created).toBe(true);
    expect(state.current().channels?.webchat).toMatchObject({
      enabled: true,
      auto_reply: true,
      managed_relay: true,
      relay_tenant_id: 'abcdefghijklmnopqr.abcdefghij',
      relay_slug: 'north-star',
      relay_url: 'https://youbot.live/north-star',
      relay_tenant_url: 'https://youbot.live/abcdefghijklmnopqr.abcdefghij',
      bot_secret: 'tenant-secret',
      owner_key: 'owner-key',
    });
  });

  it('rejects an insecure relay response', async () => {
    const state = memoryConfig();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: 'ready',
      tenantId: 'abcdefghijklmnopqr.abcdefghij',
      relayUrl: 'http://public.example/abcdefghijklmnopqr.abcdefghij',
      botSecret: 'tenant-secret',
      ownerKey: 'owner-key',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));

    await expect(ensureManagedWebchatRelay({
      loadConfig: state.load,
      saveConfig: state.save,
      fetchFn: fetchFn as typeof fetch,
      relayOrigin: 'https://youbot.live',
    })).rejects.toThrow('insecure URL');
  });

  it('adds a friendly slug to an existing signed relay', async () => {
    const state = memoryConfig({ channels: { webchat: {
      relay_url: 'https://youbot.live/abcdefghijklmnopqr.abcdefghij',
      relay_tenant_id: 'abcdefghijklmnopqr.abcdefghij',
      relay_installation_id: 'installation-existing-0001',
      bot_secret: 'tenant-secret',
      owner_key: 'owner-key',
    } } });
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        installationId: 'installation-existing-0001',
        requestedSlug: 'clear-path',
      });
      return new Response(JSON.stringify({
        status: 'ready',
        tenantId: 'abcdefghijklmnopqr.abcdefghij',
        slug: 'clear-path',
        relayUrl: 'https://youbot.live/clear-path',
        tenantRelayUrl: 'https://youbot.live/abcdefghijklmnopqr.abcdefghij',
        botSecret: 'tenant-secret',
        ownerKey: 'owner-key',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const result = await ensureManagedWebchatRelay({
      loadConfig: state.load,
      saveConfig: state.save,
      fetchFn: fetchFn as typeof fetch,
      requestedSlug: 'clear-path',
    });
    expect(result.created).toBe(true);
    expect(state.current().channels?.webchat?.relay_slug).toBe('clear-path');
    expect(state.current().channels?.webchat?.relay_url).toBe('https://youbot.live/clear-path');
  });

  it('surfaces the relay collision message', async () => {
    const state = memoryConfig();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      error: 'This relay address is already in use.',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    await expect(ensureManagedWebchatRelay({
      loadConfig: state.load,
      saveConfig: state.save,
      fetchFn: fetchFn as typeof fetch,
      requestedSlug: 'taken-name',
    })).rejects.toThrow('already in use');
  });
});
