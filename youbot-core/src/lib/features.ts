/**
 * YOUBOT Feature Flags
 *
 * Controls which features are available based on deployment mode.
 *
 * Resolution order:
 *   1. YOUBOT_MODE environment variable (highest priority — deploy-time override)
 *   2. server.mode in config.json
 *   3. Default: 'local'
 *
 * Core Modes:
 *   - 'local' → Full power, self-hosted (default)
 *   - 'cloud' → Single-tenant dedicated cloud
 *
 * Custom apps can extend with additional modes (e.g. 'cloud-shared')
 * and use overrideFeatures() to restrict capabilities at startup.
 */

import { loadYoubotConfig } from '../data/config.js';

export type YoubotMode = 'local' | 'cloud';

/**
 * Resolve the deployment mode.
 * Unknown mode values (e.g. 'cloud-shared' from a custom app) are
 * treated as 'cloud' for core feature flag purposes.
 */
function resolveMode(): YoubotMode {
  const raw = process.env.YOUBOT_MODE || loadYoubotConfig().server?.mode || 'local';
  if (raw === 'local') return 'local';
  // Any cloud variant ('cloud', 'cloud-shared', etc.) → 'cloud'
  return 'cloud';
}

/** The raw YOUBOT_MODE value — custom apps can read this for extended modes */
export const RAW_MODE: string = process.env.YOUBOT_MODE || loadYoubotConfig().server?.mode || 'local';

export const MODE: YoubotMode = resolveMode();

export const isLocal = MODE === 'local';
export const isCloud = MODE === 'cloud';

export const FEATURES: Record<string, boolean> = {
  // ── All tiers (Core) ────────────────────────────────
  webchat: true,
  memory: true,
  skills: true,
  scheduler: true,
  approvals: true,
  followups: true,
  safety: true,
  vault: true,
  mcp: true,
  webSearch: true,
  gemini: true,
  openai: true,
  sessions: true,

  // ── Cloud + Local (all on by default) ───────────────
  // Custom apps can restrict these via overrideFeatures()
  telegram:          true,
  customMcp:         true,
  customSkills:      true,
  unlimitedSessions: true,

  // ── Local only ──────────────────────────────────────
  whatsapp:       isLocal,
  imessage:       isLocal,
  ollama:         isLocal,
  lmstudio:       isLocal,
  localWhisper:   isLocal,
  localTts:       isLocal,
  cli:            isLocal,
  browserMcp:     isLocal,
};

export type FeatureName = string;

/**
 * Allow custom apps to override feature flags at startup.
 * Called by custom app init hooks to restrict capabilities
 * (e.g. SaveADay cloud-shared disables telegram, customMcp, etc.)
 */
export function overrideFeatures(overrides: Partial<Record<string, boolean>>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (key in FEATURES) {
      FEATURES[key] = value ?? false;
    }
  }
}

/**
 * Check if a feature is enabled in the current mode.
 */
export function isFeatureEnabled(feature: string): boolean {
  return FEATURES[feature] ?? false;
}

/**
 * Returns a user-friendly message for disabled features.
 */
export function getDisabledMessage(feature: string): string {
  if (FEATURES[feature]) return '';

  if (isCloud) {
    return `This feature is only available in the self-hosted (local) version.`;
  }
  return `Feature "${feature}" is not available in this configuration.`;
}
