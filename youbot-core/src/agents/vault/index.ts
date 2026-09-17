/**
 * Vault Agent Module
 * 
 * Encrypted secret storage and retrieval.
 */
import type { ToolModule } from '../../tools/types.js';
import vaultTools from './tools.js';

export const toolModules: ToolModule[] = [vaultTools];
