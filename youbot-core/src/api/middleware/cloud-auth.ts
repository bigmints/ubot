/**
 * Cloud Authentication Middleware
 *
 * In cloud modes, validates requests using SSO session cookies.
 * Supports multi-tenant isolation when RAW_MODE includes tenant semantics.
 *
 * Falls through to the existing local auth (api key) when YOUBOT_MODE=local.
 */

import http from 'http';
import { isCloud, RAW_MODE } from '../../lib/features.js';
import { loadYoubotConfig, resolveAuthConfig } from '../../data/config.js';
import type { AuthResult } from './auth.js';
import { createServerClient } from '@supabase/ssr';

const SESSION_COOKIE_NAME = 'session';

/** Resolve auth URL from env var → config.json → empty (will fail explicitly) */
function getAuthAppUrl(): string {
  if (process.env.SSO_AUTH_URL) return process.env.SSO_AUTH_URL;
  const cfg = loadYoubotConfig();
  const auth = resolveAuthConfig(cfg);
  return auth.auth_url || '';
}

/** Cache of verified sessions to avoid hitting Firebase on every request */
const sessionCache = new Map<string, { userId: string; email?: string; tenantId?: string; expiresAt: number }>();
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Parse the `session` cookie from the Cookie header.
 */
function parseCookie(req: http.IncomingMessage, name: string): string | undefined {
  const header = req.headers['cookie'];
  if (!header) return undefined;
  const match = header.split(';').find(c => c.trim().startsWith(`${name}=`));
  return match ? match.trim().slice(name.length + 1) : undefined;
}

/**
 * Parses the cookie string from the request into an array of objects for Supabase SSR.
 */
function parseCookiesForSSR(req: http.IncomingMessage): { name: string; value: string }[] {
  const header = req.headers['cookie'];
  if (!header) return [];
  return header.split(';').map(c => {
    const parts = c.split('=');
    return { name: parts[0].trim(), value: parts.slice(1).join('=').trim() };
  });
}

/**
 * Verify a Supabase session using the SSR client or a direct JWT token.
 * Returns decoded user info if valid, null otherwise.
 */
async function verifySupabaseSession(req: http.IncomingMessage, explicitToken?: string): Promise<{
  userId: string;
  email?: string;
  tenantId?: string;
} | null> {
  // Check cache first via raw cookie string mapping
  const hashKey = explicitToken || (req.headers['cookie'] ? req.headers['cookie'].split('session=')[1]?.slice(0, 50) : '');
  const cached = sessionCache.get(hashKey || '');
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!,
      {
        cookieOptions: { name: 'session' },
        cookies: {
          getAll: () => parseCookiesForSSR(req),
        }
      }
    );

    const { data: { user }, error } = explicitToken 
      ? await supabase.auth.getUser(explicitToken)
      : await supabase.auth.getUser();

    if (error || !user) {
      console.error('[CloudAuth] Supabase session verify failed:', error?.message);
      return null;
    }

    const result = {
      userId: user.id,
      email: user.email,
      tenantId: user.app_metadata?.tenant_id || user.id,
    };

    // Cache the result using the cookie hash string
    sessionCache.set(hashKey || '', {
      ...result,
      expiresAt: Date.now() + SESSION_CACHE_TTL,
    });

    // Evict old cache entries periodically
    if (sessionCache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of sessionCache) {
        if (val.expiresAt <= now) sessionCache.delete(key);
      }
    }

    return result;
  } catch (e: any) {
    console.error('[CloudAuth] Supabase session verification failed:', e.message);
    // Remove invalid entry from cache
    sessionCache.delete(hashKey || '');
    return null;
  }
}

/**
 * Cloud-aware authentication for API requests.
 * - Local mode: returns null to fall through to existing local auth.
 * - Cloud mode: validates SSO session cookie or Bearer token.
 */
export async function authenticateCloud(
  req: http.IncomingMessage
): Promise<AuthResult | null> {
  // Local mode — skip cloud auth, let existing local auth handle it
  if (!isCloud) return null;

  // Public endpoints — skip cloud auth (theme needed for login screen branding, etc.)
  const publicPaths = ['/api/health', '/api/app/theme', '/api/app/theme.css', '/api/auth/status', '/api/features', '/api/modules'];
  const url = req.url?.split('?')[0] || '';
  if (publicPaths.some(p => url === p)) return null;

  // Check: Bearer token → X-SSO-Token header
  const authHeader = req.headers['authorization'];
  const ssoToken = req.headers['x-sso-token'] as string | undefined;
  const explicitToken = ssoToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);

  const allCookies = parseCookiesForSSR(req);
  const hasAnySession = allCookies.some(c => c.name.startsWith(SESSION_COOKIE_NAME));

  if (!explicitToken && !hasAnySession) {
    return {
      authenticated: false,
      error: 'Authentication required. Please log in.',
    };
  }

  // Use explicit token if present, otherwise let SSR client use parsed cookies natively
  const result = await verifySupabaseSession(req, explicitToken);

  if (!result) {
    return { authenticated: false, error: 'Invalid or expired session. Please log in again.' };
  }

  return {
    authenticated: true,
    clientName: result.email || result.userId || 'sso-user',
    scopes: [], // SSO users get full access within their tier
  };
}

/**
 * Check if a request has a valid cloud session (for static page protection).
 * Returns user info if authenticated, null if not.
 */
export async function checkCloudSession(req: http.IncomingMessage): Promise<{
  userId: string;
  email?: string;
  tenantId?: string;
} | null> {
  if (!isCloud) return null;

  const allCookies = parseCookiesForSSR(req);
  const authHeader = req.headers['authorization'];
  const ssoToken = req.headers['x-sso-token'] as string | undefined;

  // Check for session cookie — could be exact 'session' OR chunked 'session.0', 'session.1', ...
  const sessionCookie = parseCookie(req, SESSION_COOKIE_NAME);
  const hasSessionChunks = allCookies.some(c => c.name.startsWith(`${SESSION_COOKIE_NAME}.`));
  const hasAnySession = !!sessionCookie || hasSessionChunks;

  const token = ssoToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);

  if (!hasAnySession && !token) {
    // Log cookie names for debugging (no values for security)
    const cookieNames = allCookies.map(c => c.name).join(', ');
    console.log(`[CloudAuth] No session found. Cookies present: [${cookieNames || 'none'}]`);
    return null;
  }

  // If we have an explicit token (SSO header/Bearer), use it; otherwise let SSR client use cookies
  const result = await verifySupabaseSession(req, token);

  return result;
}


/**
 * Extract tenant ID for multi-tenant request scoping.
 * Sources (in priority order):
 * 1. X-Tenant-ID header (explicit)
 * 2. SSO token (extracted during auth) — stored on req by auth middleware
 * 3. Default to the user ID
 */
export function extractTenantId(req: http.IncomingMessage): string | undefined {
  // Only extract tenant in multi-tenant modes (custom apps set RAW_MODE)
  if (RAW_MODE !== 'cloud-shared') return undefined;

  // Explicit header takes priority
  const headerTenant = req.headers['x-tenant-id'] as string | undefined;
  if (headerTenant) return headerTenant;

  // Tenant ID set by auth middleware
  return (req as any).__tenantId;
}

/**
 * Get the login redirect URL for unauthenticated users.
 */
export function getLoginRedirectUrl(returnTo?: string): string {
  const loginUrl = `${getAuthAppUrl()}/login`;
  if (returnTo) {
    return `${loginUrl}?returnUrl=${encodeURIComponent(returnTo)}`;
  }
  return loginUrl;
}
