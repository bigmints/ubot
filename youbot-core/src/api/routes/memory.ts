import { documentRevision } from '../../concierge/owner-profile.js';
import { getConciergeStore } from '../../concierge/store.js';
import { replyAvailability, sendVisitorReply } from './concierge.js';
/**
 * Memory & Persona Routes
 * /api/personas/*, /api/memories/*
 */

import http from 'http';
import { parseBody, json, notFound, error, type ApiContext } from '../context.js';
import { BOT_SOUL_ID, OWNER_SOUL_ID } from '../../memory/soul.js';

export async function handleMemoryRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {

  // ── Personas / Soul ─────────────────────────────────────
  if (url === '/api/personas' && method === 'GET') {
    if (!ctx.agentOrchestrator) {
      json(res, { personas: [] });
      return true;
    }
    const soulPersonas = await ctx.agentOrchestrator.getSoul().listPersonas();
    const agents = ctx.agentOrchestrator.listAgents().map(a => ({
      id: a.id,
      label: a.name || a.id,
      updatedAt: new Date(),
      contentLength: 0,
      type: 'agent'
    }));
    
    json(res, { personas: [...soulPersonas.map(p => ({ ...p, type: 'core' })), ...agents] });
    return true;
  }

  if (url.match(/^\/api\/personas\/[^/]+$/) && method === 'GET') {
    if (!ctx.agentOrchestrator) { json(res, { content: '' }); return true; }
    const parts = url.split('/');
    const personaId = decodeURIComponent(parts[3]);
    let content = await ctx.agentOrchestrator.getSoul().getDocument(personaId);
    
    if (!content && personaId !== BOT_SOUL_ID && personaId !== OWNER_SOUL_ID) {
      content = ctx.agentOrchestrator.getAgentMarkdown(personaId) || '';
    }
    
    json(res, { personaId, content, revision: documentRevision(content) });
    return true;
  }

  if (url.match(/^\/api\/personas\/[^/]+$/) && method === 'PUT') {
    if (!ctx.agentOrchestrator) { json(res, { error: 'Agent not initialized' }, 500); return true; }
    const parts = url.split('/');
    const personaId = decodeURIComponent(parts[3]);
    const body = await parseBody(req) as any;
    if (typeof body.content !== 'string') {
      json(res, { error: 'Missing required field: content' }, 400);
      return true;
    }
    
    const existingDoc = await ctx.agentOrchestrator.getSoul().getDocument(personaId);
    if (personaId === BOT_SOUL_ID || personaId === OWNER_SOUL_ID || existingDoc) {
      try { await ctx.agentOrchestrator.getSoul().saveDocument(personaId, body.content, body.revision); }
      catch(e) { json(res,{error:(e as Error).name==='ProfileConflict'?(e as Error).message:'The profile could not be saved. Reload and try again.'},(e as Error).name==='ProfileConflict'?409:500);return true; }
    } else {
      ctx.agentOrchestrator.saveAgentMarkdown(personaId, body.content);
    }
    
    json(res, { personaId, content: body.content, saved: true });
    return true;
  }

  if (url.match(/^\/api\/personas\/[^/]+$/) && method === 'DELETE') {
    if (!ctx.agentOrchestrator) { json(res, { error: 'Agent not initialized' }, 500); return true; }
    const parts = url.split('/');
    const personaId = decodeURIComponent(parts[3]);
    const deleted = await ctx.agentOrchestrator.getSoul().deleteDocument(personaId);
    json(res, { deleted, personaId });
    return true;
  }

  // ── Memories (Structured Profile Data) ──────────────────

  // Bulk fetch: all memories grouped by contactId
  if (url === '/api/memories' && method === 'GET') {
    if (!ctx.agentOrchestrator) { json(res, { memoriesByContact: {} }); return true; }
    const all = await ctx.agentOrchestrator.getMemoryStore().getAllMemories();
    const grouped: Record<string, typeof all> = {};
    for (const m of all) {
      if (!grouped[m.contactId]) grouped[m.contactId] = [];
      grouped[m.contactId].push(m);
    }
    json(res, { memoriesByContact: grouped });
    return true;
  }

  if (url.match(/^\/api\/memories\/[^/]+$/) && method === 'GET') {
    if (!ctx.agentOrchestrator) { json(res, { memories: [] }); return true; }
    const parts = url.split('/');
    const contactId = decodeURIComponent(parts[3]);
    const memories = await ctx.agentOrchestrator.getMemoryStore().getMemories(contactId);
    json(res, { memories });
    return true;
  }

  if (url === '/api/memories' && method === 'POST') {
    if (!ctx.agentOrchestrator) { json(res, { error: 'Agent not initialized' }, 500); return true; }
    const body = await parseBody(req) as any;
    if (!body.contactId || !body.category || !body.key || !body.value) {
      json(res, { error: 'contactId, category, key, and value are required' }, 400);
      return true;
    }
    const memory = await ctx.agentOrchestrator.getMemoryStore().saveMemory(
      body.contactId, body.category, body.key, body.value, body.source || 'manual', body.confidence || 1.0
    );
    json(res, { memory });
    return true;
  }

  if (url.match(/^\/api\/memories\/[^/]+$/) && method === 'DELETE') {
    if (!ctx.agentOrchestrator) { json(res, { error: 'Agent not initialized' }, 500); return true; }
    const parts = url.split('/');
    const memoryId = decodeURIComponent(parts[3]);
    const deleted = await ctx.agentOrchestrator.getMemoryStore().deleteMemory(memoryId);
    json(res, { deleted });
    return true;
  }

  // ── Scheduler/Tasks ───────────────────────────────────
  if (url === '/api/scheduler/tasks' && method === 'GET') {
    if (!ctx.scheduler) {
      json(res, { tasks: [], total: 0 });
      return true;
    }
    const result = ctx.scheduler.listTasks();
    json(res, result);
    return true;
  }

  if (url === '/api/scheduler/stats' && method === 'GET') {
    if (!ctx.scheduler) {
      json(res, { totalTasks: 0, runningTasks: 0, completedTasks: 0, failedTasks: 0 });
      return true;
    }
    const stats = ctx.scheduler.getStats();
    json(res, stats);
    return true;
  }

  // ── Approvals ───────────────────────────────────────────
  if (url === '/api/approvals' && method === 'GET') {
    if (!ctx.approvalStore) {
      json(res, { approvals: [] });
      return true;
    }
    const params = new URLSearchParams(url.split('?')[1] || '');
    const status = params.get('status');
    const approvals = status === 'pending' ? await ctx.approvalStore.getPending() : await ctx.approvalStore.getAll();
    json(res, { approvals });
    return true;
  }

  if (url.match(/^\/api\/approvals\/[^/]+\/respond$/) && method === 'POST') {
    if (!ctx.approvalStore) {
      error(res, 'Approval system not initialized', 503);
      return true;
    }
    const parts = url.split('/');
    const approvalId = decodeURIComponent(parts[3]);
    const body = await parseBody(req) as any;
    const response = body.response || body.message || '';

    if (!response.trim()) {
      error(res, 'Response is required');
      return true;
    }

    const approval = await ctx.approvalStore.getById(approvalId);
    if (!approval) {
      notFound(res);
      return true;
    }

    const resolved = await ctx.approvalStore.resolve(approvalId, response);

    let relayed = false;
    let deliveryError: string | undefined;
    if (ctx.coreDb && ctx.agentOrchestrator) {
      const inbox = getConciergeStore(ctx.coreDb);
      const thread = await inbox.get(approval.sessionId);
      if (thread && !thread.paused && !thread.lastError && !replyAvailability(ctx, thread)) {
        try {
          const result = await ctx.agentOrchestrator.chat(`followup-approval-${approval.id}`, `Write only a visitor-facing reply to this question: ${approval.question}. The owner answered: ${response}. Do not call tools.`, 'web', thread.name, false);
          relayed = await inbox.automatedReply(thread.id, thread.revision, result.content || response, () => sendVisitorReply(ctx, thread, result.content || response));
        } catch {
          deliveryError = 'The decision was saved, but reply delivery could not be confirmed. Review the conversation.';
        }
      }
    }
    json(res, { approval: resolved, relayed, ...(deliveryError ? { error: deliveryError } : {}) });
    return true;
  }

  if (url.match(/^\/api\/approvals\/[^/]+$/) && method === 'GET') {
    if (!ctx.approvalStore) {
      notFound(res);
      return true;
    }
    const parts = url.split('/');
    const approvalId = decodeURIComponent(parts[3]);
    const approval = await ctx.approvalStore.getById(approvalId);
    if (!approval) {
      notFound(res);
      return true;
    }
    json(res, { approval });
    return true;
  }

  if (url.match(/^\/api\/approvals\/[^/]+$/) && method === 'DELETE') {
    if (!ctx.approvalStore) {
      error(res, 'Approval system not initialized', 503);
      return true;
    }
    const parts = url.split('/');
    const approvalId = decodeURIComponent(parts[3]);
    const deleted = await ctx.approvalStore.delete(approvalId);
    if (!deleted) {
      notFound(res);
      return true;
    }
    json(res, { deleted: true, approvalId });
    return true;
  }

  return false;
}
