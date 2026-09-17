import cron from 'node-cron';
import { join } from 'path';
import { homedir } from 'os';
import type { DatabaseConnection } from '../../data/database/types.js';
import type {
  Task,
  TaskCreate,
  TaskUpdate,
  TaskFilter,
  TaskSortOptions,
  TaskListResult,
  TaskResult,
  TaskExecutionContext,
  SchedulerConfig,
  SchedulerStats,
  SchedulerEvent,
  SchedulerEventListener,
  TaskHandler,
  TaskSchedule,
} from './types.js';
import { DEFAULT_SCHEDULER_CONFIG } from './types.js';
import {
  generateTaskId,
  filterTasks,
  sortTasks,
  paginateTasks,
  validateTaskName,
  validateSchedule,
  calculateNextRun,
} from './utils.js';

/** Factory function that creates a handler from persisted task data */
export type HandlerFactory = (data: any, metadata: Record<string, unknown>) => TaskHandler;

/** Serializable row for SQLite persistence */
interface PersistedTask {
  id: string;
  name: string;
  description: string | null;
  schedule_json: string;
  data_json: string;
  priority: string;
  status: string;
  tags_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  failure_count: number;
  enabled: number;
}

type LoggerInstance = {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

type ScheduledJob = {
  taskId: string;
  job: ReturnType<typeof cron.schedule>;
};

export class TaskSchedulerService {
  private tasks: Map<string, Task> = new Map();
  private jobs: Map<string, ScheduledJob> = new Map();
  private runningTasks: Set<string> = new Set();
  private config: SchedulerConfig;
  private logger?: LoggerInstance;
  private listeners: SchedulerEventListener[] = [];
  private startTime: number = Date.now();
  private totalRunTime: number = 0;
  private totalRuns: number = 0;
  private isRunning: boolean = false;
  private db: DatabaseConnection | null = null;
  private handlerFactories: Map<string, HandlerFactory> = new Map();

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.logger = this.config.logger;
  }

  /** Register a handler factory for a task tag (e.g., 'scheduled_message', 'reminder', 'agent_task') */
  registerHandlerFactory(tag: string, factory: HandlerFactory): void {
    this.handlerFactories.set(tag, factory);
  }

  /**
   * Set database connection.
   */
  setDatabase(db: DatabaseConnection): void {
    this.db = db;
    this.logger?.info('TaskScheduler connected to database');
  }

  /** Initialize SQLite persistence */
  private initDB(): void {
    // Persistence disabled temporarily during Supabase migration
  }

  private async persistTask(task: Task): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.execute(
        `INSERT OR REPLACE INTO youbot_scheduled_tasks 
          (id, name, description, tag, schedule, data, priority, status, tags, metadata, created_at, updated_at, next_run_at, run_count, failure_count, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.name,
          task.description,
          task.handler, // The tag/handler ID is stored here
          task.schedule,
          typeof task.data === 'string' ? task.data : JSON.stringify(task.data),
          task.priority,
          task.status,
          JSON.stringify(task.tags || []),
          JSON.stringify(task.metadata || {}),
          task.createdAt.toISOString(),
          task.updatedAt.toISOString(),
          task.nextRunAt ? task.nextRunAt.toISOString() : null,
          task.runCount,
          task.failureCount,
          task.enabled ? 1 : 0
        ]
      );
    } catch (err: any) {
      this.logger?.error(`Failed to persist task ${task.id}: ${err.message}`);
    }
  }

  private async unpersistTask(id: string): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.execute(`DELETE FROM youbot_scheduled_tasks WHERE id = ?`, [id]);
    } catch (err: any) {
      this.logger?.error(`Failed to unpersist task ${id}: ${err.message}`);
    }
  }

  async loadPersistedTasks(): Promise<number> {
    if (!this.db) return 0;
    try {
      const rows = await this.db.query(`SELECT * FROM youbot_scheduled_tasks`);

      if (!rows || rows.length === 0) return 0;

      let loadedCount = 0;
      for (const row of rows) {
        const handlerTag = row.tag;
        const factory = this.handlerFactories.get(handlerTag);
        
        if (!factory) {
          this.logger?.warn(`No handler factory registered for tag '${handlerTag}'. Task ${row.id} will not be loaded.`);
          continue;
        }

        try {
          const taskData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
          const taskMetadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
          const handler = factory(taskData, taskMetadata);
          const task: Task = {
            id: row.id,
            name: row.name,
            description: row.description,
            handler: handlerTag as any,
            schedule: row.schedule,
            data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
            priority: row.priority as any,
            status: row.status as any,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            nextRunAt: row.next_run_at ? new Date(row.next_run_at) : undefined,
            runCount: row.run_count,
            failureCount: row.failure_count,
            enabled: row.enabled === 1 || row.enabled === true
          } as unknown as Task;

          // Override handler function implementation
          (task as any).handler = handler;

          this.tasks.set(task.id, task);
          loadedCount++;
        } catch (err: any) {
          this.logger?.error(`Failed to reconstruct task ${row.id}: ${err.message}`);
        }
      }

      this.logger?.info(`Loaded ${loadedCount} persisted tasks from database`);
      return loadedCount;
    } catch (err: any) {
      this.logger?.error(`Failed to load persisted tasks: ${err.message}`);
      return 0;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger?.warn('Scheduler is already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    for (const task of this.tasks.values()) {
      if (task.enabled && task.status !== 'running') {
        await this.scheduleTask(task);
      }
    }

    this.emit({ type: 'scheduler_started', timestamp: new Date() });
    this.logger?.info('Task scheduler started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    for (const { job } of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();

    this.isRunning = false;
    this.emit({ type: 'scheduler_stopped', timestamp: new Date() });
    this.logger?.info('Task scheduler stopped');
  }

  async createTask<T = unknown, R = unknown>(create: TaskCreate<T, R>): Promise<Task<T, R>> {
    if (!validateTaskName(create.name)) {
      throw new Error('Invalid task name. Must be 1-200 characters and contain only alphanumeric, underscore, hyphen, dot, or space characters.');
    }

    const scheduleValidation = validateSchedule(create.schedule);
    if (!scheduleValidation.valid) {
      throw new Error(`Invalid schedule: ${scheduleValidation.error}`);
    }

    const id = generateTaskId();
    const now = new Date();
    const nextRunAt = calculateNextRun(create.schedule);

    const task: Task<T, R> = {
      id,
      name: create.name,
      description: create.description,
      handler: create.handler,
      schedule: create.schedule,
      data: create.data ?? ({} as T),
      priority: create.priority ?? 'normal',
      status: 'pending',
      tags: create.tags ?? [],
      metadata: create.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      failureCount: 0,
      enabled: create.enabled ?? true,
      nextRunAt: nextRunAt ?? undefined,
    };

    this.tasks.set(id, task as Task);
    this.persistTask(task as Task);

    if (this.isRunning && task.enabled) {
      await this.scheduleTask(task as Task);
    }

    this.emit({ type: 'task_created', taskId: id, timestamp: new Date(), data: task });
    this.logger?.info(`Task created: ${task.name} (${id})`);

    return task;
  }

  async updateTask(id: string, update: TaskUpdate): Promise<Task> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (update.name !== undefined && !validateTaskName(update.name)) {
      throw new Error('Invalid task name');
    }

    if (update.schedule !== undefined) {
      const scheduleValidation = validateSchedule(update.schedule);
      if (!scheduleValidation.valid) {
        throw new Error(`Invalid schedule: ${scheduleValidation.error}`);
      }
    }

    const nextRunAt = update.schedule ? calculateNextRun(update.schedule) : task.nextRunAt;

    const updatedTask: Task = {
      ...task,
      name: update.name ?? task.name,
      description: update.description ?? task.description,
      schedule: update.schedule ?? task.schedule,
      priority: update.priority ?? task.priority,
      tags: update.tags ?? task.tags,
      metadata: update.metadata ?? task.metadata,
      enabled: update.enabled ?? task.enabled,
      updatedAt: new Date(),
      nextRunAt: nextRunAt ?? undefined,
    };

    this.tasks.set(id, updatedTask);
    this.persistTask(updatedTask);

    if (this.jobs.has(id)) {
      const { job } = this.jobs.get(id)!;
      job.stop();
      this.jobs.delete(id);
    }

    if (this.isRunning && updatedTask.enabled) {
      await this.scheduleTask(updatedTask);
    }

    this.emit({ type: 'task_updated', taskId: id, timestamp: new Date(), data: updatedTask });
    this.logger?.info(`Task updated: ${updatedTask.name} (${id})`);

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (this.jobs.has(id)) {
      const { job } = this.jobs.get(id)!;
      job.stop();
      this.jobs.delete(id);
    }

    this.tasks.delete(id);
    this.unpersistTask(id);
    this.runningTasks.delete(id);

    this.emit({ type: 'task_deleted', taskId: id, timestamp: new Date() });
    this.logger?.info(`Task deleted: ${task.name} (${id})`);

    return true;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(filter?: TaskFilter, sort?: TaskSortOptions, page: number = 1, pageSize: number = 20): TaskListResult {
    let tasks = Array.from(this.tasks.values());

    if (filter) {
      tasks = filterTasks(tasks, filter);
    }

    if (sort) {
      tasks = sortTasks(tasks, sort);
    }

    return paginateTasks(tasks, page, pageSize);
  }

  async runTaskNow(id: string): Promise<TaskResult> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    return this.executeTask(task);
  }

  async cancelTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (this.jobs.has(id)) {
      const { job } = this.jobs.get(id)!;
      job.stop();
      this.jobs.delete(id);
    }

    const updatedTask: Task = {
      ...task,
      status: 'cancelled',
      enabled: false,
      updatedAt: new Date(),
    };

    this.tasks.set(id, updatedTask);
    this.persistTask(updatedTask);
    this.runningTasks.delete(id);

    this.emit({ type: 'task_cancelled', taskId: id, timestamp: new Date() });
    this.logger?.info(`Task cancelled: ${task.name} (${id})`);

    return true;
  }

  async pauseTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (this.jobs.has(id)) {
      const { job } = this.jobs.get(id)!;
      job.stop();
      this.jobs.delete(id);
    }

    const updatedTask: Task = {
      ...task,
      status: 'paused',
      updatedAt: new Date(),
    };

    this.tasks.set(id, updatedTask);

    this.logger?.info(`Task paused: ${task.name} (${id})`);
    return true;
  }

  async resumeTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'paused') {
      return false;
    }

    const updatedTask: Task = {
      ...task,
      status: 'pending',
      enabled: true,
      updatedAt: new Date(),
      nextRunAt: calculateNextRun(task.schedule) ?? undefined,
    };

    this.tasks.set(id, updatedTask);

    if (this.isRunning) {
      await this.scheduleTask(updatedTask);
    }

    this.logger?.info(`Task resumed: ${task.name} (${id})`);
    return true;
  }

  getStats(): SchedulerStats {
    const tasks = Array.from(this.tasks.values());

    return {
      totalTasks: tasks.length,
      enabledTasks: tasks.filter(t => t.enabled).length,
      runningTasks: this.runningTasks.size,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      totalRuns: this.totalRuns,
      totalFailures: tasks.reduce((sum, t) => sum + t.failureCount, 0),
      averageRunTime: this.totalRuns > 0 ? this.totalRunTime / this.totalRuns : 0,
      uptime: Date.now() - this.startTime,
    };
  }

  addListener(listener: SchedulerEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private async scheduleTask(task: Task): Promise<void> {
    if (!task.enabled || !task.nextRunAt) {
      return;
    }

    const scheduleJob = async (): Promise<void> => {
      // Prevent double-firing if runTaskNow already completed this task out-of-band
      const latestTask = this.tasks.get(task.id);
      if (!latestTask || latestTask.status === 'completed' || !latestTask.enabled) {
        this.jobs.delete(task.id);
        return;
      }

      await this.executeTask(latestTask);

      const currentTask = this.tasks.get(task.id);
      if (currentTask && currentTask.enabled) {
        // 'once' tasks should NOT reschedule after execution
        if (currentTask.schedule.recurrence === 'once') {
          const completedTask = { ...currentTask, enabled: false, status: 'completed' as const };
          this.tasks.set(task.id, completedTask);
          this.jobs.delete(task.id);
          return;
        }

        const nextRun = calculateNextRun(currentTask.schedule);
        if (nextRun) {
          const updatedTask = { ...currentTask, nextRunAt: nextRun };
          this.tasks.set(task.id, updatedTask);
          const delay = nextRun.getTime() - Date.now();
          if (delay > 0) {
            const timeoutId = setTimeout(scheduleJob, delay);
            const fakeJob = {
              taskId: task.id,
              job: { stop: () => clearTimeout(timeoutId) },
            } as ScheduledJob;
            this.jobs.set(task.id, fakeJob);
          } else {
            await scheduleJob();
          }
        }
      }
    };

    if (task.schedule.recurrence === 'cron' && task.schedule.cronExpression) {
      if (!cron.validate(task.schedule.cronExpression)) {
        this.logger?.error(`Invalid cron expression for task ${task.name}: ${task.schedule.cronExpression}`);
        return;
      }

      const job = cron.schedule(
        task.schedule.cronExpression,
        async () => {
          await this.executeTask(task);
        },
        {
          timezone: task.schedule.timezone ?? this.config.timezone,
        }
      );

      this.jobs.set(task.id, { taskId: task.id, job });
    } else {
      const delay = task.nextRunAt.getTime() - Date.now();
      if (delay <= 0) {
        await scheduleJob();
      } else {
        const timeoutId = setTimeout(scheduleJob, delay);
        const fakeJob = {
          taskId: task.id,
          job: {
            stop: () => clearTimeout(timeoutId),
          },
        } as ScheduledJob;
        this.jobs.set(task.id, fakeJob);
      }
    }
  }

  private async executeTask<R>(task: Task): Promise<TaskResult<R>> {
    const startTime = Date.now();
    const context: TaskExecutionContext = {
      taskId: task.id,
      runNumber: task.runCount + 1,
      scheduledTime: task.nextRunAt ?? new Date(),
      actualTime: new Date(),
      previousResult: task.lastResult,
    };

    this.runningTasks.add(task.id);

    const runningTask: Task = {
      ...task,
      status: 'running',
      updatedAt: new Date(),
    };
    this.tasks.set(task.id, runningTask);

    this.emit({ type: 'task_started', taskId: task.id, timestamp: new Date(), data: context });
    this.logger?.debug(`Task started: ${task.name} (${task.id})`);

    try {
      const result = await Promise.race([
        task.handler(context, task.data),
        this.createTimeout<R>(this.config.defaultTimeout),
      ]) as R;

      const duration = Date.now() - startTime;
      const taskResult: TaskResult<R> = {
        success: true,
        data: result,
        duration,
        timestamp: new Date(),
      };

      const completedTask: Task = {
        ...this.tasks.get(task.id)!,
        status: 'completed',
        lastRunAt: new Date(),
        lastResult: taskResult as TaskResult,
        runCount: task.runCount + 1,
        updatedAt: new Date(),
        nextRunAt: calculateNextRun(task.schedule) ?? undefined,
      };

      this.tasks.set(task.id, completedTask);
      this.persistTask(completedTask);
      this.runningTasks.delete(task.id);

      this.totalRuns++;
      this.totalRunTime += duration;

      this.emit({ type: 'task_completed', taskId: task.id, timestamp: new Date(), data: taskResult });
      this.logger?.debug(`Task completed: ${task.name} (${task.id}) in ${duration}ms`);

      return taskResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const taskResult: TaskResult<R> = {
        success: false,
        error: errorMessage,
        duration,
        timestamp: new Date(),
      };

      const failedTask: Task = {
        ...this.tasks.get(task.id)!,
        status: 'failed',
        lastRunAt: new Date(),
        lastResult: taskResult as TaskResult,
        runCount: task.runCount + 1,
        failureCount: task.failureCount + 1,
        updatedAt: new Date(),
        nextRunAt: calculateNextRun(task.schedule) ?? undefined,
      };

      this.tasks.set(task.id, failedTask);
      this.persistTask(failedTask);
      this.runningTasks.delete(task.id);

      this.emit({ type: 'task_failed', taskId: task.id, timestamp: new Date(), data: taskResult });
      this.logger?.error(`Task failed: ${task.name} (${task.id}): ${errorMessage}`);

      return taskResult;
    }
  }

  private createTimeout<T>(ms: number): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms);
    });
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch(err => this.logger?.error('Event listener error:', err));
        }
      } catch (err) {
        this.logger?.error('Event listener error:', err);
      }
    }
  }
}

let schedulerInstance: TaskSchedulerService | null = null;

export function createTaskScheduler(config?: Partial<SchedulerConfig>): TaskSchedulerService {
  return new TaskSchedulerService(config);
}

export function getTaskScheduler(): TaskSchedulerService {
  if (!schedulerInstance) {
    schedulerInstance = createTaskScheduler();
  }
  return schedulerInstance;
}

export function resetTaskScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop().catch(() => {});
    schedulerInstance = null;
  }
}