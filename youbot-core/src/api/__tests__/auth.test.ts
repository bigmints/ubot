/**
 * Auth Middleware Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import http from 'http';
import { requiresAuth, authenticate, setApiKeysForTesting } from '../middleware/auth.js';

function createMockRequest(headers: Record<string, string> = {}): http.IncomingMessage {
  return {
    headers,
  } as unknown as http.IncomingMessage;
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    setApiKeysForTesting([
      { key: 'test-key-123', name: 'Test Client', scopes: ['chat', 'tools'] },
      { key: 'admin-key-456', name: 'Admin', scopes: [] },
    ]);
  });

  describe('requiresAuth', () => {
    it('should skip auth for OPTIONS', () => {
      expect(requiresAuth('OPTIONS', '/api/chat')).toBe(false);
    });

    it('should skip auth for /api/health', () => {
      expect(requiresAuth('GET', '/api/health')).toBe(false);
    });

    it('should skip auth for /api/health with query', () => {
      expect(requiresAuth('GET', '/api/health?verbose=true')).toBe(false);
    });

    it('should require auth for /api/chat', () => {
      expect(requiresAuth('POST', '/api/chat')).toBe(true);
    });

    it('should require auth for /api/tools', () => {
      expect(requiresAuth('GET', '/api/tools')).toBe(true);
    });
  });

  describe('authenticate', () => {
    it('should fail when no Authorization header', () => {
      const req = createMockRequest();
      const result = authenticate(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('should fail for invalid format (not Bearer)', () => {
      const req = createMockRequest({ authorization: 'Basic abc123' });
      const result = authenticate(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid Authorization format');
    });

    it('should fail for invalid key', () => {
      const req = createMockRequest({ authorization: 'Bearer wrong-key' });
      const result = authenticate(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });

    it('should succeed with valid key', () => {
      const req = createMockRequest({ authorization: 'Bearer test-key-123' });
      const result = authenticate(req);
      expect(result.authenticated).toBe(true);
      expect(result.clientName).toBe('Test Client');
      expect(result.scopes).toEqual(['chat', 'tools']);
    });

    it('should succeed with admin key', () => {
      const req = createMockRequest({ authorization: 'Bearer admin-key-456' });
      const result = authenticate(req);
      expect(result.authenticated).toBe(true);
      expect(result.clientName).toBe('Admin');
    });
  });
});
