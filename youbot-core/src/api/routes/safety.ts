/**
 * Safety Routes
 * /api/safety/*
 */

import http from 'http';
import type { SafetyRule } from '../../agents/safety/types.js';
import { parseBody, json, notFound, error, type ApiContext } from '../context.js';

export async function handleSafetyRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {

  if (url === '/api/safety/rules' && method === 'GET') {
    json(res, { rules: ctx.safetyRules, total: ctx.safetyRules.length });
    return true;
  }

  if (url === '/api/safety/rules' && method === 'POST') {
    const body = await parseBody(req) as any;
    const rule: SafetyRule = {
      id: `rule-${Date.now()}`,
      name: body.name || 'New Rule',
      description: body.description || '',
      category: body.category || 'custom',
      level: body.level || 'medium',
      action: body.action || 'warn',
      keywords: body.keywords || [],
      pattern: body.pattern,
      enabled: body.enabled !== false,
      priority: body.priority || 50,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    ctx.safetyRules.push(rule);
    json(res, rule, 201);
    return true;
  }

  if (url.match(/^\/api\/safety\/rules\/[^/]+$/) && method === 'PUT') {
    const id = url.split('/').pop()!;
    const body = await parseBody(req) as any;
    const idx = ctx.safetyRules.findIndex(r => r.id === id);
    if (idx === -1) { notFound(res); return true; }
    ctx.safetyRules[idx] = { ...ctx.safetyRules[idx], ...body, updatedAt: new Date() };
    json(res, ctx.safetyRules[idx]);
    return true;
  }

  if (url.match(/^\/api\/safety\/rules\/[^/]+$/) && method === 'DELETE') {
    const id = url.split('/').pop()!;
    const idx = ctx.safetyRules.findIndex(r => r.id === id);
    if (idx === -1) { notFound(res); return true; }
    ctx.safetyRules.splice(idx, 1);
    json(res, { deleted: true });
    return true;
  }

  if (url === '/api/safety/config' && method === 'GET') {
    json(res, ctx.safetyConfig);
    return true;
  }

  if (url === '/api/safety/config' && method === 'PUT') {
    const body = await parseBody(req) as any;
    ctx.safetyConfig = { ...ctx.safetyConfig, ...body };
    json(res, { config: ctx.safetyConfig, saved: true });
    return true;
  }

  return false;
}
