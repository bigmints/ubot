/**
 * Shared API Context & Utilities
 * All route handlers receive this context for accessing shared state.
 */

import http from 'http';
import type { AgentOrchestrator } from '../engine/orchestrator.js';
import type { ApprovalStore } from '../automation/approvals/service.js';
import type { SkillEngine } from '../agents/skills/skill-engine.js';
import type { EventBus } from '../agents/skills/event-bus.js';
import type { TaskSchedulerService } from '../automation/scheduler/service.js';
import type { WhatsAppConnection } from '../channels/whatsapp/connection.js';
import type { TelegramConnection } from '../channels/telegram/connection.js';
import type { WebchatConnection } from '../channels/webchat/connection.js';
import type { MessagingRegistry } from '../channels/registry.js';
import type { WhatsAppMessagingProvider } from '../channels/whatsapp/messaging-provider.js';
import type { TelegramMessagingProvider } from '../channels/telegram/messaging-provider.js';
import type { WhatsAppConnectionConfig } from '../channels/whatsapp/types.js';
import type { SafetyConfig, SafetyRule } from '../agents/safety/types.js';
import type { DatabaseConnection as CoreDatabaseConnection } from '../data/database/types.js';
import type { McpServerManager } from '../capabilities/mcp/mcp-manager.js';
import type { SkillRepository } from '../agents/skills/skill-repository.js';
import type { AsyncJobStore } from './job-store.js';
import type { WorkspaceProvider } from '../data/workspace-provider.js';
import type { AuthResult } from './middleware/auth.js';
import type { ContactStore } from '../data/contact-store.js';

export interface ApiContext {
  // Core
  agentOrchestrator: AgentOrchestrator | null;
  coreDb: CoreDatabaseConnection | null;
  asyncJobStore: AsyncJobStore | null;
  contactStore: ContactStore | null;

  // Channels
  webchatConnection?: WebchatConnection | null;
  waConnection: WhatsAppConnection | null;
  waQrCode: string | null;
  waStatus: string;
  waError: string | null;
  waMessages: Array<{ from: string; to: string; body: string; timestamp: string; isFromMe: boolean }>;
  waProvider: WhatsAppMessagingProvider | null;
  whatsappConfig: Partial<WhatsAppConnectionConfig>;

  tgConnection: TelegramConnection | null;
  tgStatus: string;
  tgError: string | null;
  tgProvider: TelegramMessagingProvider | null;
  tgMessages: Array<{ from: string; to: string; body: string; timestamp: string; isFromMe: boolean }>;

  messagingRegistry: MessagingRegistry;

  // Services
  skillEngine: SkillEngine | null;
  skillRepo: SkillRepository | null;
  eventBus: EventBus | null;
  scheduler: TaskSchedulerService | null;
  approvalStore: ApprovalStore | null;

  // Safety
  safetyConfig: SafetyConfig;
  safetyRules: SafetyRule[];

  // MCP
  mcpManager: McpServerManager | null;

  // Workspace
  workspacePath: string | null;
  workspaceProvider: WorkspaceProvider | null;

  // Auth
  auth?: AuthResult;

  // Helpers
  saveConfigValue: (key: string, value: string) => void;
  loadConfigValue: (key: string) => string | null;
  /** Relay a message to a session (for approval follow-ups) */
  relayMessage?: (sessionId: string, message: string) => Promise<boolean>;
}

/** Route handler type — returns true if handled, false if not matched */
export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
) => Promise<boolean>;

// ─── Shared Utilities ────────────────────────────────────

export async function parseBody(req: http.IncomingMessage, maxBytes: number = 1024 * 1024): Promise<unknown> {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      size += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      if (size > maxBytes) {
        req.destroy();
        resolve({ _error: 'Payload too large' });
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** Parse body with large payload limit (for file uploads) — 15MB */
export async function parseLargeBody(req: http.IncomingMessage): Promise<unknown> {
  return parseBody(req, 15 * 1024 * 1024);
}

/** Read a non-JSON request body with a hard streaming limit. */
export async function readBodyBuffer(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw Object.assign(new Error('Payload too large'), { statusCode: 413 });
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.byteLength;
      if (size > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(value);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks, size));
    });
    req.on('error', (cause) => {
      if (!settled) reject(cause);
    });
  });
}

export function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function notFound(res: http.ServerResponse): void {
  json(res, { error: 'Not found' }, 404);
}

export function error(res: http.ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}
