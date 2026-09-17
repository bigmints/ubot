export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export type TaskRecurrence = 'once' | 'interval' | 'cron' | 'daily' | 'weekly' | 'monthly';

export interface TaskSchedule {
  readonly recurrence: TaskRecurrence;
  readonly cronExpression?: string;
  readonly intervalMs?: number;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly timezone?: string;
  readonly maxRuns?: number;
  readonly runImmediately?: boolean;
}

export interface TaskResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly duration: number;
  readonly timestamp: Date;
}

export interface TaskExecutionContext {
  readonly taskId: string;
  readonly runNumber: number;
  readonly scheduledTime: Date;
  readonly actualTime: Date;
  readonly previousResult?: TaskResult;
}

export type TaskHandler<T = unknown, R = unknown> = (
  context: TaskExecutionContext,
  data: T
) => Promise<R>;

export interface Task<T = unknown, R = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly handler: TaskHandler<T, R>;
  readonly schedule: TaskSchedule;
  readonly data: T;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly tags: string[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastRunAt?: Date;
  readonly nextRunAt?: Date;
  readonly lastResult?: TaskResult<R>;
  readonly runCount: number;
  readonly failureCount: number;
  readonly enabled: boolean;
}

export interface TaskCreate<T = unknown, R = unknown> {
  readonly name: string;
  readonly description?: string;
  readonly handler: TaskHandler<T, R>;
  readonly schedule: TaskSchedule;
  readonly data?: T;
  readonly priority?: TaskPriority;
  readonly tags?: string[];
  readonly metadata?: Record<string, unknown>;
  readonly enabled?: boolean;
}

export interface TaskUpdate {
  readonly name?: string;
  readonly description?: string;
  readonly schedule?: TaskSchedule;
  readonly priority?: TaskPriority;
  readonly tags?: string[];
  readonly metadata?: Record<string, unknown>;
  readonly enabled?: boolean;
}

export interface TaskFilter {
  readonly status?: TaskStatus | TaskStatus[];
  readonly priority?: TaskPriority | TaskPriority[];
  readonly tags?: string[];
  readonly enabled?: boolean;
  readonly nameContains?: string;
  readonly createdAfter?: Date;
  readonly createdBefore?: Date;
  readonly nextRunAfter?: Date;
  readonly nextRunBefore?: Date;
}

export interface TaskSortOptions {
  readonly field: 'name' | 'priority' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt' | 'runCount';
  readonly direction: 'asc' | 'desc';
}

export interface TaskListResult {
  readonly tasks: Task[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface SchedulerStats {
  readonly totalTasks: number;
  readonly enabledTasks: number;
  readonly runningTasks: number;
  readonly pendingTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly totalRuns: number;
  readonly totalFailures: number;
  readonly averageRunTime: number;
  readonly uptime: number;
}

export interface LoggerInstance {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface SchedulerConfig {
  readonly maxConcurrentTasks: number;
  readonly defaultTimeout: number;
  readonly retryAttempts: number;
  readonly retryDelayMs: number;
  readonly enablePersistence: boolean;
  readonly persistencePath?: string;
  readonly timezone: string;
  readonly logger?: LoggerInstance;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrentTasks: 10,
  defaultTimeout: 30000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  enablePersistence: false,
  timezone: 'UTC',
};

export interface SchedulerEvent {
  readonly type: 'task_created' | 'task_updated' | 'task_deleted' | 'task_started' | 'task_completed' | 'task_failed' | 'task_cancelled' | 'scheduler_started' | 'scheduler_stopped';
  readonly taskId?: string;
  readonly timestamp: Date;
  readonly data?: unknown;
}

export type SchedulerEventListener = (event: SchedulerEvent) => void | Promise<void>;

export const PRIORITY_VALUES: Record<TaskPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

export const TASK_SCHEDULER_SKILL = {
  name: 'task-scheduler',
  description: 'Schedule and manage recurring and one-time tasks',
  category: 'system',
  level: 'intermediate' as const,
};