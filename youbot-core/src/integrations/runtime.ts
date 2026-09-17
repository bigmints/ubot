import type { DatabaseConnection } from '../data/database/types.js';
import type { WorkspaceProvider } from '../data/workspace-provider.js';
import { VaultIntegrationConfigStore } from './config-store.js';
import { googleCalendarConnector } from './connectors/google-calendar.js';
import { ConnectorRegistry } from './registry.js';
import { IntegrationService } from './service.js';
import { IntegrationStore } from './store.js';

let service: IntegrationService | null = null;
let initializing: Promise<IntegrationService> | null = null;

export function initializeIntegrationService(
  db: DatabaseConnection,
  workspace: WorkspaceProvider,
): Promise<IntegrationService> {
  if (service) return Promise.resolve(service);
  if (initializing) return initializing;

  initializing = createIntegrationService(db, workspace).catch((error) => {
    initializing = null;
    throw error;
  });
  return initializing;
}

async function createIntegrationService(
  db: DatabaseConnection,
  workspace: WorkspaceProvider,
): Promise<IntegrationService> {
  const registry = new ConnectorRegistry();
  registry.register(googleCalendarConnector);
  const custom = await registry.loadCustom();
  for (const failure of custom.failed) {
    console.warn(`[Integrations] Failed to load ${failure.name}: ${failure.error}`);
  }
  if (custom.loaded.length > 0) {
    console.log(`[Integrations] Loaded custom connectors: ${custom.loaded.join(', ')}`);
  }
  const nextService = new IntegrationService(
    registry,
    new IntegrationStore(db),
    new VaultIntegrationConfigStore(workspace),
  );
  await nextService.initialize();
  service = nextService;
  initializing = null;
  return service;
}

export function getIntegrationService(): IntegrationService | null {
  return service;
}

export function resetIntegrationService(): void {
  service = null;
  initializing = null;
}
