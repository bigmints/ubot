import { AgentMiddleware, MiddlewareContext, MiddlewareResult } from '../middleware.js';
import { ToolExecutionResult } from '../types.js';
import { getCircuitBreaker } from '../circuit-breaker.js';

export class CircuitBreakerMiddleware implements AgentMiddleware {
  name = 'CircuitBreakerMiddleware';

  async beforeTool(ctx: MiddlewareContext): Promise<MiddlewareResult | null> {
    const breaker = getCircuitBreaker();
    const errorMessage = breaker.isOpen(ctx.toolName);
    
    if (errorMessage) {
      return {
        skipExecution: {
          toolName: ctx.toolName,
          success: false,
          result: errorMessage,
          duration: 0
        } as ToolExecutionResult
      };
    }
    
    return null;
  }

  async afterTool(ctx: MiddlewareContext, result: ToolExecutionResult): Promise<MiddlewareResult | null> {
    const breaker = getCircuitBreaker();
    
    if (result.success) {
      breaker.recordSuccess(ctx.toolName);
    } else {
      breaker.recordFailure(ctx.toolName, result.result || result.error || 'Unknown error');
    }
    
    return null;
  }
}
