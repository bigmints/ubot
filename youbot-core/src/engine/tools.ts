/**
 * Agent Tools
 * Platform-agnostic tool definitions for the agent.
 * These tools work with any messaging provider (WhatsApp, Telegram).
 */

import type { ToolDefinition, ToolCallResult, ToolExecutionResult } from './types.js';
import type { ToolExecutionContext } from '../tools/types.js';

import { getAllToolDefinitions } from '../tools/registry.js';
import { routeTools, getConnectedMcpServers, type RouteResult } from './tool-router.js';

/** Core orchestrator tools that are always available */
export const CORE_ORCHESTRATOR_TOOLS: ToolDefinition[] = [
  {
    name: 'store_insight',
    description: 'Store an important semantic insight into long-term vector memory for your agent.',
    parameters: [
      { name: 'insight', type: 'string', description: 'The text content to memorize.', required: true },
    ],
  },
  {
    name: 'recall_memory',
    description: 'Query your long-term agent memory using semantic search.',
    parameters: [
      { name: 'query', type: 'string', description: 'What to search for.', required: true },
    ],
  },
];

/** All available tool definitions — dynamically loaded from auto-discovered modules */
export async function getAgentTools(): Promise<ToolDefinition[]> {
  return [
    ...CORE_ORCHESTRATOR_TOOLS,
    ...await getAllToolDefinitions(),
  ];
}


/**
 * Tools safe for visitor (non-owner) sessions.
 * The bot acts as a secretary for the owner:
 *   - Answers from persona knowledge (no tool needed)
 *   - Escalates to owner when unsure (ask_owner)
 * Everything else (browse, messages, contacts, skills, web search, etc.)
 * is OWNER-ONLY to prevent information leakage and misuse.
 */
export const VISITOR_SAFE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'ask_owner',
  'get_profile',
  'save_memory',
  'collections_list',
  'collections_get',
  'collections_item_get',
  'collections_search',
  'collections_view_get',
  'collections_evidence_validate',
  'collections_answer',
]);

/** Current tool aliases from the last routing pass */
let currentAliases: Map<string, string> = new Map();

/** Get current tool name aliases (for executor redirect) */
export function getToolAliases(): Map<string, string> {
  return currentAliases;
}

/** Get the filtered tool list based on whether the caller is the owner */
export async function getToolsForSource(isOwner: boolean): Promise<ToolDefinition[]> {
  // Gather native tools (includes infrastructure + auto-discovered + custom modules)
  const nativeTools = [...await getAgentTools()];

  // Gather MCP tools
  let mcpTools: ToolDefinition[] = [];
  try {
    const { getMcpServerManager } = require('../capabilities/mcp/mcp-manager.js');
    const mgr = getMcpServerManager();
    mcpTools = mgr.getMcpToolDefinitions();
  } catch {}

  // Route and deduplicate native vs MCP tools
  let routingConfig = {};
  try {
    const { getConfig } = require('../data/config.js');
    const cfg = getConfig();
    routingConfig = cfg?.capabilities?.tool_routing || {};
  } catch {}

  const connectedServers = getConnectedMcpServers();
  const result: RouteResult = routeTools(nativeTools, mcpTools, routingConfig, connectedServers);

  // Store aliases for executor redirect
  currentAliases = result.aliases;

  // result.tools already contains native + connected MCP (no custom double-count)
  const allTools = result.tools;

  // Log routing stats (only when there's something interesting)
  if (result.stats.overlapsFound > 0) {
    try {
      const { log } = require('../logger/ring-buffer.js');
      log.info('ToolRouter',
        `${result.stats.totalBefore}→${result.stats.totalAfter} tools ` +
        `(${result.stats.overlapsFound} overlaps, ${result.stats.overlapsResolved} resolved, ` +
        `${result.stats.mcpEnrichments} MCP enrichments, ` +
        `${result.stats.totalBefore - result.stats.totalAfter} deduped)`
      );
      if (result.aliases.size > 0) {
        log.info('ToolRouter', `Aliases: ${[...result.aliases.entries()].map(([k, v]) => `${k}→${v}`).join(', ')}`);
      }
    } catch {}
  }

  if (isOwner) return allTools;
  return allTools.filter(t => VISITOR_SAFE_TOOL_NAMES.has(t.name));
}

/** Format tools for the system prompt (text-based fallback) */
export function formatToolsForPrompt(tools: ToolDefinition[]): string {
  return tools.map(tool => {
    const params = tool.parameters.length > 0
      ? tool.parameters.map(p => 
          `  - ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`
        ).join('\n')
      : '  (no parameters)';
    return `- ${tool.name}: ${tool.description}\n${params}`;
  }).join('\n\n');
}

/** Convert ToolDefinition[] to OpenAI-compatible tools format for native tool calling */
export function formatToolsForAPI(tools: ToolDefinition[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
  };
}> {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          tool.parameters.map(p => [
            p.name,
            {
              type: p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string',
              description: p.description,
            },
          ])
        ),
        required: tool.parameters.filter(p => p.required).map(p => p.name),
      },
    },
  }));
}

/** Parse tool calls from LLM response text */
export function parseToolCalls(text: string): ToolCallResult[] {
  const toolCalls: ToolCallResult[] = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool && typeof parsed.tool === 'string') {
        toolCalls.push({
          toolName: parsed.tool,
          arguments: parsed.args || {},
          rawText: match[0],
        });
      }
    } catch {
      // Invalid JSON in tool call — skip
    }
  }
  
  return toolCalls;
}

/** Extract the text content from an LLM response, excluding tool call blocks */
export function extractTextContent(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

/** Tool executor type */
export type ToolExecutor = (
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

/** Registry of tool executors */
export interface ToolRegistry {
  register(toolName: string, executor: ToolExecutor): void;
  unregister(toolName: string): boolean;
  execute(toolCall: ToolCallResult, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
  has(toolName: string): boolean;
}

export function createToolRegistry(): ToolRegistry {
  const executors = new Map<string, ToolExecutor>();

  return {
    register(toolName: string, executor: ToolExecutor): void {
      executors.set(toolName, executor);
    },

    async execute(toolCall: ToolCallResult, context?: ToolExecutionContext): Promise<ToolExecutionResult> {
      const start = Date.now();
      const executor = executors.get(toolCall.toolName);
      
      if (!executor) {
        return {
          toolName: toolCall.toolName,
          success: false,
          error: `Unknown tool: ${toolCall.toolName}`,
          duration: Date.now() - start,
        };
      }

      try {
        const result = await executor(toolCall.arguments, context);
        return {
          ...result,
          duration: Date.now() - start,
        };
      } catch (err: any) {
        return {
          toolName: toolCall.toolName,
          success: false,
          error: err.message || 'Tool execution failed',
          duration: Date.now() - start,
        };
      }
    },

    has(toolName: string): boolean {
      return executors.has(toolName);
    },

    unregister(toolName: string): boolean {
      return executors.delete(toolName);
    },
  };
}
