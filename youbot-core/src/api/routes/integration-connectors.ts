import http from 'http';
import { ZodError } from 'zod';
import { getIntegrationService } from '../../integrations/runtime.js';
import { error, json, parseBody, type ApiContext } from '../context.js';

function routeError(res: http.ServerResponse, cause: unknown): void {
  if (cause instanceof ZodError) {
    json(res, { error: 'Invalid integration request', issues: cause.issues }, 400);
    return;
  }
  const message = cause instanceof Error ? cause.message : 'Integration request failed';
  const status = /not found|not installed|unknown connector/i.test(message) ? 404 : 400;
  error(res, message, status);
}

export async function handleIntegrationConnectorRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  _ctx: ApiContext,
): Promise<boolean> {
  if (!url.startsWith('/api/integrations/connectors') &&
      !url.startsWith('/api/integrations/connections') &&
      !url.startsWith('/api/integrations/records')) return false;

  const service = getIntegrationService();
  if (!service) {
    error(res, 'Integration service is initializing', 503);
    return true;
  }

  try {
    if (url === '/api/integrations/connectors' && method === 'GET') {
      json(res, { connectors: service.listConnectors() });
      return true;
    }

    const connectMatch = url.match(/^\/api\/integrations\/connectors\/([^/]+)\/connect$/);
    if (connectMatch && method === 'POST') {
      const body = await parseBody(req) as any;
      const connection = await service.connect({
        connectorId: decodeURIComponent(connectMatch[1]),
        connectionId: body.connectionId,
        name: body.name,
        config: body.config,
        enabledStreams: body.enabledStreams,
      });
      json(res, { connection }, 201);
      return true;
    }

    if (url === '/api/integrations/connections' && method === 'GET') {
      json(res, { connections: await service.listConnections() });
      return true;
    }

    if (url.startsWith('/api/integrations/records') && method === 'GET') {
      const parsed = new URL(req.url || url, `http://${req.headers.host || 'localhost'}`);
      const query = parsed.searchParams.get('q') || '';
      if (!query.trim()) {
        error(res, 'q is required');
        return true;
      }
      const requestedLimit = Number(parsed.searchParams.get('limit') || 20);
      const records = await service.search(query, {
        connectionId: parsed.searchParams.get('connectionId') || undefined,
        stream: parsed.searchParams.get('stream') || undefined,
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 20,
      });
      json(res, { records });
      return true;
    }

    const operationMatch = url.match(/^\/api\/integrations\/connections\/([^/]+)\/(check|streams|sync|actions\/[^/]+|webhook)$/);
    if (operationMatch) {
      const connectionId = decodeURIComponent(operationMatch[1]);
      const operation = operationMatch[2];
      if (operation === 'check' && method === 'POST') {
        json(res, { check: await service.check(connectionId) });
        return true;
      }
      if (operation === 'streams' && method === 'GET') {
        json(res, { streams: await service.discover(connectionId) });
        return true;
      }
      if (operation === 'sync' && method === 'POST') {
        const body = await parseBody(req) as any;
        json(res, { sync: await service.sync(connectionId, body.streams) });
        return true;
      }
      if (operation.startsWith('actions/') && method === 'POST') {
        const action = decodeURIComponent(operation.slice('actions/'.length));
        const body = await parseBody(req) as Record<string, unknown>;
        json(res, { result: await service.executeAction(connectionId, action, body) });
        return true;
      }
      if (operation === 'webhook' && method === 'POST') {
        const body = await parseBody(req, 5 * 1024 * 1024);
        json(res, await service.handleWebhook(connectionId, req.headers, body), 202);
        return true;
      }
    }

    const connectionMatch = url.match(/^\/api\/integrations\/connections\/([^/]+)$/);
    if (connectionMatch && method === 'DELETE') {
      await service.disconnect(decodeURIComponent(connectionMatch[1]));
      json(res, { deleted: true });
      return true;
    }

    return false;
  } catch (cause) {
    routeError(res, cause);
    return true;
  }
}
