/**
 * Tool Module Registry
 *
 * Auto-discovers tool modules from capability directories.
 * Each capability is a plug-and-play mini-app:
 *   1. Create a directory under capabilities/, agents/, or automation/
 *   2. Add an index.ts that exports `toolModules: ToolModule[]`
 *   3. The registry discovers and registers them automatically
 *
 * Infrastructure modules (channels, memory, engine) are registered explicitly.
 *
 * NOTE: CORE_ORCHESTRATOR_TOOLS (delegate_to_agent, execute_plan, list_agents)
 * are injected here under module:'orchestrator' so the tool selector always includes them.
 */

import fs from "fs";
import path from "path";
import type {
  ToolModule,
  ToolRegistry,
  ToolContext,
  ToolDefinition,
} from "./types.js";
import {
  loadAllCustomModules,
  getLoadedModules,
  getLoadedToolModules,
  setCoreToolNames,
} from "./custom-loader.js";
import { FEATURES, type FeatureName } from "../lib/features.js";
import { getHooks } from "../hooks/extensions.js";
import { toolAnalytics } from "../metrics/tool-analytics.js";

// Infrastructure tool modules (not auto-discovered — these are core plumbing)
import messagingTools from "../channels/tools.js";
import memoryTools from "../memory/tools.js";

const INFRASTRUCTURE_MODULES: ToolModule[] = [
  messagingTools,
  memoryTools,
];

// Directories to scan for plug-and-play modules
const SCAN_DIRS = ["capabilities", "agents", "automation"];

// Always disabled modules
const ALWAYS_DISABLED = new Set<string>();

// Map capability directory names → feature flag names
const CAPABILITY_FEATURE_MAP: Record<string, FeatureName> = {
  apple: "appleServices",
  cli: "cli",
  // transcription: always enabled — uses configured LLM provider, no local model required
  // tts: always enabled — uses configured LLM provider, no local binary required
  // models: always enabled (model management is core)
  // google: always enabled
  // 'web-search': always enabled
  // mcp: always enabled
};

/**
 * Build the set of disabled module directory names based on the current
 * YOUBOT_MODE, feature flags, and extension hooks.
 */
function getDisabledModules(): Set<string> {
  const disabled = new Set<string>(ALWAYS_DISABLED);
  for (const [dirName, feature] of Object.entries(CAPABILITY_FEATURE_MAP)) {
    if (!FEATURES[feature]) {
      disabled.add(dirName);
    }
  }
  // Extension hook can add more disabled modules
  const hooks = getHooks();
  if (hooks.toolRegistry?.getDisabledModules) {
    for (const mod of hooks.toolRegistry.getDisabledModules()) {
      disabled.add(mod);
    }
  }
  return disabled;
}

const DISABLED_MODULES = getDisabledModules();

let _discoveredModules: ToolModule[] | null = null;

/**
 * Discover tool modules by scanning capability directories.
 * Each directory with an index.ts that exports `toolModules` is registered.
 */
export async function discoverToolModules(): Promise<ToolModule[]> {
  if (_discoveredModules) return _discoveredModules;

  const srcDir = path.dirname(__dirname);
  const modules: ToolModule[] = [];

  for (const scanDir of SCAN_DIRS) {
    const fullPath = path.join(srcDir, scanDir);
    if (!fs.existsSync(fullPath)) continue;

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (DISABLED_MODULES.has(entry.name)) {
        console.log(
          `[Tools] Skipping disabled module: ${scanDir}/${entry.name}`,
        );
        continue;
      }

      const indexJs = path.join(fullPath, entry.name, "index.js");
      const indexTs = path.join(fullPath, entry.name, "index.ts");
      const indexPath = fs.existsSync(indexJs)
        ? indexJs
        : fs.existsSync(indexTs)
          ? indexTs
          : null;
      if (!indexPath) continue;

      try {
        const mod = await import(indexPath);
        if (mod.toolModules && Array.isArray(mod.toolModules)) {
          modules.push(...mod.toolModules);
          console.log(
            `[Tools] Discovered: ${scanDir}/${entry.name} (${mod.toolModules.length} module(s))`,
          );
        }
      } catch (err: any) {
        console.warn(
          `[Tools] Failed to load ${scanDir}/${entry.name}: ${err.message}`,
        );
      }
    }
  }

  _discoveredModules = modules;
  return modules;
}

/**
 * Get all modules: discovered + infrastructure + custom.
 */
async function getAllModules(): Promise<ToolModule[]> {
  const discovered = await discoverToolModules();
  return [...INFRASTRUCTURE_MODULES, ...discovered];
}

/**
 * Collect all tool definitions from all modules (core + custom).
 */
export async function getAllToolDefinitions(): Promise<ToolDefinition[]> {
  const allModules = await getAllModules();
  const customTools = getLoadedToolModules().flatMap((m) => m.tools);
  return [...allModules.flatMap((m) => m.tools), ...customTools];
}

/**
 * Collect all tool definitions along with their source module name (core + custom).
 */
export async function getAllToolsWithModules(): Promise<
  Array<{ module: string; tool: ToolDefinition }>
> {
  const allModules = await getAllModules();
  const core = allModules.flatMap((m) =>
    m.tools.map((tool) => ({ module: m.name, tool })),
  );
  const custom = getLoadedToolModules().flatMap((m) =>
    m.tools.map((tool) => ({ module: `custom:${m.name}`, tool })),
  );

  // Include core orchestrator tools (delegate_to_agent, execute_plan, list_agents)
  // so the tool selector can see them and the LLM can use multi-agent delegation.
  let orchestratorTools: Array<{ module: string; tool: ToolDefinition }> = [];
  try {
    const { CORE_ORCHESTRATOR_TOOLS } = await import("../engine/tools.js");
    orchestratorTools = CORE_ORCHESTRATOR_TOOLS.map((tool) => ({
      module: "orchestrator",
      tool,
    }));
  } catch {
    /* engine not available yet during startup */
  }

  return [...orchestratorTools, ...core, ...custom];
}

/**
 * Register all tool executors from all modules.
 * Records analytics for each tool registration.
 */
export async function registerAllToolModules(
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<void> {
  const allModules = await getAllModules();
  for (const mod of allModules) {
    console.log(
      `[Tools] Registering module: ${mod.name} (${mod.tools.length} tools)`,
    );
    mod.register(registry, ctx);
  }
  const defs = await getAllToolDefinitions();
  console.log(`[Tools] All modules registered (${defs.length} tools total)`);

  // Initialise analytics baseline (fire-and-forget)
  void toolAnalytics.getAllToolStats().catch(() => { /* ignore */ });
}

/**
 * Get module names.
 */
export async function getModuleNames(): Promise<string[]> {
  const allModules = await getAllModules();
  return allModules.map((m) => m.name);
}

/**
 * Register custom modules from custom/modules/ directory.
 * Called at startup after core modules are registered.
 */
export async function registerCustomModules(
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<void> {
  const defs = await getAllToolDefinitions();
  setCoreToolNames(defs.map((t) => t.name));

  const result = await loadAllCustomModules(registry, ctx);
  if (result.loaded.length > 0) {
    console.log(`[Tools] Custom modules loaded: ${result.loaded.join(", ")}`);
  }
  if (result.failed.length > 0) {
    console.warn(
      `[Tools] Custom modules failed: ${result.failed.map((f) => f.name).join(", ")}`,
    );
  }
}

/**
 * Get names of loaded custom modules.
 */
export function getCustomModuleNames(): string[] {
  return getLoadedModules().map((m) => m.name);
}