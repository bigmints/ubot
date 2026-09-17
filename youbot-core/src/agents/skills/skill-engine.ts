/**
 * Universal Skill Engine
 * 
 * Pipeline: Event → Trigger Match → Processor (LLM) → Outcome
 * 
 * Two-phase matching:
 *   Phase 1: Fast filters (contacts, groups, pattern) — no LLM cost
 *   Phase 2: LLM intent check (if skill has a condition) — cheap yes/no classification
 */

import type { Skill, SkillEvent, SkillRunResult, WorkflowStage } from './skill-types.js';
import type { SkillRepository } from './skill-repository.js';
import type { ConversationStore } from '../../memory/conversation.js';

/** The LLM generation function — injected from the agent orchestrator */
export type LLMGenerateFn = (systemPrompt: string, userMessage: string) => Promise<string>;

/** The agent chat function — runs a message through the full agent loop with tools */
export type AgentChatFn = (message: string, sessionId: string, source?: string, contactName?: string, skillContext?: string, isOwner?: boolean) => Promise<{
  response: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result?: string }>;
}>;

export interface SkillEngine {
  /** Process an event through the skill pipeline */
  processEvent(event: SkillEvent): Promise<SkillRunResult[]>;

  /** Run a specific skill with an event */
  runSkill(skillId: string, event: SkillEvent): Promise<SkillRunResult>;

  /** Get all skills */
  getSkills(): Skill[];

  /** Get a specific skill */
  getSkill(id: string): Skill | null;

  /** Save a new skill */
  saveSkill(skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>): Skill;

  /** Update a skill */
  updateSkill(id: string, updates: Partial<Skill>): Skill | null;

  /** Delete a skill */
  deleteSkill(id: string): boolean;

  /** Toggle skill enabled/disabled */
  toggleSkill(id: string, enabled: boolean): Skill | null;

  /** Phase 1: Fast filter match — no LLM cost */
  getMatchingSkills(event: SkillEvent): Skill[];

  /** Phase 2: LLM intent check for a single skill */
  checkCondition(skill: Skill, event: SkillEvent): Promise<boolean>;
}

