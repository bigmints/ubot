/**
 * Skills Agent Module
 * 
 * Skill engine, event bus, and skill management.
 */
import type { ToolModule } from '../../tools/types.js';
import skillsTools from './tools.js';

export const toolModules: ToolModule[] = [skillsTools];
