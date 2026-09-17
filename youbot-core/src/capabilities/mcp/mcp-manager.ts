/**
 * MCP Server Manager
 *
 * Manages MCP (Model Context Protocol) server connections.
 * Spawns external MCP server processes, discovers tools via listTools(),
 * and bridges them into youbot's ToolRegistry so the agent can call them.
 *
 * Config persisted in SQLite config_store (key: "mcp_servers").
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolRegistry } from '../../tools/types.js';
import type { ToolDefinition, ToolExecutionResult } from '../../engine/types.js';

// ─── Types ───────────────────────────────────────────────

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabledTools: string[];       // tool names to register (empty = all)
  discoveredTools: McpToolInfo[]; // tools found during validation
}

export interface McpServerStatus {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
  enabledTools: string[];
  discoveredTools: McpToolInfo[];
  registeredToolCount: number;
}

type ConfigStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

// ─── Manager ─────────────────────────────────────────────

export class McpServerManager {
  private servers: Map<string, McpServerConfig> = new Map();
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();
  private errors: Map<string, string> = new Map();
  private registeredTools: Map<string, string[]> = new Map(); // serverId → tool names
  private configStore: ConfigStore | null = null;
  private registry: ToolRegistry | null = null;

  /**
   * Initialize with config store for persistence and tool registry.
   */
  init(configStore: ConfigStore, registry: ToolRegistry): void {
    this.configStore = configStore;
    this.registry = registry;
    this.loadFromStore();
  }

  // ─── CRUD ──────────────────────────────────────────────

  getServers(): McpServerStatus[] {
    const result: McpServerStatus[] = [];
    for (const [id, config] of this.servers) {
      const client = this.clients.get(id);
      const error = this.errors.get(id);
      result.push({
        ...config,
        status: client ? 'connected' : error ? 'error' : 'disconnected',
        error,
        registeredToolCount: this.registeredTools.get(id)?.length ?? 0,
      });
    }
    return result;
  }

  getServer(id: string): McpServerStatus | null {
    const config = this.servers.get(id);
    if (!config) return null;
    const client = this.clients.get(id);
    const error = this.errors.get(id);
    return {
      ...config,
      status: client ? 'connected' : error ? 'error' : 'disconnected',
      error,
      registeredToolCount: this.registeredTools.get(id)?.length ?? 0,
    };
  }

  addServer(config: McpServerConfig): McpServerConfig {
    this.servers.set(config.id, config);
    this.saveToStore();
    return config;
  }

  updateServer(id: string, updates: Partial<Pick<McpServerConfig, 'name' | 'command' | 'args' | 'env' | 'enabledTools'>>): McpServerConfig | null {
    const existing = this.servers.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    this.servers.set(id, updated);
    this.saveToStore();
    return updated;
  }

  async removeServer(id: string): Promise<boolean> {
    if (!this.servers.has(id)) return false;
    await this.disconnectServer(id);
    this.servers.delete(id);
    this.saveToStore();
    return true;
  }

  // ─── Validation (test-connect) ─────────────────────────

  /**
   * Validate a server config by spawning, connecting, listing tools, then disconnecting.
   * Returns discovered tools without persisting anything.
   */
  async validateServer(config: Pick<McpServerConfig, 'command' | 'args' | 'env'>): Promise<McpToolInfo[]> {
    const client = new Client({ name: 'youbot-validate', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const tools: McpToolInfo[] = (result.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema,
      }));
      return tools;
    } finally {
      try { await client.close(); } catch {}
    }
  }

  // ─── Connection lifecycle ──────────────────────────────

  /**
   * Connect to a saved server, discover tools, register enabled ones.
   */
  async connectServer(id: string): Promise<void> {
    const config = this.servers.get(id);
    if (!config) throw new Error(`MCP server ${id} not found`);

    // Disconnect if already connected
    await this.disconnectServer(id);
    this.errors.delete(id);

    try {
      const client = new Client({ name: 'youbot-mcp', version: '1.0.0' });
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
      });

      await client.connect(transport);

      // Discover tools
      const result = await client.listTools();
      const tools: McpToolInfo[] = (result.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema,
      }));

      // Update discovered tools in config
      config.discoveredTools = tools;
      this.servers.set(id, config);
      this.saveToStore();

      this.clients.set(id, client);
      this.transports.set(id, transport);

      // Register enabled tools with the agent's ToolRegistry
      this.registerMcpTools(id, client, config, tools);

      console.log(`[MCP] Connected to "${config.name}" — ${tools.length} tools discovered, ${this.registeredTools.get(id)?.length ?? 0} registered`);
    } catch (err: any) {
      this.errors.set(id, err.message);
      console.error(`[MCP] Failed to connect "${config.name}":`, err.message);
    }
  }

  /**
   * Disconnect a server and unregister its tools.
   */
  async disconnectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      try { await client.close(); } catch {}
      this.clients.delete(id);
    }
    const transport = this.transports.get(id);
    if (transport) {
      this.transports.delete(id);
    }
    // Note: we can't unregister from ToolRegistry (it doesn't support removal),
    // but the executors will fail gracefully if the client is disconnected.
    this.registeredTools.delete(id);
  }

  /**
   * Connect all saved servers. Called at startup.
   */
  async connectAll(): Promise<void> {
    const ids = [...this.servers.keys()];
    if (ids.length === 0) return;
    console.log(`[MCP] Connecting ${ids.length} saved MCP server(s)...`);
    for (const id of ids) {
      await this.connectServer(id).catch(() => {}); // errors logged inside
    }
  }

  // ─── Tool registration ─────────────────────────────────

  /**
   * Register MCP tools as youbot tool executors.
   * Each MCP tool becomes a tool named `mcp_{serverName}_{toolName}`.
   */
  private registerMcpTools(
    serverId: string,
    client: Client,
    config: McpServerConfig,
    tools: McpToolInfo[],
  ): void {
    if (!this.registry) return;

    const enabledSet = new Set(config.enabledTools);
    const registeredNames: string[] = [];
    const prefix = this.sanitizeName(config.name);

    for (const tool of tools) {
      // If enabledTools is empty, enable all; otherwise check
      if (enabledSet.size > 0 && !enabledSet.has(tool.name)) continue;

      const youbotToolName = `mcp_${prefix}_${this.sanitizeName(tool.name)}`;

      // Skip if already registered (shouldn't happen but safety)
      if (this.registry.has(youbotToolName)) continue;

      // Create executor that calls the MCP tool
      const executor = async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
        const currentClient = this.clients.get(serverId);
        if (!currentClient) {
          return { toolName: youbotToolName, success: false, error: `MCP server "${config.name}" is disconnected`, duration: 0 };
        }
        const start = Date.now();
        try {
          const result = await currentClient.callTool({ name: tool.name, arguments: args });
          const textParts = (result.content as any[])
            ?.filter((c: any) => c.type === 'text')
            .map((c: any) => c.text) || [];
          const MAX_RESULT_CHARS = 50_000;
          let resultText = textParts.join('\n') || JSON.stringify(result.content);
          if (resultText.length > MAX_RESULT_CHARS) {
            resultText = resultText.slice(0, MAX_RESULT_CHARS) +
              `\n\n... [truncated — ${resultText.length - MAX_RESULT_CHARS} chars omitted]`;
          }
          return {
            toolName: youbotToolName,
            success: true,
            result: resultText,
            duration: Date.now() - start,
          };
        } catch (err: any) {
          return {
            toolName: youbotToolName,
            success: false,
            error: err.message,
            duration: Date.now() - start,
          };
        }
      };

      this.registry.register(youbotToolName, executor);
      registeredNames.push(youbotToolName);
    }

    this.registeredTools.set(serverId, registeredNames);
  }

  /**
   * Get all MCP tool definitions for the LLM prompt.
   */
  getMcpToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const [serverId, config] of this.servers) {
      if (!this.clients.has(serverId)) continue; // not connected
      const prefix = this.sanitizeName(config.name);
      const enabledSet = new Set(config.enabledTools);

      for (const tool of config.discoveredTools) {
        if (enabledSet.size > 0 && !enabledSet.has(tool.name)) continue;
        const youbotToolName = `mcp_${prefix}_${this.sanitizeName(tool.name)}`;

        // Convert JSON Schema inputSchema to ToolDefinition parameters
        const params: ToolDefinition['parameters'] = [];
        if (tool.inputSchema && typeof tool.inputSchema === 'object') {
          const props = (tool.inputSchema as any).properties || {};
          const required = new Set((tool.inputSchema as any).required || []);
          for (const [name, schema] of Object.entries(props)) {
            const s = schema as any;
            params.push({
              name,
              type: s.type === 'number' || s.type === 'integer' ? 'number' :
                    s.type === 'boolean' ? 'boolean' : 'string',
              description: s.description || '',
              required: required.has(name),
            });
          }
        }

        defs.push({
          name: youbotToolName,
          description: `[MCP: ${config.name}] ${tool.description}`,
          parameters: params,
        });
      }
    }
    return defs;
  }

  // ─── Persistence ───────────────────────────────────────

  private loadFromStore(): void {
    if (!this.configStore) return;

    // Primary: load from config.json capabilities.mcp.servers (standard format)
    try {
      const fs = require('fs');
      const YOUBOT_HOME = process.env.YOUBOT_HOME || '';
      const candidates = [
        YOUBOT_HOME ? require('path').join(YOUBOT_HOME, 'config.json') : '',
        require('path').join(process.cwd(), 'config.json'),
        `${process.env.HOME}/.youbot/config.json`,
      ].filter(Boolean);
      const configPath = candidates.find((p: string) => fs.existsSync(p)) || '';
      if (configPath) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const mcpServers = cfg?.capabilities?.mcp?.servers;
        if (mcpServers && typeof mcpServers === 'object' && Object.keys(mcpServers).length > 0) {
          for (const [name, entry] of Object.entries(mcpServers)) {
            const s = entry as any;
            if (!s.command) continue;
            const id = s.id || `mcp-${Date.now()}-${name}`;
            const config: McpServerConfig = {
              id,
              name,
              command: s.command,
              args: Array.isArray(s.args) ? s.args : [],
              env: s.env || {},
              enabledTools: s.enabledTools || [],
              discoveredTools: [], // rediscovered on connect
            };
            this.servers.set(id, config);
          }
          console.log(`[MCP] Loaded ${Object.keys(mcpServers).length} server(s) from config.json`);
          return;
        }
      }
    } catch (err) {
      console.error('[MCP] Failed to load from config.json:', err);
    }

    // Fallback: migrate from legacy SQLite config_store blob
    const raw = this.configStore.get('mcp_servers');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const configs: McpServerConfig[] = Array.isArray(parsed) ? parsed : [];
      for (const c of configs) {
        if (c && c.id) this.servers.set(c.id, c);
      }
      if (configs.length > 0) {
        console.log(`[MCP] Migrated ${configs.length} server config(s) from DB → saving to config.json`);
        this.saveToStore(); // migrate to config.json
      }
    } catch (err) {
      console.error('[MCP] Failed to load legacy configs:', err);
    }
  }

  private saveToStore(): void {
    // Save to config.json under capabilities.mcp.servers (standard mcpServers format)
    try {
      const fs = require('fs');
      const YOUBOT_HOME = process.env.YOUBOT_HOME || '';
      const candidates = [
        YOUBOT_HOME ? require('path').join(YOUBOT_HOME, 'config.json') : '',
        require('path').join(process.cwd(), 'config.json'),
        `${process.env.HOME}/.youbot/config.json`,
      ].filter(Boolean);
      const configPath = candidates.find((p: string) => fs.existsSync(p)) || candidates[0];
      let cfg: any = {};
      if (fs.existsSync(configPath)) {
        cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
      if (!cfg.capabilities) cfg.capabilities = {};
      if (!cfg.capabilities.mcp) cfg.capabilities.mcp = { enabled: true };

      // Store in standard format: { "serverName": { command, args, env, enabledTools } }
      const servers: Record<string, any> = {};
      for (const [, config] of this.servers) {
        servers[config.name] = {
          id: config.id,
          command: config.command,
          args: config.args,
          env: config.env,
          enabledTools: config.enabledTools,
          // discoveredTools NOT stored — rediscovered on connect
        };
      }
      cfg.capabilities.mcp.servers = servers;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4), 'utf-8');
    } catch (err) {
      console.error('[MCP] Failed to save to config.json:', err);
    }

    // Also update legacy SQLite store for backward compat
    if (this.configStore) {
      const configs = [...this.servers.values()].map(c => ({
        id: c.id, name: c.name, command: c.command,
        args: c.args, env: c.env, enabledTools: c.enabledTools,
        discoveredTools: [], // don't store schemas
      }));
      this.configStore.set('mcp_servers', JSON.stringify(configs));
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
}

// Singleton
let manager: McpServerManager | null = null;

export function getMcpServerManager(): McpServerManager {
  if (!manager) {
    manager = new McpServerManager();
  }
  return manager;
}
