import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { LLMProviderConfig, Attachment } from '../../engine/types.js';
import { parseBody, parseLargeBody, json, notFound, error, type ApiContext } from '../context.js';
import { getProcessingSessions } from '../../engine/handler.js';

// Async jobs are now persisted via ctx.asyncJobStore (Phase 2)

export async function handleChatRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {

  // ── Poll async job result ─────────────────────────────────
  if (url.startsWith('/api/chat/job/') && method === 'GET') {
    const jobId = url.replace('/api/chat/job/', '').split('?')[0];
    const job = await ctx.asyncJobStore?.get(jobId);
    if (!job) {
      error(res, 'Job not found', 404);
      return true;
    }
    json(res, {
      jobId,
      status: job.status,
      sessionId: job.sessionId,
      result: job.result,
      error: job.error,
      elapsed: job.completedAt ? job.completedAt - job.startedAt : Date.now() - job.startedAt,
    });
    return true;
  }

  // ── Chat / Agent ────────────────────────────────────────

  if (url === '/api/chat' && method === 'POST') {
    if (!ctx.agentOrchestrator) {
      error(res, 'Agent not initialized', 503);
      return true;
    }
    // Use large body parser for file uploads
    const body = await parseLargeBody(req) as any;

    if ((body as any)._error) {
      error(res, 'Payload too large (max 15MB)', 413);
      return true;
    }

    const message = body.message || body.content || '';
    const isOwner = ctx.auth?.isOwner ?? false;
    let sessionId = body.sessionId || 'web-console';

    // Sandbox non-owner sessions to prevent access to dashboard threads
    if (!isOwner) {
      const clientPrefix = ctx.auth?.clientName ? `api_${ctx.auth.clientName.replace(/\W+/g, '_')}_` : 'api_anon_';
      if (!sessionId.startsWith(clientPrefix)) {
        sessionId = `${clientPrefix}${sessionId}`;
      }
    }

    if (!message.trim()) {
      error(res, 'Message is required');
      return true;
    }

    // Process attachments if present
    let attachments: Attachment[] | undefined;
    console.log(`[Upload] body.attachments present: ${Array.isArray(body.attachments)}, count: ${body.attachments?.length || 0}`);
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      attachments = [];

      // Ensure uploads directory exists
      const uploadsDir = path.join(ctx.workspacePath || path.join(process.cwd(), 'workspace'), 'uploads');
      console.log(`[Upload] Uploads dir: ${uploadsDir}`);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      for (const att of body.attachments) {
        console.log(`[Upload] Processing: ${att.filename}, type: ${att.mimeType}, base64 len: ${att.base64?.length || 0}`);
        if (!att.filename || !att.base64 || !att.mimeType) {
          console.log(`[Upload] Skipping — missing fields: filename=${!!att.filename}, base64=${!!att.base64}, mimeType=${!!att.mimeType}`);
          continue;
        }

        const id = crypto.randomUUID();
        const ext = path.extname(att.filename) || '';
        const safeName = `${id}${ext}`;
        const filePath = path.join(uploadsDir, safeName);

        // Decode and save the file
        const buffer = Buffer.from(att.base64, 'base64');
        fs.writeFileSync(filePath, buffer);
        console.log(`[Upload] Saved ${safeName} (${buffer.length} bytes)`);

        const attachment: Attachment = {
          id,
          filename: att.filename,
          mimeType: att.mimeType,
          path: filePath,
          size: buffer.length,
        };

        // For images: keep base64 for LLM vision
        if (att.mimeType.startsWith('image/')) {
          attachment.base64 = att.base64;
        }

        // For PDFs: extract text
        if (att.mimeType === 'application/pdf') {
          try {
            console.log(`[Upload] Parsing PDF: ${att.filename}`);
            const { PDFParse } = await import('pdf-parse');
            const parser = new PDFParse({ data: new Uint8Array(buffer) });
            let text = String(await parser.getText() || '');
            console.log(`[Upload] PDF text extracted: ${text.length} chars`);
            if (text.length > 100000) {
              text = text.slice(0, 100000) + '\n\n... (truncated)';
            }
            attachment.textContent = text;
          } catch (err: any) {
            console.error('[Upload] PDF parse error:', err.message);
            attachment.textContent = `[Failed to extract PDF text: ${err.message}]`;
          }
        }

        // For text-based documents: read as text
        if (/^text\/|application\/json|application\/xml/.test(att.mimeType)) {
          attachment.textContent = buffer.toString('utf8');
          if (attachment.textContent.length > 100000) {
            attachment.textContent = attachment.textContent.slice(0, 100000) + '\n\n... (truncated)';
          }
        }

        console.log(`[Upload] Attachment ready: ${att.filename}, hasText: ${!!attachment.textContent}, textLen: ${attachment.textContent?.length || 0}`);
        attachments.push(attachment);
      }

      if (attachments.length === 0) attachments = undefined;
    }

    // Async mode: return immediately with jobId, poll /api/chat/job/:id for results
    if (body.async) {
      if (!ctx.asyncJobStore) {
        error(res, 'Async job persistence not available', 500);
        return true;
      }
      const jobId = crypto.randomUUID();
      await ctx.asyncJobStore.create(jobId, sessionId);

      // Periodic cleanup (keep last 24 hours of jobs)
      await ctx.asyncJobStore.cleanup(24 * 60 * 60 * 1000);

      // Fire and forget
      ctx.agentOrchestrator.chat(
        sessionId, message, 'web', undefined, isOwner, attachments, undefined,
        (event) => {
          ctx.asyncJobStore?.addEvent(jobId, event).catch(() => {});
        }
      ).then((response) => {
        ctx.asyncJobStore?.update(jobId, {
          status: 'completed',
          result: response,
          completedAt: Date.now()
        });

        // Auto-name thread (same as sync path)
        try {
          const store = ctx.agentOrchestrator!.getConversationStore();
          store.listSessions().then(async (sessions) => {
            const session = sessions.find((s: any) => s.id === sessionId);
            if (session && (/^(Command Center|Thread \d+|New Thread|General)$/i.test(session.name) || session.name === session.id)) {
              try {
                let generatedName = await ctx.agentOrchestrator!.generate(
                  'You are an expert copywriter. Generate a brief, 3 to 5 word title for the user message. Do not use quotes or punctuation.',
                  message.trim().slice(0, 500)
                );
                generatedName = generatedName.replace(/["']/g, '').trim();
                if (generatedName.length > 3 && generatedName.length < 50) {
                  await store.renameSession(sessionId, generatedName);
                }
              } catch (e) {
                let autoName = message.trim().replace(/\n.*/s, '');
                if (autoName.length > 40) autoName = autoName.slice(0, 40).replace(/\s\S*$/, '') + '…';
                if (autoName.length > 3) store.renameSession(sessionId, autoName).catch(()=>{});
              }
            }
          }).catch(() => {});
        } catch { /* best-effort */ }
      }).catch((e: any) => {
        ctx.asyncJobStore?.update(jobId, {
          status: 'failed',
          error: e.message,
          completedAt: Date.now()
        });
      });

      json(res, { jobId, status: 'processing', sessionId }, 202);
      return true;
    }

    // Sync mode (default): wait for completion
    try {
      const response = await ctx.agentOrchestrator.chat(
        sessionId, message, 'web', undefined, isOwner, attachments
      );

      // Auto-name thread from first message if it has a generic name
      try {
        const store = ctx.agentOrchestrator.getConversationStore();
        const sessions = await store.listSessions();
        const session = sessions.find((s: any) => s.id === sessionId);
        if (session && (/^(Command Center|Thread \d+|New Thread|General)$/i.test(session.name) || session.name === session.id)) {
          try {
            let generatedName = await ctx.agentOrchestrator.generate(
              'You are an expert copywriter. Generate a brief, 3 to 5 word title for the user message. Do not use quotes or punctuation.',
              message.trim().slice(0, 500)
            );
            generatedName = generatedName.replace(/["']/g, '').trim();
            if (generatedName.length > 3 && generatedName.length < 50) {
              await store.renameSession(sessionId, generatedName);
            }
          } catch(e) {
            // Generate name from first message (first 40 chars, trimmed at word boundary)
            let autoName = message.trim().replace(/\n.*/s, ''); // first line only
            if (autoName.length > 40) {
              autoName = autoName.slice(0, 40).replace(/\s\S*$/, '') + '…';
            }
            if (autoName.length > 3) {
              await store.renameSession(sessionId, autoName);
            }
          }
        }
      } catch { /* auto-naming is best-effort */ }

      // ── API-level empty content guard ──────────────────────
      // Belt-and-suspenders: ensure we never send an empty content bubble
      // to the frontend, even if the orchestrator somehow returns empty.
      if (!response.content || (response.content as string).trim() === '') {
        const toolCalls = response.toolCalls || [];
        if (toolCalls.length > 0) {
          const failures = toolCalls.filter((t: any) => !t.success);
          const successes = toolCalls.filter((t: any) => t.success);
          if (failures.length > 0 && successes.length === 0) {
            response.content = "I'm sorry, I couldn't complete that just now. I've noted the issue and will try again shortly.";
          } else if (successes.length > 0 && failures.length === 0) {
            const summary = successes.map((r: any) =>
              `• \`${r.toolName}\`: ${String(r.result || 'Completed').slice(0, 150)}`
            ).join('\n');
            response.content = `✅ Done!\n\n${summary}`;
          } else if (successes.length > 0) {
            response.content = "I handled part of that, but couldn't finish everything just now. I'll keep it noted and follow up when I can.";
          } else {
            response.content = "I wasn't able to complete that. Please try rephrasing your request.";
          }
        } else {
          response.content = "I wasn't able to generate a response. Please try again.";
        }
        console.warn('[Chat API] Empty content guard triggered — patched response before sending to client');
      }

      json(res, response);
    } catch (e: any) {
      console.error('[API] Chat error:', e);
      error(res, e.message, 500);
    }
    return true;
  }

  // ── Serve uploaded files ────────────────────────────────
  if (url.startsWith('/api/chat/uploads/') && method === 'GET') {
    const fileId = url.replace('/api/chat/uploads/', '').split('?')[0];
    const uploadsDir = path.join(ctx.workspacePath || path.join(process.cwd(), 'workspace'), 'uploads');

    // Find the file by ID prefix
    try {
      const files = fs.readdirSync(uploadsDir);
      const match = files.find(f => f.startsWith(fileId));
      if (match) {
        const filePath = path.join(uploadsDir, match);
        const stat = fs.statSync(filePath);
        const ext = path.extname(match).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
          '.svg': 'image/svg+xml',
          // Audio
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
          '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
          // Video
          '.mp4': 'video/mp4',
          // Documents
          '.json': 'application/json', '.xml': 'application/xml',
          '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
        };
        res.writeHead(200, {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400',
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        error(res, 'File not found', 404);
      }
    } catch {
      error(res, 'File not found', 404);
    }
    return true;
  }

  if (url === '/api/chat/history' && method === 'GET') {
    if (!ctx.agentOrchestrator) {
      json(res, { messages: [] });
      return true;
    }
    const urlObj = new URL(url, 'http://localhost');
    const sessionId = urlObj.searchParams.get('sessionId') || 'web-console';
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const store = ctx.agentOrchestrator.getConversationStore();
    const messages = await store.getHistory(sessionId, limit);
    json(res, { messages });
    return true;
  }

  if (url.startsWith('/api/chat/history') && method === 'GET') {
    if (!ctx.agentOrchestrator) {
      json(res, { messages: [] });
      return true;
    }
    const qIdx = url.indexOf('?');
    const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx)) : new URLSearchParams();
    const sessionId = params.get('sessionId') || 'web-console';
    const limit = parseInt(params.get('limit') || '50', 10);
    const store = ctx.agentOrchestrator.getConversationStore();
    const messages = await store.getHistory(sessionId, limit);
    json(res, { messages });
    return true;
  }

  if (url === '/api/chat/clear' && method === 'POST') {
    if (!ctx.agentOrchestrator) {
      json(res, { cleared: true });
      return true;
    }
    const body = await parseBody(req) as any;
    const sessionId = body.sessionId || 'web-console';
    await ctx.agentOrchestrator.getConversationStore().clearSession(sessionId);
    json(res, { cleared: true, sessionId });
    return true;
  }

  if (url === '/api/chat/sessions' && method === 'GET') {
    if (!ctx.agentOrchestrator) {
      json(res, { sessions: [] });
      return true;
    }
    const allSessions = await ctx.agentOrchestrator.getConversationStore().listSessions();
    const sessions = allSessions.filter((s: any) => !s.id.startsWith('subagent-'));
    json(res, { sessions });
    return true;
  }

  // Create a new thread
  if (url === '/api/chat/sessions' && method === 'POST') {
    if (!ctx.agentOrchestrator) {
      error(res, 'Agent not initialized', 503);
      return true;
    }
    try {
      const body = await parseBody(req) as any;
      const { v4: uuidv4 } = await import('uuid');
      const store = ctx.agentOrchestrator.getConversationStore();
      const id = uuidv4();
      const name = body.name || 'New Thread';
      const session = await store.createSession(id, 'web', name);
      json(res, { session });
    } catch (e: any) {
      console.error('[API] createSession Error:', e);
      error(res, e.message, 500);
    }
    return true;
  }

  // Rename a thread
  if (url === '/api/chat/sessions' && method === 'PUT') {
    if (!ctx.agentOrchestrator) {
      error(res, 'Agent not initialized', 503);
      return true;
    }
    const body = await parseBody(req) as any;
    const { sessionId, name } = body;
    if (!sessionId || !name) {
      error(res, 'sessionId and name are required');
      return true;
    }
    const store = ctx.agentOrchestrator.getConversationStore();
    await store.renameSession(sessionId, name);
    json(res, { renamed: true, sessionId, name });
    return true;
  }

  // Delete a thread
  if (url === '/api/chat/sessions/delete' && method === 'POST') {
    if (!ctx.agentOrchestrator) {
      error(res, 'Agent not initialized', 503);
      return true;
    }
    const body = await parseBody(req) as any;
    const { sessionId } = body;
    if (!sessionId) {
      error(res, 'sessionId is required');
      return true;
    }
    await ctx.agentOrchestrator.getConversationStore().deleteSession(sessionId);
    json(res, { deleted: true, sessionId });
    return true;
  }

  // Active processing status — which sessions are currently being processed by the LLM
  if (url === '/api/chat/processing' && method === 'GET') {
    json(res, { sessions: getProcessingSessions() });
    return true;
  }

  if (url === '/api/chat/config' && method === 'GET') {
    if (!ctx.agentOrchestrator) {
      json(res, { error: 'Agent not initialized' }, 503);
      return true;
    }
    const config = ctx.agentOrchestrator.getConfig();
    const { loadYoubotConfig: loadCfg } = await import('../../data/config.js');
    const fileCfg = loadCfg();
    const webchat = fileCfg.channels?.webchat || {};
    json(res, {
      llmBaseUrl: config.llmBaseUrl,
      llmModel: config.llmModel,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maxHistoryMessages: config.maxHistoryMessages,
      autoReplyWhatsApp: config.autoReplyWhatsApp,
      autoReplyTelegram: config.autoReplyTelegram,
      autoReplyWebchat: config.autoReplyWebchat,
      autoReplyContacts: config.autoReplyContacts,
      ownerPhone: config.ownerPhone || '',
      ownerTelegramId: config.ownerTelegramId || '',
      ownerTelegramUsername: config.ownerTelegramUsername || '',
      primaryEscalationChannel: config.primaryEscalationChannel || 'both',
      webchatEnabled: webchat.enabled !== false,
      webchatToken: webchat.connection_token || '',
    webchatRelayUrl: webchat.relay_url || '',
    webchatRelaySlug: webchat.relay_slug || '',
    webchatBotSecret: webchat.bot_secret || '',
      webchatOwnerKey: webchat.owner_key || '',
      webchatWidgetTitle: webchat.widget_title || '',
      webchatWidgetColor: webchat.widget_color || '#6366f1',
      webchatWelcomeMessage: webchat.welcome_message || '',
      webchatAvatarUrl: webchat.avatar_url || '',
    });
    return true;
  }

  if (url === '/api/chat/config' && method === 'PUT') {
    if (!ctx.agentOrchestrator) {
      json(res, { error: 'Agent not initialized' }, 503);
      return true;
    }
    const body = await parseBody(req) as any;
    const updated = ctx.agentOrchestrator.updateConfig(body);

    // Save directly to config.json (single source of truth)
    const { loadYoubotConfig, saveYoubotConfig } = await import('../../data/config.js');
    const cfg = loadYoubotConfig();
    if (body.ownerPhone !== undefined) { if (!cfg.owner) cfg.owner = {}; cfg.owner.phone = updated.ownerPhone || ''; }
    if (body.ownerTelegramId !== undefined) { if (!cfg.owner) cfg.owner = {}; cfg.owner.telegram_id = updated.ownerTelegramId || ''; }
    if (body.ownerTelegramUsername !== undefined) { if (!cfg.owner) cfg.owner = {}; cfg.owner.telegram_username = updated.ownerTelegramUsername || ''; }
    if (body.autoReplyWhatsApp !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.whatsapp) cfg.channels.whatsapp = {}; cfg.channels.whatsapp.auto_reply = updated.autoReplyWhatsApp; }
    if (body.autoReplyTelegram !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.telegram) cfg.channels.telegram = {}; cfg.channels.telegram.auto_reply = updated.autoReplyTelegram; }
    if (body.autoReplyWebchat !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.auto_reply = updated.autoReplyWebchat; }
    if (body.primaryEscalationChannel !== undefined) { if (!cfg.agent) cfg.agent = {}; cfg.agent.primary_escalation_channel = updated.primaryEscalationChannel; }
    if (body.maxHistoryMessages !== undefined) { if (!cfg.agent) cfg.agent = {}; cfg.agent.max_history_messages = updated.maxHistoryMessages; }
    // Webchat-specific settings (saved directly to config.json channels.webchat)
    if (body.webchatEnabled !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.enabled = body.webchatEnabled; }
    if (body.webchatWidgetTitle !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.widget_title = body.webchatWidgetTitle; }
    if (body.webchatWidgetColor !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.widget_color = body.webchatWidgetColor; }
    if (body.webchatWelcomeMessage !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.welcome_message = body.webchatWelcomeMessage; }
    if (body.webchatRelayUrl !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.relay_url = body.webchatRelayUrl; }
    if (body.webchatBotSecret !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.bot_secret = body.webchatBotSecret; }
    if (body.webchatOwnerKey !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.owner_key = body.webchatOwnerKey; }
    if (body.webchatAvatarUrl !== undefined) { if (!cfg.channels) cfg.channels = {}; if (!cfg.channels.webchat) cfg.channels.webchat = {}; cfg.channels.webchat.avatar_url = body.webchatAvatarUrl; }
    saveYoubotConfig(cfg);

    json(res, {
      llmBaseUrl: updated.llmBaseUrl,
      llmModel: updated.llmModel,
      temperature: updated.temperature,
      maxTokens: updated.maxTokens,
      maxHistoryMessages: updated.maxHistoryMessages,
      autoReplyWhatsApp: updated.autoReplyWhatsApp,
      autoReplyTelegram: updated.autoReplyTelegram,
      autoReplyWebchat: updated.autoReplyWebchat,
      ownerPhone: updated.ownerPhone || '',
      ownerTelegramId: updated.ownerTelegramId || '',
      ownerTelegramUsername: updated.ownerTelegramUsername || '',
      primaryEscalationChannel: updated.primaryEscalationChannel || 'both',
      saved: true,
    });
    return true;
  }

  if (url === '/api/whatsapp/messages' && method === 'GET') {
    json(res, { messages: ctx.waMessages.slice(-50) });
    return true;
  }

  // ── LLM Providers ─────────────────────────────────────

  if (url.startsWith('/api/llm-providers/models') && method === 'GET') {
    const params = new URL(url, 'http://localhost').searchParams;
    let baseUrl = params.get('baseUrl') || '';
    let apiKey = params.get('apiKey') || '';
    const providerType = params.get('provider') || 'custom';
    const providerId = params.get('providerId') || '';

    if (providerId && ctx.agentOrchestrator) {
      const config = ctx.agentOrchestrator.getConfig();
      const stored = (config.llmProviders || []).find(p => p.id === providerId);
      if (stored) {
        if (!apiKey || apiKey.includes('*')) apiKey = stored.apiKey;
        if (!baseUrl) baseUrl = stored.baseUrl;
      }
    }

    if (!baseUrl) {
      error(res, 'baseUrl is required');
      return true;
    }

    try {
      let models: Array<{ id: string; name: string }> = [];

      if (providerType === 'ollama') {
        const ollamaHost = baseUrl.replace(/\/v1\/?$/, '');
        let fetchHost = ollamaHost;
        if (fetchHost.includes('://localhost:')) fetchHost = fetchHost.replace('://localhost:', '://127.0.0.1:');

        const ollamaRes = await fetch(`${fetchHost}/api/tags`);
        if (ollamaRes.ok) {
          const data = await ollamaRes.json() as any;
          const allModels = (data.models || []) as any[];

          // Check capabilities for each model in parallel via /api/show
          const capChecks = await Promise.allSettled(
            allModels.map(async (m: any) => {
              const modelName = m.name || m.model;
              try {
                const showResp = await fetch(`${ollamaHost}/api/show`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: modelName }),
                });
                if (showResp.ok) {
                  const info = await showResp.json() as any;
                  return { model: m, capabilities: info.capabilities || [] };
                }
              } catch { /* ignore */ }
              return { model: m, capabilities: [] as string[] };
            })
          );

          // Filter: only models that support tool calling
          models = capChecks
            .filter((r): r is PromiseFulfilledResult<{ model: any; capabilities: string[] }> =>
              r.status === 'fulfilled')
            .map(r => r.value)
            .filter(({ capabilities }) => capabilities.includes('tools'))
            .map(({ model: m, capabilities }) => {
              const name = m.name || m.model;
              const size = m.details?.parameter_size ? ` (${m.details.parameter_size})` : '';
              const vision = capabilities.includes('vision') ? ' 👁️' : '';
              return { id: name, name: `${name}${size}${vision}` };
            });
        }
      } else {
        const normalizedUrl = baseUrl.replace(/\/+$/, '');
        const modelsUrl = `${normalizedUrl}/models`;
        let fetchUrl = modelsUrl;
        if (fetchUrl.includes('://localhost:')) fetchUrl = fetchUrl.replace('://localhost:', '://127.0.0.1:');

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const modelsRes = await fetch(fetchUrl, { headers });
        if (modelsRes.ok) {
          const data = await modelsRes.json() as any;
          models = (data.data || []).map((m: any) => ({
            id: m.id,
            name: m.name || m.id, pricing: m.pricing, context_length: m.context_length,
          }));
        }
      }

      models.sort((a, b) => a.id.localeCompare(b.id));
      json(res, { models });
    } catch (err: any) {
      json(res, { models: [], error: err.message });
    }
    return true;
  }

  // Legacy /api/llm-providers GET — reads from new keyed format
  if (url === '/api/llm-providers' && method === 'GET') {
    const { loadYoubotConfig } = await import('../../data/config.js');
    const cfg = loadYoubotConfig();
    const providers = Object.entries(cfg.capabilities?.models?.providers || {})
      .filter(([_, p]) => p.enabled !== false)
      .map(([key, p]) => ({
        id: key,
        name: key,
        provider: key,
        baseUrl: p.baseUrl || '',
        apiKey: p.apiKey ? `${String(p.apiKey).slice(0, 4)}${'*'.repeat(8)}${String(p.apiKey).slice(-4)}` : '',
        model: p.model || '',
        isDefault: key === cfg.capabilities?.models?.default,
      }));
    json(res, { providers, defaultId: cfg.capabilities?.models?.default || '' });
    return true;
  }

  return false;
}
