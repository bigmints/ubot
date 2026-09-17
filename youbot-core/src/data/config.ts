import fs from 'fs';
import path from 'path';

// ─── Standard Provider Pattern ───────────────────────────
// Every multi-provider capability uses:
//   { enabled, default: "key", providers: { key: { enabled, ...config } } }

export interface ProviderConfig {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  models?: Record<string, string>;  // per-purpose model assignments
  timeout?: number;
  [key: string]: unknown;  // provider-specific extras
}

export interface ProvidersSection {
  enabled?: boolean;
  default?: string;
  providers?: Record<string, ProviderConfig>;
}

// ─── Capability-specific types ───────────────────────────

export interface GoogleServiceConfig {
  enabled?: boolean;
  credentials?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
    refresh_token?: string;
  };
}

export interface GoogleCapabilityConfig {
  enabled?: boolean;
  apiKey?: string;
  services?: Record<string, GoogleServiceConfig>;
}


export interface CliCapabilityConfig extends ProvidersSection {
  workDir?: string;
}

export interface McpServerConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabledTools?: string[];
}

export interface ExecCapabilityConfig {
  enabled?: boolean;
  security?: 'workspace' | 'allowed' | 'full';
  max_timeout?: number;
}

// ─── Capabilities Container ──────────────────────────────

export interface ToolRoutingConfig {
  /** Preferred provider per capability group. E.g. { browser: 'playwright' } */
  preferences?: Record<string, string>;
  /** Deduplicate overlapping tools. Default: true */
  deduplicate?: boolean;
}

export interface CapabilitiesConfig {
  models?: ProvidersSection;
  search?: ProvidersSection;
  cli?: CliCapabilityConfig;
  exec?: ExecCapabilityConfig;
  google?: GoogleCapabilityConfig;
  apple?: {
    enabled?: boolean;
    services?: {
      calendar?: { enabled?: boolean };
      contacts?: { enabled?: boolean };
      notes?: { enabled?: boolean };
      mail?: { enabled?: boolean };
    };
  };
  tool_routing?: ToolRoutingConfig;
  mcp?: { servers?: Record<string, McpServerConfig> };
  [key: string]: unknown;  // extensible for future capabilities
}

// ─── Auth Config ─────────────────────────────────────────

export type AuthMode = 'local' | 'sso';

export interface AuthConfig {
  /** 'local' = username/password login, 'sso' = external SSO provider.
   *  Default: 'local'. When 'local', password is auto-generated if missing. */
  mode?: AuthMode;
  /** Local auth username. Default: 'admin' */
  username?: string;
  /** Local auth password. Auto-generated on first boot if missing. */
  password?: string;
  /** SSO provider name (e.g. 'supabase'). Only used when mode is 'sso'. */
  provider?: string;
  /** SSO auth URL (e.g. 'https://auth.example.com'). Only used when mode is 'sso'. */
  auth_url?: string;
  /** SSO cookie name. Default: 'session'. Only used when mode is 'sso'. */
  cookie_name?: string;
}

// ─── Config Interface ────────────────────────────────────

export interface YoubotConfig {
  concierge?: import('../concierge/profile.js').ConciergeProfile;
  conciergeRevision?: number;
  meta?: { version?: string };
  server?: {
    /** Network interface to bind. Defaults to loopback for local installations. */
    host?: string;
    port?: number;
    frontend_port?: number;
    mode?: 'local' | 'cloud' | 'cloud-shared';
    auth?: AuthConfig;
    /** @deprecated Use server.auth.username */
    access_username?: string;
    /** @deprecated Use server.auth.password */
    access_password?: string;
  };
  database?: {
    provider?: 'sqlite' | 'supabase';
    path?: string;
    supabase_url?: string;
    supabase_service_key?: string;
  };

  /** Workspace storage configuration */
  workspace?: {
    /** Storage provider: 'local' (filesystem) or 'gcs' (Google Cloud Storage) */
    provider?: 'local' | 'gcs';
    /** Local: relative or absolute path. GCS: bucket name. Default: './workspace' */
    path?: string;
    /** GCS: key prefix for tenant isolation */
    prefix?: string;
  };

  /** Path to custom apps directory. Default: 'custom/apps' */
  apps_dir?: string;

  owner?: {
    phone?: string;
    telegram_id?: string;
    telegram_username?: string;
  };

  /** Owner display name used in approval notifications */
  ownerName?: string;

  channels?: {
    whatsapp?: { enabled?: boolean; auto_reply?: boolean };
    telegram?: { enabled?: boolean; token?: string; auto_reply?: boolean };
    webchat?: {
      enabled?: boolean;
      auto_reply?: boolean;
      connection_token?: string;
      relay_url?: string;
      bot_secret?: string;
      owner_key?: string;
      managed_relay?: boolean;
      relay_tenant_id?: string;
      relay_slug?: string;
      relay_tenant_url?: string;
      relay_installation_id?: string;
      managed_relay_origin?: string;
      welcome_message?: string;
      widget_title?: string;
      widget_color?: string;
      avatar_url?: string;
    };
  };

