/**
 * Event Bus
 * Central hub that receives events from all adapters and routes them to the skill engine.
 */

import type { SkillEvent } from './skill-types.js';

export type EventHandler = (event: SkillEvent) => void | Promise<void>;

export interface EventBus {
  /** Emit an event from any adapter */
  emit(event: SkillEvent): void;
  /** Subscribe to all events */
  on(handler: EventHandler): void;
  /** Unsubscribe */
  off(handler: EventHandler): void;
}

/** Create an event bus instance */
export function createEventBus(): EventBus {
  const handlers = new Set<EventHandler>();

  return {
    emit(event: SkillEvent) {
      const key = `${event.source}:${event.type}`;
      console.log(`[EventBus] Dispatching ${key}`);
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch(err => console.error('[EventBus] Handler error:', err.message));
          }
        } catch (err: any) {
          console.error('[EventBus] Handler error:', err.message);
        }
      }
    },

    on(handler: EventHandler) {
      handlers.add(handler);
    },

    off(handler: EventHandler) {
      handlers.delete(handler);
    },
  };
}
