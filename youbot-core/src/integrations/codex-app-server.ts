import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export interface CodexAccount {
  type: string;
  email?: string | null;
  planType?: string | null;
}

export interface CodexModel {
  id: string;
  model?: string;
  displayName?: string;
  hidden?: boolean;
  isDefault?: boolean;
  inputModalities?: string[];
}

export interface CodexToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CodexTurnInput {
  model: string;
  developerInstructions?: string;
  input: Array<Record<string, unknown>>;
  tools?: CodexToolDefinition[];
  outputSchema?: unknown;
  signal?: AbortSignal;
}

export interface CodexTurnResult {
  id: string;
  model: string;
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
  stopReason: "stop" | "toolUse" | "length" | "aborted" | "error";
  errorMessage?: string;
  usage: { input: number; output: number; totalTokens: number };
}

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type NotificationListener = (params: unknown) => void;
type ServerRequestHandler = (params: unknown) => Promise<unknown> | unknown;

const CLIENT_VERSION = "1.0.0";

function isTrustedChatGptAuthHost(hostname: string): boolean {
  return hostname === "chatgpt.com"
    || hostname.endsWith(".chatgpt.com")
    || hostname === "auth.openai.com";
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export class CodexAppServerClient {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private starting?: Promise<void>;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notifications = new Map<string, Set<NotificationListener>>();
  private readonly requestHandlers = new Map<string, Set<ServerRequestHandler>>();

  constructor(
    readonly codexHome: string,
    private readonly executable = path.resolve(
      __dirname,
      "../../node_modules/@openai/codex/bin/codex.js",
    ),
  ) {}

  private send(message: JsonRpcMessage): void {
    if (!this.process?.stdin.writable) throw new Error("Codex app-server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failPending(message: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }

  private async dispatch(message: JsonRpcMessage): Promise<void> {
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Codex app-server request failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      const handlers = [...(this.requestHandlers.get(message.method) ?? [])];
      try {
        if (!handlers.length) throw new Error(`Unsupported app-server request: ${message.method}`);
        let handled = false;
        for (const handler of handlers.reverse()) {
          const result = await handler(message.params);
          if (result === undefined) continue;
          this.send({ id: message.id, result });
          handled = true;
          break;
        }
        if (!handled) throw new Error(`Unsupported app-server request: ${message.method}`);
      } catch (cause) {
        this.send({
          id: message.id,
          error: { code: -32603, message: errorMessage(cause, "App-server request failed.") },
        });
      }
      return;
    }

    if (message.method) {
      for (const listener of this.notifications.get(message.method) ?? []) {
        listener(message.params);
      }
    }
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.process && !this.process.killed) return;
    this.starting = (async () => {
      await mkdir(this.codexHome, { recursive: true, mode: 0o700 });
      await chmod(this.codexHome, 0o700);
      const child = spawn(process.execPath, [this.executable, "app-server"], {
        env: { ...process.env, CODEX_HOME: this.codexHome },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.process = child;
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (!line.trim()) return;
        try {
          void this.dispatch(JSON.parse(line) as JsonRpcMessage);
        } catch {
          // App-server stderr carries diagnostics; malformed stdout must not expose credentials.
        }
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 8_000) stderr += chunk.toString("utf8").slice(0, 8_000 - stderr.length);
      });
      child.once("error", (cause) => this.failPending(errorMessage(cause, "Could not start Codex app-server.")));
      child.once("exit", (code) => {
        if (this.process === child) this.process = undefined;
        this.failPending(
          code === 0
            ? "Codex app-server stopped."
            : `Codex app-server stopped unexpectedly${stderr.trim() ? `: ${stderr.trim()}` : "."}`,
        );
      });
      await this.request("initialize", {
        clientInfo: { name: "youbot", title: "Youbot", version: CLIENT_VERSION },
        capabilities: { experimentalApi: true },
      });
      this.notify("initialized", {});
    })();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (method !== "initialize") await this.start();
    const id = this.nextId++;
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.send({ method, id, ...(params === undefined ? {} : { params }) });
    return response;
  }

  notify(method: string, params?: unknown): void {
    this.send({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(method: string, listener: NotificationListener): () => void {
    const listeners = this.notifications.get(method) ?? new Set<NotificationListener>();
    listeners.add(listener);
    this.notifications.set(method, listeners);
    return () => listeners.delete(listener);
  }

  onRequest(method: string, handler: ServerRequestHandler): () => void {
    const handlers = this.requestHandlers.get(method) ?? new Set<ServerRequestHandler>();
    handlers.add(handler);
    this.requestHandlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  async readAccount(refreshToken = false): Promise<{ account: CodexAccount | null }> {
    return this.request("account/read", { refreshToken });
  }

  async startChatGptLogin(): Promise<{ loginId: string; authUrl: string }> {
    const result = await this.request<Record<string, unknown>>("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt",
    });
    if (result.type !== "chatgpt" || typeof result.loginId !== "string" || typeof result.authUrl !== "string") {
      throw new Error("Codex app-server returned an invalid ChatGPT sign-in response.");
    }
    const authUrl = new URL(result.authUrl);
    if (authUrl.protocol !== "https:" || !isTrustedChatGptAuthHost(authUrl.hostname)) {
      throw new Error("ChatGPT sign-in returned an unexpected URL.");
    }
    return { loginId: result.loginId, authUrl: authUrl.toString() };
  }

  cancelChatGptLogin(loginId: string): Promise<unknown> {
    return this.request("account/login/cancel", { loginId });
  }

  logout(): Promise<unknown> {
    return this.request("account/logout");
  }

  async listModels(): Promise<CodexModel[]> {
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const result: { data?: CodexModel[]; nextCursor?: string | null } =
        await this.request<{ data?: CodexModel[]; nextCursor?: string | null }>(
        "model/list",
        { cursor, limit: 100, includeHidden: false },
      );
      models.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return models;
  }

  async complete(input: CodexTurnInput): Promise<CodexTurnResult> {
    await this.start();
    const dynamicTools = (input.tools ?? []).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
    const started = await this.request<{ thread?: { id?: string } }>("thread/start", {
      model: input.model,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "youbot",
      baseInstructions: "You are the response model inside Youbot. Answer the supplied conversation only. Do not inspect files, run commands, browse, or change the environment. Use only host-provided dynamic tools when a tool is required.",
      developerInstructions: input.developerInstructions || null,
      dynamicTools: dynamicTools.length ? dynamicTools : null,
    });
    const threadId = started.thread?.id;
    if (!threadId) throw new Error("Codex app-server did not create a conversation thread.");

    let turnId = "";
    let text = "";
    let reasoning = "";
    let completedItemText = "";
    let error: string | undefined;
    let stopReason: CodexTurnResult["stopReason"] = "stop";
    const toolCalls: CodexTurnResult["toolCalls"] = [];
    let usage = { input: 0, output: 0, totalTokens: 0 };

    const cleanups: Array<() => void> = [];
    let settle!: () => void;
    const finished = new Promise<void>((resolve) => { settle = resolve; });
    cleanups.push(this.onNotification("item/agentMessage/delta", (params) => {
      const event = params as { threadId?: string; turnId?: string; delta?: string };
      if (event.threadId === threadId && (!turnId || event.turnId === turnId)) text += event.delta ?? "";
    }));
    cleanups.push(this.onNotification("item/reasoning/textDelta", (params) => {
      const event = params as { threadId?: string; turnId?: string; delta?: string };
      if (event.threadId === threadId && (!turnId || event.turnId === turnId)) reasoning += event.delta ?? "";
    }));
    cleanups.push(this.onNotification("item/completed", (params) => {
      const event = params as { threadId?: string; turnId?: string; item?: Record<string, unknown> };
      if (event.threadId !== threadId || (turnId && event.turnId !== turnId)) return;
      if (event.item?.type === "agentMessage" && typeof event.item.text === "string") {
        completedItemText = event.item.text;
      }
    }));
    cleanups.push(this.onNotification("thread/tokenUsage/updated", (params) => {
      const event = params as { threadId?: string; turnId?: string; tokenUsage?: { last?: Record<string, number> } };
      if (event.threadId !== threadId || (turnId && event.turnId !== turnId)) return;
      const last = event.tokenUsage?.last;
      if (last) {
        usage = {
          input: last.inputTokens ?? 0,
          output: last.outputTokens ?? 0,
          totalTokens: last.totalTokens ?? 0,
        };
      }
    }));
    cleanups.push(this.onRequest("item/tool/call", async (params) => {
      const call = params as { threadId?: string; turnId?: string; callId?: string; tool?: string; arguments?: unknown };
      if (call.threadId !== threadId) return undefined;
      if (!call.callId || !call.tool) throw new Error("Invalid dynamic tool request.");
      toolCalls.push({ id: call.callId, name: call.tool, arguments: call.arguments ?? {} });
      stopReason = "toolUse";
      if (call.turnId) void this.request("turn/interrupt", { threadId, turnId: call.turnId }).catch(() => undefined);
      return {
        contentItems: [{ type: "inputText", text: "Tool call captured for the Youbot host." }],
        success: false,
      };
    }));
    cleanups.push(this.onNotification("turn/completed", (params) => {
      const event = params as { threadId?: string; turn?: { id?: string; status?: string; error?: unknown } };
      if (event.threadId !== threadId || (turnId && event.turn?.id !== turnId)) return;
      const status = event.turn?.status;
      if (status === "failed") {
        stopReason = "error";
        error = errorMessage(event.turn?.error, "Codex could not complete the request.");
      } else if (status === "interrupted" && !toolCalls.length) {
        stopReason = "aborted";
      }
      settle();
    }));

    const abort = () => {
      if (!turnId) return;
      void this.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const turn = await this.request<{ turn?: { id?: string } }>("turn/start", {
        threadId,
        input: input.input,
        model: input.model,
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      });
      turnId = turn.turn?.id ?? "";
      if (!turnId) throw new Error("Codex app-server did not start a response turn.");
      if (input.signal?.aborted) abort();
      await finished;
    } finally {
      input.signal?.removeEventListener("abort", abort);
      for (const cleanup of cleanups) cleanup();
      void this.request("thread/unsubscribe", { threadId }).catch(() => undefined);
    }

    return {
      id: turnId,
      model: input.model,
      text: completedItemText || text,
      reasoning,
      toolCalls,
      stopReason,
      ...(error ? { errorMessage: error } : {}),
      usage,
    };
  }

  async close(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    if (!child) return;
    child.kill("SIGTERM");
    this.failPending("Codex app-server stopped.");
  }
}
