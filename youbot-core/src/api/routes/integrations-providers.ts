/**
 * Unified Integration Provider CRUD Routes (v2 — keyed providers)
 * 
 * Routes:
 *   GET    /api/integrations/:category           — List providers
 *   POST   /api/integrations/:category           — Add provider (key in body)
 *   PUT    /api/integrations/:category/:key       — Update provider
 *   DELETE /api/integrations/:category/:key       — Delete provider
 *   PUT    /api/integrations/:category/:key/default — Set as default
 *   PUT    /api/integrations/:category/:key/toggle  — Enable/disable
 *   GET    /api/integrations/:category/models     — Discover models
 */

import { parseBody, type ApiContext } from '../context.js';
import type { ProviderConfig, ProvidersSection } from '../../data/config.js';
import { loadYoubotConfig, saveYoubotConfig } from '../../data/config.js';
import { saveVertexCredentials, loadVertexCredentials, getVertexBaseUrl } from '../../engine/vertex-auth.js';
import { DEFAULT_PROVIDER_MODELS, ALL_PURPOSES } from '../../engine/types.js';
import http from 'http';

// ─── Helpers ─────────────────────────────────────────────

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
}

type Category = 'models' | 'search' | 'cli' | 'llm-image' | 'llm-transcript';
const VALID_CATEGORIES: Category[] = ['models', 'search', 'cli', 'llm-image', 'llm-transcript'];

// ─── Config Access ───────────────────────────────────────

function getSection(category: Category): ProvidersSection {
  const cfg = loadYoubotConfig();
  const caps = cfg.capabilities || {};
  return (caps[category] as ProvidersSection) || {};
}

function saveSection(category: Category, section: ProvidersSection): void {
  const cfg = loadYoubotConfig();
  if (!cfg.capabilities) cfg.capabilities = {};
  if (category === 'cli') {
    const existingWorkDir = (cfg.capabilities.cli as any)?.workDir;
    cfg.capabilities.cli = { ...section, workDir: existingWorkDir };
  } else {
    (cfg.capabilities as any)[category] = section;
  }
  saveYoubotConfig(cfg);
}

function parseCategory(url: string): Category | null {
  const match = url.match(/^\/api\/integrations\/([\w-]+)/);
  if (!match) return null;
  const cat = match[1] as Category;
  return VALID_CATEGORIES.includes(cat) ? cat : null;
}

