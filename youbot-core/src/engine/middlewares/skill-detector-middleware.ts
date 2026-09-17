/**
 * Skill Detector Middleware
 * 
 * Monitors successful multi-tool workflows and suggests saving them as skills.
 */

import { log } from '../../logger/ring-buffer.js';
import type { AgentMiddleware, MiddlewareContext } from '../middleware.js';
import type { ToolExecutionResult } from '../types.js';

export interface SkillSuggestion {
  name: string;
  description: string;
  toolSequence: string[];
  suggestedPrompt: string;
}

const pendingSuggestions = new Map<string, SkillSuggestion>();
const shownOffers = new Set<string>();

export class SkillDetectorMiddleware implements AgentMiddleware {
  name = 'SkillDetectorMiddleware';

  async beforeTurn(ctx: MiddlewareContext): Promise<void> {
    // If we have a pending suggestion for this session, inject it into the system prompt
    const suggestion = pendingSuggestions.get(ctx.sessionId);
    if (suggestion && !shownOffers.has(ctx.sessionId)) {
      // We don't modify ctx here because middleware beforeTurn runs before buildMessages
      // Instead, the orchestrator will check this map (or we could use a different hook)
    }
  }

  async afterTurn(ctx: { iterations: number; toolResults: ToolExecutionResult[]; sessionId: string }): Promise<void> {
    const { toolResults, sessionId } = ctx;
    
    // Detection criteria:
    // 1. 4+ tool calls
    // 2. All succeeded
    // 3. 2+ unique tools
    if (toolResults.length < 4) return;
    
    const allSucceeded = toolResults.every((r: ToolExecutionResult) => r.success);
    if (!allSucceeded) return;

    const uniqueTools = new Set(toolResults.map((r: ToolExecutionResult) => r.toolName));
    if (uniqueTools.size < 2) return;

    // Detect successful workflow
    log.info('SkillDetector', `Detected potential skill in session ${sessionId} (${toolResults.length} tools)`);

    const toolSequence = toolResults.map((r: ToolExecutionResult) => r.toolName);
    const name = `Workflow ${toolSequence[0]}...`;
    const description = `Automated workflow using ${Array.from(uniqueTools).join(', ')}`;
    
    const suggestion: SkillSuggestion = {
      name,
      description,
      toolSequence,
      suggestedPrompt: `Perform the workflow: ${description}`
    };

    pendingSuggestions.set(sessionId, suggestion);
    shownOffers.delete(sessionId); // Reset so it shows again
  }

  static getPendingSuggestion(sessionId: string): SkillSuggestion | null {
    return pendingSuggestions.get(sessionId) || null;
  }

  static clearSuggestion(sessionId: string): void {
    pendingSuggestions.delete(sessionId);
    shownOffers.delete(sessionId);
  }

  static markAsShown(sessionId: string): void {
    shownOffers.add(sessionId);
  }
}
