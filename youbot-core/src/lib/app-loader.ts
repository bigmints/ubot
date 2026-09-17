/**
 * Custom App Loader
 *
 * Scans custom/apps/ for app manifests and registers them at startup.
 * Each app can provide engine hooks, auth, theme, tool modules, and navigation.
 *
 * - Apps dir: reads from config.json `apps_dir`, default: 'custom/apps'
 * - Theme: custom app theme > config.json `theme` section > null
 * - Mode: reads from features.ts (which reads config.json + env var)
 */

import { readdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import type { CustomApp, EngineHook, AuthPlugin, AppTheme, NavGroup, DeploymentMode } from './custom-app.js';
import { registerHooks, type RegisteredHooks } from '../hooks/extensions.js';
import { loadYoubotConfig } from '../data/config.js';
import { MODE, RAW_MODE } from './features.js';
import type { ToolModule } from '../tools/types.js';

const cfg = loadYoubotConfig();
const CUSTOM_APPS_DIR = resolve(process.cwd(), cfg.apps_dir ?? 'custom/apps');

// ── Global App Registry ─────────────────────────────────

let loadedApps: CustomApp[] = [];
let loadedTheme: AppTheme | null = null;
let loadedNavigation: NavGroup[] = [];
let loadedToolModules: ToolModule[] = [];

export function getLoadedApps(): CustomApp[] { return loadedApps; }
export function getActiveNavigation(): NavGroup[] { return loadedNavigation; }
export function getCustomToolModules(): ToolModule[] { return loadedToolModules; }

/**
 * Returns active theme: custom app theme > config.json theme > built-in default
 */
export function getActiveTheme(): AppTheme | null {
  if (loadedTheme) return loadedTheme;
  // Fallback to config.json theme section
  const t = cfg.theme;
  if (t?.app_name) {
    return {
      appName: t.app_name,
      logoUrl: t.logo_url ?? undefined,
      faviconUrl: t.favicon_url ?? undefined,
      colors: t.colors as AppTheme['colors'],
      fonts: t.fonts as AppTheme['fonts'],
    };
  }
  // Fallback to built-in default theme
  if (builtInDefaultTheme) return builtInDefaultTheme;
  return null;
}

/** Loaded once during init from themes/default/theme.ts */
let builtInDefaultTheme: AppTheme | null = null;

// ── App Discovery ───────────────────────────────────────

async function discoverAppManifests(): Promise<string[]> {
  try {
    await access(CUSTOM_APPS_DIR);
    const entries = await readdir(CUSTOM_APPS_DIR, { withFileTypes: true });
    const manifestPaths: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Try manifest.ts first (tsx dev mode), then manifest.js (compiled production)
      let found = false;
      for (const filename of ['manifest.ts', 'manifest.js']) {
        const manifestPath = join(CUSTOM_APPS_DIR, entry.name, filename);
        try {
          await access(manifestPath);
          manifestPaths.push(manifestPath);
          found = true;
          break;
        } catch {
          // try next
        }
      }
      if (!found) {
        // No manifest — skip (may just be a work-in-progress dir)
      }
    }

    return manifestPaths;
  } catch {
    // custom/apps/ doesn't exist — perfectly fine for vanilla YOUBOT
    return [];
  }
}

// ── App Registration ────────────────────────────────────

async function registerApp(app: CustomApp): Promise<void> {
  // Mode guard
  if (app.deploymentModes && !app.deploymentModes.includes(RAW_MODE as DeploymentMode)) {
    console.log(`[AppLoader] ⏭ ${app.name} — not active in ${RAW_MODE} mode`);
    return;
  }

  console.log(`[AppLoader] 🚀 Loading ${app.name} v${app.version}`);

  const hooksToRegister: Partial<RegisteredHooks> = {};

  // Engine hooks
  if (app.engineHooks) {
    try {
      const { default: engineHook } = await app.engineHooks();
      hooksToRegister.engine = engineHook as EngineHook;
      console.log(`[AppLoader]   ✅ Engine hooks registered`);
    } catch (err: any) {
      console.error(`[AppLoader]   ❌ Engine hooks failed:`, err.message);
    }
  }

  // Auth plugin
  if (app.auth) {
    try {
      const { default: authPlugin } = await app.auth();
      // Only register if modes match
      const plugin = authPlugin as AuthPlugin;
      if (!plugin.modes || plugin.modes.includes(MODE)) {
        hooksToRegister.auth = plugin;
        console.log(`[AppLoader]   ✅ Auth plugin registered`);
      }
    } catch (err: any) {
      console.error(`[AppLoader]   ❌ Auth plugin failed:`, err.message);
    }
  }

  // Register all collected hooks
  if (Object.keys(hooksToRegister).length > 0) {
    registerHooks(hooksToRegister);
  }

  // Theme (last app wins)
  if (app.theme) {
    try {
      const { default: theme } = await app.theme();
      loadedTheme = theme as AppTheme;
      console.log(`[AppLoader]   ✅ Theme loaded: ${loadedTheme.appName}`);
    } catch (err: any) {
      console.error(`[AppLoader]   ❌ Theme failed:`, err.message);
    }
  }

  // Navigation
  if (app.navigation) {
    try {
      const { default: navGroups } = await app.navigation();
      loadedNavigation = [...loadedNavigation, ...(navGroups as NavGroup[])];
      console.log(`[AppLoader]   ✅ Navigation groups: ${(navGroups as NavGroup[]).length}`);
    } catch (err: any) {
      console.error(`[AppLoader]   ❌ Navigation failed:`, err.message);
    }
  }

  // Tool modules
  if (app.toolModules?.length) {
    for (const moduleFactory of app.toolModules) {
      try {
        const { default: toolModule } = await moduleFactory();
        loadedToolModules.push(toolModule as ToolModule);
        console.log(`[AppLoader]   ✅ Tool module: ${(toolModule as ToolModule).name}`);
      } catch (err: any) {
        console.error(`[AppLoader]   ❌ Tool module failed:`, err.message);
      }
    }
  }
}

// ── Main Entry Point ────────────────────────────────────

/**
 * Discover and load all custom apps.
 * Call this at startup before initializing the agent.
 */
export async function loadCustomApps(): Promise<void> {
  // Load built-in default theme (themes/default/theme.ts)
  try {
    const defaultThemePath = resolve(process.cwd(), 'themes/default/theme.ts');
    await access(defaultThemePath);
    const { default: theme } = await import(defaultThemePath);
    builtInDefaultTheme = theme;
    console.log(`[AppLoader] 🎨 Built-in default theme loaded`);
  } catch {
    // No built-in theme — that's fine, custom apps or config.json can provide one
  }

  const manifestPaths = await discoverAppManifests();

  if (manifestPaths.length === 0) {
    console.log('[AppLoader] No custom apps found in custom/apps/');
    return;
  }

  console.log(`[AppLoader] Found ${manifestPaths.length} custom app(s)`);

  for (const manifestPath of manifestPaths) {
    try {
      const module = await import(manifestPath);
      const app: CustomApp = module.default || module;

      if (!app?.id || !app?.name) {
        console.warn(`[AppLoader] ⚠ Invalid manifest at ${manifestPath} — missing id or name`);
        continue;
      }

      await registerApp(app);
      loadedApps.push(app);
    } catch (err: any) {
      console.error(`[AppLoader] ❌ Failed to load ${manifestPath}:`, err.message);
    }
  }

  console.log(`[AppLoader] ✅ Loaded ${loadedApps.length} custom app(s): ${loadedApps.map(a => a.name).join(', ')}`);
}
