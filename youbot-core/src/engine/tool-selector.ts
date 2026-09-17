/**
 * Two-Phase Tool Selection with Multi-Model Support
 *
 * Reduces token usage by ~75% through intelligent tool filtering:
 *   Phase 1: Classify intent with a SMALL fast model + compact module catalog
 *   Phase 2: Main model processes with only the needed tool definitions
 *
 * The router model is auto-detected: picks the smallest available Ollama model
 * that supports completion. A 3-4B model can classify in ~2-3s vs 30s+ for a 30B model.
 */

import type { ToolDefinition } from './types.js';
import OpenAI from 'openai';
import { log } from '../logger/ring-buffer.js';
import { getHooks } from '../hooks/extensions.js';

/** Modules whose tools are ALWAYS included (core agent behavior) */
const ALWAYS_INCLUDE_MODULES = new Set([
  'approvals',      // ask_owner — secretary behavior
  'personas',       // save_memory, get_profile — soul system
  'followups',      // conversation continuity
  'web-fetch',      // always need URL fetching as fallback
  'web-search',     // always need web search capability — use this FIRST for lookups
  'skills',         // run_skill — MUST be available so LLM uses pre-built workflows
  'messaging',      // send_message — owner frequently sends messages across channels
  'google',         // gmail, calendar, drive — owner's core productivity suite
  'scheduler',      // reminders, scheduled tasks — common owner requests
  'orchestrator',   // delegate_to_agent — owner needs specialized agent delegation
]);

/** Static one-liner descriptions per module — used in the compact catalog */
const MODULE_DESCRIPTIONS: Record<string, string> = {
  messaging:     'Send, search, forward, react to messages on WhatsApp/Telegram; check connection status',
  personas:      'Save/retrieve user memories and profiles',
  sessions:      'Manage multi-session conversations',
  apple:         'Apple Calendar, Contacts, Notes, Mail (macOS)',
  cli:           'Run code, build custom tools, AI coding agents',
  exec:          'Execute shell commands directly',
  files:         'Read, write, list, search local files',
  media:         'Extract text from PDFs/documents, describe images',
  patch:         'Apply code patches to files',
  google:        'Gmail, Drive, Sheets, Docs, Calendar, Contacts, Places',
  transcription: 'Transcribe audio/voice recordings',
  'web-search':  'Search the web for information',
  'web-fetch':   'Fetch and read URL content',
  skills:        'Create and manage automation skills/workflows',
  vault:         'Store and retrieve secure credentials',
  approvals:     'Escalate to owner for sensitive decisions',
  followups:     'Track and schedule conversation follow-ups',
  scheduler:     'Schedule messages, reminders, and agent tasks',
  browser:       'Browser automation, screenshots, form filling',
  mcp:           'External MCP server tools',
  orchestrator:  'Multi-agent coordination ONLY: delegate to specialized agents (researcher, writer, publisher) or decompose requests requiring 3+ distinct capabilities. Do NOT use for simple lookups, weather, facts, or single-tool tasks.',
};

/**
 * Build the compact module catalog for Phase 1.
 * ~300 tokens instead of ~12,600 for full tool schemas.
 */
function buildModuleCatalog(
  availableModules: string[],
  descriptions: Record<string, string> = MODULE_DESCRIPTIONS,
  alwaysOn: Set<string> = ALWAYS_INCLUDE_MODULES,
): string {
  const lines = availableModules
    .filter(m => !alwaysOn.has(m))
    .map(m => {
      const desc = descriptions[m] || m;
      return `- ${m}: ${desc}`;
    });

  return [
    'Available tool modules (respond with JSON array of needed module names, or [] if none needed):',
    ...lines,
  ].join('\n');
}

const SELECTOR_SYSTEM_PROMPT = `You are a tool routing classifier. Given a user message, determine which ADDITIONAL tool modules are needed beyond the always-included ones.

Rules:
- Return ONLY a JSON array of module names, e.g. ["cli", "files"] or []
- The following modules are ALWAYS available and do NOT need to be listed: approvals, personas, followups, web-fetch, web-search, skills, messaging, google, scheduler, orchestrator
- Return [] only for pure small talk (greetings like "hi", "thanks", "ok", short affirmations)
- For ANY action request, task, or question about real-world info: include relevant modules
- If unsure whether a module is needed, INCLUDE it — over-inclusion is safer than under-inclusion
- If the user mentions websites, URLs, browsing, or checking a site: include "browser"
- If the user mentions files, documents, reading/writing content locally: include "files"
- If the user mentions running code, scripts, terminal commands: include "cli"
- If the user mentions Apple apps (Calendar, Notes, Contacts, Reminders on Mac): include "apple"
- If the user mentions audio, voice, transcription: include "transcription"

Examples:
- "hi" → []
- "check my email" → [] (google always included)
- "search for latest news on AI" → [] (web-search always included)
- "open this website and fill the form" → ["browser"]
- "read this PDF file" → ["files", "media"]
- "run this python script" → ["cli"]`;