export function createSkillEngine(
  repo: SkillRepository,
  llmGenerate: LLMGenerateFn,
  agentChat: AgentChatFn,
  conversationStore?: ConversationStore,
): SkillEngine {
  
  // ── Phase 1: Fast filter matching ────────────────────────

  function passesFilters(skill: Skill, event: SkillEvent): boolean {
    const filters = skill.trigger.filters;
    if (!filters) return true; // No filters = match everything

    // Source filter
    if (filters.source && event.source !== filters.source) {
      return false;
    }

    // Groups only
    const isGroup = (event.from || '').endsWith('@g.us') || 
      ((event.data?.rawJid as string) || '').includes('@g.us');
    if (filters.groupsOnly && !isGroup) {
      return false;
    }

    // DMs only (inverse of groupsOnly)
    if (filters.dmsOnly && isGroup) {
      return false;
    }

    // Group filter
    if (filters.groups && filters.groups.length > 0) {
      if (!isGroup) return false;
      const from = event.from || '';
      const matched = filters.groups.some(g => {
        const normalized = g.replace(/\D/g, '');
        return from.includes(normalized) || from === g;
      });
      if (!matched) return false;
    }

    // Contact filter
    // For group messages, check participant (actual sender) not the group JID
    if (filters.contacts && filters.contacts.length > 0) {
      const from = event.from || '';
      const participant = (event.data?.participant as string) || '';
      const matched = filters.contacts.some(c => {
        const normalized = c.replace(/\D/g, '');
        return from.includes(normalized) || participant.includes(normalized);
      });
      if (!matched) return false;
    }

    // Pattern filter
    if (filters.pattern) {
      try {
        const regex = new RegExp(filters.pattern, 'i');
        if (!regex.test(event.body || '')) return false;
      } catch {
        // Invalid regex — skip
      }
    }

    return true;
  }

  // ── Phase 2: LLM intent check ───────────────────────────

  async function checkCondition(skill: Skill, event: SkillEvent): Promise<boolean> {
    if (!skill.trigger.condition) return true; // No condition = always matches

    const prompt = `You are a message classifier. Decide if this event matches the condition.

Condition: "${skill.trigger.condition}"

Event:
- Source: ${event.source}
- Type: ${event.type}
- From: ${event.from || 'unknown'}
- Body: "${(event.body || '').slice(0, 500)}"

Does this event match the condition? Respond with ONLY "yes" or "no".`;

    try {
      const result = await llmGenerate(prompt, '');
      return result.trim().toLowerCase().startsWith('yes');
    } catch (err: any) {
      console.error(`[SkillEngine] Condition check failed for "${skill.name}":`, err.message);
      return false; // Fail closed
    }
  }

  // ── Variable Resolution ────────────────────────────────────

  function resolveVariables(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{(.+?)\}\}/g, (_, path) => {
      const keys = path.trim().split('.');
      let val: any = context;
      for (const k of keys) {
        val = val ? val[k] : undefined;
      }
      if (val === undefined) return `{{${path}}}`;
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });
  }

  function resolveToolArgs(
    args: Record<string, unknown>,
    context: Record<string, any>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        resolved[key] = resolveVariables(value, context);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  // ── Stage Execution ───────────────────────────────────────

  async function executeStage(
    stage: WorkflowStage,
    context: Record<string, any>,
    sessionId: string,
    source: string,
    contactName?: string,
    isOwner?: boolean,
  ): Promise<{ output: string; toolCalls: any[]; success: boolean; error?: string }> {
    const maxRetries = stage.retries ?? 0;
    let lastError = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[SkillEngine] Retrying stage "${stage.name}" (attempt ${attempt + 1}/${maxRetries + 1})`);
        }

        switch (stage.type) {
          case 'prompt': {
            if (!stage.instructions) return { output: '', toolCalls: [], success: true };
            const resolved = resolveVariables(stage.instructions, context);
            const result = await llmGenerate(resolved, '');
            return { output: result, toolCalls: [], success: true };
          }

          case 'tool': {
            if (!stage.tool) return { output: '', toolCalls: [], success: false, error: 'No tool specified' };
            const resolvedArgs = resolveToolArgs(stage.tool.arguments, context);
            const toolResult = await agentChat(
              `[STAGE: ${stage.name}] Call tool ${stage.tool.name} with ${JSON.stringify(resolvedArgs)}`,
              sessionId, source, contactName, undefined, isOwner,
            );
            return {
              output: toolResult.response,
              toolCalls: toolResult.toolCalls,
              success: true,
            };
          }

          case 'condition': {
            if (!stage.condition || !stage.stages?.length) {
              return { output: '', toolCalls: [], success: true };
            }
            const resolvedCondition = resolveVariables(stage.condition, context);
            const passes = await checkConditionText(resolvedCondition, context);
            if (!passes) {
              console.log(`[SkillEngine] Condition "${stage.name}" not met — skipping sub-stages`);
              return { output: '', toolCalls: [], success: true };
            }
            // Run sub-stages sequentially
            return await executeStages(stage.stages, context, sessionId, source, contactName, isOwner);
          }

          case 'parallel': {
            if (!stage.stages?.length) {
              return { output: '', toolCalls: [], success: true };
            }
            console.log(`[SkillEngine] Running ${stage.stages.length} stages in parallel`);
            const results = await Promise.all(
              stage.stages.map(async (subStage) => {
                const subResult = await executeStage(subStage, { ...context }, sessionId, source, contactName, isOwner);
                if (subStage.outputKey) {
                  context[subStage.outputKey] = subResult.output;
                }
                return subResult;
              }),
            );
            const combined = results.map(r => r.output).filter(Boolean).join('\n');
            const allToolCalls = results.flatMap(r => r.toolCalls);
            const allSuccess = results.every(r => r.success);
            return { output: combined, toolCalls: allToolCalls, success: allSuccess };
          }

          default:
            return { output: '', toolCalls: [], success: false, error: `Unknown stage type: ${stage.type}` };
        }
      } catch (err: any) {
        lastError = err.message || 'Stage execution failed';
        if (attempt < maxRetries) continue;
      }
    }

    // All retries exhausted
    return { output: '', toolCalls: [], success: false, error: lastError };
  }

  /** Check a freeform condition using the LLM */
  async function checkConditionText(condition: string, context: Record<string, any>): Promise<boolean> {
    const prompt = `You are a condition evaluator. Given this context and condition, respond ONLY "yes" or "no".

Context:
${JSON.stringify(context.event || {}, null, 2)}

Condition: "${condition}"

Answer:`;
    try {
      const result = await llmGenerate(prompt, '');
      return result.trim().toLowerCase().startsWith('yes');
    } catch {
      return false;
    }
  }

  /** Execute a sequence of stages, accumulating context */
  async function executeStages(
    stages: WorkflowStage[],
    context: Record<string, any>,
    sessionId: string,
    source: string,
    contactName?: string,
    isOwner?: boolean,
  ): Promise<{ output: string; toolCalls: any[]; success: boolean; error?: string }> {
    let finalOutput = '';
    let allToolCalls: any[] = [];

    for (const stage of stages) {
      console.log(`[SkillEngine] Running stage: ${stage.name} (${stage.type})`);
      const result = await executeStage(stage, context, sessionId, source, contactName, isOwner);

      if (stage.outputKey) {
        context[stage.outputKey] = result.output;
      }
      finalOutput = result.output;
      allToolCalls = [...allToolCalls, ...result.toolCalls];

      if (!result.success) {
        const errorAction = stage.onError || 'abort';
        console.error(`[SkillEngine] Stage "${stage.name}" failed: ${result.error}`);
        if (errorAction === 'abort') {
          return { output: finalOutput, toolCalls: allToolCalls, success: false, error: result.error };
        }
        // 'skip' — continue to next stage
        console.log(`[SkillEngine] Skipping failed stage "${stage.name}" (onError=skip)`);
      }
    }

    return { output: finalOutput, toolCalls: allToolCalls, success: true };
  }

  // ── Skill Execution ───────────────────────────────────────

  async function executeSkill(skill: Skill, event: SkillEvent): Promise<SkillRunResult> {
    const start = Date.now();

    if (!skill.enabled) {
      return {
        skillId: skill.id,
        success: false,
        response: '',
        toolCalls: [],
        duration: Date.now() - start,
        error: `Skill "${skill.name}" is disabled`,
      };
    }

    try {
      // Session ID must match the convention in handler.ts resolveSessionId:
      // WhatsApp: raw JID, Telegram: telegram:chatId, others: channel:senderId
      const sessionId = event.source === 'whatsapp'
        ? (event.from || `skill-${skill.id}-${Date.now()}`)
        : event.source
          ? `${event.source}:${event.from}`
          : (event.from || `skill-${skill.id}-${Date.now()}`);
      
      const contactName = (event.data?.senderName as string) || event.from || undefined;

      // Build pipeline context from the event
      const pipelineContext: Record<string, any> = {
        event: {
          source: event.source,
          from: contactName || event.from,
          body: event.body,
          data: event.data,
        }
      };

      const isOwner = event.data?.isOwner as boolean | undefined;

      if (skill.processor.stages && skill.processor.stages.length > 0) {
        // ─── Stage-based pipeline execution ──────────────────────────────────
        const result = await executeStages(
          skill.processor.stages, pipelineContext, sessionId, event.source, contactName, isOwner,
        );
        return {
          skillId: skill.id,
          success: result.success,
          response: result.output,
          toolCalls: result.toolCalls,
          duration: Date.now() - start,
          error: result.error,
        };
      } else {
        // ─── Legacy single-processor execution ──────────────────────────────
        const senderDisplay = contactName || event.from || 'unknown';
        
        const channelLabel = event.source === 'web' ? 'Command Center' : event.source || 'messaging';

        // Fetch owner's recent messages for context (so bot skills know what the owner asked for)
        let ownerContextBlock = '';
        if (conversationStore) {
          try {
            const ownerHistory = await conversationStore.getHistory('web-console', 10);
            const ownerMsgs = ownerHistory
              .filter((m: any) => m.role === 'user')
              .slice(-5)
              .map((m: any) => `  - "${m.content.slice(0, 200)}"`);
            if (ownerMsgs.length > 0) {
              ownerContextBlock = [
                ``,
                `OWNER'S RECENT COMMANDS (from their control session — use this to understand their intent):`,
                ...ownerMsgs,
                ``,
              ].join('\n');
            }
          } catch { /* ignore */ }
        }

        const skillContext = [
          `[SKILL: ${skill.name}] Respond to ${senderDisplay}'s ${channelLabel} message.`,
          `Your ENTIRE response will be sent back to them via ${channelLabel}.`,
          ownerContextBlock,
          `Skill instructions: ${skill.processor.instructions}`,
          ``,
          `RULES:`,
          `- USE tools first if the request needs information you don't have (search_messages, get_contacts, web_search, etc.)`,
          `- After using tools, compose the final reply with the actual information found`,
          `- NEVER say "I'll check" or "I'll confirm" or "let me get back to you" — DO the action RIGHT NOW using tools`,
          `- If you need owner approval, call ask_owner IMMEDIATELY in this turn — don't promise to do it later`,
          `- If you found information via tools, GIVE THE ANSWER — don't say "I found it, I'll let you know"`,
          `- COMPLETE every action in this turn. There is no "later" — this is your only chance to act`,
          `- NEVER claim you did something unless you actually called a tool and got a result in THIS conversation`,
          `- Your own previous messages saying "I'll check" or "I'll confirm" do NOT mean you actually did it — if asked, call the tool again`,
          `- If you're unsure whether you completed an action, call the tool to verify — don't guess or assume`,
          `- Write the reply message directly — not a description of what you'll do`,
          `- Do NOT use send_message. Follow visitor security policy.`,
        ].join('\n');

        // The actual user message is just what the visitor said —
        // this keeps conversation history clean and contextual
        const visitorMessage = event.body || '(no body)';

        const result = await agentChat(
          visitorMessage,
          sessionId,
          event.source,
          contactName,
          skillContext,
          isOwner,
        );
        return {
          skillId: skill.id,
          success: true,
          response: result.response,
          toolCalls: result.toolCalls,
          duration: Date.now() - start,
        };
      }
    } catch (err: any) {
      return {
        skillId: skill.id,
        success: false,
        response: '',
        toolCalls: [],
        duration: Date.now() - start,
        error: err.message || 'Skill execution failed',
      };
    }
  }

  return {
    async processEvent(event: SkillEvent): Promise<SkillRunResult[]> {
      const eventKey = `${event.source}:${event.type}`;
      console.log(`[SkillEngine] Processing event: ${eventKey}`);

      // Phase 1: Fast filter
      const candidates = this.getMatchingSkills(event);
      console.log(`[SkillEngine] Phase 1: ${candidates.length} candidates after fast filter`);

      if (candidates.length === 0) return [];

      // Phase 2: LLM intent check (only for skills with conditions)
      const matched: Skill[] = [];
      for (const skill of candidates) {
        if (skill.trigger.condition) {
          const passes = await checkCondition(skill, event);
          if (passes) {
            console.log(`[SkillEngine] Phase 2: "${skill.name}" condition matched`);
            matched.push(skill);
          } else {
            console.log(`[SkillEngine] Phase 2: "${skill.name}" condition NOT matched`);
          }
        } else {
          matched.push(skill); // No condition = always matches if filters passed
        }
      }

      console.log(`[SkillEngine] ${matched.length} skills matched, executing...`);

      // Execute all matched skills
      const results: SkillRunResult[] = [];
      for (const skill of matched) {
        console.log(`[SkillEngine] Executing "${skill.name}"...`);
        const result = await executeSkill(skill, event);
      console.log(`[SkillEngine] Skill execution ${result.success ? 'succeeded' : 'failed'}`);
        results.push(result);
      }

      return results;
    },

    async runSkill(skillId: string, event: SkillEvent): Promise<SkillRunResult> {
      const skill = repo.getById(skillId);
      if (!skill) {
        return {
          skillId,
          success: false,
          response: '',
          toolCalls: [],
          duration: 0,
          error: `Skill not found: ${skillId}`,
        };
      }
      return executeSkill(skill, event);
    },

    getSkills() {
      return repo.getAll();
    },

    getSkill(id: string) {
      return repo.getById(id);
    },

    saveSkill(skill) {
      return repo.create(skill);
    },

    updateSkill(id, updates) {
      return repo.update(id, updates);
    },

    deleteSkill(id) {
      return repo.delete(id);
    },

    toggleSkill(id, enabled) {
      return repo.toggleEnabled(id, enabled);
    },

    getMatchingSkills(event: SkillEvent): Skill[] {
      const eventKey = `${event.source}:${event.type}`;
      const candidates = repo.getByEventType(eventKey);
      return candidates.filter(skill => passesFilters(skill, event));
    },

    checkCondition,
  };
}
