import { describe, it, expect } from 'vitest';
import schedulerModule from '../../automation/scheduler/tools.js';
import { registerModule, createMockContext } from './test-helpers.js';

describe('Scheduler Tool Module', () => {
  it('should export correct module metadata', () => {
    expect(schedulerModule.name).toBe('scheduler');
    expect(schedulerModule.tools.length).toBe(7);
    expect(schedulerModule.tools.map(t => t.name)).toEqual([
      'schedule_message', 'set_auto_reply', 'create_reminder',
      'list_schedules', 'delete_schedule', 'trigger_schedule',
      'schedule_agent_task',
    ]);
  });

  it('should register all 6 executors', () => {
    const registry = registerModule(schedulerModule);
    expect(registry.registeredNames()).toHaveLength(7);
  });

  describe('schedule_message', () => {
    it('should fail when missing required params', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('schedule_message', { to: '', body: '', time: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('should fail when time is unparseable', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('schedule_message', { to: '123', body: 'hi', time: 'xyzzy' });
      expect(result.success).toBe(false);
    });

    it('should fail when scheduler is null', async () => {
      const registry = registerModule(schedulerModule, createMockContext({ allNull: true }));
      const result = await registry.call('schedule_message', { to: '123', body: 'hi', time: 'tomorrow at 9am' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should schedule a message for the future', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('schedule_message', {
        to: '1234567890',
        body: 'Hello scheduled!',
        time: 'in 2 hours',
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain('Scheduled');
    });
  });

  describe('set_auto_reply', () => {
    it('should enable auto reply', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('set_auto_reply', {
        contacts: 'all',
        instructions: 'Say I am busy',
        enabled: true,
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain('enabled');
    });

    it('should disable auto reply', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('set_auto_reply', {
        contacts: '123',
        instructions: '',
        enabled: false,
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain('disabled');
    });
  });

  describe('create_reminder', () => {
    it('should fail when missing params', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('create_reminder', { message: '', time: '' });
      expect(result.success).toBe(false);
    });

    it('should fail when scheduler is null', async () => {
      const registry = registerModule(schedulerModule, createMockContext({ allNull: true }));
      const result = await registry.call('create_reminder', { message: 'test', time: 'tomorrow' });
      expect(result.success).toBe(false);
    });

    it('should create a reminder', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('create_reminder', {
        message: 'Take medicine',
        time: 'in 1 hour',
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain('Reminder set');
    });
  });

  describe('list_schedules', () => {
    it('should fail when scheduler is null', async () => {
      const registry = registerModule(schedulerModule, createMockContext({ allNull: true }));
      const result = await registry.call('list_schedules');
      expect(result.success).toBe(false);
    });

    it('should return empty when no tasks', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('list_schedules');
      expect(result.success).toBe(true);
      expect(result.result).toContain('No scheduled tasks');
    });
  });

  describe('delete_schedule', () => {
    it('should fail without task_id', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('delete_schedule', { task_id: '' });
      expect(result.success).toBe(false);
    });

    it('should fail when scheduler is null', async () => {
      const registry = registerModule(schedulerModule, createMockContext({ allNull: true }));
      const result = await registry.call('delete_schedule', { task_id: 'task-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('trigger_schedule', () => {
    it('should fail without task_id', async () => {
      const registry = registerModule(schedulerModule);
      const result = await registry.call('trigger_schedule', { task_id: '' });
      expect(result.success).toBe(false);
    });

    it('should fail when scheduler is null', async () => {
      const registry = registerModule(schedulerModule, createMockContext({ allNull: true }));
      const result = await registry.call('trigger_schedule', { task_id: 'task-1' });
      expect(result.success).toBe(false);
    });
  });
});
