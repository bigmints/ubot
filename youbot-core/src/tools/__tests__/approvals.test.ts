import { describe, it, expect } from 'vitest';
import approvalsModule from '../../automation/approvals/tools.js';
import { registerModule, createMockContext } from './test-helpers.js';

describe('Approvals Tool Module', () => {
  it('should export correct module metadata', () => {
    expect(approvalsModule.name).toBe('approvals');
    expect(approvalsModule.tools.length).toBe(4);
    expect(approvalsModule.tools.map(t => t.name)).toEqual([
      'ask_owner', 'respond_to_approval', 'list_pending_approvals', 'delete_approval'
    ]);
  });

  it('should register all 3 tool executors', () => {
    const registry = registerModule(approvalsModule);
    expect(registry.has('ask_owner')).toBe(true);
    expect(registry.has('respond_to_approval')).toBe(true);
    expect(registry.has('list_pending_approvals')).toBe(true);
  });

  describe('ask_owner', () => {
    it('should fail when approval store is null', async () => {
      const registry = registerModule(approvalsModule, createMockContext({ allNull: true }));
      const result = await registry.call('ask_owner', { question: 'test?' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should fail when question is empty', async () => {
      const registry = registerModule(approvalsModule);
      const result = await registry.call('ask_owner', { question: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('question');
    });

    it('should create an approval request', async () => {
      const registry = registerModule(approvalsModule);
      const result = await registry.call('ask_owner', {
        question: 'Can I share pricing?',
        context: 'Customer asking about prices',
        requester_jid: '1234567890@s.whatsapp.net',
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain('Request recorded');
      expect(result.result).not.toContain('has been notified');
    });
  });

  describe('respond_to_approval', () => {
    it('should fail when approval store is null', async () => {
      const registry = registerModule(approvalsModule, createMockContext({ allNull: true }));
      const result = await registry.call('respond_to_approval', { response: 'yes' });
      expect(result.success).toBe(false);
    });

    it('should fail when response is empty', async () => {
      const registry = registerModule(approvalsModule);
      const result = await registry.call('respond_to_approval', { response: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('response');
    });

    it('should report no pending approvals when none exist', async () => {
      const registry = registerModule(approvalsModule);
      const result = await registry.call('respond_to_approval', { response: 'approved' });
      expect(result.success).toBe(true);
      expect(result.result).toContain('No pending');
    });
  });

  describe('list_pending_approvals', () => {
    it('should fail when store is null', async () => {
      const registry = registerModule(approvalsModule, createMockContext({ allNull: true }));
      const result = await registry.call('list_pending_approvals');
      expect(result.success).toBe(false);
    });

    it('should return empty list when no approvals', async () => {
      const registry = registerModule(approvalsModule);
      const result = await registry.call('list_pending_approvals');
      expect(result.success).toBe(true);
      expect(result.result).toContain('No pending');
    });
  });
});
