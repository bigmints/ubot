/**
 * Custom Module Loader
 * 
 * Dynamically discovers, loads, validates, and registers custom tool modules
 * from the custom/modules/ directory. Supports hot-reload without server restart.
 * 
 * Custom modules follow the same ToolModule interface as core modules but
 * are loaded at runtime via dynamic import().
 */

import { existsSync, readdirSync } from 'fs';
import path from 'path';
import type { ToolModule, ToolRegistry, ToolContext } from './types.js';
import { log } from '../logger/ring-buffer.js';

const UBOT_ROOT = process.env.UBOT_HOME || process.cwd();

// Track loaded custom modules for hot-reload
const loadedModules = new Map<string, ToolModule>();

/** Core tool names that custom modules cannot override */
const CORE_TOOL_NAMES = new Set<string>();

/**
 * Set core tool names to prevent collisions.
 * Called once at startup after core modules are registered.
 */
export function setCoreToolNames(names: string[]): void {
  CORE_TOOL_NAMES.clear();
  for (const name of names) {
    CORE_TOOL_NAMES.add(name);
  }
}

/**
 * Validate that an object conforms to the ToolModule interface.
 */
function validateToolModule(obj: any, moduleName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!obj || typeof obj !== 'object') {
    errors.push('Module must export a default object');
    return { valid: false, errors };
  }

  if (typeof obj.name !== 'string' || !obj.name) {
    errors.push('Module must have a "name" string property');
  }

  if (!Array.isArray(obj.tools)) {
    errors.push('Module must have a "tools" array property');
  } else {
    for (const tool of obj.tools) {
      if (!tool.name || typeof tool.name !== 'string') {
        errors.push(`Tool missing "name" property`);
      }
      if (!tool.description || typeof tool.description !== 'string') {
        errors.push(`Tool "${tool.name}" missing "description" property`);
      }
      if (!Array.isArray(tool.parameters)) {
        errors.push(`Tool "${tool.name}" missing "parameters" array`);
      }
      // Check for collision with core tools
      if (CORE_TOOL_NAMES.has(tool.name)) {
        errors.push(`Tool name "${tool.name}" conflicts with a core tool — use "custom_" prefix`);
      }
    }
  }

  if (typeof obj.register !== 'function') {
    errors.push('Module must have a "register" function');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Get the base directory for custom modules.
 */
function getCustomDir(subdir: 'modules' | 'staging' | 'templates'): string {
  return path.join(UBOT_ROOT, 'custom', subdir);
}

/**
 * Find the index file for a module directory (prefers .js in production, .ts in dev).
 */
function findModuleIndex(base: string, name: string): string | null {
  const jsPath = path.join(base, name, 'index.js');
  const tsPath = path.join(base, name, 'index.ts');
  // Prefer .js (production/compiled), fall back to .ts (dev/tsx)
  if (existsSync(jsPath)) return jsPath;
  if (existsSync(tsPath)) return tsPath;
  return null;
}

/**
 * Discover all custom module directories that contain an index.ts or index.js file.
 */
export function discoverModules(dir: 'modules' | 'staging' = 'modules'): string[] {
  const base = getCustomDir(dir);
  if (!existsSync(base)) return [];

  return readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => findModuleIndex(base, d.name) !== null)
    .map(d => d.name);
}

/**
 * Load a single custom module by name.
 * Uses dynamic import() with cache-busting for hot-reload.
 */
