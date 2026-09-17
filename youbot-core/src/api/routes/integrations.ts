/**
 * Integration Routes
 * /api/google/*
 */

import http from 'http';
import { parseBody, readBodyBuffer, json, error, type ApiContext } from '../context.js';
import { resolveRoutedHttpModel } from '../../integrations/model-routing.js';

export async function handleIntegrationRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {




  // ── MCP Servers ─────────────────────────────────────────

  if (url === '/api/mcp/servers' && method === 'GET') {
    const mgr = ctx.mcpManager;
    if (!mgr) { json(res, { servers: [] }); return true; }
    json(res, { servers: mgr.getServers() });
    return true;
  }

  if (url === '/api/mcp/servers' && method === 'POST') {
    const mgr = ctx.mcpManager;
    if (!mgr) { error(res, 'MCP manager not initialized', 503); return true; }
    const body = await parseBody(req) as any;
    if (!body.name || !body.command) { error(res, 'name and command are required'); return true; }

    const config = {
      id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: body.name,
      command: body.command,
      args: body.args || [],
      env: body.env || {},
      enabledTools: body.enabledTools || [],
      discoveredTools: body.discoveredTools || [],
    };
    mgr.addServer(config);

    // Auto-connect if requested
    if (body.autoConnect !== false) {
      await mgr.connectServer(config.id).catch(() => {});
    }

    const status = mgr.getServer(config.id);
    json(res, { server: status }, 201);
    return true;
  }

  if (url === '/api/mcp/servers/validate' && method === 'POST') {
    const mgr = ctx.mcpManager;
    if (!mgr) { error(res, 'MCP manager not initialized', 503); return true; }
    const body = await parseBody(req) as any;
    if (!body.command) { error(res, 'command is required'); return true; }
    try {
      const tools = await mgr.validateServer({
        command: body.command,
        args: body.args || [],
        env: body.env || {},
      });
      json(res, { valid: true, tools });
    } catch (err: any) {
      json(res, { valid: false, error: err.message, tools: [] });
    }
    return true;
  }

  if (url.match(/^\/api\/mcp\/servers\/[^/]+$/) && method === 'PUT') {
    const mgr = ctx.mcpManager;
    if (!mgr) { error(res, 'MCP manager not initialized', 503); return true; }
    const id = url.split('/').pop()!;
    const body = await parseBody(req) as any;
    const updated = mgr.updateServer(id, body);
    if (!updated) { error(res, 'Server not found', 404); return true; }

    // Reconnect if tools changed
    if (body.enabledTools !== undefined || body.command !== undefined) {
      await mgr.connectServer(id).catch(() => {});
    }

    const status = mgr.getServer(id);
    json(res, { server: status });
    return true;
  }

  if (url.match(/^\/api\/mcp\/servers\/[^/]+$/) && method === 'DELETE') {
    const mgr = ctx.mcpManager;
    if (!mgr) { error(res, 'MCP manager not initialized', 503); return true; }
    const id = url.split('/').pop()!;
    const removed = await mgr.removeServer(id);
    if (!removed) { error(res, 'Server not found', 404); return true; }
    json(res, { deleted: true });
    return true;
  }

  if (url.match(/^\/api\/mcp\/servers\/[^/]+\/reconnect$/) && method === 'POST') {
    const mgr = ctx.mcpManager;
    if (!mgr) { error(res, 'MCP manager not initialized', 503); return true; }
    const parts = url.split('/');
    const id = parts[parts.length - 2];
    try {
      await mgr.connectServer(id);
      const status = mgr.getServer(id);
      json(res, { server: status });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  // ── Local Transcription Status ───────────────────────────
  if (url === '/api/transcription/status' && method === 'GET') {
    try {
      const { isTranscriptionAvailable, getModelPath } = await import('../../capabilities/transcription/service.js');
      const modelPath = getModelPath();
      const available = isTranscriptionAvailable();
      let fileSize = 0;
      if (available) {
        const { statSync } = await import('fs');
        try {
          fileSize = statSync(modelPath).size;
        } catch { /* ignore */ }
      }

      // Check if ffmpeg is available
      let ffmpegAvailable = false;
      try {
        const { execSync } = await import('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore' });
        ffmpegAvailable = true;
      } catch { /* ignore */ }

      json(res, {
        available,
        model: {
          name: modelPath.split('/').pop()?.replace('.bin', '') || 'ggml-large-v3',
          path: modelPath,
          size: fileSize,
          sizeFormatted: available ? `${(fileSize / 1024 / 1024).toFixed(1)} MB` : null,
        },
        ffmpeg: ffmpegAvailable,
        backend: process.arch === 'arm64' ? 'Metal (Apple Silicon)' : 'CPU',
      });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  // ── Local Transcription Model Download ─────────────────
  if (url === '/api/transcription/download' && method === 'POST') {
    try {
      const body = await parseBody(req) as { model?: string };
      const modelName = body.model || 'ggml-large-v3.bin';
      const { getModelPath } = await import('../../capabilities/transcription/service.js');
      const { join, dirname } = await import('path');
      const { existsSync, mkdirSync } = await import('fs');

      const modelsDir = dirname(getModelPath());
      if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });

      const modelPath = join(modelsDir, modelName);

      if (existsSync(modelPath)) {
        json(res, { success: true, message: 'Model already exists', path: modelPath });
        return true;
      }

      // Start download in background
      const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;

      // Use spawn to download in background
      const { spawn } = await import('child_process');
      const tmpPath = modelPath + '.downloading';
      const child = spawn('curl', ['-L', '-o', tmpPath, downloadUrl], {
        stdio: 'ignore',
        detached: true,
      });

      // Track download state
      (globalThis as any).__whisperDownload = {
        modelName,
        pid: child.pid,
        startedAt: Date.now(),
        done: false,
        error: null,
      };

      child.on('exit', async (code) => {
        const state = (globalThis as any).__whisperDownload;
        if (code === 0) {
          // Rename from .downloading to final path
          try {
            const { renameSync } = await import('fs');
            renameSync(tmpPath, modelPath);
            state.done = true;
            console.log(`[Transcription] ✅ Model downloaded: ${modelName}`);
          } catch (err: any) {
            state.done = true;
            state.error = err.message;
          }
        } else {
          state.done = true;
          state.error = `Download failed with exit code ${code}`;
          try {
            const { unlinkSync } = await import('fs');
            unlinkSync(tmpPath);
          } catch {}
        }
      });

      child.unref();

      json(res, {
        success: true,
        message: `Downloading ${modelName}...`,
        model: modelName,
      });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  if (url === '/api/transcription/download/progress' && method === 'GET') {
    const state = (globalThis as any).__whisperDownload;
    if (!state) {
      json(res, { downloading: false });
      return true;
    }

    // Check file size for progress
    let downloadedBytes = 0;
    try {
      const { getModelPath } = await import('../../capabilities/transcription/service.js');
      const { dirname, join } = await import('path');
      const { statSync } = await import('fs');
      const tmpPath = join(dirname(getModelPath()), state.modelName + '.downloading');
      try { downloadedBytes = statSync(tmpPath).size; } catch {}
    } catch {}

    json(res, {
      downloading: !state.done,
      modelName: state.modelName,
      done: state.done,
      error: state.error,
      downloadedBytes,
      downloadedFormatted: `${(downloadedBytes / 1024 / 1024).toFixed(0)} MB`,
      elapsedSeconds: Math.round((Date.now() - state.startedAt) / 1000),
    });
    return true;
  }

  // ── Transcribe uploaded audio ──────────────────────────
  if (url === '/api/transcription/transcribe' && method === 'POST') {
    try {
      const { transcribeAudio, isTranscriptionAvailable } = await import('../../capabilities/transcription/service.js');

      if (!isTranscriptionAvailable()) {
        error(res, 'Local transcription model not installed. Download it from Models → Transcription.', 503);
        return true;
      }

      // Bound uploads while streaming so one request cannot exhaust process memory.
      const audioBuffer = await readBodyBuffer(req, 25 * 1024 * 1024);

      if (audioBuffer.length === 0) {
        error(res, 'No audio data received');
        return true;
      }

      // Determine format from content-type
      const contentType = req.headers['content-type'] || 'audio/webm';
      const extMap: Record<string, string> = {
        'audio/webm': '.webm',
        'audio/ogg': '.ogg',
        'audio/wav': '.wav',
        'audio/mp4': '.m4a',
        'audio/mpeg': '.mp3',
      };
      const ext = extMap[contentType.split(';')[0]] || '.webm';

      // Save to temp file
      const { join } = await import('path');
      const { writeFileSync, mkdirSync, unlinkSync } = await import('fs');
      const { randomUUID } = await import('crypto');
      const tmpDir = join(process.env.YOUBOT_HOME || process.cwd(), 'workspace', 'uploads');
      mkdirSync(tmpDir, { recursive: true });
      const tmpPath = join(tmpDir, `voice-${randomUUID()}${ext}`);
      writeFileSync(tmpPath, audioBuffer);

      // Transcribe
      const cfg = ctx.agentOrchestrator?.getConfig?.() as any;
      const provider = cfg
        ? await resolveRoutedHttpModel(cfg, 'transcription', 'whisper-1')
        : undefined;
      let result;
      try {
        result = await transcribeAudio(tmpPath, {
          providerBaseUrl: provider?.baseUrl,
          providerApiKey: provider?.apiKey,
          providerModelId: provider?.modelId,
          providerHeaders: provider?.headers,
        });
      } finally {
        try { unlinkSync(tmpPath); } catch {}
      }

      json(res, {
        text: result.text,
        duration: result.duration,
        language: result.language,
      });
    } catch (err: any) {
      const oversized = err?.statusCode === 413;
      error(res, oversized ? 'Audio upload exceeds the 25 MB limit' : err.message, oversized ? 413 : 500);
    }
    return true;
  }

  // ── TTS Status ─────────────────────────────────────────
  if (url === '/api/tts/status' && method === 'GET') {
    try {
      const { isTtsAvailable, getAvailableVoices } = await import('../../capabilities/tts/service.js');
      json(res, {
        available: isTtsAvailable(),
        voices: getAvailableVoices(),
      });
    } catch (err: any) {
      json(res, { available: false, voices: [], error: err.message });
    }
    return true;
  }

  // ── TTS Speak ──────────────────────────────────────────
  if (url === '/api/tts/speak' && method === 'POST') {
    try {
      const body = await parseBody(req) as { text: string; voice?: string; speed?: number };
      if (!body.text?.trim()) { error(res, 'Missing "text" field'); return true; }

      const cleanText = body.text
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
        .slice(0, 2000);

      if (!cleanText) { error(res, 'No speakable text'); return true; }

      const voice = body.voice || 'alloy';
      const speed = body.speed ?? 1.0;

      // ── 1. Configured LLM provider TTS ─────────────────
      let audioBuffer: Buffer | null = null;

      try {
        const cfg = ctx.agentOrchestrator?.getConfig?.() as any;
        const provider = cfg
          ? await resolveRoutedHttpModel(cfg, 'tts', 'tts-1')
          : undefined;

        if (provider?.baseUrl) {
          let baseUrl = String(provider.baseUrl).replace(/\/+$/, '');
          baseUrl = baseUrl.replace(/\/openai\/?$/, '');
          if (!baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
          if (baseUrl.includes('://localhost:')) baseUrl = baseUrl.replace('://localhost:', '://127.0.0.1:');

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(provider.headers ?? {}),
          };
          if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

          const ttsRes = await fetch(`${baseUrl}/audio/speech`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: provider.modelId, input: cleanText, voice, speed, response_format: 'wav' }),
          });

          if (ttsRes.ok) {
            audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
          } else {
          await ttsRes.body?.cancel().catch(() => undefined);
          console.warn(`[TTS] Provider request failed with status ${ttsRes.status}; falling back`);
          }
        }
      } catch (err: any) {
        console.warn(`[TTS] Provider error: ${err.message} — falling back`);
      }

      // ── 2. macOS say + afconvert fallback ───────────────
      if (!audioBuffer) {
        const { exec } = await import('child_process');
        const { writeFile, readFile, unlink } = await import('fs/promises');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const { randomUUID } = await import('crypto');

        const id = randomUUID();
        const txtFile = join(tmpdir(), `youbot-tts-${id}.txt`);
        const aiffFile = join(tmpdir(), `youbot-tts-${id}.aiff`);
        const wavFile = join(tmpdir(), `youbot-tts-${id}.wav`);

        await writeFile(txtFile, cleanText, 'utf8');
        await new Promise<void>((resolve, reject) => {
          exec(`say -f '${txtFile}' -o '${aiffFile}'`, (err) => {
            unlink(txtFile).catch(() => {});
            err ? reject(new Error(`say: ${err.message}`)) : resolve();
          });
        });
        await new Promise<void>((resolve, reject) => {
          exec(`afconvert -f WAVE -d LEI16 '${aiffFile}' '${wavFile}'`, (err) => {
            unlink(aiffFile).catch(() => {});
            err ? reject(new Error(`afconvert: ${err.message}`)) : resolve();
          });
        });
        audioBuffer = await readFile(wavFile);
        await unlink(wavFile).catch(() => {});
      }

      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(audioBuffer);
    } catch (err: any) {
      error(res, `TTS failed: ${err.message}`, 500);
    }
    return true;
  }

  return false;
}
