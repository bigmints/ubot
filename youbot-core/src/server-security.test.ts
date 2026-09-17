import { Readable } from 'node:stream';
import type http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySecurityHeaders,
  handleRequest,
  readRequestBody,
  resetState,
  resolveServerHost,
  safeExternalAuthUrl,
  shouldApplyServerAccessGate,
} from './index.js';

function requestWithBody(body: string, remoteAddress = '127.0.0.77'): http.IncomingMessage {
  const request = Readable.from([body]) as unknown as http.IncomingMessage;
  Object.assign(request, {
    url: '/api/auth/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress },
  });
  return request;
}

function responseMock() {
  const response = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    writeHead: vi.fn(() => { response.headersSent = true; }),
    end: vi.fn(() => { response.writableEnded = true; }),
    destroy: vi.fn(() => { response.destroyed = true; }),
  };
  return response;
}

describe('server security boundaries', () => {
  beforeEach(() => resetState());

  it('binds to loopback by default while honoring explicit configuration', () => {
    expect(resolveServerHost(undefined, {})).toBe('127.0.0.1');
    expect(resolveServerHost('192.0.2.10', {})).toBe('192.0.2.10');
    expect(resolveServerHost('192.0.2.10', { YOUBOT_HOST: '::1' })).toBe('::1');
  });

  it('protects sensitive direct API routes in local and SSO modes', () => {
    expect(shouldApplyServerAccessGate('local', 'secret', 'GET', '/api/auth/profile')).toBe(true);
    expect(shouldApplyServerAccessGate('local', 'secret', 'PUT', '/api/auth/password')).toBe(true);
    expect(shouldApplyServerAccessGate('sso', undefined, 'POST', '/api/shutdown')).toBe(true);
    expect(shouldApplyServerAccessGate('sso', undefined, 'GET', '/api/auth/status')).toBe(false);
  });

  it('sets browser security headers and HSTS only for secure requests', () => {
    const insecure = responseMock();
    applySecurityHeaders(
      { headers: {}, socket: {} } as http.IncomingMessage,
      insecure as unknown as http.ServerResponse,
    );
    expect(insecure.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(insecure.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(insecure.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining("default-src 'self'"));
    expect(insecure.setHeader).not.toHaveBeenCalledWith('Strict-Transport-Security', expect.anything());

    const secure = responseMock();
    applySecurityHeaders(
      { headers: { 'x-forwarded-proto': 'https' }, socket: {} } as http.IncomingMessage,
      secure as unknown as http.ServerResponse,
    );
    expect(secure.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  });

  it('rejects request bodies above the 64 KiB authentication limit', async () => {
    await expect(readRequestBody(requestWithBody('x'.repeat(64 * 1024 + 1))))
      .rejects.toMatchObject({ statusCode: 413 });
  });

  it('throttles repeated failed logins by client address', async () => {
    const payload = JSON.stringify({ username: 'invalid', password: 'invalid' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = responseMock();
      await handleRequest(requestWithBody(payload), response as unknown as http.ServerResponse);
      expect(response.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
    }

    const blocked = responseMock();
    await handleRequest(requestWithBody(payload), blocked as unknown as http.ServerResponse);
    expect(blocked.writeHead).toHaveBeenCalledWith(429, {
      'Content-Type': 'application/json',
      'Retry-After': expect.any(String),
    });
  });

  it('accepts only HTTP(S) SSO redirects', () => {
    expect(safeExternalAuthUrl('https://login.example.com/start')).toBe('https://login.example.com/start');
    expect(safeExternalAuthUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeExternalAuthUrl('not-a-url')).toBeUndefined();
  });
});
