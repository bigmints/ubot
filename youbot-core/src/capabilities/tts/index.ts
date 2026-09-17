/**
 * TTS Capability — Auto-discovery entry point
 *
 * Exports the tool modules for the TTS capability.
 * Discovered automatically by the tool registry scanner.
 */

import ttsToolModule from './tools.js';

export const toolModules = [ttsToolModule];