export async function loadModule(
  moduleName: string,
  dir: 'modules' | 'staging' = 'modules',
): Promise<{ module: ToolModule | null; errors: string[] }> {
  const base = getCustomDir(dir);
  const indexPath = findModuleIndex(base, moduleName);

  if (!indexPath) {
    return { module: null, errors: [`Module "${moduleName}" not found (no index.ts or index.js) at ${path.join(base, moduleName)}`] };
  }

  try {
    // Use cache-busting query param for hot-reload
    const cacheBuster = `?t=${Date.now()}`;
    const imported = await import(`${indexPath}${cacheBuster}`);
    // Handle CJS→ESM interop: import() of CJS `exports.default = X` produces
    // { default: { default: X } }. Unwrap until we get the actual ToolModule.
    let mod = imported.default || imported;
    if (mod && mod.default && typeof mod.default === 'object') {
      mod = mod.default;
    }

    const validation = validateToolModule(mod, moduleName);
    if (!validation.valid) {
      return { module: null, errors: validation.errors };
    }

    return { module: mod as ToolModule, errors: [] };
  } catch (err: any) {
    return { module: null, errors: [`Failed to import module "${moduleName}": ${err.message}`] };
  }
}

/**
 * Register a custom module's tools into the live registry.
 */
export function registerModule(
  module: ToolModule,
  registry: ToolRegistry,
  ctx: ToolContext,
): void {
  log.info('CustomLoader', `Registering custom module: ${module.name} (${module.tools.length} tools)`);
  module.register(registry, ctx);
  loadedModules.set(module.name, module);
}

/**
 * Load and register all custom modules from custom/modules/.
 * Called at startup after core modules are registered.
 */
export async function loadAllCustomModules(
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<{ loaded: string[]; failed: Array<{ name: string; errors: string[] }> }> {
  const moduleNames = discoverModules('modules');
  const loaded: string[] = [];
  const failed: Array<{ name: string; errors: string[] }> = [];

  for (const name of moduleNames) {
    const result = await loadModule(name, 'modules');
    if (result.module) {
      registerModule(result.module, registry, ctx);
      loaded.push(name);
    } else {
      log.error('CustomLoader', `Failed to load custom module "${name}": ${result.errors.join(', ')}`);
      failed.push({ name, errors: result.errors });
    }
  }

  if (loaded.length > 0) {
    log.info('CustomLoader', `Loaded ${loaded.length} custom module(s): ${loaded.join(', ')}`);
  }

  return { loaded, failed };
}

/**
 * Hot-reload a specific custom module.
 * Re-imports and re-registers without server restart.
 */
export async function hotReloadModule(
  moduleName: string,
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<{ success: boolean; errors: string[] }> {
  const result = await loadModule(moduleName, 'modules');
  if (!result.module) {
    return { success: false, errors: result.errors };
  }

  // Re-register (overwrites existing executors)
  registerModule(result.module, registry, ctx);
  log.info('CustomLoader', `Hot-reloaded custom module: ${moduleName}`);
  return { success: true, errors: [] };
}

/**
 * Get list of loaded custom modules with their tool counts.
 */
export function getLoadedModules(): Array<{ name: string; toolCount: number; toolNames: string[] }> {
  return Array.from(loadedModules.entries()).map(([name, mod]) => ({
    name,
    toolCount: mod.tools.length,
    toolNames: mod.tools.map((t: any) => t.name),
  }));
}

/**
 * Get full ToolModule objects for all loaded custom modules.
 * Used by the registry to include custom tools in API responses.
 */
export function getLoadedToolModules(): ToolModule[] {
  return Array.from(loadedModules.values());
}

/**
 * Get all tool definitions from loaded custom modules.
 */
export function getCustomToolDefinitions(): Array<{ name: string; description: string; parameters: any[] }> {
  const defs: Array<{ name: string; description: string; parameters: any[] }> = [];
  for (const mod of loadedModules.values()) {
    defs.push(...mod.tools);
  }
  return defs;
}

/**
 * Unload a custom module from the in-memory registry.
 * If a ToolRegistry is provided, also unregister tool executors.
 */
export function unloadModule(moduleName: string, registry?: ToolRegistry): boolean {
  const mod = loadedModules.get(moduleName);
  if (!mod) return false;

  // Unregister executors from the live registry
  if (registry) {
    for (const tool of mod.tools) {
      registry.unregister(tool.name);
    }
  }

  loadedModules.delete(moduleName);
  log.info('CustomLoader', `Unloaded custom module: ${moduleName} (${mod.tools.length} tools removed)`);
  return true;
}
