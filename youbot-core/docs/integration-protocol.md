# Youbot Integration Protocol

The Youbot Integration Protocol (YIP) is the native connector contract for external data sources. MCP remains supported for remote tool servers; YIP is for durable connections that need credentials, stream discovery, incremental sync, normalized storage, webhooks, or write actions.

## Lifecycle

1. `manifest` describes identity, authentication, streams, actions, and capabilities.
2. `configSchema` validates connection configuration and generates JSON Schema for the dashboard.
3. `check()` verifies credentials before a connection is saved.
4. `discover()` returns available streams. Static connectors may use manifest streams.
5. `read()` yields record batches and durable state checkpoints.
6. `executeAction()` and `handleWebhook()` are optional capabilities.

Youbot stores configuration encrypted in the existing workspace vault. Connection status, per-stream cursors, and normalized records are stored in the core database. A cursor is committed only after its corresponding records are stored.

## Connector shape

Place custom connectors at `custom/integrations/<connector>/index.ts` in development or `index.js` in production. Export `connector` or a default connector.

```ts
import { z } from 'zod';
import type { ConnectorDefinition } from '../../../src/integrations/types.js';

const configSchema = z.object({ apiKey: z.string().min(1) });

export const connector = {
  manifest: {
    protocolVersion: '1.0',
    id: 'example-source',
    name: 'Example Source',
    description: 'Imports example records.',
    version: '1.0.0',
    auth: { type: 'api_key' },
    capabilities: { incrementalSync: true, webhooks: false, actions: false },
    streams: [{
      name: 'documents', title: 'Documents', description: 'Example documents.',
      primaryKey: ['externalId'], supportsIncremental: true,
    }],
    actions: [],
  },
  configSchema,
  async check({ config }) {
    return { ok: Boolean(config.apiKey) };
  },
  async *read({ state }) {
    const response = await fetch('https://api.example.com/documents');
    const items = await response.json();
    yield {
      records: items.map((item: any) => ({
        sourceId: 'example-source', stream: 'documents', externalId: item.id,
        updatedAt: item.updatedAt, text: item.title, data: item,
      })),
      state: { cursor: items.at(-1)?.updatedAt || state },
    };
  },
} satisfies ConnectorDefinition<z.infer<typeof configSchema>>;
```

Normalized records require `sourceId`, `stream`, `externalId`, `text`, and `data`. They may also include `updatedAt`, `cursor`, `metadata`, `acl`, and `fingerprint`.

## HTTP API

- `GET /api/integrations/connectors`
- `POST /api/integrations/connectors/:connectorId/connect`
- `GET /api/integrations/connections`
- `POST /api/integrations/connections/:id/check`
- `GET /api/integrations/connections/:id/streams`
- `POST /api/integrations/connections/:id/sync`
- `POST /api/integrations/connections/:id/actions/:action`
- `POST /api/integrations/connections/:id/webhook`
- `DELETE /api/integrations/connections/:id`
- `GET /api/integrations/records?q=term&connectionId=id&stream=name&limit=20`

The built-in Google Calendar connector is registered as `google-calendar`. Agent access is exposed through `integration_list_sources`, `integration_search_data`, `integration_sync_source`, and `integration_run_action`.