  agent?: {
    max_history_messages?: number;
    max_tool_iterations?: number;
    system_prompt?: string;
    primary_escalation_channel?: 'telegram' | 'whatsapp' | 'both';
  };

  /** Delay (in hours) before auto-scheduling a follow-up after ask_owner. Default: 2 */
  approvalFollowUpDelayHours?: number;

  /** Purpose-based routing: which capability.provider to use for each purpose */
  defaults?: Record<string, string>;

  /** All integrations live here */
  capabilities?: CapabilitiesConfig;

  // ─── Legacy (kept for migration, will be removed) ──────
  /** @deprecated use capabilities.models */
  models?: ProvidersSection;
  /** @deprecated use capabilities.search */
  search?: ProvidersSection;
  /** @deprecated use capabilities.cli */
  cli?: any;
  /** @deprecated */
  llm?: any;
  /** @deprecated */
  integrations?: any;
  /** @deprecated */
  mcp?: any;

  // ─── Voice & Audio Capabilities
  // The system is equipped with Text-to-Speech (TTS). If the user asks for a voice reply or audio message, you MUST use the send_audio tool to deliver your response as voice. Never claim you cannot speak or generate audio.

  // ─── Extension / Fork Fields ──────────────────────────
  // Forks can add arbitrary top-level keys to config.json.
  // Common pattern: { theme: { appName, colors, fonts }, app: { ... } }
  // Use getHooks() + config to read these in your fork's startup hook.
  theme?: {
    app_name?: string;
    description?: string;
    logo_url?: string;
    favicon_url?: string;
    colors?: Record<string, string>;
    fonts?: Record<string, string>;
    [key: string]: unknown;
  };
  app?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Config File I/O ─────────────────────────────────────

const YOUBOT_HOME = process.env.YOUBOT_HOME || '';
export let activeConfigPath = '';

export function loadYoubotConfig(): YoubotConfig {
  const candidates = [
    YOUBOT_HOME ? path.join(YOUBOT_HOME, 'config.json') : '',
    path.join(process.cwd(), 'config.json'),
  ].filter(Boolean);

  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        // This file contains provider keys, channel tokens and auth credentials.
        try { fs.chmodSync(configPath, 0o600); } catch { /* best effort */ }
        const raw = fs.readFileSync(configPath, 'utf8');
        activeConfigPath = configPath;
        return JSON.parse(raw) as YoubotConfig;
      }
    } catch { /* next */ }
  }

  activeConfigPath = YOUBOT_HOME
    ? path.join(YOUBOT_HOME, 'config.json')
    : path.join(process.cwd(), 'config.json');
  return {};
}

export function saveYoubotConfig(config: YoubotConfig): void {
  if (!activeConfigPath) {
    activeConfigPath = path.join(process.cwd(), 'config.json');
  }
  try {
    fs.mkdirSync(path.dirname(activeConfigPath), { recursive: true, mode: 0o700 });
    const tempPath = `${activeConfigPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 4) + '\n', { mode: 0o600 });
    fs.renameSync(tempPath, activeConfigPath);
    fs.chmodSync(activeConfigPath, 0o600);
  } catch (err: any) {
    console.error(`[Config] Failed to save config to ${activeConfigPath}:`, err.message);
  }
}

// ─── Helper: Get default provider ─────────────────────────

export function getDefaultProvider(section?: ProvidersSection): { key: string; config: ProviderConfig } | null {
  if (!section?.providers) return null;
  const defaultKey = section.default;
  if (defaultKey && section.providers[defaultKey]?.enabled !== false) {
    return { key: defaultKey, config: section.providers[defaultKey] };
  }
  const entries = Object.entries(section.providers);
  for (const [key, config] of entries) {
    if (config.enabled !== false) return { key, config };
  }
  return entries.length > 0 ? { key: entries[0][0], config: entries[0][1] } : null;
}

// ─── Helper: Resolve Auth Config ──────────────────────────

export interface ResolvedAuth {
  mode: AuthMode;
  // Local
  username: string;
  password: string | undefined;
  // SSO
  provider?: string;
  auth_url?: string;
  cookie_name?: string;
}

/**
 * Resolve auth config with backward compatibility.
 * Reads from server.auth (new) or server.access_* (deprecated flat fields).
 */
export function resolveAuthConfig(config: YoubotConfig): ResolvedAuth {
  const auth = config.server?.auth;
  let mode: AuthMode = auth?.mode ?? 'local';

  // Force SSO mode when running as the SaaS platform or shared cloud
  if (process.env.YOUBOT_MODE === 'cloud-saas' || process.env.YOUBOT_MODE === 'cloud-shared') {
    mode = 'sso';
  }

  return {
    mode,
    // Local auth — new fields first, then deprecated flat fields
    username: auth?.username ?? config.server?.access_username ?? 'admin',
    password: auth?.password ?? config.server?.access_password,
    // SSO
    provider: auth?.provider,
    auth_url: process.env.SSO_AUTH_URL || process.env.NEXT_PUBLIC_SSO_AUTH_URL || auth?.auth_url,
    cookie_name: auth?.cookie_name ?? 'session',
  };
}
