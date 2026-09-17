import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskFilter,
  TaskSortOptions,
  TaskListResult,
  TaskSchedule,
  TaskRecurrence,
  PRIORITY_VALUES,
} from './types.js';

export function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `task_${timestamp}_${random}`;
}

export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `run_${timestamp}_${random}`;
}

export function getPriorityValue(priority: TaskPriority): number {
  const values: Record<TaskPriority, number> = {
    low: 1,
    normal: 2,
    high: 3,
    critical: 4,
  };
  return values[priority];
}

export function comparePriorities(a: TaskPriority, b: TaskPriority): number {
  return getPriorityValue(b) - getPriorityValue(a);
}

export function isValidCronExpression(expression: string): boolean {
  const cronParts = expression.trim().split(/\s+/);
  return cronParts.length >= 5 && cronParts.length <= 6;
}

export function parseInterval(interval: string): number | null {
  const match = interval.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

export function calculateNextRun(schedule: TaskSchedule, fromDate: Date = new Date()): Date | null {
  if (schedule.endDate && fromDate >= schedule.endDate) {
    return null;
  }

  const startDate = schedule.startDate ? new Date(Math.max(fromDate.getTime(), schedule.startDate.getTime())) : fromDate;

  switch (schedule.recurrence) {
    case 'once':
      return schedule.startDate || fromDate;

    case 'interval':
      if (!schedule.intervalMs) return null;
      return new Date(startDate.getTime() + schedule.intervalMs);

    case 'cron':
      if (!schedule.cronExpression) return null;
      return calculateNextCronRun(schedule.cronExpression, startDate, schedule.timezone);

    case 'daily': {
      // Preserve original time-of-day from startDate
      if (schedule.startDate) {
        const next = new Date(fromDate);
        next.setHours(schedule.startDate.getHours(), schedule.startDate.getMinutes(), schedule.startDate.getSeconds(), 0);
        // If that time already passed today, move to tomorrow
        if (next.getTime() <= fromDate.getTime()) {
          next.setDate(next.getDate() + 1);
        }
        return next;
      }
      return new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    }

    case 'weekly': {
      if (schedule.startDate) {
        const next = new Date(fromDate);
        next.setHours(schedule.startDate.getHours(), schedule.startDate.getMinutes(), schedule.startDate.getSeconds(), 0);
        // Move forward day-by-day until we hit the same weekday as startDate
        const targetDay = schedule.startDate.getDay();
        while (next.getDay() !== targetDay || next.getTime() <= fromDate.getTime()) {
          next.setDate(next.getDate() + 1);
        }
        return next;
      }
      return new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    case 'monthly': {
      const nextMonth = new Date(startDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      if (schedule.startDate) {
        nextMonth.setHours(schedule.startDate.getHours(), schedule.startDate.getMinutes(), schedule.startDate.getSeconds(), 0);
      }
      return nextMonth;
    }

    default:
      return null;
  }
}

function calculateNextCronRun(expression: string, fromDate: Date, timezone?: string): Date {
  const parts = expression.trim().split(/\s+/);
  const minute = parts[0];
  const hour = parts[1];
  const dayOfMonth = parts[2];
  const month = parts[3];
  const dayOfWeek = parts[4];

  const next = new Date(fromDate);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchesCronPart(next.getMinutes(), minute, 0, 59) &&
        matchesCronPart(next.getHours(), hour, 0, 23) &&
        matchesCronPart(next.getDate(), dayOfMonth, 1, 31) &&
        matchesCronPart(next.getMonth() + 1, month, 1, 12) &&
        matchesCronPart(next.getDay(), dayOfWeek, 0, 6)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return next;
}

function matchesCronPart(value: number, expression: string, min: number, max: number): boolean {
  if (expression === '*') return true;

  if (expression.includes(',')) {
    return expression.split(',').some(part => matchesCronPart(value, part, min, max));
  }

  if (expression.includes('/')) {
    const [, stepStr] = expression.split('/');
    const step = parseInt(stepStr, 10);
    return (value - min) % step === 0;
  }

  if (expression.includes('-')) {
    const [startStr, endStr] = expression.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return value >= start && value <= end;
  }

  return value === parseInt(expression, 10);
}

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks.filter(task => {
    if (filter.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!statuses.includes(task.status)) return false;
    }

    if (filter.priority !== undefined) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      if (!priorities.includes(task.priority)) return false;
    }

    if (filter.tags !== undefined && filter.tags.length > 0) {
      if (!filter.tags.some(tag => task.tags.includes(tag))) return false;
    }

    if (filter.enabled !== undefined && task.enabled !== filter.enabled) return false;

    if (filter.nameContains !== undefined) {
      if (!task.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false;
    }

    if (filter.createdAfter !== undefined && task.createdAt < filter.createdAfter) return false;
    if (filter.createdBefore !== undefined && task.createdAt > filter.createdBefore) return false;

    if (filter.nextRunAfter !== undefined && (!task.nextRunAt || task.nextRunAt < filter.nextRunAfter)) return false;
    if (filter.nextRunBefore !== undefined && (!task.nextRunAt || task.nextRunAt > filter.nextRunBefore)) return false;

    return true;
  });
}

export function sortTasks(tasks: Task[], options: TaskSortOptions): Task[] {
  return [...tasks].sort((a, b) => {
    let comparison = 0;

    switch (options.field) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'priority':
        comparison = comparePriorities(a.priority, b.priority);
        break;
      case 'createdAt':
        comparison = a.createdAt.getTime() - b.createdAt.getTime();
        break;
      case 'updatedAt':
        comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
      case 'lastRunAt':
        const aLastRun = a.lastRunAt?.getTime() ?? 0;
        const bLastRun = b.lastRunAt?.getTime() ?? 0;
        comparison = aLastRun - bLastRun;
        break;
      case 'nextRunAt':
        const aNextRun = a.nextRunAt?.getTime() ?? Infinity;
        const bNextRun = b.nextRunAt?.getTime() ?? Infinity;
        comparison = aNextRun - bNextRun;
        break;
      case 'runCount':
        comparison = a.runCount - b.runCount;
        break;
    }

    return options.direction === 'desc' ? -comparison : comparison;
  });
}

