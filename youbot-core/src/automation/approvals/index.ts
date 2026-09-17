/**
 * Approvals Automation Module
 * 
 * Pending approval management for gated actions.
 */
import type { ToolModule } from '../../tools/types.js';
import approvalsTools from './tools.js';

export const toolModules: ToolModule[] = [approvalsTools];
