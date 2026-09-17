/**
 * Tool Router
 *
 * Intelligently selects between native and MCP tools by:
 * 1. Auto-detecting overlaps by name matching (no manual group registration)
 * 2. Applying user preferences per MCP server name
 * 3. Falling back when preferred provider is disconnected
 * 4. Registering transparent aliases so the LLM can use short names
 *
 * When a new MCP server is added, its tools are automatically checked against
 * native tools. If `mcp_foo_read_file` exists and native `read_file` exists,
 * they're auto-detected as overlaps — no code changes needed.
 */

import type { ToolDefinition
 } from './types.js';

// ─── Overlap Detection ──────────────────────────────────

interface ToolOverlap {
  /** The MCP server name (used as the preference key) */
  mcpServer: string;
  /** The native tool name (e.g. 'browser_click') */
  nativeName: string;
  /** The full MCP tool name (e.g. 'mcp_playwright_browser_click') */
  mcpName: string;
}

/**
 * Auto-detect MCP tools that overlap with native tools by name matching.
 * Strips the `mcp_{server}_` prefix and checks if the base name matches
 * any native tool name. No manual group registration needed.
 */
function detectOverlaps(
  nativeTools: ToolDefinition[],
  mcpTools: ToolDefinition[],
): ToolOverlap[] {
  const overlaps: ToolOverlap[] = [];
  const nativeNames = new Set(nativeTools.map(t => t.name));

  for (const mcpTool of mcpTools) {
    const parsed = parseMcpToolName(mcpTool.name);
    if (!parsed) continue;

    // Auto-match: if the base name matches any native tool, it's an overlap
    if (nativeNames.has(parsed.baseName)) {
      overlaps.push({
        mcpServer: parsed.server,
        nativeName: parsed.baseName,
        mcpName: mcpTool.name,
      });
    }
  }

  return overlaps;
}

/** Parse `mcp_playwright_browser_click` → { server: 'playwright', baseName: 'browser_click' } */
function parseMcpToolName(name: string): { server: string; baseName: string } | null {
  if (!name.startsWith('mcp_')) return null;
  const withoutPrefix = name.slice(4); // remove 'mcp_'
  const underscoreIdx = withoutPrefix.indexOf('_');
  if (underscoreIdx === -1) return null;
  return {
    server: withoutPrefix.slice(0, underscoreIdx),
    baseName: withoutPrefix.slice(underscoreIdx + 1),
  };
}

// ─── Router ─────────────────────────────────────────────

export interface ToolRoutingConfig {
  /** Preferred provider per capability group. E.g. { browser: 'playwright' } */
  preferences?: Record<string, string>;
  /** Whether to deduplicate overlapping tools. Default: true */
  deduplicate?: boolean;
}

export interface RouteResult {
  /** The filtered, deduplicated tool definitions for the LLM */
  tools: ToolDefinition[];
  /** Alias map: short name → actual executor name. E.g. browser_click → mcp_playwright_browser_click */
  aliases: Map<string, string>;
  /** Stats for logging */
  stats: {
    totalBefore: number;
    totalAfter: number;
    overlapsFound: number;
    overlapsResolved: number;
    mcpEnrichments: number;
  };
}

/**
 * Route and deduplicate tools based on capability groups and preferences.
 *
 * @param nativeTools - Tools from built-in modules
 * @param mcpTools - Tools from connected MCP servers
 * @param config - Routing preferences
 * @param mcpConnected - Set of currently connected MCP server names
 */