export function paginateTasks(
  tasks: Task[],
  page: number = 1,
  pageSize: number = 20
): TaskListResult {
  const total = tasks.length;
  const offset = (page - 1) * pageSize;
  const paginatedTasks = tasks.slice(offset, offset + pageSize);

  return {
    tasks: paginatedTasks,
    total,
    page,
    pageSize,
  };
}

export function validateTaskName(name: string): boolean {
  return name.length >= 1 && name.length <= 200 && /^[a-zA-Z0-9_\-.\s:,()'"!]+$/.test(name);
}

export function validateSchedule(schedule: TaskSchedule): { valid: boolean; error?: string } {
  if (!schedule.recurrence) {
    return { valid: false, error: 'Recurrence type is required' };
  }

  switch (schedule.recurrence) {
    case 'cron':
      if (!schedule.cronExpression || !isValidCronExpression(schedule.cronExpression)) {
        return { valid: false, error: 'Valid cron expression is required for cron recurrence' };
      }
      break;

    case 'interval':
      if (!schedule.intervalMs || schedule.intervalMs < 1000) {
        return { valid: false, error: 'Interval must be at least 1000ms' };
      }
      break;

    case 'once':
      if (!schedule.startDate) {
        return { valid: false, error: 'Start date is required for one-time tasks' };
      }
      break;
  }

  if (schedule.startDate && schedule.endDate && schedule.startDate >= schedule.endDate) {
    return { valid: false, error: 'Start date must be before end date' };
  }

  if (schedule.maxRuns !== undefined && schedule.maxRuns < 1) {
    return { valid: false, error: 'Max runs must be at least 1' };
  }

  return { valid: true };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
  return `${(ms / 3600000).toFixed(2)}h`;
}

export function createDefaultStats(): import('./types.js').SchedulerStats {
  return {
    totalTasks: 0,
    enabledTasks: 0,
    runningTasks: 0,
    pendingTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    totalRuns: 0,
    totalFailures: 0,
    averageRunTime: 0,
    uptime: Date.now(),
  };
}