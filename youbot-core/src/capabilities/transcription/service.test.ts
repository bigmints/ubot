import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { transcribeAudio } from "./service.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("transcription routing", () => {
  it("sends the routed model to an OpenAI-compatible transcription endpoint", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "youbot-transcription-test-"));
    directories.push(directory);
    const audio = path.join(directory, "sample.wav");
    await writeFile(audio, Buffer.from("audio"));
    let requestBody = "";
    let requestHeaders: HeadersInit | undefined;
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const rawBody = init?.body as unknown;
      requestBody = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : Buffer.from(rawBody as ArrayBuffer).toString("utf8");
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({ text: "hello", language: "en" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", request);

    await expect(transcribeAudio(audio, {
      providerBaseUrl: "http://127.0.0.1:9000/v1",
      providerApiKey: "test-key",
      providerModelId: "routed-whisper-model",
      providerHeaders: { "x-test-route": "yes" },
    })).resolves.toMatchObject({ text: "hello", language: "en" });
    expect(request).toHaveBeenCalledOnce();
    expect(requestBody).toContain("routed-whisper-model");
    expect(requestHeaders).toMatchObject({ "x-test-route": "yes" });
  });
});
