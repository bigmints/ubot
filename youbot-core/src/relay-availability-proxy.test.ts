import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setApiKeysForTesting } from './api/middleware/auth.js';
import { handleRequest } from './index.js';

describe('relay slug availability proxy', () => {
  beforeEach(() => {
    setApiKeysForTesting([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['youbot', false, 'This address is reserved by Youbot.'],
    ['north-star-73', true, undefined],
    ['two--hyphens', false, 'Use 3–40 lowercase letters, numbers, or single hyphens.'],
  ])('forwards the complete slug query for %s', async (slug, available, reason) => {
    const relayFetch = vi.fn(async (input: string | URL | Request) => {
      const forwardedSlug = new URL(String(input)).searchParams.get('slug');
      const body = forwardedSlug === 'youbot'
        ? { available: false, reason: 'This address is reserved by Youbot.' }
        : forwardedSlug === 'north-star-73'
          ? { available: true }
          : { available: false, reason: 'Use 3–40 lowercase letters, numbers, or single hyphens.' };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', relayFetch);

    let statusCode = 0;
    let responseBody = '';
    const response = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      writeHead: vi.fn((status: number) => {
        statusCode = status;
        response.headersSent = true;
        return response;
      }),
      end: vi.fn((body?: string) => {
        responseBody = body || '';
        response.writableEnded = true;
        return response;
      }),
      on: vi.fn(() => response),
    };
    const request = {
      url: `/api/channels/webchat/relay/availability?slug=${encodeURIComponent(slug)}`,
      method: 'GET',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as http.IncomingMessage;

    await handleRequest(request, response as unknown as http.ServerResponse);

    expect(relayFetch).toHaveBeenCalledOnce();
    expect(new URL(String(relayFetch.mock.calls[0][0])).searchParams.get('slug')).toBe(slug);
    expect(statusCode).toBe(200);
    expect(JSON.parse(responseBody)).toEqual(reason ? { available, reason } : { available });
  });
});
