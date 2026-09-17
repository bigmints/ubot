/**
 * Transcription Service — Provider-Based
 *
 * Speech-to-text using the configured LLM provider.
 *
 * Provider strategy (in order):
 *   1. Gemini/Vertex → native generateContent with inline audio blob
 *   2. OpenAI-compatible /v1/audio/transcriptions (OpenAI, Groq, etc.)
 *   3. Local whisper.cpp addon (legacy fallback, if model is present)
 *
 * Note: Gemini's OpenAI-compat layer does NOT expose /audio/transcriptions.
 * OpenRouter also does not proxy audio transcription.
 * Only OpenAI and Groq support the Whisper API natively.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import FormData from 'form-data';

// ─── Types ───────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  language: string;
  duration?: number;
}

export interface TranscriptionOptions {
  /** Language code (e.g. 'en', 'ar', 'auto'). Default: 'auto' */
  language?: string;
  /** Provider config override */
  providerBaseUrl?: string;
  providerApiKey?: string;
  providerModelId?: string;
  providerHeaders?: Record<string, string>;
}

// ─── Local Whisper (legacy) ───────────────────────────────

const DEFAULT_MODEL_NAME = 'ggml-large-v3.bin';

function getModelsDir(): string {
  const youbotHome = process.env.YOUBOT_HOME || process.cwd();
  return join(youbotHome, 'data', 'models', 'transcription');
}

export function getModelPath(): string {
  return join(getModelsDir(), DEFAULT_MODEL_NAME);
}

export function isTranscriptionAvailable(): boolean {
  return existsSync(getModelPath());
}

// ─── Helpers ─────────────────────────────────────────────

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.mp3')  return 'audio/mpeg';
  if (ext === '.mp4')  return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.wav')  return 'audio/wav';
  if (ext === '.m4a')  return 'audio/mp4';
  return 'audio/ogg';
}

function isGeminiProvider(baseUrl: string): boolean {
  return baseUrl.includes('generativelanguage.googleapis.com') || baseUrl.includes('aiplatform.googleapis.com');
}

// ─── Gemini native transcription ─────────────────────────

/**
 * Transcribe via Gemini's generateContent API.
 * Gemini can understand audio natively — we send the audio as an inline blob.
 */
