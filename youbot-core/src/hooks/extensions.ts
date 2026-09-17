/**
 * YOUBOT Extension Hooks
 *
 * Provides extension points so forks can add functionality
 * without modifying core files. Register hooks at startup
 * via registerHooks().
 *
 * Each hook is optional — if not registered, YOUBOT behaves
 * with its default local-mode behavior.
 */

import http from 'http';
import type { LLMProviderConfig } from '../engine/types.js';
import type { WorkspaceProvider } from '../data/workspace-provider.js';

// ── Engine Hook ─────────────────────────────────────────

export type UserRole = 'superadmin' | 'owner' | 'manager' | 'staff' | 'visitor';
export type ModelRouting = Record<string, string>;

export interface EngineHook {
  /** Extra LLM providers injected alongside user config (e.g. MANAGED_AI_PROVIDERS) */
  getExtraProviders?(): LLMProviderConfig[];

  /** Default model routing overrides (purpose → providerId) */
  getDefaultModelRouting?(): Partial<ModelRouting>;

  /**
   * Resolve the role for a session.
   * Return null to fall back to YOUBOT default (owner/visitor binary).
   */
  resolveRole?(sessionId: string, source: string, isOwnerDetected: boolean): UserRole | null;

  /**
   * Return an identity verification prompt to inject for a session/role.
   * Return null to skip.
   */
  getIdentityPrompt?(sessionId: string, role: UserRole): string | null;

  /** Extra tool module routing descriptions merged into the LLM router. */
  getExtraToolModules?(): Record<string, string>;

  /** Module IDs always included regardless of LLM routing decision. */
  getAlwaysOnModules?(): string[];

  /**
   * Load skill context for a named default skill (returns SKILL.md content).
   * Return null if the skill isn't found.
   */
  loadSkillContext?(skillName: string): Promise<string | null>;
}

// ── Auth Hook ──────────────────────────────────────────

export interface AuthResult {
  authenticated: boolean;
  clientName?: string;
  error?: string;
  scopes?: string[];
}

export interface AuthHook {
  /**
   * Called before every API request.
   * Return AuthResult to handle auth, or null to fall through to default API key auth.
   */
  authenticate(req: http.IncomingMessage): Promise<AuthResult | null>;
  /** Return the external sign-in URL used when an SSO session is missing. */
  getLoginUrl?(returnTo?: string): string | null;
}

// ── Middleware Hook ────────────────────────────────────

export interface MiddlewareHook {
  /**
   * Called for every incoming HTTP request before routing.
   * Return true if the request has been fully handled (response sent).
   * Return false to continue normal request processing.
   */
  onRequest?(req: http.IncomingMessage, res: http.ServerResponse, url: string, method: string): Promise<boolean>;

  /**
   * Called once when the HTTP server starts listening.
   * Use this for WebSocket upgrade handling, etc.
   */
  onServerStart?(server: http.Server): void;
}

// ── Route Hook ─────────────────────────────────────────

export interface RouteHook {
  /**
   * Called for /api/* routes not handled by core.
   * Return true if the request was handled.
   */
  handleRoute?(req: http.IncomingMessage, res: http.ServerResponse, url: string, method: string): Promise<boolean>;
}

// ── Startup Hook ───────────────────────────────────────

export interface StartupHook {
  /**
   * Called during initializeApi(), after core initialization.
   * Use this to set up additional services, register tools, etc.
   */
  onInitialize?(context: {
    db: any;
    agent: any;
    workspacePath: string | null;
  }): Promise<void>;

  /**
   * Called to modify channel auto-connect behavior.
   * Return true to skip the default auto-connect for a channel.
   */
  shouldSkipChannel?(channel: 'whatsapp' | 'telegram' | 'webchat'): boolean;
}

// ── Tool Registry Hook ─────────────────────────────────

export interface ToolRegistryHook {
  /**
   * Return module directory names that should be disabled/skipped.
   */
  getDisabledModules?(): string[];

  /**
   * Return additional directory paths to scan for tool modules.
   */
  getAdditionalScanDirs?(): string[];
}

// ── Database Hook ──────────────────────────────────────

export interface DatabaseHook {
  /**
   * Provide a custom database connection instead of the default SQLite.
   * Return a DatabaseConnection-compatible object, or null to use default SQLite.
   * Receives the default config (dbPath, migrations) for reference.
   */
  createConnection(context: {
    dbPath: string;
    migrations: any[];
    youbotHome: string;
  }): any | null;
}

// ── Workspace Hook ─────────────────────────────────────

export interface WorkspaceHook {
  /**
   * Provide a custom workspace provider instead of the default local filesystem.
   * Called once at startup. Return a WorkspaceProvider, or null to use default.
   */
  createWorkspaceProvider(context: {
    defaultPath: string;
    youbotHome: string;
  }): WorkspaceProvider | null;
}

// ── Registered Hooks ───────────────────────────────────

export interface RegisteredHooks {
  auth?: AuthHook;
  middleware?: MiddlewareHook;
  routes?: RouteHook;
  startup?: StartupHook;
  toolRegistry?: ToolRegistryHook;
  database?: DatabaseHook;
  /** Engine behaviour extensions — providers, routing, RBAC, skill loading */
  engine?: EngineHook;
  /** Override default filesystem-based workspace with a custom provider (e.g. GCS) */
  workspace?: WorkspaceHook;
}

let _hooks: RegisteredHooks = {};

/**
 * Register extension hooks. Call this before server starts.
 * Typically called from a youbot.extensions.ts file in the fork.
 */
export function registerHooks(hooks: Partial<RegisteredHooks>): void {
  _hooks = { ..._hooks, ...hooks };
  console.log(`[Hooks] Registered: ${Object.keys(hooks).join(', ')}`);
}

/**
 * Get registered hooks (used internally by core).
 */
export function getHooks(): Readonly<RegisteredHooks> {
  return _hooks;
}

/**
 * Reset hooks (for testing).
 */
export function resetHooks(): void {
  _hooks = {};
}
