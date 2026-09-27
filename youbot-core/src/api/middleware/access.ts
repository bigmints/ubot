import crypto from 'node:crypto';
import type { AuthResult } from './auth.js';

/** Non-owner clients only access their own chat resources. Everything else is owner-only. */
export function canAccessApiRoute(auth: AuthResult | undefined, method: string, url: string): boolean {
  if (!auth?.authenticated) return false;
  if (auth.isOwner === true) return true;
  if (!auth.clientId || (auth.scopes?.length && !auth.scopes.includes('chat'))) return false;
  const pathname = url.split('?')[0];
  if (method === 'POST' && ['/api/chat', '/api/chat/clear', '/api/chat/sessions', '/api/chat/sessions/delete'].includes(pathname)) return true;
  if (method === 'PUT' && pathname === '/api/chat/sessions') return true;
  return method === 'GET' && (pathname === '/api/chat/history' || pathname === '/api/chat/sessions'
    || /^\/api\/chat\/job\/[^/]+$/.test(pathname));
}

export function clientSessionPrefix(auth: AuthResult | undefined): string | null {
  if (!auth?.authenticated || !auth.clientId) return null;
  return `api_${crypto.createHash('sha256').update(auth.clientId).digest('hex')}_`;
}

/** Raw client aliases and previously returned IDs both resolve inside the client's namespace. */
export function resolveChatSession(auth: AuthResult | undefined, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) return null;
  if (auth?.authenticated && auth.isOwner === true) return value;
  const prefix = clientSessionPrefix(auth);
  return prefix ? (value.startsWith(prefix) ? value : `${prefix}${value}`) : null;
}
