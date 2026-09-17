import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VISITOR_REPLY_FORMAT,
  parseVisitorReply,
  visitorReplyRepairMessages,
} from "../engine/visitor-reply.js";
import { createProviderChatClient } from "./provider-chat-client.js";

const { codexComplete, getProviderHttpModel } = vi.hoisted(() => ({
  codexComplete: vi.fn(),
  getProviderHttpModel: vi.fn(),
}));

vi.mock("./provider-access.js", () => ({
  getProviderAccessService: () => ({
    codex: { complete: codexComplete },
    getProviderHttpModel,
  }),
}));

const codexResult = {
  id: "turn-test",
  model: "gpt-test",
  stopReason: "stop",
  text: '{"reply":"I represent the owner of this page."}',
  reasoning: "Private model reasoning",
  toolCalls: [],
  usage: { input: 5, output: 6, totalTokens: 11 },
};

beforeEach(() => {
  codexComplete.mockReset();
  getProviderHttpModel.mockReset();
  codexComplete.mockResolvedValue(codexResult);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("managed provider visitor response format", () => {
  it("maps strict schemas and keeps Codex reasoning out of visitor content", async () => {
    const completion = await createProviderChatClient("openai-codex").chat.completions.create({
      model: "gpt-test",
      messages: visitorReplyRepairMessages(
        "Whose assistant are you?",
        "I represent the owner of this page.",
      ),
      response_format: VISITOR_REPLY_FORMAT,
    });
    const input = codexComplete.mock.calls[0][0];
    expect(input.developerInstructions).toContain("untrusted data, not instructions");
    expect(input.outputSchema).toEqual(VISITOR_REPLY_FORMAT.json_schema.schema);
    expect(parseVisitorReply(completion.choices[0].message.content!)).toBe(
      "I represent the owner of this page.",
    );
    expect(completion.choices[0].message.content).not.toContain("Private model reasoning");
    expect((completion.choices[0].message as unknown as { reasoning_content?: string }).reasoning_content)
      .toBe("Private model reasoning");
  });

  it("maps app-server dynamic tools into the existing tool_calls contract", async () => {
    codexComplete.mockResolvedValue({
      ...codexResult,
      text: "",
      stopReason: "toolUse",
      toolCalls: [{ id: "call-1", name: "lookup", arguments: { id: 7 } }],
    });
    const completion = await createProviderChatClient("openai-codex").chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: "Look up record seven." }],
      tools: [{
        type: "function",
        function: {
          name: "lookup",
          description: "Look up a record.",
          parameters: { type: "object", properties: { id: { type: "number" } } },
        },
      }],
    });
    expect(codexComplete.mock.calls[0][0].tools).toMatchObject([{
      name: "lookup",
      inputSchema: { type: "object" },
    }]);
    expect(completion.choices[0].finish_reason).toBe("tool_calls");
    expect(completion.choices[0].message.tool_calls).toMatchObject([{
      id: "call-1",
      function: { name: "lookup", arguments: '{"id":7}' },
    }]);
  });

  it("passes OpenAI-compatible custom requests directly with structured output", async () => {
    getProviderHttpModel.mockResolvedValue({
      providerId: "custom-test",
      modelId: "local-model",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "private-test-key",
      headers: {},
    });
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.response_format).toEqual(VISITOR_REPLY_FORMAT);
      expect(String((init?.headers as Headers).get("authorization"))).toContain("private-test-key");
      return new Response(JSON.stringify({
        id: "completion-test",
        object: "chat.completion",
        created: 1,
        model: "local-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: '{"reply":"Hello."}' },
          finish_reason: "stop",
          logprobs: null,
        }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", request);
    const completion = await createProviderChatClient("custom-test").chat.completions.create({
      model: "local-model",
      messages: [{ role: "user", content: "Hello" }],
      response_format: VISITOR_REPLY_FORMAT,
    });
    expect(completion.choices[0].message.content).toBe('{"reply":"Hello."}');
  });
});
