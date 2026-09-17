/**
 * Vault Routes
 * /api/vault/*
 *
 * OWNER-ONLY: Access restricted to:
 *   - Dashboard requests (same-origin from localhost)
 *   - API keys with 'vault' or 'owner' scope
 */

import http from 'http';
import { getVaultService } from '../../agents/vault/service.js';
import { parseBody, json, notFound, error, type ApiContext } from '../context.js';
import { authenticate } from '../middleware/auth.js';

/**
 * Check if request is from the owner.
 * Owner = dashboard (same-origin localhost) OR API key with vault/owner scope.
 */
function isOwnerRequest(req: http.IncomingMessage): boolean {
  // Dashboard requests (same-origin, any hostname) are always the owner
  const origin = String(req.headers['origin'] || req.headers['referer'] || '');
  const serverPort = process.env.PORT || '11490';
  const dashboardPorts = [serverPort, '4080', '4081', '11490', '3000'];
  const isDashboard = dashboardPorts.some(port => origin.includes(`:${port}`));
  if (isDashboard) return true;

  // External API: require vault or owner scope on the API key
  const authResult = authenticate(req);
  if (!authResult.authenticated) return false;
  if (!authResult.scopes || authResult.scopes.length === 0) {
    // No scopes defined = full access (backward compat for single-user)
    return true;
  }
  return authResult.scopes.includes('vault') || authResult.scopes.includes('owner');
}

export async function handleVaultRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {
  if (!url.startsWith('/api/vault')) return false;

  // ── Owner-only guard ───────────────────────────────────
  if (!isOwnerRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Vault access denied. Owner-only resource.' }));
    return true;
  }

  const workspaceProvider = ctx.workspaceProvider;
  if (!workspaceProvider) {
    error(res, 'Workspace not configured', 500);
    return true;
  }

  const vault = getVaultService(workspaceProvider);

  // ── GET /api/vault — list or search ────────────────────
  if (url.startsWith('/api/vault') && !url.includes('/api/vault/') && method === 'GET') {
    try {
      const params = new URL(url, 'http://localhost').searchParams;
      const category = params.get('category') || undefined;
      const search = params.get('search') || undefined;
      const items = search ? vault.search(search) : vault.list(category);
      const stats = vault.stats();
      json(res, { items, stats });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  // ── POST /api/vault — store text item ──────────────────
  if (url === '/api/vault' && method === 'POST') {
    try {
      const body = await parseBody(req) as any;
      if (!body.label || !body.value) {
        error(res, 'label and value are required', 400);
        return true;
      }
      const metadata = body.notes ? { notes: String(body.notes) } : undefined;
      const item = vault.store(
        String(body.label),
        String(body.value),
        String(body.category || 'general'),
        metadata,
      );
      json(res, { item }, 201);
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  if (url === '/api/vault/document' && method === 'POST') {
    try {
      const body = await parseBody(req) as any;
      if (!body.label) {
        error(res, 'label is required', 400);
        return true;
      }

      let fileData: Buffer;
      let filename: string;

      if (body.file_data && body.filename) {
        // Browser upload: base64 encoded file data
        fileData = Buffer.from(body.file_data, 'base64');
        filename = String(body.filename);
      } else if (body.file_path) {
        // Tool/CLI: file path on disk — read the file
        const fs = await import('fs');
        const path = await import('path');
        const filePath = String(body.file_path);
        fileData = fs.readFileSync(filePath);
        filename = path.basename(filePath);
      } else {
        error(res, 'file_data+filename or file_path is required', 400);
        return true;
      }

      const metadata = body.notes ? { notes: String(body.notes) } : undefined;
      const item = vault.storeDocument(
        String(body.label),
        fileData,
        filename,
        String(body.category || 'documents'),
        metadata,
      );

      json(res, { item }, 201);
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  // ── GET /api/vault/:id — retrieve item ─────────────────
  if (url.match(/^\/api\/vault\/[^/]+$/) && method === 'GET') {
    const id = decodeURIComponent(url.split('/').pop()!);
    try {
      const item = vault.retrieve(id);
      if (!item) { notFound(res); return true; }
      json(res, { item });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  // ── DELETE /api/vault/:id — delete item ────────────────
  if (url.match(/^\/api\/vault\/[^/]+$/) && method === 'DELETE') {
    const id = decodeURIComponent(url.split('/').pop()!);
    try {
      const deleted = vault.delete(id);
      if (!deleted) { notFound(res); return true; }
      json(res, { deleted: true });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  return false;
}
