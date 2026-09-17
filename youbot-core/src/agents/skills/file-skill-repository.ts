/**
 * File-Based Skill Repository
 *
 * Stores skills as markdown files with YAML frontmatter:
 *
 *   workspace/skills/
 *     daily-brief/
 *       SKILL.md
 *     linkedin-checker/
 *       SKILL.md
 *
 * Format:
 *   ---
 *   name: daily_brief
 *   description: Send a daily morning brief
 *   triggers: [web:message, scheduler:task]
 *   condition: when the owner asks for a morning brief
 *   outcome: reply
 *   tools: [web_search, web_fetch, send_message]
 *   enabled: true
 *   ---
 *   # Daily Brief
 *
 *   When triggered, search for top news...
 *
 * The markdown body IS the processor instructions.
 * No database needed — skills are simple files you can edit, git-track, and share.
 *
 * Storage is abstracted via WorkspaceProvider so skills can live on local disk,
 * GCS, or any other backend without changing this code.
 */

import type { Skill, SkillTrigger, SkillProcessor, SkillOutcome } from './skill-types.js';
import type { SkillRepository } from './skill-repository.js';
import type { WorkspaceProvider } from '../../data/workspace-provider.js';

// ─── Frontmatter Parsing ─────────────────────────────────

interface SkillFrontmatter {
  name?: string;
  description?: string;
  triggers?: string[];
  condition?: string;
  outcome?: string;
  target?: string;
  channel?: string;
  tools?: string[];
  enabled?: boolean;
  system?: boolean;
  filters?: {
    contacts?: string[];
    groups?: string[];
    groupsOnly?: boolean;
    dmsOnly?: boolean;
    source?: string;
    pattern?: string;
  };
}

function parseFrontmatter(content: string): { meta: SkillFrontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].trim();

  // Simple YAML parser for flat keys + arrays
  const meta: Record<string, any> = {};
  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^\s*(\w+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    let val: any = rawVal.trim();

    // Parse arrays: [item1, item2] or []
    const arrMatch = val.match(/^\[(.*)\]$/);
    if (arrMatch) {
      if (arrMatch[1].trim() === '') {
        val = [];
      } else {
        val = arrMatch[1].split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
      }
    }
    // Parse booleans
    else if (val === 'true') val = true;
    else if (val === 'false') val = false;
    // Strip quotes
    else {
      val = val.replace(/^['"]|['"]$/g, '');
    }

    meta[key] = val;
  }

  return { meta: meta as SkillFrontmatter, body };
}

function toFrontmatter(skill: Skill): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);

  if (skill.trigger.events.length > 0) {
    lines.push(`triggers: [${skill.trigger.events.join(', ')}]`);
  }
  if (skill.trigger.condition) {
    lines.push(`condition: ${skill.trigger.condition}`);
  }
  if (skill.trigger.filters) {
    const f = skill.trigger.filters;
    if (f.contacts?.length) lines.push(`filter_contacts: [${f.contacts.join(', ')}]`);
    if (f.groups?.length) lines.push(`filter_groups: [${f.groups.join(', ')}]`);
    if (f.groupsOnly) lines.push(`filter_groups_only: true`);
    if (f.dmsOnly) lines.push(`filter_dms_only: true`);
    if (f.source) lines.push(`filter_source: ${f.source}`);
    if (f.pattern) lines.push(`filter_pattern: ${f.pattern}`);
  }

  lines.push(`outcome: ${skill.outcome.action}`);
  if (skill.outcome.target) lines.push(`target: ${skill.outcome.target}`);
  if (skill.outcome.channel) lines.push(`channel: ${skill.outcome.channel}`);

  if (skill.processor.tools?.length) {
    lines.push(`tools: [${skill.processor.tools.join(', ')}]`);
  }
  lines.push(`enabled: ${skill.enabled}`);
  if (skill.system) lines.push(`system: true`);
  lines.push('---');

  return lines.join('\n');
}

// ─── Workspace ↔ Skill Conversion ─────────────────────────

