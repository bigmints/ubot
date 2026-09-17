import { AgentMiddleware, MiddlewareContext, MiddlewareResult } from '../middleware.js';
import { ToolExecutionResult } from '../types.js';
import { log } from '../../logger/ring-buffer.js';

export class LoggingMiddleware implements AgentMiddleware {
  name = 'LoggingMiddleware';
  private startTimes = new Map<string, number>();

  async beforeTool(ctx: MiddlewareContext): Promise<MiddlewareResult | null> {
    const key = ctx.toolCallId || ctx.toolName;
    this.startTimes.set(key, Date.now());
    return null;
  }

  async afterTool(ctx: MiddlewareContext, result: ToolExecutionResult): Promise<MiddlewareResult | null> {
    const key = ctx.toolCallId || ctx.toolName;
    const startTime = this.startTimes.get(key);
    const duration = startTime ? Date.now() - startTime : 0;
    this.startTimes.delete(key);

    const toolName = ctx.toolName;
    if (result.success === true) {
      log.info('Agent', `✓ ${toolName} (${duration}ms)`);
    } else {
      log.warn('Agent', `✗ ${toolName} (${duration}ms): ${result.result || result.error}`);
    }

    return null;
  }

  async afterTurn(ctx: {
    iterations: number;
    toolResults: ToolExecutionResult[];
    sessionId: string;
  }): Promise<void> {
    const totalCalls = ctx.toolResults.length;
    const successCount = ctx.toolResults.filter(r => r.success === true).length;
    const failureCount = totalCalls - successCount;

    log.info('Agent', `Turn Summary: ${ctx.iterations} iterations, ${totalCalls} tool calls (✓ ${successCount}, ✗ ${failureCount})`);

    if (failureCount > 0) {
      const failedTools = ctx.toolResults
        .filter(r => r.success !== true)
        .map(r => `${r.toolName}: ${r.result || r.error}`);
      log.warn('Agent', `Failed Tools: ${failedTools.join(', ')}`);
    }
  }
}