async function transcribeViaGemini(
  filePath: string,
  options: TranscriptionOptions & { baseUrl: string; apiKey?: string },
): Promise<TranscriptionResult | null> {
  try {
    const fileBuffer = readFileSync(filePath);
    const mimeType = getMimeType(filePath);
    const base64Audio = fileBuffer.toString('base64');

    // Strip /openai compat layer — use native Gemini API
    let apiBase = options.baseUrl.replace(/\/+$/, '').replace(/\/openai\/?$/, '');
    // apiBase should be like: https://generativelanguage.googleapis.com/v1beta
    if (!apiBase.includes('/v1')) apiBase = apiBase.replace(/\/?$/, '/v1beta');

    const modelId = options.providerModelId || 'gemini-2.0-flash';
    const url = `${apiBase}/models/${encodeURIComponent(modelId)}:generateContent?key=${options.apiKey || ''}`;

    const langHint = options.language && options.language !== 'auto' ? ` in ${options.language}` : '';
    const body = {
      contents: [{
        parts: [
          { text: `Please transcribe this audio recording accurately${langHint}. Return ONLY the transcription text, no commentary, no timestamps, no speaker labels.` },
          { inlineData: { mimeType, data: base64Audio } },
        ],
      }],
      generationConfig: { temperature: 0 },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.providerHeaders ?? {}) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      console.warn(`[Transcription] Gemini request failed with status ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!text) return null;

    return { text, language: options.language || 'auto' };
  } catch (err: any) {
    console.warn(`[Transcription] Gemini error: ${err.message}`);
    return null;
  }
}

// ─── OpenAI-compatible Whisper API ───────────────────────

/**
 * Transcribe via OpenAI-compatible /v1/audio/transcriptions endpoint.
 * Works with: OpenAI, Groq, local Whisper servers.
 * Does NOT work with: Gemini, OpenRouter.
 */
async function transcribeViaWhisperApi(
  filePath: string,
  options: TranscriptionOptions & { baseUrl: string; apiKey?: string },
): Promise<TranscriptionResult | null> {
  try {
    let baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (baseUrl.includes('://localhost:')) baseUrl = baseUrl.replace('://localhost:', '://127.0.0.1:');
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.replace(/\/v\d+$/, '') + '/v1';
    }

    const transcribeUrl = `${baseUrl}/audio/transcriptions`;
    const fileBuffer = readFileSync(filePath);
    const fileSize = statSync(filePath).size;
    const ext = extname(filePath).toLowerCase() || '.ogg';
    const mimeType = getMimeType(filePath);

    const form = new FormData();
    form.append('file', fileBuffer, { filename: `audio${ext}`, contentType: mimeType, knownLength: fileSize });
    form.append('model', options.providerModelId || 'whisper-1');
    if (options.language && options.language !== 'auto') form.append('language', options.language);
    form.append('response_format', 'json');

    const headers: Record<string, string> = { ...form.getHeaders(), ...(options.providerHeaders ?? {}) };
    if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`;

    const response = await fetch(transcribeUrl, {
      method: 'POST',
      headers,
      body: form.getBuffer() as unknown as BodyInit,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      console.warn(`[Transcription] Whisper API request failed with status ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    return {
      text: data.text?.trim() || '',
      language: data.language || options.language || 'auto',
      duration: data.duration,
    };
  } catch (err: any) {
    console.warn(`[Transcription] Whisper API error: ${err.message}`);
    return null;
  }
}

// ─── Main transcription function ──────────────────────────

export async function transcribeAudio(
  filePath: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const language = options.language || 'auto';

  const baseUrl = options.providerBaseUrl || (globalThis as any).__youbotConfig?.llmBaseUrl;
  const apiKey = options.providerApiKey || (globalThis as any).__youbotConfig?.llmApiKey;

  if (baseUrl) {
    // ── 1. Gemini/Vertex — use native generateContent ───────
    if (isGeminiProvider(baseUrl)) {
      const result = await transcribeViaGemini(filePath, { ...options, baseUrl, apiKey, language });
      if (result) {
      console.info('[Transcription] Gemini transcription completed');
        return result;
      }
      console.warn('[Transcription] Gemini failed — trying Whisper API fallback');
    }

    // ── 2. OpenAI-compatible Whisper API ────────────────────
    const result = await transcribeViaWhisperApi(filePath, { ...options, baseUrl, apiKey, language });
    if (result) {
      console.info('[Transcription] Whisper API transcription completed');
      return result;
    }
    console.warn('[Transcription] Provider failed — trying local whisper fallback');
  }

  // ── 3. Local whisper.cpp fallback ───────────────────────
  if (isTranscriptionAvailable()) {
    try {
      const { WhisperNodeAddon } = await import('@kutalia/whisper-node-addon') as any;
      const modelPath = getModelPath();

      let inputPath = filePath;
      const ext = extname(filePath).toLowerCase();
      const tmpDir = join(process.env.YOUBOT_HOME || process.cwd(), 'workspace', 'tmp');
      mkdirSync(tmpDir, { recursive: true });

      if (ext !== '.wav') {
        const { execSync } = await import('child_process');
        const converted = join(tmpDir, `whisper-${randomUUID()}.wav`);
        execSync(`ffmpeg -i "${filePath}" -ar 16000 -ac 1 -f wav "${converted}"`, { stdio: 'ignore' });
        inputPath = converted;
      }

      const whisper = new WhisperNodeAddon(modelPath);
      const segments = await whisper.transcribe(inputPath, {
        language: language === 'auto' ? 'en' : language,
        n_threads: 4,
      });
      if (inputPath !== filePath) {
        try { const { unlinkSync } = await import('fs'); unlinkSync(inputPath); } catch {}
      }

      const text = (segments || []).map((s: any) => s.text?.trim()).join(' ').trim();
      return { text, language };
    } catch (err: any) {
      console.error('[Transcription] Local whisper failed:', err.message);
      throw new Error(`Transcription failed: ${err.message}`);
    }
  }

  throw new Error(
    'Transcription unavailable. Configure an LLM provider with audio support ' +
    '(OpenAI, Groq) or download a local Whisper model.'
  );
}
