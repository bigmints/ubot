import { ToolExecutionResult } from './types.js';

export interface AgentMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface MiddlewareContext {
  messages: AgentMessage[];
  toolName: string;
  toolArgs: Record<string, any>;
  toolCallId?: string;
  sessionId: string;
  iteration: number;
  maxIterations: number;
  toolContext?: any;
}

export interface MiddlewareResult {
  skipExecution?: ToolExecutionResult;
  injectMessage?: AgentMessage;
  shouldBreak?: boolean;
  breakReason?: string;
}

export interface AgentMiddleware {
  name: string;
  beforeTool?(ctx: MiddlewareContext): Promise<MiddlewareResult | null>;
  afterTool?(ctx: MiddlewareContext, result: ToolExecutionResult): Promise<MiddlewareResult | null>;
  beforeIteration?(ctx: {
    iteration: number;
    maxIterations: number;
    sessionId: string;
    messages: AgentMessage[];
  }): Promise<MiddlewareResult | null>;
  afterTurn?(ctx: {
    iterations: number;
    toolResults: ToolExecutionResult[];
    sessionId: string;
  }): Promise<void>;
}

export class MiddlewarePipeline {
  private middlewares: AgentMiddleware[] = [];

  use(middleware: AgentMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  getMiddlewares(): AgentMiddleware[] {
    return [...this.middlewares];
  }

  async runBeforeTool(ctx: MiddlewareContext): Promise<MiddlewareResult | null> {
    for (const middleware of this.middlewares) {
      if (middleware.beforeTool) {
        const result = await middleware.beforeTool(ctx);
        if (result) return result;
      }
    }
    return null;
  }

  async runAfterTool(ctx: MiddlewareContext, result: ToolExecutionResult): Promise<MiddlewareResult | null> {
    for (const middleware of this.middlewares) {
      if (middleware.afterTool) {
        const afterResult = await middleware.afterTool(ctx, result);
        if (afterResult) return afterResult;
      }
    }
    return null;
  }

  async runBeforeIteration(ctx: {
    iteration: number;
    maxIterations: number;
    sessionId: string;
    messages: AgentMessage[];
  }): Promise<MiddlewareResult | null> {
    for (const middleware of this.middlewares) {
      if (middleware.beforeIteration) {
        const result = await middleware.beforeIteration(ctx);
        if (result) return result;
      }
    }
    return null;
  }

  async runAfterTurn(ctx: {
    iterations: number;
    toolResults: ToolExecutionResult[];
    sessionId: string;
  }): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.afterTurn) {
        await middleware.afterTurn(ctx);
      }
    }
  }
}
