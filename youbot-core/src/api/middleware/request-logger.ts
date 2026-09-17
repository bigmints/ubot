/**
 * API Request Logger
 * 
 * Structured request logging for audit trail.
 * Logs: timestamp, method, URL, client name, status code, duration.
 */

import http from 'http';
import { log } from '../../logger/ring-buffer.js';

/** Paths to skip logging (noisy/uninteresting) */
const SKIP_PATHS = ['/api/health'];

/**
 * Log an incoming API request (call at start of request).
 * Returns a function to call when the response is finished.
 */
export function logRequest(
  req: http.IncomingMessage,
  url: string,
  method: string,
  clientName?: string,
): () => void {
  if (SKIP_PATHS.some(p => url === p || url.startsWith(p + '?'))) {
    return () => {}; // no-op for skipped paths
  }

  const startTime = Date.now();

  return () => {
    const duration = Date.now() - startTime;
    const status = (req as any).__responseStatus || 200;

    log.info('API', `${method} ${url} → ${status} (${duration}ms)${clientName ? ` [${clientName}]` : ''}`);
  };
}

/**
 * Wrap the response to capture status code for logging.
 */
export function wrapResponse(res: http.ServerResponse): void {
  const originalWriteHead = res.writeHead.bind(res);
  (res as any).writeHead = function (statusCode: number, ...args: any[]) {
    (res as any).__responseStatus = statusCode;
    return originalWriteHead(statusCode, ...args);
  };
}