function readSkill(workspace: WorkspaceProvider, skillsPrefix: string, skillId: string): Skill | null {
  const skillPath = `${skillsPrefix}/${skillId}/SKILL.md`;
  const content = workspace.readFile(skillPath);
  if (!content) return null;

  const { meta, body } = parseFrontmatter(content);

  const trigger: SkillTrigger = {
    events: meta.triggers || ['manual:run'],
    condition: meta.condition,
    filters: {},
  };
  if (meta.filters) trigger.filters = meta.filters;
  // Handle flat filter_ keys
  if ((meta as any).filter_contacts) trigger.filters!.contacts = (meta as any).filter_contacts;
  if ((meta as any).filter_groups) trigger.filters!.groups = (meta as any).filter_groups;
  if ((meta as any).filter_groups_only) trigger.filters!.groupsOnly = true;
  if ((meta as any).filter_dms_only) trigger.filters!.dmsOnly = true;
  if ((meta as any).filter_source) trigger.filters!.source = (meta as any).filter_source;
  if ((meta as any).filter_pattern) trigger.filters!.pattern = (meta as any).filter_pattern;

  const processor: SkillProcessor = {
    instructions: body,
    tools: meta.tools,
  };

  const outcome: SkillOutcome = {
    action: (meta.outcome as any) || 'reply',
    target: meta.target,
    channel: meta.channel,
  };

  // Without direct stat access, use current time as fallback
  // File-based timestamps are a local-only convenience
  const now = new Date();

  return {
    id: skillId,
    name: meta.name || skillId,
    description: meta.description || '',
    trigger,
    processor,
    outcome,
    enabled: meta.enabled !== false,
    system: meta.system === true,
    createdAt: now,
    updatedAt: now,
  };
}

function writeSkill(workspace: WorkspaceProvider, skillsPrefix: string, skill: Skill): void {
  const slug = skill.id || slugify(skill.name);
  const frontmatter = toFrontmatter(skill);
  const content = `${frontmatter}\n\n${skill.processor.instructions}\n`;
  workspace.writeFile(`${skillsPrefix}/${slug}/SKILL.md`, content);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ─── File-Based Repository ───────────────────────────────

/**
 * Create a file-based skill repository.
 *
 * @param workspace - The workspace provider (local fs, GCS, etc.)
 * @param skillsPrefix - Relative path within workspace where skills live (default: 'skills')
 */
export function createFileSkillRepository(workspace: WorkspaceProvider, skillsPrefix: string = 'skills'): SkillRepository {
  function loadAll(): Skill[] {
    const entries = workspace.listDir(skillsPrefix);
    const skills: Skill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const skill = readSkill(workspace, skillsPrefix, entry.name);
      if (skill) skills.push(skill);
    }
    return skills;
  }

  return {
    create(data) {
      const id = slugify(data.name);
      const skill: Skill = {
        ...data,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      writeSkill(workspace, skillsPrefix, skill);
      return skill;
    },

    getById(id) {
      return readSkill(workspace, skillsPrefix, id);
    },

    getAll() {
      return loadAll().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    getEnabled() {
      return loadAll().filter(s => s.enabled).sort((a, b) => a.name.localeCompare(b.name));
    },

    getByEventType(eventKey: string) {
      const [eventSource, eventType] = eventKey.split(':');
      return this.getEnabled().filter(skill =>
        skill.trigger.events.some(e => {
          // Exact match (e.g. 'whatsapp:message' === 'whatsapp:message')
          if (e === eventKey) return true;
          // Wildcard matches
          if (e === '*:*') return true;
          if (e === `${eventSource}:*`) return true;
          // Bare event name (e.g. 'message' matches 'whatsapp:message', 'telegram:message', etc.)
          if (!e.includes(':') && e === eventType) return true;
          return false;
        })
      );
    },

    update(id, updates) {
      const existing = this.getById(id);
      if (!existing) return null;

      const updated: Skill = {
        ...existing,
        ...updates,
        id, // keep original ID
        updatedAt: new Date(),
      };

      // If trigger/processor/outcome are partial, merge them
      if (updates.trigger) updated.trigger = { ...existing.trigger, ...updates.trigger };
      if (updates.processor) updated.processor = { ...existing.processor, ...updates.processor };
      if (updates.outcome) updated.outcome = { ...existing.outcome, ...updates.outcome };

      writeSkill(workspace, skillsPrefix, updated);
      return updated;
    },

    delete(id) {
      // Prevent deletion of system skills
      const skill = this.getById(id);
      if (skill?.system) return false;
      return workspace.deleteDir(`${skillsPrefix}/${id}`);
    },

    toggleEnabled(id, enabled) {
      return this.update(id, { enabled });
    },

    /** The directory where skills are stored */
    get dir() { return `${workspace.rootPath}/${skillsPrefix}`; },

    /** Get raw SKILL.md content for a skill */
    getRaw(id: string): string | null {
      return workspace.readFile(`${skillsPrefix}/${id}/SKILL.md`);
    },

    /** Save raw SKILL.md content and return the parsed skill (or null on parse failure) */
    saveRaw(id: string, content: string): Skill | null {
      workspace.writeFile(`${skillsPrefix}/${id}/SKILL.md`, content);
      return readSkill(workspace, skillsPrefix, id);
    },
  };
}
