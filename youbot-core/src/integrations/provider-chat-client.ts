import { randomUUID } from "node:crypto";

import OpenAI from "openai";

import { getProviderAccessService } from "./provider-access.js";

type ChatRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function textParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): Array<Record<string, unknown>> => {
    if (!part || typeof part !== "object") return [];
    const row = part as Record<string, unknown>;
    if (row.type === "text" && typeof row.text === "string") {
      return [{ type: "text", text: row.text }];
    }
    if (row.type === "image_url") {
      const image = row.image_url as { url?: unknown; detail?: unknown } | undefined;
      if (typeof image?.url === "string") {
        return [{
          type: "image",
          url: image.url,
          ...(typeof image.detail === "string" ? { detail: image.detail } : {}),
        }];
      }
    }
    return [];
  });
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return textParts(message.content)
    .filter((part) => part.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n");
}

function systemInstructions(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map(messageText)
    .filter(Boolean)
    .join("\n\n");
}

function transcript(messages: ChatMessage[]): string {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !("tool_calls" in message)) continue;
    for (const call of message.tool_calls ?? []) {
      if (call.type === "function") toolNames.set(call.id, call.function.name);
    }
  }
  return messages
    .filter((message) => message.role !== "system" && message.role !== "developer")
    .flatMap((message): string[] => {
      if (message.role === "assistant") {
        const lines = [`assistant: ${messageText(message)}`];
        for (const call of message.tool_calls ?? []) {
          if (call.type === "function") {
            lines.push(`assistant tool request ${call.function.name} (${call.id}): ${call.function.arguments}`);
          }
        }
        return lines;
      }
      if (message.role === "tool") {
        return [`tool ${toolNames.get(message.tool_call_id) ?? "result"} (${message.tool_call_id}): ${messageText(message)}`];
      }
      return [`${message.role}: ${messageText(message)}`];
    })
    .join("\n\n");
}

function toCodexInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [{
    type: "text",
    text: transcript(messages),
    text_elements: [],
  }];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of textParts(message.content)) {
      if (part.type === "image" && typeof part.url === "string") {
        input.push({
          type: "image",
          url: part.url,
          ...(typeof part.detail === "string" ? { detail: part.detail } : {}),
        });
      }
    }
  }
  return input;
}

function structuredOutputSchema(
  format: ChatRequest["response_format"],
): unknown | undefined {
  if (!format || format.type !== "json_schema") return undefined;
  return format.json_schema.schema;
}

async function createCodexCompletion(
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const result = await getProviderAccessService().codex.complete({
    model: request.model,
    developerInstructions: systemInstructions(request.messages),
    input: toCodexInput(request.messages),
    tools: (request.tools ?? []).flatMap((tool) =>
      tool.type === "function"
        ? [{
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
          }]
        : []),
    outputSchema: structuredOutputSchema(request.response_format),
    signal,
  });
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    throw new Error(result.errorMessage || "ChatGPT could not complete the request.");
  }
  const toolCalls = result.toolCalls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
  }));
  return {
    id: result.id || `youbot-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model || request.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: result.text || null,
        ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        refusal: null,
        annotations: [],
      },
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
      logprobs: null,
    }],
    usage: {
      prompt_tokens: result.usage.input,
      completion_tokens: result.usage.output,
      total_tokens: result.usage.totalTokens,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

async function createResponsesCompletion(
  client: OpenAI,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const responseFormat = request.response_format;
  const response = await client.responses.create({
    model: request.model,
    instructions: systemInstructions(request.messages) || undefined,
    input: transcript(request.messages),
    ...(request.tools?.length
      ? {
          tools: request.tools.flatMap((tool) =>
            tool.type === "function"
              ? [{
                  type: "function" as const,
                  name: tool.function.name,
                  description: tool.function.description,
                  parameters: tool.function.parameters,
                  strict: false,
                }]
              : []),
        }
      : {}),
    ...(responseFormat
      ? {
          text: {
            format:
              responseFormat.type === "json_schema"
                ? { type: "json_schema" as const, ...responseFormat.json_schema }
                : { type: "json_object" as const },
          },
        }
      : {}),
    ...(request.max_tokens ? { max_output_tokens: request.max_tokens } : {}),
    ...(request.temperature !== undefined && request.temperature !== null
      ? { temperature: request.temperature }
      : {}),
  } as never, { signal });
  const output = (response as unknown as { output?: Array<Record<string, unknown>> }).output ?? [];
  const toolCalls = output.flatMap((item) =>
    item.type === "function_call" && typeof item.name === "string"
      ? [{
          id: typeof item.call_id === "string" ? item.call_id : String(item.id ?? randomUUID()),
          type: "function" as const,
          function: {
            name: item.name,
            arguments: typeof item.arguments === "string" ? item.arguments : "{}",
          },
        }]
      : []);
  const usage = (response as unknown as {
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  }).usage;
  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: response.output_text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        refusal: null,
        annotations: [],
      },
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
      logprobs: null,
    }],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

async function createAnthropicCompletion(
  baseUrl: string,
  apiKey: string,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const messages = request.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: messageText(message),
    }));
  const schema = structuredOutputSchema(request.response_format);
  const system = [
    systemInstructions(request.messages),
    schema ? `Return only JSON matching this schema: ${JSON.stringify(schema)}` : "",
  ].filter(Boolean).join("\n\n");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: request.model,
      system: system || undefined,
      messages,
      max_tokens: request.max_tokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.flatMap((tool) =>
              tool.type === "function"
                ? [{
                    name: tool.function.name,
                    description: tool.function.description,
                    input_schema: tool.function.parameters,
                  }]
                : []),
          }
        : {}),
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      body.error && typeof body.error === "object" && "message" in body.error
        ? String((body.error as { message?: unknown }).message)
        : `Anthropic request failed with HTTP ${response.status}.`,
    );
  }
  const content = Array.isArray(body.content) ? body.content as Array<Record<string, unknown>> : [];
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text))
    .join("");
  const toolCalls = content.flatMap((item) =>
    item.type === "tool_use" && typeof item.name === "string"
      ? [{
          id: typeof item.id === "string" ? item.id : randomUUID(),
          type: "function" as const,
          function: { name: item.name, arguments: JSON.stringify(item.input ?? {}) },
        }]
      : []);
  const usage = body.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    id: typeof body.id === "string" ? body.id : `youbot-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        refusal: null,
        annotations: [],
      },
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
      logprobs: null,
    }],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

