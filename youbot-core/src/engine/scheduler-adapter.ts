/**
 * Scheduler → Event Bus Adapter
 * 
 * Bridges the TaskSchedulerService event system to the skill engine's EventBus,
 * enabling skills to be triggered by scheduled events (cron, reminders, etc.)
 * 
 * Example skill trigger: { events: ['scheduler:task.completed'] }
 */

import type { EventBus } from '../agents/skills/event-bus.js';
import type { TaskSchedulerService } from '../automation/scheduler/service.js';
import { log } from '../logger/ring-buffer.js';

/**
 * Wire the scheduler's built-in event system to the skill engine's EventBus.
 * Call this once at startup after both scheduler and eventBus are initialized.
 */
export function wireSchedulerToEventBus(
  scheduler: TaskSchedulerService,
  eventBus: EventBus,
): () => void {
  const unsubscribe = scheduler.addListener((event) => {
    // Map scheduler events to skill events
    const typeMap: Record<string, string> = {
      'task_started': 'task.started',
      'task_completed': 'task.completed',
      'task_failed': 'task.failed',
      'task_cancelled': 'task.cancelled',
    };

    const skillEventType = typeMap[event.type];
    if (!skillEventType) return; // Ignore scheduler_started/stopped etc.

    const taskData = (event as any).data || {};
    const taskId = (event as any).taskId || '';

    eventBus.emit({
      source: 'scheduler',
      type: skillEventType,
      data: {
        taskId,
        eventType: event.type,
        ...taskData,
      },
      body: `Scheduler event: ${skillEventType} for task ${taskId}`,
      timestamp: event.timestamp,
    });

    log.info('SchedulerAdapter', `Emitted scheduler:${skillEventType} for task ${taskId}`);
  });

  log.info('SchedulerAdapter', 'Scheduler → EventBus bridge active');
  return unsubscribe;
}
