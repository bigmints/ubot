import { parseBody, type ApiContext } from '../context.js';
import { loadYoubotConfig, saveYoubotConfig } from '../../data/config.js';
import http from 'http';
import { google } from 'googleapis';

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
}

export async function handleIntegrationsGoogleRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext
): Promise<boolean> {
  const basePath = '/api/integrations/google/calendar';
  if (!url.startsWith(basePath)) return false;

  // ── GET Config ──
  if (url === basePath && method === 'GET') {
    const config = loadYoubotConfig();
    const calendar = config.capabilities?.google?.services?.calendar;

    json(res, {
      configured: !!calendar?.credentials?.client_id && !!calendar?.credentials?.client_secret,
      authenticated: !!calendar?.credentials?.refresh_token,
      client_id: calendar?.credentials?.client_id || '',
    });
    return true;
  }

  // ── POST Config ──
  if (url === basePath && method === 'POST') {
    const body = await parseBody(req) as Record<string, any>;
    const config = loadYoubotConfig();

    if (!config.capabilities) config.capabilities = {};
    if (!config.capabilities.google) config.capabilities.google = { enabled: true, services: {} };
    if (!config.capabilities.google.services) config.capabilities.google.services = {};
    if (!config.capabilities.google.services.calendar) config.capabilities.google.services.calendar = { enabled: true, credentials: {} };

    const creds = config.capabilities.google.services.calendar.credentials!;
    if (body.client_id !== undefined) creds.client_id = body.client_id;
    if (body.client_secret !== undefined) creds.client_secret = body.client_secret;

    if (!creds.redirect_uris) {
      creds.redirect_uris = ['http://localhost:4080/integrations/google/callback', 'http://localhost:4081/integrations/google/callback'];
    }

    saveYoubotConfig(config);
    json(res, { success: true });
    return true;
  }

  // ── GET Auth URL ──
  if (url.startsWith(`${basePath}/auth-url`) && method === 'GET') {
    const fullUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const redirectUri = fullUrl.searchParams.get('redirect_uri');

    const config = loadYoubotConfig();
    const creds = config.capabilities?.google?.services?.calendar?.credentials;
    if (!creds?.client_id || !creds?.client_secret) {
      error(res, 'Google Calendar client credentials not configured', 400);
      return true;
    }

    const oauth2Client = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      redirectUri || creds.redirect_uris?.[0]
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
    });

    json(res, { url: authUrl });
    return true;
  }

  // ── POST Token (exchange code) ──
  if (url === `${basePath}/token` && method === 'POST') {
    const body = await parseBody(req) as Record<string, any>;
    if (!body.code) {
      error(res, 'Authorization code is required', 400);
      return true;
    }

    const config = loadYoubotConfig();
    const creds = config.capabilities?.google?.services?.calendar?.credentials;
    if (!creds?.client_id || !creds?.client_secret) {
      error(res, 'Google Calendar client credentials not configured', 400);
      return true;
    }

    const oauth2Client = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      body.redirect_uri || creds.redirect_uris?.[0]
    );

    try {
      const { tokens } = await oauth2Client.getToken(body.code);
      if (tokens.refresh_token) {
        creds.refresh_token = tokens.refresh_token;
        saveYoubotConfig(config);
        json(res, { success: true });
      } else {
        if (creds.refresh_token) {
          json(res, { success: true, message: 'Already have refresh token' });
        } else {
          error(res, 'No refresh token received. Please try authenticating again and ensure you grant offline access.', 400);
        }
      }
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  // ── DELETE Integration ──
  if (url === basePath && method === 'DELETE') {
    const config = loadYoubotConfig();
    const creds = config.capabilities?.google?.services?.calendar?.credentials;
    if (creds) {
      delete creds.refresh_token;
      saveYoubotConfig(config);
    }
    json(res, { success: true });
    return true;
  }

  return false;
}