async function createGeminiCompletion(
  baseUrl: string,
  apiKey: string,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const url = new URL(
    `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(request.model)}:generateContent`,
  );
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: systemInstructions(request.messages)
        ? { parts: [{ text: systemInstructions(request.messages) }] }
        : undefined,
      contents: request.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: messageText(message) }],
        })),
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.max_tokens ? { maxOutputTokens: request.max_tokens } : {}),
        ...(structuredOutputSchema(request.response_format)
          ? {
              responseMimeType: "application/json",
              responseSchema: structuredOutputSchema(request.response_format),
            }
          : {}),
      },
      ...(request.tools?.length
        ? {
            tools: [{
              functionDeclarations: request.tools.flatMap((tool) =>
                tool.type === "function"
                  ? [{
                      name: tool.function.name,
                      description: tool.function.description,
                      parameters: tool.function.parameters,
                    }]
                  : []),
            }],
          }
        : {}),
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google AI request failed with HTTP ${response.status}.`);
  const candidate = Array.isArray(body.candidates)
    ? body.candidates[0] as { content?: { parts?: Array<Record<string, unknown>> } } | undefined
    : undefined;
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => typeof part.text === "string")
    .map((part) => String(part.text))
    .join("");
  const toolCalls = parts.flatMap((part) => {
    const call = part.functionCall as { name?: unknown; args?: unknown } | undefined;
    return call && typeof call.name === "string"
      ? [{
          id: randomUUID(),
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        }]
      : [];
  });
  const usage = body.usageMetadata as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } | undefined;
  return {
    id: `youbot-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        refusal: null,
        annotations: [],
      },
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
      logprobs: null,
    }],
    usage: {
      prompt_tokens: usage?.promptTokenCount ?? 0,
      completion_tokens: usage?.candidatesTokenCount ?? 0,
      total_tokens: usage?.totalTokenCount ?? 0,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

export function createProviderChatClient(providerId: string): OpenAI {
  const create = async (
    request: ChatRequest,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
    if (providerId === "openai-codex") {
      return createCodexCompletion(request, requestOptions?.signal);
    }
    const connection = await getProviderAccessService().getProviderHttpModel(
      providerId,
      request.model,
    );
    if (!connection.apiKey && !providerId.startsWith("custom-")) {
      throw new Error("Connect this provider before using it.");
    }
    if (connection.api === "anthropic-messages" && providerId === "anthropic") {
      return createAnthropicCompletion(
        connection.baseUrl,
        connection.apiKey || "",
        request,
        requestOptions?.signal,
      );
    }
    if (connection.api === "google-generative-ai" && providerId === "google") {
      return createGeminiCompletion(
        connection.baseUrl,
        connection.apiKey || "",
        request,
        requestOptions?.signal,
      );
    }
    const client = new OpenAI({
      apiKey: connection.apiKey || "youbot-keyless-provider",
      baseURL: connection.baseUrl,
      defaultHeaders: connection.headers,
    });
    if (connection.api === "openai-responses") {
      return createResponsesCompletion(client, request, requestOptions?.signal);
    }
    return client.chat.completions.create(request, {
      signal: requestOptions?.signal,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>;
  };

  return { chat: { completions: { create } } } as unknown as OpenAI;
}
