import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexAppServerClient } from "./codex-app-server.js";
import {
  normalizeCustomProviderBaseUrl,
  parseCompatibleModels,
  ProviderAccessService,
} from "./provider-access.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "youbot-provider-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeCodex(overrides: Record<string, unknown> = {}): CodexAppServerClient {
  return {
    readAccount: vi.fn(async () => ({ account: null, requiresOpenaiAuth: true })),
    listModels: vi.fn(async () => []),
    onNotification: vi.fn(() => () => undefined),
    startChatGptLogin: vi.fn(async () => ({
      loginId: "login-test",
      authUrl: "https://chatgpt.com/auth-test",
    })),
    cancelChatGptLogin: vi.fn(async () => ({})),
    logout: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as CodexAppServerClient;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("custom provider validation", () => {
  it("allows secure public URLs and private HTTP URLs", () => {
    expect(normalizeCustomProviderBaseUrl("https://models.example.com/v1/"))
      .toBe("https://models.example.com/v1");
    expect(normalizeCustomProviderBaseUrl("http://127.0.0.1:8000/v1"))
      .toBe("http://127.0.0.1:8000/v1");
    expect(normalizeCustomProviderBaseUrl("http://100.77.38.96:9000/v1"))
      .toBe("http://100.77.38.96:9000/v1");
  });

  it("rejects insecure public URLs and URLs containing credentials", () => {
    expect(() => normalizeCustomProviderBaseUrl("http://models.example.com/v1")).toThrow(/HTTPS/);
    expect(() => normalizeCustomProviderBaseUrl("https://user:secret@models.example.com/v1"))
      .toThrow(/credentials/);
  });

  it("deduplicates and filters an OpenAI-compatible model list", () => {
    expect(parseCompatibleModels({
      data: [
        { id: "alpha", name: "Alpha" },
        { id: "alpha", name: "Duplicate" },
        { id: "beta" },
        { nope: true },
      ],
    })).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "beta" },
    ]);
  });
});

describe("ProviderAccessService", () => {
  it("verifies and stores a custom provider without returning or writing its secret to models.json", async () => {
    const directory = await temporaryDirectory();
    const request = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-key");
      return new Response(JSON.stringify({
        data: [{ id: "local-chat", name: "Local Chat" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const service = new ProviderAccessService(directory, request as typeof fetch, fakeCodex());
    const state = await service.addCustom({
      name: "Local AI",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "secret-key",
    });
    expect(state.providers.find((provider) => provider.id === "custom-local-ai")).toMatchObject({
      connected: true,
      credentialType: "api-key",
    });
    expect(JSON.stringify(state)).not.toContain("secret-key");
    expect(await readFile(path.join(directory, "models.json"), "utf8")).not.toContain("secret-key");
  });

  it("rejects a selected model that was not returned by the endpoint", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "available-model", name: "Available Model" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new ProviderAccessService(
      await temporaryDirectory(),
      request as typeof fetch,
      fakeCodex(),
    );
    await expect(service.addCustom({
      name: "Local AI",
      baseUrl: "http://127.0.0.1:8080/v1",
      modelId: "missing-model",
    })).rejects.toThrow("Choose a model returned by provider.");
  });

  it("migrates a Pi-format custom key transactionally without exposing or deleting the source", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "auth.json"), JSON.stringify({
      "custom-gx10": { type: "api_key", key: "gx10-secret" },
      "openai-codex": { type: "oauth", access: "legacy-access", refresh: "legacy-refresh" },
    }), { mode: 0o600 });
    await writeFile(path.join(directory, "models.json"), JSON.stringify({
      providers: {
        "custom-gx10": {
          name: "gx10",
          baseUrl: "http://100.77.38.96:8080/v1",
          models: [{ id: "gx-model", name: "GX Model" }],
        },
      },
    }), { mode: 0o600 });
    const service = new ProviderAccessService(directory, fetch, fakeCodex());
    const state = await service.state();
    expect(state.providers.find((provider) => provider.id === "custom-gx10")).toMatchObject({
      connected: true,
      credentialType: "api-key",
    });
    expect(JSON.stringify(state)).not.toContain("gx10-secret");
    expect(await readFile(path.join(directory, "auth.json"), "utf8")).toContain("gx10-secret");
    const migrated = await readFile(path.join(directory, "credentials.json"), "utf8");
    expect(migrated).toContain("gx10-secret");
    expect(migrated).not.toContain("legacy-access");
    expect(migrated).not.toContain("legacy-refresh");
  });

  it("starts only the ChatGPT-branded subscription flow and supports cancellation", async () => {
    const codex = fakeCodex();
    const service = new ProviderAccessService(await temporaryDirectory(), fetch, codex);
    const waiting = await service.startSubscription("openai-codex");
    expect(waiting).toMatchObject({
      status: "waiting",
      authUrl: "https://chatgpt.com/auth-test",
    });
    expect(service.cancel()).toMatchObject({ status: "idle", authUrl: undefined });
    expect(codex.cancelChatGptLogin).toHaveBeenCalledWith("login-test");
  });
});
