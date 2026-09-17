/**
 * Transcription Tool Module — Provider-Based
 *
 * Provides a `transcribe_audio` tool for the agent to transcribe audio files.
 * Uses the configured LLM provider's /v1/audio/transcriptions endpoint.
 * Falls back to local whisper.cpp if provider is unavailable.
 *
 * Auto-discovered by the tool registry (src/tools/registry.ts).
 */

import type { ToolModule, ToolRegistry, ToolContext } from '../../tools/types.js';
import { toolResult, safeExecutor } from '../../tools/types.js';
import { transcribeAudio } from './service.js';
import { resolveRoutedHttpModel } from '../../integrations/model-routing.js';

const transcriptionToolModule: ToolModule = {
  name: 'transcription',

  tools: [
    {
      name: 'transcribe_audio',
      description:
        'Transcribe an audio file to text using AI speech-to-text. ' +
        'Supports WAV, OGG, MP3, M4A, WEBM and other audio formats. ' +
        'Use this to transcribe voice messages, audio recordings, or any sound file. ' +
        'Works with files saved to disk — pass the absolute file path.',
      parameters: [
        {
          name: 'file_path',
          type: 'string',
          description: 'Absolute path to the audio file to transcribe.',
          required: true,
        },
        {
          name: 'language',
          type: 'string',
          description: 'Language hint (e.g. "en", "ar", "auto"). Default: "auto".',
          required: false,
        },
      ],
    },
  ],

  register(registry: ToolRegistry, ctx: ToolContext) {
    registry.register(
      'transcribe_audio',
      safeExecutor('transcribe_audio', async (args) => {
        const filePath = String(args.file_path || '').trim();
        const language = String(args.language || 'auto');

        if (!filePath) throw new Error('file_path is required');

        // Pull provider config from agent context
        const agent = ctx.getAgent();
        const config = agent?.getConfig?.() as any;
        
        const provider = config
          ? await resolveRoutedHttpModel(config, 'transcription', 'whisper-1')
          : undefined;

        const result = await transcribeAudio(filePath, {
          language,
          providerBaseUrl: provider?.baseUrl,
          providerApiKey: provider?.apiKey,
          providerModelId: provider?.modelId,
          providerHeaders: provider?.headers,
        });

        return JSON.stringify({
          text: result.text,
          language: result.language,
          ...(result.duration ? { duration_seconds: result.duration } : {}),
        });
      }),
    );
  },
};

export const toolModules: ToolModule[] = [transcriptionToolModule];
export default transcriptionToolModule;
