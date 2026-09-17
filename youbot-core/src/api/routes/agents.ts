/**
 * Agents API Routes
 * 
 * REST API for managing specialized multi-agent profiles (Nexus, Coder, etc.)
 */
import type { RouteHandler } from '../context.js';
import { json, parseBody, error as apiError } from '../context.js';
import { crewRegistry } from '../../engine/crew-registry.js';
import { saveAgentYaml } from '../../engine/agent-loader.js';
import type { AgentDefinition } from '../../engine/types.js';

/**
 * Normalise autonomyTier from a request body to the canonical string union.
 * Handles numbers (1→'T1'), strings ('T2', '2'), etc.
 */
function normaliseTierInput(raw: unknown): AgentDefinition['autonomyTier'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase();
    if (upper === 'T1' || upper === 'T2' || upper === 'T3') return upper as AgentDefinition['autonomyTier'];
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 3) return `T${n}` as AgentDefinition['autonomyTier'];
    return undefined;
  }
  if (typeof raw === 'number' && raw >= 1 && raw <= 3) {
    return `T${raw}` as AgentDefinition['autonomyTier'];
  }
  return undefined;
}

export const handleAgentsRoutes: RouteHandler = async (req, res, url, method, ctx) => {
  // Strip query string for consistent matching
  const [path] = url.split('?');

  // GET /api/agents — list all agents
  if (path === '/api/agents' && method === 'GET') {
    try {
      const agents = crewRegistry.listAgents();
      console.log('[DEBUG] GET /api/agents -> Returning', agents.length, 'agents. Registry details:', crewRegistry);
      json(res, { agents });
    } catch (err: any) {
      apiError(res, err.message, 500);
    }
    return true;
  }

  // Match /api/agents/:id
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch) {
    const agentId = decodeURIComponent(agentMatch[1]);

    // GET /api/agents/:id
    if (method === 'GET') {
      const agent = crewRegistry.getAgent(agentId);
      if (!agent) {
        apiError(res, 'Agent not found', 404);
        return true;
      }
      json(res, { agent });
      return true;
    }

    // PUT /api/agents/:id
    if (method === 'PUT') {
      if (!ctx.workspacePath) {
        apiError(res, 'Workspace path not initialized', 500);
        return true;
      }

      try {
        const body = await parseBody(req) as Record<string, unknown>;
        
        // Validate required fields
        if (!body.name || typeof body.name !== 'string') {
          apiError(res, 'Missing required field: name', 400);
          return true;
        }
        if (!body.description || typeof body.description !== 'string') {
          apiError(res, 'Missing required field: description', 400);
          return true;
        }

        const updatedAgent: AgentDefinition = {
          id: agentId,
          name: body.name as string,
          description: body.description as string,
          systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
          allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools : undefined,
          model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
          temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
          autonomyTier: normaliseTierInput(body.autonomyTier),
          capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
          skills: Array.isArray(body.skills) ? body.skills : undefined,
          persona: typeof body.persona === 'object' && body.persona ? body.persona as AgentDefinition['persona'] : undefined,
          workflows: Array.isArray(body.workflows) ? body.workflows : undefined,
        };

        // Save to disk (also cleans up legacy .md files)
        saveAgentYaml(ctx.workspacePath, updatedAgent);

        // Hot-reload the registry
        crewRegistry.reloadAgents();

        json(res, { agent: crewRegistry.getAgent(agentId) });
      } catch (err: any) {
        apiError(res, err.message, 500);
      }
      return true;
    }
  }

  return false;
};