function parseProviderKey(url: string): string | null {
  // Match /api/integrations/models/gemini or /api/integrations/models/gemini/default
  const match = url.match(/^\/api\/integrations\/[\w-]+\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  // Don't match "models" as a key (it's the /models endpoint for discovery)
  if (match[1] === 'models') return null;
  return match[1];
}

// ─── Route Handler ───────────────────────────────────────

export async function handleIntegrationProviderRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {

  if (!url.startsWith('/api/integrations/')) return false;

  // ── VERTEX CREDENTIALS upload (special route) ──
  if (url === '/api/integrations/vertex/credentials' && method === 'POST') {
    const body = await parseBody(req) as { serviceAccountJson?: string };
    if (!body.serviceAccountJson) {
      error(res, 'serviceAccountJson is required');
      return true;
    }

    const result = saveVertexCredentials(body.serviceAccountJson);
    if (!result.success) {
      error(res, result.error || 'Failed to save credentials');
      return true;
    }

    json(res, { success: true, projectId: result.projectId });
    return true;
  }

  if (url === '/api/integrations/vertex/credentials' && method === 'GET') {
    const creds = loadVertexCredentials();
    json(res, {
      configured: !!creds,
      projectId: creds?.project_id || null,
      clientEmail: creds?.client_email || null,
    });
    return true;
  }

  const category = parseCategory(url);
  if (!category) return false;

  // ── LIST providers ──
  if (url === `/api/integrations/${category}` && method === 'GET') {
    const section = getSection(category);
    json(res, {
      default: section.default || '',
      providers: section.providers || {},
      category,
    });
    return true;
  }

  // ── ADD provider ──
  if (url === `/api/integrations/${category}` && method === 'POST') {
    const body = await parseBody(req) as { key?: string } & ProviderConfig;
    if (!body.key) {
      error(res, 'key is required (provider name, e.g. "gemini")');
      return true;
    }

    const section = getSection(category);
    if (!section.providers) section.providers = {};

    const key = body.key.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const providerEntry: ProviderConfig = {
      enabled: body.enabled !== false,
      baseUrl: body.baseUrl || undefined,
      apiKey: body.apiKey || undefined,
      model: body.model || undefined,
      timeout: body.timeout || undefined,
    };

    // Vertex AI: store project/region, auto-generate base URL
    if (key === 'vertex') {
      const vertexBody = body as any;
      if (vertexBody.projectId) providerEntry.projectId = vertexBody.projectId;
      if (vertexBody.region) providerEntry.region = vertexBody.region;
      if (vertexBody.projectId) {
        providerEntry.baseUrl = getVertexBaseUrl(vertexBody.projectId, vertexBody.region || 'us-central1');
      }
      // For Vertex, apiKey is not used — token is generated from service account
      providerEntry.authType = 'vertex-sa';
    }

    section.providers[key] = providerEntry;

    // Auto-populate per-purpose models from defaults
    const defaultModels = DEFAULT_PROVIDER_MODELS[key];
    if (defaultModels && !providerEntry.models) {
      providerEntry.models = { ...defaultModels };
    }

    // First provider becomes default
    if (!section.default || Object.keys(section.providers).length === 1) {
      section.default = key;
    }

    saveSection(category, section);
    if (category === 'models') syncModelsToAgent(ctx);

    json(res, { key, provider: section.providers[key] }, 201);
    return true;
  }

  // ── DISCOVER models ──
  const urlPath = url.split('?')[0];
  if (urlPath === `/api/integrations/${category}/models` && method === 'GET') {
    const fullUrl = new URL(req.url || '', 'http://localhost');
    const baseUrl = fullUrl.searchParams.get('baseUrl');
    const apiKey = fullUrl.searchParams.get('apiKey') || '';
    const providerType = fullUrl.searchParams.get('provider') || '';
    const providerKey = fullUrl.searchParams.get('providerKey') || '';

    let finalBaseUrl = baseUrl;
    if (!finalBaseUrl) {
      const typeToCheck = providerType || providerKey;
      if (typeToCheck === 'openai') finalBaseUrl = 'https://api.openai.com/v1';
      else if (typeToCheck === 'anthropic') finalBaseUrl = 'https://api.anthropic.com/v1';
      else if (typeToCheck === 'gemini') finalBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
      else if (typeToCheck === 'openrouter') finalBaseUrl = 'https://openrouter.ai/api/v1';
      else if (typeToCheck === 'groq') finalBaseUrl = 'https://api.groq.com/openai/v1';
      else if (typeToCheck === 'together') finalBaseUrl = 'https://api.together.xyz/v1';
    }

    if (!finalBaseUrl) {
      json(res, { models: [], error: 'baseUrl is required' });
      return true;
    }

    try {
      let resolvedKey = apiKey;
      if (!resolvedKey && providerKey) {
        const section = getSection(category);
        resolvedKey = section.providers?.[providerKey]?.apiKey as string || '';
      }

      if (providerType === 'ollama') {
        const ollamaHost = finalBaseUrl.replace(/\/v1\/?$/, '');
        let fetchHost = ollamaHost;
        if (fetchHost.includes('://localhost:')) fetchHost = fetchHost.replace('://localhost:', '://127.0.0.1:');
        
        const resp = await fetch(`${fetchHost}/api/tags`);
        if (resp.ok) {
          const data = await resp.json() as any;
          const allModels = (data.models || []) as any[];

          // Check capabilities for each model in parallel via /api/show
          const capChecks = await Promise.allSettled(
            allModels.map(async (m: any) => {
              const modelName = m.name || m.model;
              try {
                const showResp = await fetch(`${ollamaHost}/api/show`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: modelName }),
                });
                if (showResp.ok) {
                  const info = await showResp.json() as any;
                  return { model: m, capabilities: info.capabilities || [] };
                }
              } catch { /* ignore per-model failures */ }
              return { model: m, capabilities: [] as string[] };
            })
          );

          // Filter: only models that support tool calling (YOUBOT relies on tools)
          const models = capChecks
            .filter((r): r is PromiseFulfilledResult<{ model: any; capabilities: string[] }> =>
              r.status === 'fulfilled')
            .map(r => r.value)
            .filter(({ capabilities }) => capabilities.includes('tools'))
            .map(({ model: m, capabilities }) => {
              const name = m.name || m.model;
              const size = m.details?.parameter_size ? ` (${m.details.parameter_size})` : '';
              const vision = capabilities.includes('vision') ? ' 👁️' : '';
              return { id: name, name: `${name}${size}${vision}` };
            });

          json(res, { models });
          return true;
        }
      }

      const modelsUrl = finalBaseUrl.replace(/\/+$/, '') + '/models';
      let fetchUrl = modelsUrl;
      if (fetchUrl.includes('://localhost:')) fetchUrl = fetchUrl.replace('://localhost:', '://127.0.0.1:');

      const headers: Record<string, string> = {};
      if (resolvedKey) headers['Authorization'] = `Bearer ${resolvedKey}`;

      const resp = await fetch(fetchUrl, { headers });
      if (!resp.ok) {
        let errMsg = `Failed: ${resp.status} ${resp.statusText}`;
        try {
          const errData = await resp.json();
          if (errData.error && errData.error.message) errMsg = `Failed: ${resp.status} - ${errData.error.message}`;
          else if (errData.error) errMsg = `Failed: ${resp.status} - ${typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error)}`;
        } catch(e) {}
        json(res, { models: [], error: errMsg });
        return true;
      }
      const data = await resp.json() as { data?: Array<{ id: string }> };
      const models = (data.data || []).map((m: any) => ({ id: m.id, name: m.id }));
      json(res, { models });
    } catch (err: any) {
      json(res, { models: [], error: err.message });
    }
    return true;
  }

  // ── Routes with provider key ──
  const providerKey = parseProviderKey(url);
  if (!providerKey) return false;

  const section = getSection(category);
  if (!section.providers?.[providerKey]) {
    error(res, `Provider "${providerKey}" not found`, 404);
    return true;
  }

  // ── SET DEFAULT ──
  if (url.endsWith('/default') && method === 'PUT') {
    section.default = providerKey;
    saveSection(category, section);

    if (category === 'models') syncModelsToAgent(ctx);
    json(res, { success: true, default: providerKey });
    return true;
  }

  // ── TOGGLE enable/disable ──
  if (url.endsWith('/toggle') && method === 'PUT') {
    const provider = section.providers![providerKey];
    provider.enabled = provider.enabled === false ? true : false;
    saveSection(category, section);
    if (category === 'models') syncModelsToAgent(ctx);
    json(res, { success: true, enabled: provider.enabled });
    return true;
  }

  // ── UPDATE provider ──
  if (method === 'PUT' && !url.endsWith('/default') && !url.endsWith('/toggle')) {
    const body = await parseBody(req) as Partial<ProviderConfig>;
    const existing = section.providers![providerKey];

    if (body.baseUrl !== undefined) existing.baseUrl = body.baseUrl;
    if (body.apiKey !== undefined && body.apiKey !== '') existing.apiKey = body.apiKey;
    if (body.model !== undefined) existing.model = body.model;
    if (body.enabled !== undefined) existing.enabled = body.enabled;
    if (body.timeout !== undefined) existing.timeout = body.timeout;

    saveSection(category, section);
    if (category === 'models') syncModelsToAgent(ctx);
    json(res, { provider: existing });
    return true;
  }

  // ── DELETE provider ──
  if (method === 'DELETE') {
    const wasDefault = section.default === providerKey;
    delete section.providers![providerKey];

    // Reassign default
    if (wasDefault) {
      const remaining = Object.keys(section.providers || {});
      section.default = remaining[0] || '';
    }

    saveSection(category, section);
    if (category === 'models') syncModelsToAgent(ctx);
    json(res, { success: true });
    return true;
  }

  return false;
}

