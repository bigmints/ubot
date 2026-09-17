/**
 * Follow-Ups Automation Module
 *
 * Auto-discovered tool module for conversation continuity.
 * Provides tools for scheduling, managing, and tracking follow-ups
 * to ensure every conversation reaches closure.
 */

import type { ToolModule } from '../../tools/types.js';
import followupTools from './tools.js';

/** Auto-discovered tool modules for this capability */
export const toolModules: ToolModule[] = [followupTools];

export { startFollowUpChecker } from './checker.js';
