import type { WorkspaceProvider } from '../data/workspace-provider.js';
import { getVaultService } from '../agents/vault/service.js';
import type { IntegrationConfigStore } from './types.js';

const configLabel = (connectionId: string) => `integration:${connectionId}:config`;

export class VaultIntegrationConfigStore implements IntegrationConfigStore {
  constructor(private readonly workspace: WorkspaceProvider) {}

  async get(connectionId: string): Promise<unknown | null> {
    const item = getVaultService(this.workspace).retrieve(configLabel(connectionId));
    if (!item?.value) return null;
    try {
      return JSON.parse(item.value);
    } catch {
      throw new Error(`Stored configuration for "${connectionId}" is invalid`);
    }
  }

  async set(connectionId: string, config: unknown): Promise<void> {
    getVaultService(this.workspace).store(
      configLabel(connectionId),
      JSON.stringify(config),
      'integration-config',
      { connectionId },
    );
  }

  async delete(connectionId: string): Promise<void> {
    getVaultService(this.workspace).delete(configLabel(connectionId));
  }
}
