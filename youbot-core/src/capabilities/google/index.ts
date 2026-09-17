import type { ToolModule, ToolRegistry, ToolContext } from '../../tools/types.js';
import { safeExecutor } from '../../tools/types.js';
import { calendarTools, listEvents, createEvent, deleteEvent } from './calendar-tools.js';

const googleModule: ToolModule = {
  name: 'google',
  tools: [...calendarTools],
  register(registry: ToolRegistry, ctx: ToolContext) {
    registry.register('google_calendar_list_events', safeExecutor('google_calendar_list_events', listEvents));
    registry.register('google_calendar_create_event', safeExecutor('google_calendar_create_event', createEvent));
    registry.register('google_calendar_delete_event', safeExecutor('google_calendar_delete_event', deleteEvent));
  },
  ui: {
    title: 'Google Integration',
    icon: 'Calendar',
    href: '/integrations',
    group: 'Capabilities',
  },
};

export const toolModules: ToolModule[] = [googleModule];
