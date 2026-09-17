/**
 * TTS Tool Module — Provider-Based
 *
 * Converts text to speech using the configured LLM provider's
 * OpenAI-compatible /v1/audio/speech endpoint.
 *
 * Provider priority:
 *   1. Configured LLM provider (OpenAI, Gemini, etc.) via /v1/audio/speech
 *   2. macOS `say` + `afconvert` as a zero-config local fallback
 *
 * Piper-tts is NOT used. All TTS goes through the model provider.
 *
 * Tools:
 *   generate_audio  — synthesize speech, returns WAV buffer path
 *   send_audio      — synthesize and deliver as a voice note to a contact
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../../tools/types.js';
import { resolveRoutedHttpModel } from '../../integrations/model-routing.js';

export const TTS_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_audio',
    description:
      'Convert text to speech using the configured AI model provider. ' +
      'Use when the user says "read this aloud", "generate a voice note", ' +
      '"turn this into audio", or "speak this text". ' +
      'Returns the path to the generated WAV file for playback or forwarding.',
    parameters: [
      {
        name: 'text',
        type: 'string',
        description: 'The text to convert to speech. Markdown formatting is cleaned automatically.',
        required: true,
      },
      {
        name: 'voice',
        type: 'string',
        description: 'Voice preset: "alloy", "echo", "fable", "onyx", "nova", "shimmer" (provider-dependent). Default: "alloy".',
        required: false,
      },
      {
        name: 'speed',
        type: 'number',
        description: 'Speaking speed (0.25–4.0, default 1.0).',
        required: false,
      },
    ],
  },
  {
    name: 'send_audio',
    description:
      'Convert text to speech and send it as a voice note to a contact on WhatsApp or Telegram. ' +
      'Use when the user says "send a voice note to X", "leave an audio message for X", ' +
      'or "send this as audio". When replying to the current user with voice, pass their session/contact ID to "to".',
    parameters: [
      {
        name: 'text',
        type: 'string',
        description: 'The text to synthesize and send as a voice note.',
        required: true,
      },
      {
        name: 'to',
        type: 'string',
        description: 'Recipient phone number with country code (e.g. +971501234567) or contact ID.',
        required: true,
      },
      {
        name: 'channel',
        type: 'string',
        description: 'Messaging channel: "whatsapp" or "telegram". Defaults to the connected channel.',
        required: false,
      },
      {
        name: 'voice',
        type: 'string',
        description: 'Voice preset (alloy, echo, fable, onyx, nova, shimmer). Default: "alloy".',
        required: false,
      },
    ],
  },
];

// ── Text cleaner ────────────────────────────────────────────

function cleanForTts(text: string, maxLen = 2000): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// ── Core synthesis ──────────────────────────────────────────

/**
 * Synthesize text → WAV Buffer.
 * Tries the configured LLM provider's /v1/audio/speech first.
 * Falls back to macOS say+afconvert if provider doesn't support TTS.
 */
