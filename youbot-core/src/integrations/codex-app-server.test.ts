import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerClient } from "./codex-app-server.js";

const temporaryDirectories: string[] = [];

async function fakeServer(authUrl = "https://chatgpt.com/auth-test"): Promise<{ directory: string; executable: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "youbot-codex-server-test-"));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, "fake-codex-app-server.cjs");
  await writeFile(executable, String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
let pendingTool = false;
rl.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialized") return;
  if (message.id === 901 && pendingTool) {
    pendingTool = false;
    send({ method: "turn/completed", params: { threadId: "thread-test", turn: { id: "turn-test", status: "interrupted", error: null } } });
    return;
  }
  if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "fake" } });
  if (message.method === "account/read") return send({ id: message.id, result: { account: null, requiresOpenaiAuth: true } });
  if (message.method === "account/login/start") {
    if (message.params.type !== "chatgpt" || message.params.appBrand !== "chatgpt" || message.params.useHostedLoginSuccessPage !== true) {
      return send({ id: message.id, error: { code: -1, message: "wrong branding" } });
    }
      return send({ id: message.id, result: { type: "chatgpt", loginId: "login-test", authUrl: ${JSON.stringify(authUrl)} } });
  }
  if (message.method === "model/list") return send({ id: message.id, result: { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test" }], nextCursor: null } });
  if (message.method === "thread/start") {
    if (message.params.ephemeral !== true || message.params.dynamicTools?.[0]?.name !== "lookup") {
      return send({ id: message.id, error: { code: -1, message: "wrong thread params" } });
    }
    return send({ id: message.id, result: { thread: { id: "thread-test" } } });
  }
  if (message.method === "turn/start") {
    if (message.params.outputSchema?.type !== "object") return send({ id: message.id, error: { code: -1, message: "missing output schema" } });
    send({ id: message.id, result: { turn: { id: "turn-test" } } });
    const prompt = message.params.input?.[0]?.text || "";
    if (prompt.includes("use tool")) {
      pendingTool = true;
      send({ method: "item/tool/call", id: 901, params: { threadId: "thread-test", turnId: "turn-test", callId: "call-test", namespace: null, tool: "lookup", arguments: { id: 7 } } });
      return;
    }
    send({ method: "item/agentMessage/delta", params: { threadId: "thread-test", turnId: "turn-test", itemId: "item-test", delta: "{\"ok\":true}" } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-test", turnId: "turn-test", tokenUsage: { last: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } } } });
    send({ method: "item/completed", params: { threadId: "thread-test", turnId: "turn-test", item: { type: "agentMessage", id: "item-test", text: "{\"ok\":true}" } } });
    send({ method: "turn/completed", params: { threadId: "thread-test", turn: { id: "turn-test", status: "completed", error: null } } });
    return;
  }
  if (message.method === "turn/interrupt" || message.method === "thread/unsubscribe" || message.method === "account/login/cancel" || message.method === "account/logout") {
    return send({ id: message.id, result: {} });
  }
});
`);
  return { directory, executable };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("CodexAppServerClient", () => {
  it("uses ChatGPT-branded managed login through the official RPC shape", async () => {
    const { directory, executable } = await fakeServer();
    const client = new CodexAppServerClient(path.join(directory, "home"), executable);
    try {
      await expect(client.readAccount()).resolves.toEqual({ account: null, requiresOpenaiAuth: true });
      await expect(client.startChatGptLogin()).resolves.toEqual({
        loginId: "login-test",
        authUrl: "https://chatgpt.com/auth-test",
      });
      await expect(client.listModels()).resolves.toMatchObject([{ id: "gpt-test" }]);
    } finally {
      await client.close();
    }
  });

  it("accepts the official OpenAI OAuth host returned by the bundled runtime", async () => {
    const { directory, executable } = await fakeServer("https://auth.openai.com/oauth/authorize");
    const client = new CodexAppServerClient(path.join(directory, "home"), executable);
    try {
      await expect(client.startChatGptLogin()).resolves.toEqual({
        loginId: "login-test",
        authUrl: "https://auth.openai.com/oauth/authorize",
      });
    } finally {
      await client.close();
    }
  });

  it("rejects lookalike ChatGPT OAuth hosts", async () => {
    const { directory, executable } = await fakeServer("https://notchatgpt.com/oauth/authorize");
    const client = new CodexAppServerClient(path.join(directory, "home"), executable);
    try {
      await expect(client.startChatGptLogin()).rejects.toThrow("unexpected URL");
    } finally {
      await client.close();
    }
  });

  it("maps ephemeral turns, output schemas, usage, and captured dynamic tools", async () => {
    const { directory, executable } = await fakeServer();
    const client = new CodexAppServerClient(path.join(directory, "home"), executable);
    const common = {
      model: "gpt-test",
      tools: [{ name: "lookup", description: "Look up a record", inputSchema: { type: "object" } }],
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    };
    try {
      const completed = await client.complete({
        ...common,
        input: [{ type: "text", text: "answer", text_elements: [] }],
      });
      expect(completed).toMatchObject({
        text: '{"ok":true}',
        stopReason: "stop",
        usage: { input: 3, output: 4, totalTokens: 7 },
      });
      const tool = await client.complete({
        ...common,
        input: [{ type: "text", text: "use tool", text_elements: [] }],
      });
      expect(tool.stopReason).toBe("toolUse");
      expect(tool.toolCalls).toEqual([{ id: "call-test", name: "lookup", arguments: { id: 7 } }]);
    } finally {
      await client.close();
    }
  });
});
