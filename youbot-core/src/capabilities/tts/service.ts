/**
 * Local Text-to-Speech Service using Piper TTS
 * 
 * Converts text to speech using the local Piper TTS engine.
 * Voices are stored in YOUBOT_HOME/data/models/tts/
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ─── Constants ───────────────────────────────────────────

const DEFAULT_VOICE = 'en_US-amy-medium';

function getTtsModelsDir(): string {
  const youbotHome = process.env.YOUBOT_HOME || process.cwd();
  return join(youbotHome, 'data', 'models', 'tts');
}

function getTmpDir(): string {
  const youbotHome = process.env.YOUBOT_HOME || process.cwd();
  const dir = join(youbotHome, 'workspace', 'tmp');
  try { execSync(`mkdir -p "${dir}"`, { stdio: 'ignore' }); } catch {}
  return dir;
}

// ─── Availability Checks ─────────────────────────────────

let _piperPath: string | null = null;

function findPiper(): string | null {
  if (_piperPath !== null) return _piperPath;
  try {
    _piperPath = execSync('which piper', { encoding: 'utf-8' }).trim();
    return _piperPath;
  } catch {
    _piperPath = '';
    return null;
  }
}

export function isTtsAvailable(): boolean {
  const piper = findPiper();
  if (!piper) return false;
  const modelsDir = getTtsModelsDir();
  if (!existsSync(modelsDir)) return false;
  // Check if any .onnx voice files exist
  try {
    const files = readdirSync(modelsDir);
    return files.some(f => f.endsWith('.onnx'));
  } catch {
    return false;
  }
}

export function getVoiceModelPath(voice?: string): string {
  const modelsDir = getTtsModelsDir();
  const voiceName = voice || DEFAULT_VOICE;
  return join(modelsDir, `${voiceName}.onnx`);
}

export function getAvailableVoices(): string[] {
  const modelsDir = getTtsModelsDir();
  if (!existsSync(modelsDir)) return [];
  try {
    return readdirSync(modelsDir)
      .filter(f => f.endsWith('.onnx'))
      .map(f => f.replace('.onnx', ''));
  } catch {
    return [];
  }
}

// ─── TTS Service ─────────────────────────────────────────

export interface TtsOptions {
  voice?: string;
  speed?: number;  // speaking rate multiplier
}

export interface TtsResult {
  audioPath: string;
  duration: number;
  voice: string;
}

/**
 * Convert text to speech using local Piper TTS.
 * Returns the path to the generated WAV file.
 */
export function textToSpeech(
  text: string,
  options: TtsOptions = {},
): TtsResult {
  const { voice = DEFAULT_VOICE, speed = 1.0 } = options;

  const piper = findPiper();
  if (!piper) {
    throw new Error('Piper TTS not installed. Install with: pip3 install piper-tts');
  }

  const modelPath = getVoiceModelPath(voice);
  if (!existsSync(modelPath)) {
    throw new Error(
      `Voice model not found: ${voice}. ` +
      `Download it from the Models → TTS page.`
    );
  }

  // Clean text for TTS (remove markdown, emojis, etc.)
  const cleanText = text
    .replace(/```[\s\S]*?```/g, ' code block omitted ')  // code blocks
    .replace(/`([^`]+)`/g, '$1')  // inline code
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g, '$1')  // italic
    .replace(/#{1,6}\s/g, '')  // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
    .replace(/[•\-]\s/g, '')  // bullet points
    .replace(/\n{2,}/g, '. ')  // paragraph breaks
    .replace(/\n/g, ' ')  // newlines
    .replace(/\s{2,}/g, ' ')  // multiple spaces
    .trim();

  if (!cleanText) {
    throw new Error('No speakable text found');
  }

  // Limit length for TTS (avoid extremely long outputs)
  const truncated = cleanText.length > 2000
    ? cleanText.slice(0, 2000) + '...'
    : cleanText;

  const tmpDir = getTmpDir();
  const outPath = join(tmpDir, `tts-${randomUUID()}.wav`);

  const startTime = Date.now();

  try {
    // Piper reads from stdin and writes WAV to output file
    const args = [
      '--model', modelPath,
      '--output_file', outPath,
    ];

    if (speed !== 1.0) {
      args.push('--length-scale', String(1.0 / speed));
    }

    execFileSync(piper, args, {
      input: truncated,
      timeout: 30000,
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    const duration = (Date.now() - startTime) / 1000;
    console.log(`[TTS] ✅ Generated speech in ${duration.toFixed(1)}s (${truncated.length} chars, voice: ${voice})`);

    return { audioPath: outPath, duration, voice };
  } catch (err: any) {
    throw new Error(`TTS failed: ${err.message}`);
  }
}
