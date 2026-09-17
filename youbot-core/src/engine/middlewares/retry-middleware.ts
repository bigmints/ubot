import { AgentMiddleware, MiddlewareContext, MiddlewareResult } from '../middleware.js';
import { ToolExecutionResult } from '../types.js';
import { log } from '../../logger/ring-buffer.js';

/** Check if a tool error is transient (worth retrying) vs permanent */
function isTransientError(error: string): boolean {
  const transientPatterns = [
    'timeout', 'timed out', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
    'ENETUNREACH', 'EHOSTUNREACH', '-32001', 'network', 'socket hang up',
    'EPIPE', 'EAI_AGAIN', 'fetch failed', 'aborted',
  ];
  const lower = error.toLowerCase();
  return transientPatterns.some(p => lower.includes(p.toLowerCase()));
}

export class RetryMiddleware implements AgentMiddleware {
  readonly name = 'RetryMiddleware';

  constructor(
    private executeToolFn: (ctx: MiddlewareContext) => Promise<ToolExecutionResult>
  ) {}

  async afterTool(ctx: MiddlewareContext, result: ToolExecutionResult): Promise<MiddlewareResult | null> {
    if (!result.success && isTransientError(result.error || '')) {
      const MAX_RETRIES = 2;
      let currentResult = result;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const backoff = Math.pow(2, attempt) * 1000; // 2000ms, 4000ms
        log.warn('Agent', `Retrying ${ctx.toolName} (attempt ${attempt}/${MAX_RETRIES}): ${currentResult.error}`);
        
        await new Promise(r => setTimeout(r, backoff));
        
        currentResult = await this.executeToolFn(ctx);
        
        if (currentResult.success) {
          log.info('Agent', `Retry succeeded for ${ctx.toolName} on attempt ${attempt}`);
          return {
            skipExecution: currentResult
          };
        }
      }
    }

    return null;
  }
}
