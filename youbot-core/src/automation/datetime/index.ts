import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../../tools/types.js';

const DATETIME_TOOLS: ToolDefinition[] = [
  {
    name: 'current_datetime',
    description: 'Get the current date and time in ISO 8601 format.',
    parameters: [],
  },
];

const datetimeModule: ToolModule = {
  name: 'datetime',
  tools: DATETIME_TOOLS,
  register(registry: ToolRegistry, _ctx: ToolContext) {
    registry.register('current_datetime', async () => {
      const now = new Date();
      return {
        toolName: 'current_datetime',
        success: true,
        result: JSON.stringify({
          iso: now.toISOString(),
          local: now.toLocaleString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timestamp: now.getTime(),
        }),
        duration: 0,
      };
    });
  },
};

export default datetimeModule;

export const toolModules = [datetimeModule];
