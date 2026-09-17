/**
 * Tools Route
 * /api/tools
 * Exposes the registry of all AI tools and their current connection/health status.
 */

import http from 'http';
import { json, type ApiContext } from '../context.js';
import { getAllToolsWithModules } from '../../tools/registry.js';
import { type ToolDefinition } from '../../tools/types.js';

export interface ToolHealthStatus {
  module: string;
  tool: ToolDefinition;
  status: 'active' | 'disconnected' | 'error';
  message: string;
}

export async function handleToolsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {
  if (url === '/api/tools' && method === 'GET') {
    const allTools = await getAllToolsWithModules();
    
    // Also fetch MCP tools from the manager if available
    let mcpTools: Array<{ module: string, tool: ToolDefinition }> = [];
    if (ctx.mcpManager) {
      const defs = ctx.mcpManager.getMcpToolDefinitions();
      // Heuristic: map to their server name if we can, otherwise just "mcp"
      // MCP tool names usually match `servername_toolname`
      mcpTools = defs.map(tool => {
        const parts = tool.name.split('_');
        const moduleName = parts.length > 1 ? `mcp:${parts[0]}` : 'mcp';
        return { module: moduleName, tool };
      });
    }

    const combined = [...allTools, ...mcpTools];

    const results: ToolHealthStatus[] = combined.map(({ module, tool }) => {
      let status: 'active' | 'disconnected' | 'error' = 'active';
      let message = 'Available';

      // Determine health dynamically based on the module and system context
      switch (module) {
        case 'messaging':
          // We could get more granular if tool.name implies whatsapp vs telegram, 
          // but universally, messaging works if at least ONE provider is connected
          const waConnected = ctx.waStatus === 'connected';
          const tgConnected = ctx.tgStatus === 'connected';
          if (!waConnected && !tgConnected) {
            status = 'disconnected';
            message = 'No messaging providers connected (WhatsApp/Telegram offline)';
          } else {
            message = [
              waConnected ? 'WhatsApp' : null,
              tgConnected ? 'Telegram' : null
            ].filter(Boolean).join(' and ') + ' connected';
          }
          break;

        case 'google':
          // Needs credentials. We don't have direct access to Google token status here,
          // but we can assume generic active unless we implement deep token checks.
          break;

        case 'browser':
          if (tool.name === 'browse_url' || tool.name === 'read_browser_page') {
            // Assume active, browser will launch on demand
          }
          break;
      }
      
      // Handle MCP tool health dynamically
      if (module.startsWith('mcp:')) {
        const serverName = module.split(':')[1];
        if (ctx.mcpManager) {
          const servers = ctx.mcpManager.getServers();
          const server = servers.find(s => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') === serverName);
          const mcpStatus = server?.status;
          if (mcpStatus !== 'connected') {
            status = 'disconnected';
            message = `MCP Server '${serverName}' is ${mcpStatus || 'offline'}`;
          }
        }
      }

      return {
        module,
        tool,
        status,
        message,
      };
    });

    json(res, { tools: results });
    return true;
  }

  return false;
}
