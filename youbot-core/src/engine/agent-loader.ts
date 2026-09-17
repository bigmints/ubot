/**
 * Agent Loader
 * 
 * Discovers and parses specialized agent definitions from <workspace>/agents/*.agent.yaml
 * Includes fallback logic for legacy .agent.md files.
 * When saving, legacy .md files are replaced by .yaml to prevent duplicates.
 */

import fs from 'fs';
import path from 'path';
import type { AgentDefinition } from './types.js';
import yaml from 'yaml';

/**
 * Normalise autonomyTier from various formats to the canonical 'T1'|'T2'|'T3' union.
 * Handles: numbers (1→'T1'), strings ('T2'→'T2', '2'→'T2'), undefined → undefined.
 */
function normaliseAutonomyTier(raw: unknown): AgentDefinition['autonomyTier'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase();
    if (upper === 'T1' || upper === 'T2' || upper === 'T3') return upper as AgentDefinition['autonomyTier'];
    // Try numeric string: '1' → 'T1'
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 3) return `T${n}` as AgentDefinition['autonomyTier'];
    return undefined;
  }
  if (typeof raw === 'number' && raw >= 1 && raw <= 3) {
    return `T${raw}` as AgentDefinition['autonomyTier'];
  }
  return undefined;
}

export function loadAgentDefinitions(workspacePath: string): AgentDefinition[] {
  const agentsDir = path.join(workspacePath, 'agents');
  if (!fs.existsSync(agentsDir)) {
    try {
      fs.mkdirSync(agentsDir, { recursive: true });
    } catch (err) {
      console.error(`[AgentLoader] Failed to create agents directory: ${agentsDir}`);
      return [];
    }
  }

  const agents: AgentDefinition[] = [];
  // Track IDs to avoid duplicates when both .yaml and .md exist for the same agent.
  // YAML takes precedence over .md.
  const seenIds = new Set<string>();

  try {
    const files = fs.readdirSync(agentsDir);
    
    // Sort so .yaml/.yml files come before .md — YAML takes priority
    const sorted = files.sort((a, b) => {
      const aIsYaml = a.endsWith('.agent.yaml') || a.endsWith('.agent.yml');
      const bIsYaml = b.endsWith('.agent.yaml') || b.endsWith('.agent.yml');
      if (aIsYaml && !bIsYaml) return -1;
      if (!aIsYaml && bIsYaml) return 1;
      return a.localeCompare(b);
    });

    for (const file of sorted) {
      const filePath = path.join(agentsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      if (file.endsWith('.agent.yaml') || file.endsWith('.agent.yml')) {
        const id = file.replace(/\.agent\.ya?ml$/, '');
        if (seenIds.has(id)) continue;
        const agent = parseAgentYaml(id, content);
        if (agent) {
          agents.push(agent);
          seenIds.add(id);
        }
      } else if (file.endsWith('.agent.md')) {
        const id = file.replace(/\.agent\.md$/, '');
        if (seenIds.has(id)) continue; // YAML version already loaded
        const agent = parseAgentMarkdown(id, content);
        if (agent) {
          agents.push(agent);
          seenIds.add(id);
        }
      }
    }
  } catch (err: any) {
    console.error(`[AgentLoader] Error loading agents: ${err.message}`);
  }
  
  // Resolve inheritance: merge allowedTools and capabilities from parent agents
  resolveInheritance(agents);
  
  return agents;
}

/**
 * Resolve inheritsFrom references by merging allowedTools and capabilities
 * from the parent agent. Child values are appended to (not overwritten by) parent values.
 */
function resolveInheritance(agents: AgentDefinition[]): void {
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const resolved = new Set<string>();

  for (const agent of agents) {
    if (!agent.inheritsFrom) continue;
    if (resolved.has(agent.id)) continue; // Already processed

    const parent = agentMap.get(agent.inheritsFrom);
    if (!parent) {
      console.warn(`[AgentLoader] Agent "${agent.id}" references unknown parent "${agent.inheritsFrom}" — skipping inheritance`);
      continue;
    }

    // Merge allowedTools: parent tools first, then agent-specific tools (deduplicated)
    const parentTools = parent.allowedTools || [];
    const childTools = agent.allowedTools || [];
    const mergedTools = [...new Set([...parentTools, ...childTools])];
    if (mergedTools.length > 0) {
      agent.allowedTools = mergedTools;
    }

    // Merge capabilities: parent capabilities first, then agent-specific (deduplicated)
    const parentCaps = parent.capabilities || [];
    const childCaps = agent.capabilities || [];
    const mergedCaps = [...new Set([...parentCaps, ...childCaps])];
    if (mergedCaps.length > 0) {
      agent.capabilities = mergedCaps;
    }

    resolved.add(agent.id);
    console.log(`[AgentLoader] Agent "${agent.id}" inherited from "${agent.inheritsFrom}" (${mergedTools.length} tools, ${mergedCaps.length} capabilities)`);
  }
}

function parseAgentYaml(id: string, content: string): AgentDefinition | null {
  try {
    const parsed = yaml.parse(content);
    return {
      id,
      name: parsed.name || id,
      description: parsed.description || '',
      systemPrompt: parsed.systemPrompt || parsed.instructions,
      allowedTools: parsed.allowedTools || parsed.tools, // Accept both, canonical is allowedTools
      model: parsed.model,
      temperature: parsed.temperature,
      autonomyTier: normaliseAutonomyTier(parsed.autonomyTier),
      capabilities: parsed.capabilities,
      skills: parsed.skills,
      persona: parsed.persona,
      workflows: parsed.workflows,
      fallbackAgent: parsed.fallbackAgent,
      errorPolicy: parsed.errorPolicy,
      maxIterations: parsed.maxIterations,
      inheritsFrom: parsed.inheritsFrom,
    };
  } catch (err: any) {
    console.error(`[AgentLoader] Failed to parse YAML for agent ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Basic parser for legacy .agent.md files
 */
function parseAgentMarkdown(id: string, content: string): AgentDefinition | null {
  const agent: AgentDefinition = {
    id,
    name: id,
    description: '',
  };

  const sections = content.split(/^#\s+/m);
  
  for (const section of sections) {
    if (!section.trim()) continue;
    
    const lines = section.split('\n');
    const title = lines[0].trim().toLowerCase();
    const body = lines.slice(1).join('\n').trim();
    
    if (title === 'identity' || title === 'name') {
      const nameMatch = body.match(/name:\s*(.+)/i);
      if (nameMatch) agent.name = nameMatch[1].trim();
      
      const descMatch = body.match(/description:\s*(.+)/i);
      if (descMatch) agent.description = descMatch[1].trim();
    } else if (title === 'tools' || title === 'allowed tools') {
      const toolLines = body.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
      agent.allowedTools = toolLines;
    } else if (title === 'system prompt' || title === 'instructions') {
      agent.systemPrompt = body;
    } else if (title === 'config' || title === 'settings') {
      const modelMatch = body.match(/model:\s*(.+)/i);
      if (modelMatch) agent.model = modelMatch[1].trim();
      
      const tempMatch = body.match(/temperature:\s*(.+)/i);
      if (tempMatch) agent.temperature = parseFloat(tempMatch[1]);

      const tierMatch = body.match(/autonomyTier:\s*(.+)/i);
      if (tierMatch) agent.autonomyTier = normaliseAutonomyTier(tierMatch[1].trim());
    }
  }

  return agent;
}

export function saveAgentYaml(workspacePath: string, agent: AgentDefinition): void {
  const agentsDir = path.join(workspacePath, 'agents');
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  // Remove legacy .md file if it exists to prevent duplicate loading
  const legacyMdPath = path.join(agentsDir, `${agent.id}.agent.md`);
  if (fs.existsSync(legacyMdPath)) {
    fs.unlinkSync(legacyMdPath);
    console.log(`[AgentLoader] Removed legacy .agent.md for ${agent.id} (migrated to YAML)`);
  }

  const filePath = path.join(agentsDir, `${agent.id}.agent.yaml`);
  const yamlObj: Record<string, unknown> = {
    name: agent.name,
    description: agent.description,
  };
  
  if (agent.systemPrompt) yamlObj.systemPrompt = agent.systemPrompt;
  if (agent.allowedTools) yamlObj.allowedTools = agent.allowedTools;
  if (agent.model) yamlObj.model = agent.model;
  if (agent.temperature !== undefined) yamlObj.temperature = agent.temperature;
  if (agent.autonomyTier) yamlObj.autonomyTier = agent.autonomyTier;
  if (agent.capabilities) yamlObj.capabilities = agent.capabilities;
  if (agent.skills) yamlObj.skills = agent.skills;
  if (agent.persona) yamlObj.persona = agent.persona;
  if (agent.workflows) yamlObj.workflows = agent.workflows;
  if (agent.fallbackAgent) yamlObj.fallbackAgent = agent.fallbackAgent;
  if (agent.errorPolicy) yamlObj.errorPolicy = agent.errorPolicy;
  if (agent.maxIterations) yamlObj.maxIterations = agent.maxIterations;
  if (agent.inheritsFrom) yamlObj.inheritsFrom = agent.inheritsFrom;

  const content = yaml.stringify(yamlObj);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[AgentLoader] Saved agent definition to ${filePath}`);
}
