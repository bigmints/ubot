import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';
import { connectorManifestSchema } from './schemas.js';
import type { ConnectorDefinition } from './types.js';

export interface ConnectorDescription {
  manifest: ConnectorDefinition['manifest'];
  configSchema: Record<string, unknown>;
}
export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorDefinition<any>>();

  register(connector: ConnectorDefinition<any>): void {
    const manifest = connectorManifestSchema.parse(connector.manifest);
    if (this.connectors.has(manifest.id)) {
      throw new Error(`Connector "${manifest.id}" is already registered`);
    }
    this.connectors.set(manifest.id, { ...connector, manifest });
  }

  get(id: string): ConnectorDefinition<any> | null {
    return this.connectors.get(id) || null;
  }

  list(): ConnectorDescription[] {
    return Array.from(this.connectors.values()).map((connector) => ({
      manifest: connector.manifest,
      configSchema: z.toJSONSchema(connector.configSchema) as Record<string, unknown>,
    }));
  }

  async loadCustom(baseDir = path.join(process.env.UBOT_HOME || process.cwd(), 'custom', 'integrations')): Promise<{
    loaded: string[];
    failed: Array<{ name: string; error: string }>;
  }> {
    if (!existsSync(baseDir)) return { loaded: [], failed: [] };

    const loaded: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    const entries = readdirSync(baseDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const entry of entries) {
      const jsPath = path.join(baseDir, entry.name, 'index.js');
      const tsPath = path.join(baseDir, entry.name, 'index.ts');
      const indexPath = existsSync(jsPath) ? jsPath : existsSync(tsPath) ? tsPath : null;
      if (!indexPath) continue;

      try {
        const imported = await import(`${pathToFileURL(indexPath).href}?t=${Date.now()}`);
        const connector = (imported.connector || imported.default) as ConnectorDefinition;
        this.register(connector);
        loaded.push(connector.manifest.id);
      } catch (error: any) {
        failed.push({ name: entry.name, error: error.message });
      }
    }

    return { loaded, failed };
  }
}
