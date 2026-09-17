import { getIntegrationService } from '../../integrations/runtime.js';
import type { ToolModule } from '../../tools/types.js';
import { safeExecutor } from '../../tools/types.js';

const integrationModule: ToolModule = {
  name: 'integrations',
  tools: [
    {
      name: 'integration_list_sources',
      description: 'List installed external data connectors and configured source connections.',
      parameters: [],
    },
    {
      name: 'integration_search_data',
      description: 'Search records synchronized from external data sources.',
      parameters: [
        { name: 'query', type: 'string', description: 'Text to search for', required: true },
        { name: 'connectionId', type: 'string', description: 'Optional source connection ID', required: false },
        { name: 'stream', type: 'string', description: 'Optional stream name', required: false },
        { name: 'limit', type: 'number', description: 'Maximum results, up to 100', required: false },
      ],
    },
    {
      name: 'integration_sync_source',
      description: 'Synchronize one configured external data source.',
      parameters: [
        { name: 'connectionId', type: 'string', description: 'Source connection ID', required: true },
        { name: 'streams', type: 'array', items: { type: 'string' }, description: 'Optional stream names', required: false },
      ],
    },
    {
      name: 'integration_run_action',
      description: 'Run a supported action on a configured external integration.',
      parameters: [
        { name: 'connectionId', type: 'string', description: 'Source connection ID', required: true },
        { name: 'action', type: 'string', description: 'Action name from the connector manifest', required: true },
        { name: 'input', type: 'object', description: 'Action-specific input', required: true },
      ],
    },
  ],
  register(registry) {
    registry.register('integration_list_sources', safeExecutor('integration_list_sources', async () => {
      const service = getIntegrationService();
      if (!service) throw new Error('Integration service is not initialized');
      return JSON.stringify({ connectors: service.listConnectors(), connections: await service.listConnections() });
    }));
    registry.register('integration_search_data', safeExecutor('integration_search_data', async (args) => {
      const service = getIntegrationService();
      if (!service) throw new Error('Integration service is not initialized');
      if (!args.query) throw new Error('query is required');
      return JSON.stringify(await service.search(String(args.query), {
        connectionId: args.connectionId ? String(args.connectionId) : undefined,
        stream: args.stream ? String(args.stream) : undefined,
        limit: args.limit ? Number(args.limit) : undefined,
      }));
    }));
    registry.register('integration_sync_source', safeExecutor('integration_sync_source', async (args) => {
      const service = getIntegrationService();
      if (!service) throw new Error('Integration service is not initialized');
      if (!args.connectionId) throw new Error('connectionId is required');
      return JSON.stringify(await service.sync(String(args.connectionId), args.streams as string[] | undefined));
    }));
    registry.register('integration_run_action', safeExecutor('integration_run_action', async (args) => {
      const service = getIntegrationService();
      if (!service) throw new Error('Integration service is not initialized');
      if (!args.connectionId || !args.action) throw new Error('connectionId and action are required');
      return JSON.stringify(await service.executeAction(
        String(args.connectionId), String(args.action), (args.input || {}) as Record<string, unknown>,
      ));
    }));
  },
};

export const toolModules: ToolModule[] = [integrationModule];