export interface ToolSelectionResult {
  tools: ToolDefinition[];
  selectedModules: string[];
  skipped: boolean;
  tokensSaved: number;
  routerModel?: string;
}

// ─── Router Model Auto-Detection ─────────────────────────

let cachedRouterModel: { checked: boolean; model: string | null } = { checked: false, model: null };

/**
 * Auto-detect the best small model for routing.
 * Picks the smallest Ollama model that:
 *   1. Supports completion + tools
 *   2. Is different from the main model
 *   3. Is strictly smaller than the main model
 * Caches the result for the process lifetime.
 */
async function detectRouterModel(baseUrl: string, mainModel: string): Promise<string | null> {
  if (cachedRouterModel.checked) return cachedRouterModel.model;

  // Only attempt auto-detection for local Ollama instances
  // Cloud providers (Gemini, OpenAI, etc.) don't support multi-model routing
  const isLocalOllama = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
  if (!isLocalOllama) {
    cachedRouterModel = { checked: true, model: null };
    return null;
  }

  const ollamaHost = baseUrl.replace(/\/v1\/?$/, '');
  try {
    const resp = await fetch(`${ollamaHost}/api/tags`);
    if (!resp.ok) { cachedRouterModel = { checked: true, model: null }; return null; }
    const data = await resp.json() as any;
    const models = (data.models || []) as any[];

    if (models.length <= 1) {
      cachedRouterModel = { checked: true, model: null };
      return null;
    }

    // Get capabilities for each model in parallel
    const modelInfos = await Promise.allSettled(
      models.map(async (m: any) => {
        const name = m.name || m.model;
        const showResp = await fetch(`${ollamaHost}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!showResp.ok) return null;
        const info = await showResp.json() as any;
        const caps: string[] = info.capabilities || [];
        const sizeStr = m.details?.parameter_size || '';
        const sizeB = parseModelSize(sizeStr);
        return { name, capabilities: caps, sizeB, sizeStr };
      })
    );

    // All tool-capable models, sorted by size ascending
    const toolCapable = modelInfos
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
      .filter(m =>
        m.capabilities.includes('completion') &&
        m.capabilities.includes('tools')
      )
      .sort((a, b) => a.sizeB - b.sizeB);

    // Find the main model's size
    const mainInfo = toolCapable.find(m => m.name === mainModel);
    const mainSize = mainInfo?.sizeB ?? Infinity;

    // Pick the smallest model that is NOT the main model AND is strictly smaller
    const router = toolCapable.find(m => m.name !== mainModel && m.sizeB < mainSize);

    if (!router) {
      log.info('ToolSelector', `No smaller router model found (main: ${mainModel} ${mainInfo?.sizeStr || '?'}, ${toolCapable.length} tool-capable models)`);
      cachedRouterModel = { checked: true, model: null };
      return null;
    }

    cachedRouterModel = { checked: true, model: router.name };
    const thinkTag = router.capabilities.includes('thinking') ? ', thinking' : '';
    log.info('ToolSelector',
      `Router: ${router.name} (${router.sizeStr}${thinkTag}) ← main: ${mainModel} (${mainInfo?.sizeStr || '?'}) — ` +
      `${toolCapable.length} tool-capable models`
    );
    return router.name;
  } catch (err: any) {
    log.warn('ToolSelector', `Router model detection failed: ${err.message}`);
    cachedRouterModel = { checked: true, model: null };
    return null;
  }
}

/** Parse model size string like "3.8B" to a number in billions */
function parseModelSize(sizeStr: string): number {
  if (!sizeStr) return Infinity; // Unknown size → treat as large
  const match = sizeStr.match(/([\d.]+)\s*(B|M|K)/i);
  if (!match) return Infinity;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'B') return value;
  if (unit === 'M') return value / 1000;
  if (unit === 'K') return value / 1000000;
  return value;
}

/**
 * Invalidate the cached router model (e.g. when models are added/removed)
 */
export function invalidateRouterModelCache(): void {
  cachedRouterModel = { checked: false, model: null };
}

// ─── Main Selection Logic ────────────────────────────────

/**
 * Phase 1: Classify which tool modules are needed for a message.
 * Uses a small fast model for classification to minimize latency.
 */
export async function selectToolsForMessage(
  client: OpenAI,
  model: string,
  userMessage: string,
  allToolsWithModules: Array<{ module: string; tool: ToolDefinition }>,
  isOwner: boolean,
  baseUrl?: string,
  routerOverride?: { client: OpenAI; model: string },
): Promise<ToolSelectionResult> {
  const startTime = Date.now();

  const allModules = [...new Set(allToolsWithModules.map(t => t.module))];
  const allTools = allToolsWithModules.map(t => t.tool);

  const fullPayloadChars = JSON.stringify(allTools.map(t => ({
    name: t.name, description: t.description, parameters: t.parameters,
  }))).length;

  // Use purpose-based router override if provided, otherwise auto-detect
  let routerModel = model;
  let routerClient = client;

  if (routerOverride) {
    routerModel = routerOverride.model;
    routerClient = routerOverride.client;
    log.info('ToolSelector', `Using purpose-routed router model: ${routerModel} (main: ${model})`);
  } else if (baseUrl) {
    const detectedRouter = await detectRouterModel(baseUrl, model);
    if (detectedRouter && detectedRouter !== model) {
      routerModel = detectedRouter;
      // Create a separate client pointing to the same Ollama but using the small model
      routerClient = new OpenAI({
        apiKey: 'ollama', // Ollama doesn't need a key
        baseURL: baseUrl,
        timeout: 60000,
      });
      log.info('ToolSelector', `Using router model: ${routerModel} (main: ${model})`);
    }
  }

  // Merge extra module descriptions from engine hook (custom apps)
  const extraModuleDescs = getHooks().engine?.getExtraToolModules?.() ?? {};
  const mergedDescriptions = { ...MODULE_DESCRIPTIONS, ...extraModuleDescs };

  // Merge always-on modules from engine hook
  const extraAlwaysOn = getHooks().engine?.getAlwaysOnModules?.() ?? [];
  const mergedAlwaysOn = new Set([...ALWAYS_INCLUDE_MODULES, ...extraAlwaysOn]);

  const catalog = buildModuleCatalog(allModules, mergedDescriptions, mergedAlwaysOn);

  try {
    const completion = await routerClient.chat.completions.create({
      model: routerModel,
      messages: [
        { role: 'system', content: SELECTOR_SYSTEM_PROMPT },
        { role: 'user', content: `${catalog}\n\nUser message: "${userMessage}"` },
      ],
      temperature: 0.0,
      max_tokens: 300, // Allow room for thinking tokens + answer
    });

    const response = completion.choices[0]?.message?.content || '[]';

    // Parse the JSON array of module names
    let selectedModules: string[] = [];
    try {
      // Handle markdown code fences + thinking tags
      let cleaned = response;
      // Strip <think>...</think> tags (reasoning models), including incomplete ones
      cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      // Handle incomplete think blocks (model ran out of tokens mid-thought)
      cleaned = cleaned.replace(/<think>[\s\S]*/g, '').trim();
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Try to find a JSON array in the response
      const arrayMatch = cleaned.match(/\[[\s\S]*?\]/);
      if (arrayMatch) {
        cleaned = arrayMatch[0];
      }
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        selectedModules = parsed.filter((m: unknown): m is string =>
          typeof m === 'string' && allModules.includes(m)
        );
      }
    } catch {
      log.warn('ToolSelector', 'Failed to parse router response; using all tools');
      return {
        tools: allTools,
        selectedModules: allModules,
        skipped: false,
        tokensSaved: 0,
        routerModel,
      };
    }

    // Only force-include core modules when the LLM selected at least one module.
    // If the classifier returned [] (pure chat), trust it — send zero tools.
    if (selectedModules.length > 0) {
      for (const core of ALWAYS_INCLUDE_MODULES) {
        if (allModules.includes(core) && !selectedModules.includes(core)) {
          selectedModules.push(core);
        }
      }
    }

    let selectedTools = allToolsWithModules
      .filter(t => selectedModules.includes(t.module))
      .map(t => t.tool);

    if (!isOwner) {
      const { VISITOR_SAFE_TOOL_NAMES } = await import('./tools.js');
      selectedTools = selectedTools.filter(t => VISITOR_SAFE_TOOL_NAMES.has(t.name));
    }

    const selectedPayloadChars = JSON.stringify(selectedTools.map(t => ({
      name: t.name, description: t.description, parameters: t.parameters,
    }))).length;

    const tokensSaved = Math.floor((fullPayloadChars - selectedPayloadChars) / 4);
    const duration = Date.now() - startTime;

    log.info('ToolSelector',
      `Phase 1 (${routerModel}): ${selectedModules.length}/${allModules.length} modules → ` +
      `${selectedTools.length}/${allTools.length} tools ` +
      `(saved ~${tokensSaved} tokens, ${duration}ms) ` +
      `[${selectedModules.join(', ') || 'none'}]`
    );

    return {
      tools: selectedTools,
      selectedModules,
      skipped: false,
      tokensSaved,
      routerModel,
    };
  } catch (err: any) {
    log.error('ToolSelector', `Classification failed: ${err.message} — using all tools`);
    return {
      tools: allTools,
      selectedModules: allModules,
      skipped: false,
      tokensSaved: 0,
      routerModel,
    };
  }
}
