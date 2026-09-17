import type { ToolModule } from '../../tools/types.js';
import schedulerTools from './tools.js';

/** Auto-discovered tool modules for this capability */
export const toolModules: ToolModule[] = [schedulerTools];

export * from './types.js';
export * from './utils.js';
export {
  TaskSchedulerService,
  createTaskScheduler,
  getTaskScheduler,
  resetTaskScheduler,
} from './service.js';

import type { SchedulerConfig, TaskCreate, Task, TaskFilter, TaskSortOptions, TaskResult, SchedulerStats, SchedulerEventListener } from './types.js';
import { TaskSchedulerService, createTaskScheduler, getTaskScheduler, resetTaskScheduler } from './service.js';

export async function initializeScheduler(config?: Partial<SchedulerConfig>): Promise<TaskSchedulerService> {
  const scheduler = createTaskScheduler(config);
  await scheduler.start();
  return scheduler;
}

export function getScheduler(): TaskSchedulerService {
  return getTaskScheduler();
}

export function resetScheduler(): void {
  resetTaskScheduler();
}

export async function scheduleTask<T = unknown, R = unknown>(
  name: string,
  cronExpression: string,
  handler: import('./types.js').TaskHandler<T, R>,
  data?: T
): Promise<Task<T, R>> {
  const scheduler = getTaskScheduler();
  return scheduler.createTask({
    name,
    handler,
    schedule: {
      recurrence: 'cron',
      cronExpression,
    },
    data,
  });
}

export async function scheduleOnce<T = unknown, R = unknown>(
  name: string,
  runAt: Date,
  handler: import('./types.js').TaskHandler<T, R>,
  data?: T
): Promise<Task<T, R>> {
  const scheduler = getTaskScheduler();
  return scheduler.createTask({
    name,
    handler,
    schedule: {
      recurrence: 'once',
      startDate: runAt,
    },
    data,
  });
}

export async function scheduleInterval<T = unknown, R = unknown>(
  name: string,
  intervalMs: number,
  handler: import('./types.js').TaskHandler<T, R>,
  data?: T
): Promise<Task<T, R>> {
  const scheduler = getTaskScheduler();
  return scheduler.createTask({
    name,
    handler,
    schedule: {
      recurrence: 'interval',
      intervalMs,
    },
    data,
  });
}