// ─── Sync Helpers ────────────────────────────────────────

export function syncModelsToAgent(ctx: ApiContext): void {
  if (!ctx.agentOrchestrator) return;
  const cfg = loadYoubotConfig();
  const section = cfg.capabilities?.models;
  if (!section?.providers) return;

  const defaultKey = section.default || Object.keys(section.providers)[0] || '';
  const defaultProvider = section.providers[defaultKey];

  if (defaultProvider) {
    const oldProviders = Object.entries(section.providers)
      .filter(([_, p]) => p.enabled !== false)
      .map(([key, p]) => ({
        id: key,
        name: key,
        provider: key as any,
        baseUrl: (p.baseUrl || '') as string,
        apiKey: (p.apiKey || '') as string,
        model: (p.model || '') as string,
        isDefault: key === defaultKey,
        models: (p.models || DEFAULT_PROVIDER_MODELS[key] || {}) as any,
        credentialSource: p.credentialSource === 'provider-access' ? 'provider-access' as const : undefined,
        runtimeProviderId: typeof p.runtimeProviderId === 'string' ? p.runtimeProviderId : undefined,
      }));

    ctx.agentOrchestrator.updateConfig({
      llmProviders: oldProviders,
      defaultLlmProviderId: defaultKey,
      llmBaseUrl: (defaultProvider.baseUrl || '') as string,
      llmModel: (defaultProvider.model || '') as string,
      llmApiKey: (defaultProvider.apiKey || '') as string,
      modelRouting: ((cfg as any).modelRouting || {}) as any,
    });
  }
}
