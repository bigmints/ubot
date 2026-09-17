/**
 * Vertex AI OAuth2 token generation from service account JSON.
 * 
 * Generates short-lived access tokens using the JWT → OAuth2 flow:
 *   1. Create a signed JWT from the service account credentials
 *   2. Exchange it for an access token via Google's token endpoint
 *   3. Cache the token until it expires
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Get the path to the stored Vertex AI credentials file.
 */
export function getVertexCredentialsPath(): string {
  const youbotDir = process.env.YOUBOT_DIR || path.join(process.env.HOME || '/root', '.youbot');
  return path.join(youbotDir, 'vertex-credentials.json');
}

/**
 * Save Vertex AI service account JSON to disk.
 */
export function saveVertexCredentials(jsonContent: string): { success: boolean; projectId?: string; error?: string } {
  try {
    const parsed = JSON.parse(jsonContent);
    if (parsed.type !== 'service_account') {
      return { success: false, error: 'Invalid credentials: must be a service_account JSON key' };
    }
    if (!parsed.private_key || !parsed.client_email) {
      return { success: false, error: 'Invalid credentials: missing private_key or client_email' };
    }

    const credPath = getVertexCredentialsPath();
    fs.writeFileSync(credPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });

    // Clear token cache so next call uses fresh credentials
    tokenCache.clear();

    return { success: true, projectId: parsed.project_id };
  } catch (err: any) {
    return { success: false, error: `Failed to parse JSON: ${err.message}` };
  }
}

/**
 * Load saved Vertex AI credentials.
 */
export function loadVertexCredentials(): ServiceAccountCredentials | null {
  const credPath = getVertexCredentialsPath();
  if (!fs.existsSync(credPath)) return null;
  try {
    const raw = fs.readFileSync(credPath, 'utf-8');
    return JSON.parse(raw) as ServiceAccountCredentials;
  } catch {
    return null;
  }
}

/**
 * Generate an OAuth2 access token from service account credentials.
 * Tokens are cached and refreshed 5 minutes before expiry.
 */
export async function getVertexAccessToken(): Promise<string | null> {
  const creds = loadVertexCredentials();
  if (!creds) return null;

  const cacheKey = creds.client_email;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.accessToken;
  }

  try {
    const token = await exchangeJwtForToken(creds);
    tokenCache.set(cacheKey, {
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in - 60) * 1000,
    });
    return token.access_token;
  } catch (err) {
    console.error('[Vertex] Failed to get access token');
    return null;
  }
}

/**
 * Create a signed JWT and exchange it for an access token.
 */
async function exchangeJwtForToken(creds: ServiceAccountCredentials): Promise<{ access_token: string; expires_in: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = base64url(sign.sign(creds.private_key));

  const jwt = `${unsigned}.${signature}`;

  const tokenUrl = creds.token_uri || 'https://oauth2.googleapis.com/token';
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<{ access_token: string; expires_in: number }>;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Get the Vertex AI OpenAI-compatible base URL for a project+region.
 */
export function getVertexBaseUrl(projectId: string, region: string = 'us-central1'): string {
  return `https://${region}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${region}/endpoints/openapi`;
}