export function routeTools(
  nativeTools: ToolDefinition[],
  mcpTools: ToolDefinition[],
  config: ToolRoutingConfig = {},
  mcpConnected: Set<string> = new Set(),
): RouteResult {
  const deduplicate = config.deduplicate !== false; // default true
  const preferences = config.preferences || {};
  const aliases = new Map<string, string>();

  if (!deduplicate || mcpTools.length === 0) {
    // No dedup — return everything as-is
    return {
      tools: [...nativeTools, ...mcpTools],
      aliases,
      stats: {
        totalBefore: nativeTools.length + mcpTools.length,
        totalAfter: nativeTools.length + mcpTools.length,
        overlapsFound: 0,
        overlapsResolved: 0,
        mcpEnrichments: 0,
      },
    };
  }

  // 1. Detect overlaps
  const overlaps = detectOverlaps(nativeTools, mcpTools);

  // 2. Build sets for quick lookup
  const hiddenNative = new Set<string>();  // native tools to hide (MCP preferred)
  const hiddenMcp = new Set<string>();     // MCP tools to hide (native preferred)
  let overlapsResolved = 0;

  for (const overlap of overlaps) {
    // Preference key is the MCP server name (e.g. "playwright", "filesystem")
    const pref = preferences[overlap.mcpServer];
    const mcpServerConnected = mcpConnected.has(overlap.mcpServer);

    if (pref === overlap.mcpServer && mcpServerConnected) {
      // User prefers MCP and it's connected → hide native, alias native name → MCP
      hiddenNative.add(overlap.nativeName);
      aliases.set(overlap.nativeName, overlap.mcpName);
      overlapsResolved++;
    } else if (pref === 'native' || !pref) {
      // User prefers native (or no preference = native default) → hide MCP overlap
      hiddenMcp.add(overlap.mcpName);
      overlapsResolved++;
    } else if (pref === overlap.mcpServer && !mcpServerConnected) {
      // User prefers MCP but it's disconnected → fallback to native, hide MCP
      hiddenMcp.add(overlap.mcpName);
      overlapsResolved++;
    }
  }

  // 3. Filter tools
  const filteredNative = nativeTools.filter(t => !hiddenNative.has(t.name));

  // For MCP tools: hide overlapping ones that lost preference.
  // Keep MCP-unique tools (enrichments) regardless.
  const nativeNameSet = new Set(nativeTools.map(t => t.name));
  let mcpEnrichments = 0;
  const filteredMcp = mcpTools.filter(t => {
    if (hiddenMcp.has(t.name)) return false;

    // Filter out tools from disconnected MCP servers — don't send to LLM
    const parsed = parseMcpToolName(t.name);
    if (parsed && !mcpConnected.has(parsed.server)) return false;

    // If this MCP tool has no native overlap, it's an enrichment — always keep
    if (parsed && !nativeNameSet.has(parsed.baseName)) {
      mcpEnrichments++;
    }
    return true;
  });

  // 4. For MCP tools that won preference, present them under a friendly name
  //    by renaming the tool definition (the alias handles execution routing)
  const renamedMcp = filteredMcp.map(t => {
    const parsed = parseMcpToolName(t.name);
    if (parsed && hiddenNative.has(parsed.baseName)) {
      // This MCP tool is replacing a native tool — present with the short name
      return {
        ...t,
        name: parsed.baseName, // LLM sees `browser_click` not `mcp_playwright_browser_click`
        description: t.description.replace(/^\[MCP: [^\]]+\]\s*/, ''), // clean prefix
      };
    }
    return t;
  });

  const resolved = [...filteredNative, ...renamedMcp];

  return {
    tools: resolved,
    aliases,
    stats: {
      totalBefore: nativeTools.length + mcpTools.length,
      totalAfter: resolved.length,
      overlapsFound: overlaps.length,
      overlapsResolved,
      mcpEnrichments,
    },
  };
}

// ─── Connected MCP Server Helper ────────────────────────

/**
 * Get the set of currently connected MCP server names.
 * Lazy-loads the MCP manager to avoid circular deps.
 */
export function getConnectedMcpServers(): Set<string> {
  try {
    const { getMcpServerManager } = require('../capabilities/mcp/mcp-manager.js');
    const mgr = getMcpServerManager();
    const servers = mgr.getServers();
    const connected = new Set<string>();
    for (const s of servers) {
      if (s.status === 'connected') {
        connected.add(sanitizeName(s.name));
      }
    }
    return connected;
  } catch {
    return new Set();
  }
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
