import { describe, it, expect } from 'vitest';
import messagingModule from '../../channels/tools.js';
import { registerModule, createMockContext } from './test-helpers.js';

describe('Messaging Tool Module', () => {
  it('should export correct module metadata', () => {
    expect(messagingModule.name).toBe('messaging');
    expect(messagingModule.tools.length).toBe(16);
  });

  it('should register all 8 tool executors', () => {
    const registry = registerModule(messagingModule);
    const expected = [
      'send_message', 'search_messages', 'get_contacts', 'get_conversations',
      'delete_message', 'reply_to_message', 'get_connection_status', 'forward_message',
    ];
    for (const name of expected) {
      expect(registry.has(name)).toBe(true);
    }
  });

  describe('send_message', () => {
    it('should fail when no messaging provider', async () => {
      const registry = registerModule(messagingModule, createMockContext({ allNull: true }));
      const result = await registry.call('send_message', { to: '123', body: 'hi' });
      expect(result.success).toBe(false);
    });

    it('should fail when body is empty', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('send_message', { to: '123', body: '' });
      expect(result.success).toBe(false);
    });

    it('should fail when recipient is empty', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('send_message', { to: '', body: 'hello' });
      expect(result.success).toBe(false);
    });

    it('should send a message successfully', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('send_message', { to: '+1234567890', body: 'Hello!' });
      expect(result.success, JSON.stringify(result)).toBe(true);
    });
  });

  describe('get_contacts', () => {
    it('should return contacts', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('get_contacts', {});
      expect(result.success).toBe(true);
    });
  });

  describe('get_conversations', () => {
    it('should return conversations', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('get_conversations', {});
      expect(result.success).toBe(true);
    });
  });

  describe('get_connection_status', () => {
    it('should return status', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('get_connection_status', {});
      expect(result.success).toBe(true);
    });
  });

  describe('search_messages', () => {
    it('should search messages', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('search_messages', { query: 'hello' });
      expect(result.success).toBe(true);
    });
  });

  describe('forward_message', () => {
    it('should fail without recipient', async () => {
      const registry = registerModule(messagingModule);
      const result = await registry.call('forward_message', { to: '', text: 'hi' });
      expect(result.success).toBe(false);
    });
  });
});
