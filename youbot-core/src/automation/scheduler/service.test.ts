import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskSchedulerService, createTaskScheduler, resetTaskScheduler } from './service.js';
import type { Task, TaskResult, TaskExecutionContext } from './types.js';

describe('TaskSchedulerService', () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    scheduler = createTaskScheduler({
      maxConcurrentTasks: 5,
      defaultTimeout: 5000,
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    resetTaskScheduler();
  });

  describe('createTask', () => {
    it('should create a task with valid parameters', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      
      const task = await scheduler.createTask({
        name: 'Test Task',
        description: 'A test task',
        handler,
        schedule: {
          recurrence: 'interval',
          intervalMs: 60000,
        },
        data: { key: 'value' },
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe('Test Task');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('normal');
      expect(task.runCount).toBe(0);
    });

    it('should throw error for invalid task name', async () => {
      const handler = vi.fn();

      await expect(scheduler.createTask({
        name: '',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      })).rejects.toThrow('Invalid task name');
    });

    it('should throw error for invalid schedule', async () => {
      const handler = vi.fn();

      await expect(scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 100 },
      })).rejects.toThrow('Invalid schedule');
    });
  });

  describe('getTask', () => {
    it('should return undefined for non-existent task', () => {
      const task = scheduler.getTask('non-existent');
      expect(task).toBeUndefined();
    });

    it('should return created task', async () => {
      const handler = vi.fn();
      
      const created = await scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      const task = scheduler.getTask(created.id);
      expect(task).toBeDefined();
      expect(task?.name).toBe('Test Task');
    });
  });

  describe('updateTask', () => {
    it('should update task properties', async () => {
      const handler = vi.fn();
      
      const task = await scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      const updated = await scheduler.updateTask(task.id, {
        name: 'Updated Task',
        priority: 'high',
      });

      expect(updated.name).toBe('Updated Task');
      expect(updated.priority).toBe('high');
    });

    it('should throw error for non-existent task', async () => {
      await expect(scheduler.updateTask('non-existent', { name: 'Test' }))
        .rejects.toThrow('Task not found');
    });
  });

  describe('deleteTask', () => {
    it('should delete existing task', async () => {
      const handler = vi.fn();
      
      const task = await scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      const result = await scheduler.deleteTask(task.id);
      expect(result).toBe(true);
      expect(scheduler.getTask(task.id)).toBeUndefined();
    });

    it('should return false for non-existent task', async () => {
      const result = await scheduler.deleteTask('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('listTasks', () => {
    it('should list all tasks', async () => {
      const handler = vi.fn();
      
      await scheduler.createTask({
        name: 'Task 1',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });
      
      await scheduler.createTask({
        name: 'Task 2',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      const result = scheduler.listTasks();
      expect(result.tasks).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter tasks by status', async () => {
      const handler = vi.fn();
      
      await scheduler.createTask({
        name: 'Task 1',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
        enabled: true,
      });
      
      await scheduler.createTask({
        name: 'Task 2',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
        enabled: false,
      });

      const result = scheduler.listTasks({ enabled: true });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe('Task 1');
    });
  });

  describe('runTaskNow', () => {
    it('should execute task handler', async () => {
      const handler = vi.fn().mockResolvedValue({ data: 'result' });
      
      const task = await scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
        data: { input: 'test' },
      });

      const result = await scheduler.runTaskNow(task.id);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'result' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle task failure', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Task failed'));
      
      const task = await scheduler.createTask({
        name: 'Failing Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      const result = await scheduler.runTaskNow(task.id);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Task failed');
    });
  });

  describe('cancelTask', () => {
    it('should cancel a task', async () => {
      const handler = vi.fn();
      
      const task = await scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      const result = await scheduler.cancelTask(task.id);
      expect(result).toBe(true);
      
      const cancelledTask = scheduler.getTask(task.id);
      expect(cancelledTask?.status).toBe('cancelled');
      expect(cancelledTask?.enabled).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return scheduler statistics', async () => {
      const handler = vi.fn();
      
      await scheduler.createTask({
        name: 'Task 1',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });
      
      await scheduler.createTask({
        name: 'Task 2',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
        enabled: false,
      });

      const stats = scheduler.getStats();
      
      expect(stats.totalTasks).toBe(2);
      expect(stats.enabledTasks).toBe(1);
    });
  });

  describe('events', () => {
    it('should emit task_created event', async () => {
      const listener = vi.fn();
      scheduler.addListener(listener);
      
      const handler = vi.fn();
      await scheduler.createTask({
        name: 'Test Task',
        handler,
        schedule: { recurrence: 'interval', intervalMs: 60000 },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'task_created' })
      );
    });
  });
});