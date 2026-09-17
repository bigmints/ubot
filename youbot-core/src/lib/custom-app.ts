/**
 * Custom App Interface
 *
 * Defines the contract for first-class custom apps that run on the YOUBOT platform.
 * Apps live in custom/apps/<id>/ and are auto-discovered at startup.
 *
 * An app can provide: engine hooks, auth plugin, theme, navigation, API routes,
 * and tool modules — all lazily loaded and fully optional.
 */

import type { LLMProviderConfig } from '../engine/types.js';

// ── Nav types (mirrored from web-ui sidebar — kept in sync manually) ─────────
// We define these here rather than importing from web-ui/ to avoid the
// JSX / tsconfig boundary between backend tsc and Next.js bundler.

/** A single nav item in the sidebar */
export interface NavItem {
  title: string;
  url: string;
  icon?: string;
  badge?: string | number;
  items?: NavItem[];
}

/** A group of nav items with a label */
export interface NavGroup {
  title: string;
  items: NavItem[];
}

// ── Deployment mode ─────────────────────────────────────

export type DeploymentMode = 'local' | 'cloud' | (string & {});

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
   * Return null to fall back to YOUBOT's default (owner/visitor).
   */
  resolveRole?(sessionId: string, source: string, isOwnerDetected: boolean): UserRole | null;

  /**
   * Return an identity prompt to inject into the system prompt for a session/role.
   * Used for staff identity verification UX, etc.
   */
  getIdentityPrompt?(sessionId: string, role: UserRole): string | null;

  /** Extra tool module routing descriptions (moduleId → description for LLM routing) */
  getExtraToolModules?(): Record<string, string>;

  /** Module IDs that should always be included (in addition to YOUBOT defaults) */
  getAlwaysOnModules?(): string[];

  /**
   * Load skill context for a named default skill.
   * Return null if the skill isn't found.
   */
  loadSkillContext?(skillName: string): Promise<string | null>;
}

// ── Auth Plugin ─────────────────────────────────────────

import type http from 'http';

export interface AuthResult {
  authenticated: boolean;
  clientName?: string;
  userId?: string;
  role?: UserRole;
  error?: string;
}

export interface SessionUser {
  id: string;
  email?: string;
  role: UserRole;
  tenantId?: string;
}

export interface AuthPlugin {
  /** Called for every backend API request. Return null to fall back to default API key auth. */
  authenticate(req: http.IncomingMessage): Promise<AuthResult | null>;

  /** Return the SSO login URL, or null if using default YOUBOT auth. */
  getLoginUrl?(returnTo?: string): string | null;

  /** Validate a web session cookie. Return null for invalid/expired sessions. */
  validateSession?(cookie: string): Promise<SessionUser | null>;

  /** Deployment modes this plugin is active for (default: all modes) */
  modes?: DeploymentMode[];
}

// ── App Theme ───────────────────────────────────────────

export interface AppTheme {
  /** App display name shown in sidebar, title bar, etc. */
  appName: string;

  /** URL path to logo image (relative to YOUBOT public dir or absolute URL) */
  logoUrl?: string;

  /** URL path to favicon */
  faviconUrl?: string;

  /**
   * Absolute filesystem path to a CSS file containing :root and .dark
   * variable overrides. This replaces the limited `colors` map for
   * complete Tailwind v4 theme customization.
   * Convention: `custom/themes/<id>/theme.css`
   */
  cssPath?: string;

  /** CSS custom property overrides injected as :root vars (legacy — prefer cssPath) */
  colors?: {
    primary?: string;
    background?: string;
    foreground?: string;
    sidebar?: string;
    accent?: string;
    border?: string;
  };

  /** Custom fonts (Google Fonts names) */
  fonts?: {
    heading?: string;
    body?: string;
  };

  /**
   * Absolute filesystem path to a nav.json file that defines the sidebar
   * layout per deployment mode. If omitted, YOUBOT's default nav is used.
   * Convention: `custom/themes/<id>/nav.json`
   */
  navConfigPath?: string;
}

// ── Custom App Manifest ─────────────────────────────────

import type { ToolModule } from '../tools/types.js';

export interface CustomApp {
  /** Unique app ID (e.g. 'my-crm', 'analytics-pro') */
  id: string;

  /** Display name */
  name: string;

  /** Semver version string */
  version: string;

  /** Deployment modes this app supports. Omit to support all. */
  deploymentModes?: DeploymentMode[];

  /** Lazy-loaded engine extension hooks */
  engineHooks?: () => Promise<{ default: EngineHook }>;

  /** Lazy-loaded auth plugin */
  auth?: () => Promise<{ default: AuthPlugin }>;

  /** Lazy-loaded theme configuration */
  theme?: () => Promise<{ default: AppTheme }>;

  /** Lazy-loaded navigation groups to inject into the sidebar */
  navigation?: () => Promise<{ default: NavGroup[] }>;

  /** Lazy-loaded backend route handler (for /api/<id>/* routes) */
  apiRoutes?: () => Promise<{ default: (req: http.IncomingMessage, res: http.ServerResponse, url: string, method: string) => Promise<boolean> }>;

  /** Lazy-loaded tool module factories */
  toolModules?: Array<() => Promise<{ default: ToolModule }>>;
}
