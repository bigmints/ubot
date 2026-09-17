/**
 * Tool Module Framework — Types
 *
 * Standard interface for self-contained tool modules.
 * Each module defines its tool definitions AND registers its own executors.
 * This allows each service to live in its own file and be independently maintained.
 */

import type { ToolDefinition, ToolExecutionResult, ToolCallResult } from '../engine/types.js';
import type { WorkspaceProvider } from '../data/workspace-provider.js';

// Re-export for convenience
export type { ToolDefinition, ToolExecutionResult, ToolCallResult };

/** Executor function signature — takes args, returns result */
export interface ToolExecutionContext {
  sessionId?: string;
  isOwner?: boolean;
  source?: string;
  contactName?: string;
  /** Trusted inbound message for tools whose safety behavior must not depend on model-supplied text. */
  userMessage?: string;
  getDatabase?: () => any | null;
  reportProgress?: (event: any) => void;
  [key: string]: unknown;
}
export type ToolExecutor = (args: Record<string, unknown>, execution?: ToolExecutionContext) => Promise<ToolExecutionResult>;

/** Registry interface — register tool executors, execute tool calls */
export interface ToolRegistry {
  register(toolName: string, executor: ToolExecutor): void;
  unregister(toolName: string): boolean;
  execute(toolCall: ToolCallResult, execution?: ToolExecutionContext): Promise<ToolExecutionResult>;
  has(toolName: string): boolean;
}

/**
 * Shared context passed to tool modules during registration.
 * Provides access to shared services without tight coupling to api.ts.
 */
export interface ToolContext {
  sessionId?: string;
  /** Host-owned return routing; keeps webchat, Telegram and WhatsApp separate. */
  relayMessage?: (sessionId: string, message: string) => Promise<boolean>;
  getDatabase(): any | null;
  getMessagingRegistry(): any;
  getScheduler(): any | null;
  getApprovalStore(): any | null;
  getSkillEngine(): any | null;
  getWhatsApp(): any | null;
  getTelegram(): any | null;
  getAgent(): any | null;
  getEventBus(): any | null;
  getWorkspacePath(): string | null;
  getWorkspaceProvider(): WorkspaceProvider | null;
  getCliService(): any | null;
  getFollowUpStore(): any | null;
  getContactStore(): any | null;

  reportProgress?: (event: any) => void;
}

/**
 * Standard interface for a self-contained tool module.
 *
 * Each module provides:
 *   - name: identifier for logging/debugging
 *   - tools: ToolDefinition[] exposed to the LLM
 *   - register(): wires up executors using the shared ToolContext
 *
 * Example:
 * ```typescript
 * export default {
 *   name: 'my-service',
 *   tools: [
 *     { name: 'my_tool', description: '...', parameters: [...] },
 *   ],
 *   register(registry, ctx) {
 *     registry.register('my_tool', async (args) => {
 *       // implementation
 *       return { toolName: 'my_tool', success: true, result: '...', duration: 0 };
 *     });
 *   },
 * } satisfies ToolModule;
 * ```
 */
export interface ToolModule {
  /** Human-readable name for the module (e.g. 'google', 'web-search') */
  name: string;

  /** Tool definitions exposed to the LLM */
  tools: ToolDefinition[];

  /** Register executor functions with the tool registry */
  register(registry: ToolRegistry, ctx: ToolContext): void;

  /** Optional UI metadata to inject into the dashboard sidebar */
  ui?: {
    title: string;
    icon: string;      // e.g. "Sparkles", "Database"
    href: string;      // e.g. "/xtara"
    group?: string;    // e.g. "Capabilities" (default)
  };
}

/**
 * Helper to create a standard tool result.
 */
export function toolResult(
  toolName: string,
  success: boolean,
  resultOrError: string,
): ToolExecutionResult {
  return {
    toolName,
    success,
    ...(success ? { result: resultOrError } : { error: resultOrError }),
    duration: 0,
  };
}

/**
 * Helper to wrap an async tool executor with error handling.
 */
export function safeExecutor(
  toolName: string,
  fn: (args: Record<string, unknown>) => Promise<string>,
): ToolExecutor {
  return async (args) => {
    try {
      const result = await fn(args);
      return toolResult(toolName, true, result);
    } catch (err: any) {
      console.error(`[${toolName}] Error:`, err.message);
      return toolResult(toolName, false, err.message);
    }
  };
}
