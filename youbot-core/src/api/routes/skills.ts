/**
 * Skills Routes
 * /api/skills/*
 */

import http from 'http';
import type { SkillEvent } from '../../agents/skills/skill-types.js';
import { parseBody, json, notFound, error, type ApiContext } from '../context.js';
import type { SkillRepository } from '../../agents/skills/skill-repository.js';

export async function handleSkillRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {

  if (url === '/api/skills' && method === 'GET') {
    if (!ctx.skillEngine) {
      json(res, { skills: [] });
      return true;
    }
    json(res, { skills: ctx.skillEngine.getSkills() });
    return true;
  }

  if (url === '/api/skills' && method === 'POST') {
    if (!ctx.skillEngine) {
      error(res, 'Skill engine not initialized', 503);
      return true;
    }
    const body = await parseBody(req) as any;
    try {
      const saved = ctx.skillEngine.saveSkill(body);
      json(res, saved, 201);
    } catch (e: any) {
      error(res, e.message);
    }
    return true;
  }

  if (url === '/api/skills/generate' && method === 'POST') {
    error(res, 'Skill generation via API is deprecated. Use chat to create skills with natural language.', 410);
    return true;
  }

  if (url.match(/^\/api\/skills\/[^/]+\/run$/) && method === 'POST') {
    if (!ctx.skillEngine) {
      error(res, 'Skill engine not initialized', 503);
      return true;
    }
    const parts = url.split('/');
    const id = parts[parts.length - 2];
    const body = await parseBody(req) as any;
    try {
      const event: SkillEvent = {
        source: 'api',
        type: 'manual_run',
        body: body.message || '',
        from: body.from || 'api',
        timestamp: new Date(),
        data: body.parameters || {},
      };
      const result = await ctx.skillEngine.runSkill(id, event);
      json(res, result);
    } catch (e: any) {
      error(res, e.message, 500);
    }
    return true;
  }

  // ── Raw SKILL.md access ─────────────────────────────────
  if (url.match(/^\/api\/skills\/[^/]+\/raw$/) && method === 'GET') {
    const id = url.split('/').slice(-2)[0];
    const repo = (ctx as any).skillRepo as SkillRepository | undefined;
    if (!repo?.getRaw) { error(res, 'Raw access not supported', 501); return true; }
    const raw = repo.getRaw(id);
    if (!raw) { notFound(res); return true; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(raw);
    return true;
  }

  if (url.match(/^\/api\/skills\/[^/]+\/raw$/) && method === 'PUT') {
    const id = url.split('/').slice(-2)[0];
    const repo = (ctx as any).skillRepo as SkillRepository | undefined;
    if (!repo?.saveRaw) { error(res, 'Raw access not supported', 501); return true; }
    const chunks: Buffer[] = [];
    await new Promise<void>(resolve => { req.on('data', c => chunks.push(c)); req.on('end', resolve); });
    const content = Buffer.concat(chunks).toString('utf-8');
    const saved = repo.saveRaw(id, content);
    if (!saved) { error(res, 'Failed to parse skill frontmatter', 400); return true; }
    // Reload in engine
    if (ctx.skillEngine) {
      const updated = (ctx.skillEngine as any).repo?.getById?.(id) || saved;
      json(res, updated);
    } else {
      json(res, saved);
    }
    return true;
  }

  if (url.match(/^\/api\/skills\/[^/]+$/) && method === 'PUT') {
    if (!ctx.skillEngine) {
      error(res, 'Skill engine not initialized', 503);
      return true;
    }
    const id = url.split('/').pop()!;
    const body = await parseBody(req) as any;
    try {
      const updated = ctx.skillEngine.updateSkill(id, body);
      if (updated) json(res, updated);
      else notFound(res);
    } catch (e: any) {
      error(res, e.message, 500);
    }
    return true;
  }

  if (url.match(/^\/api\/skills\/[^/]+$/) && method === 'DELETE') {
    if (!ctx.skillEngine) {
      error(res, 'Skill engine not initialized', 503);
      return true;
    }
    const id = url.split('/').pop()!;
    try {
      const deleted = ctx.skillEngine.deleteSkill(id);
      json(res, { deleted });
    } catch (e: any) {
      error(res, e.message, 500);
    }
    return true;
  }

  return false;
}