async function synthesize(
  text: string,
  ctx: ToolContext,
  voice = 'alloy',
  speed = 1.0,
): Promise<Buffer> {
  // ── 1. Provider TTS (model-based) ──────────────────────
  const agent = ctx.getAgent();
  const config = agent?.getConfig?.() as any;
  const provider = config
    ? await resolveRoutedHttpModel(config, 'tts', 'tts-1')
    : undefined;

  if (provider?.baseUrl) {
    try {
      let baseUrl = String(provider.baseUrl).replace(/\/+$/, '');
      // Normalise: strip /openai suffix, ensure /v1
      baseUrl = baseUrl.replace(/\/openai\/?$/, '');
      if (!baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
      // IPv6 localhost fix
      if (baseUrl.includes('://localhost:')) baseUrl = baseUrl.replace('://localhost:', '://127.0.0.1:');

      const ttsUrl = `${baseUrl}/audio/speech`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(provider.headers ?? {}),
      };
      if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

      const ttsRes = await fetch(ttsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.modelId,
          input: text,
          voice,
          speed,
          response_format: 'wav',
        }),
      });

      if (ttsRes.ok) {
        return Buffer.from(await ttsRes.arrayBuffer());
      }

      await ttsRes.body?.cancel().catch(() => undefined);
      console.warn(`[TTS] Provider request failed with status ${ttsRes.status}; falling back to system TTS`);
    } catch (err: any) {
      console.warn(`[TTS] Provider error: ${err.message} — falling back to system TTS`);
    }
  }

  // ── 2. macOS say + afconvert fallback ──────────────────
  const { exec } = await import('child_process');
  const { writeFile, readFile, unlink } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { randomUUID } = await import('crypto');

  const id = randomUUID();
  const txtFile = join(tmpdir(), `youbot-tts-${id}.txt`);
  const aiffFile = join(tmpdir(), `youbot-tts-${id}.aiff`);
  const wavFile = join(tmpdir(), `youbot-tts-${id}.wav`);

  await writeFile(txtFile, text, 'utf8');

  await new Promise<void>((resolve, reject) => {
    exec(`say -f '${txtFile}' -o '${aiffFile}'`, (err) => {
      unlink(txtFile).catch(() => {});
      err ? reject(new Error(`say failed: ${err.message}`)) : resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    exec(`afconvert -f WAVE -d LEI16 '${aiffFile}' '${wavFile}'`, (err) => {
      unlink(aiffFile).catch(() => {});
      err ? reject(new Error(`afconvert failed: ${err.message}`)) : resolve();
    });
  });

  const buf = await readFile(wavFile);
  await unlink(wavFile).catch(() => {});
  return buf;
}

// ── Tool Module ─────────────────────────────────────────────

const ttsToolModule: ToolModule = {
  name: 'tts',
  tools: TTS_TOOLS,

  register(registry: ToolRegistry, ctx: ToolContext) {

    // ── generate_audio ──────────────────────────────────
    registry.register('generate_audio', async (args) => {
      const text = String(args.text || '').trim();
      const voice = args.voice ? String(args.voice) : 'alloy';
      const speed = args.speed ? Math.min(4.0, Math.max(0.25, Number(args.speed))) : 1.0;

      if (!text) return { toolName: 'generate_audio', success: false, error: 'text is required', duration: 0 };

      const cleanText = cleanForTts(text);
      if (!cleanText) return { toolName: 'generate_audio', success: false, error: 'No speakable text found', duration: 0 };

      try {
        const buf = await synthesize(cleanText, ctx, voice, speed);

        const { join } = await import('path');
        const { writeFile } = await import('fs/promises');
        const { randomUUID } = await import('crypto');
        const { tmpdir } = await import('os');

        const outPath = join(tmpdir(), `youbot-audio-${randomUUID()}.wav`);
        await writeFile(outPath, buf);

        return {
          toolName: 'generate_audio',
          success: true,
          result: `✅ Audio generated (${(buf.length / 1024).toFixed(0)} KB). Saved to: ${outPath}`,
          duration: 0,
          data: { audioPath: outPath, sizeBytes: buf.length },
        };
      } catch (err: any) {
        return { toolName: 'generate_audio', success: false, error: `TTS failed: ${err.message}`, duration: 0 };
      }
    });

    // ── send_audio ───────────────────────────────────────
    registry.register('send_audio', async (args) => {
      const text = String(args.text || '').trim();
      const to = String(args.to || '').trim();
      const voice = args.voice ? String(args.voice) : 'alloy';
      const channel = args.channel ? String(args.channel) : undefined;

      if (!text) return { toolName: 'send_audio', success: false, error: 'text is required', duration: 0 };
      if (!to) return { toolName: 'send_audio', success: false, error: 'to is required', duration: 0 };

      const cleanText = cleanForTts(text);
      if (!cleanText) return { toolName: 'send_audio', success: false, error: 'No speakable text found', duration: 0 };

      try {
        const buf = await synthesize(cleanText, ctx, voice);

        const { join } = await import('path');
        const { writeFile, unlink } = await import('fs/promises');
        const { randomUUID } = await import('crypto');
        const { tmpdir } = await import('os');

        const audioPath = join(tmpdir(), `youbot-audio-${randomUUID()}.wav`);
        await writeFile(audioPath, buf);

        const mr = ctx.getMessagingRegistry();
        const msgProvider = mr.resolveProvider(channel);

        await msgProvider.sendMessage(to, '', {
          mediaType: 'audio',
          mediaPath: audioPath,
          ptt: true,
          mimetype: 'audio/wav',
        });

        // Cleanup after Baileys/Telegram transmits
        setTimeout(() => { unlink(audioPath).catch(() => {}); }, 60_000);

        return {
          toolName: 'send_audio',
          success: true,
          result: `✅ Voice note sent to ${to} via ${msgProvider.channel}. "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'send_audio', success: false, error: `Failed to send audio: ${err.message}`, duration: 0 };
      }
    });
  },
};

export default ttsToolModule;
