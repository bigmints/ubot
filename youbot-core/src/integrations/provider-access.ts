import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import providerCatalogueJson from "./provider-catalog.json";
import {
  CodexAppServerClient,
  type CodexAccount,
  type CodexModel,
} from "./codex-app-server.js";

type CatalogueModel = {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  input?: string[];
  maxTokens?: number;
};

type CatalogueProvider = {
  id: string;
  name: string;
  baseUrl?: string;
  models: CatalogueModel[];
};

type StoredCredential = {
  type: "api_key";
  key: string;
};

type CredentialConfig = {
  version: 1;
  migratedFromPi: boolean;
  providers: Record<string, StoredCredential>;
};

type CustomProviderConfig = {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  authHeader?: boolean;
  models?: Array<{
    id?: string;
    name?: string;
    api?: string;
    baseUrl?: string;
    input?: string[];
    maxTokens?: number;
  }>;
};

type ModelsConfig = {
  providers?: Record<string, CustomProviderConfig | unknown>;
};

export interface ProviderAccessModel {
  id: string;
  name: string;
}

export interface ProviderAccessProvider {
  id: string;
  name: string;
  methods: Array<"subscription" | "api-key">;
  connected: boolean;
  configured: boolean;
  credentialType?: "subscription" | "api-key" | "none";
  custom: boolean;
  keyless: boolean;
  subscriptionLabel?: string;
  accountLabel?: string;
  models: ProviderAccessModel[];
}

export interface ProviderAccessState {
  status: "idle" | "waiting" | "authenticated" | "failed";
  providers: ProviderAccessProvider[];
  message?: string;
  authUrl?: string;
  deviceCode?: string;
  prompt?: {
    id: string;
    type: string;
    message: string;
    options?: Array<{ id: string; label: string }>;
  };
}

export interface CustomProviderInput {
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelId?: string;
}

export interface CustomProviderVerification {
  baseUrl: string;
  modelsEndpoint: string;
  models: ProviderAccessModel[];
}

export interface ProviderHttpModel {
  providerId: string;
  modelId: string;
  api: string;
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
}

const KEYLESS_PI_COMPATIBILITY_TOKEN = "youbot-keyless-provider";
const PROVIDER_CATALOGUE = providerCatalogueJson as CatalogueProvider[];
const CHATGPT_PROVIDER_ID = "openai-codex";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

let singleton: ProviderAccessService | undefined;

function isPrivateHttpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (version === 6) return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return false;
}

export function normalizeCustomProviderBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Provider URL cannot contain credentials, query parameters, or a fragment.");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isPrivateHttpHost(url.hostname))
  ) {
    throw new Error(
      "Use HTTPS, or HTTP for a loopback, private-network, or Tailnet provider.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function parseCompatibleModels(body: unknown): ProviderAccessModel[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error("Provider did not return an OpenAI-compatible model list.");
  }
  const models: ProviderAccessModel[] = [];
  const seen = new Set<string>();
  for (const item of (body as { data: unknown[] }).data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || id.length > 300 || seen.has(id)) continue;
    seen.add(id);
    const name =
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim().slice(0, 300)
        : typeof row.display_name === "string" && row.display_name.trim()
          ? row.display_name.trim().slice(0, 300)
          : id;
    models.push({ id, name });
  }
  if (!models.length) throw new Error("Provider returned no usable models.");
  return models;
}

function emptyCredentialConfig(): CredentialConfig {
  return { version: 1, migratedFromPi: false, providers: {} };
}

function accountLabel(account: CodexAccount | null): string | undefined {
  if (!account || account.type !== "chatgpt") return undefined;
  const details = [account.email, account.planType].filter(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  return details.join(" · ") || "ChatGPT subscription";
}

export class ProviderAccessService {
  private credentials: CredentialConfig = emptyCredentialConfig();
  private initialized = false;
  private account: CodexAccount | null = null;
  private codexModels: CodexModel[] = [];
  private loginId?: string;
  private listenersInstalled = false;
  private current: ProviderAccessState = { status: "idle", providers: [] };
  private mutation: Promise<unknown> = Promise.resolve();
  readonly codex: CodexAppServerClient;

  constructor(
    readonly directory: string,
    private readonly request: typeof fetch = fetch,
    codex?: CodexAppServerClient,
  ) {
    this.codex = codex ?? new CodexAppServerClient(path.join(directory, "codex-home"));
  }

  private update(change: Partial<ProviderAccessState>): ProviderAccessState {
    this.current = { ...this.current, ...change };
    return structuredClone(this.current);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.catch(() => undefined).then(operation);
    this.mutation = result;
    return result;
  }

  private async readModelsConfig(): Promise<ModelsConfig> {
    const file = path.join(this.directory, "models.json");
    const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    });
    return JSON.parse(raw) as ModelsConfig;
  }

  private async writePrivateJson(file: string, value: unknown): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
    await chmod(file, 0o600);
  }

  private async writeModelsConfig(config: ModelsConfig): Promise<void> {
    await this.writePrivateJson(path.join(this.directory, "models.json"), config);
  }

  private async migrateLegacyCredentials(config: CredentialConfig): Promise<CredentialConfig> {
    if (config.migratedFromPi) return config;
    const legacyPath = path.join(this.directory, "auth.json");
    const raw = await readFile(legacyPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    });
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    const migrated = structuredClone(config);
    for (const [providerId, value] of Object.entries(legacy)) {
      if (migrated.providers[providerId] || !value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if (row.type === "api_key" && typeof row.key === "string" && row.key.trim()) {
        migrated.providers[providerId] = { type: "api_key", key: row.key };
      }
    }
    migrated.migratedFromPi = true;
    await this.writePrivateJson(path.join(this.directory, "credentials.json"), migrated);
    const readback = JSON.parse(
      await readFile(path.join(this.directory, "credentials.json"), "utf8"),
    ) as CredentialConfig;
    if (!readback.migratedFromPi) throw new Error("Provider credential migration did not persist.");
    return readback;
  }

  private async loadCredentials(): Promise<void> {
    const file = path.join(this.directory, "credentials.json");
    const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return JSON.stringify(emptyCredentialConfig());
      throw error;
    });
    const parsed = JSON.parse(raw) as Partial<CredentialConfig>;
    const config: CredentialConfig = {
      version: 1,
      migratedFromPi: parsed.migratedFromPi === true,
      providers:
        parsed.providers && typeof parsed.providers === "object"
          ? parsed.providers as Record<string, StoredCredential>
          : {},
    };
    this.credentials = await this.migrateLegacyCredentials(config);
  }

  private installCodexListeners(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    this.codex.onNotification("account/login/completed", (params) => {
      const event = params as { loginId?: string | null; success?: boolean; error?: string | null };
      if (this.loginId && event.loginId && event.loginId !== this.loginId) return;
      this.loginId = undefined;
      if (!event.success) {
        this.update({
          status: "failed",
          message: event.error || "ChatGPT sign-in did not complete.",
          authUrl: undefined,
        });
        return;
      }
      void this.refreshChatGpt(true).then(() => {
        this.update({
          status: "authenticated",
          message: "ChatGPT subscription connected.",
          authUrl: undefined,
        });
      }).catch((cause) => {
        this.update({
          status: "failed",
          message: cause instanceof Error ? cause.message : "Could not read the ChatGPT account.",
          authUrl: undefined,
        });
      });
    });
    this.codex.onNotification("account/updated", () => {
      void this.refreshChatGpt(false).catch(() => undefined);
    });
  }

  private async refreshChatGpt(refreshToken: boolean): Promise<void> {
    const result = await this.codex.readAccount(refreshToken);
    this.account = result.account?.type === "chatgpt" ? result.account : null;
    this.codexModels = this.account ? await this.codex.listModels() : [];
    await this.refreshProviders();
  }

  private async refreshProviders(): Promise<void> {
    const customProviders = (await this.readModelsConfig()).providers ?? {};
    const providers: ProviderAccessProvider[] = [];
    providers.push({
      id: CHATGPT_PROVIDER_ID,
      name: "ChatGPT",
      methods: ["subscription"],
      connected: this.account?.type === "chatgpt",
      configured: this.account?.type === "chatgpt",
      credentialType: this.account?.type === "chatgpt" ? "subscription" : undefined,
      custom: false,
      keyless: false,
      subscriptionLabel: "Sign in with ChatGPT",
      accountLabel: accountLabel(this.account),
      models: this.codexModels.map((model) => ({
        id: model.model || model.id,
        name: model.displayName || model.model || model.id,
      })),
    });

    for (const provider of PROVIDER_CATALOGUE) {
      const connected = Boolean(this.credentials.providers[provider.id]);
      providers.push({
        id: provider.id,
        name: provider.name,
        methods: ["api-key"],
        connected,
        configured: connected,
        credentialType: connected ? "api-key" : undefined,
        custom: false,
        keyless: false,
        models: provider.models.map((model) => ({ id: model.id, name: model.name })),
      });
    }

    for (const [id, raw] of Object.entries(customProviders)) {
      if (!id.startsWith("custom-") || !raw || typeof raw !== "object") continue;
      const provider = raw as CustomProviderConfig;
      const keyless =
        provider.apiKey === KEYLESS_PI_COMPATIBILITY_TOKEN ||
        !this.credentials.providers[id];
      providers.push({
        id,
        name: provider.name?.trim() || id,
        methods: keyless ? [] : ["api-key"],
        connected: keyless || Boolean(this.credentials.providers[id]),
        configured: true,
        credentialType: keyless ? "none" : "api-key",
        custom: true,
        keyless,
        models: (provider.models ?? []).flatMap((model) => {
          const modelId = model.id?.trim();
          return modelId ? [{ id: modelId, name: model.name?.trim() || modelId }] : [];
        }),
      });
    }
    providers.sort((a, b) => {
      if (a.id === CHATGPT_PROVIDER_ID) return -1;
      if (b.id === CHATGPT_PROVIDER_ID) return 1;
      return a.name.localeCompare(b.name);
    });
    this.update({ providers });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    await this.loadCredentials();
    this.installCodexListeners();
    try {
      const result = await this.codex.readAccount(false);
      this.account = result.account?.type === "chatgpt" ? result.account : null;
      this.codexModels = this.account ? await this.codex.listModels() : [];
    } catch {
      this.account = null;
      this.codexModels = [];
    }
    await this.refreshProviders();
    this.initialized = true;
  }

  async state(): Promise<ProviderAccessState> {
    await this.initialize();
    return structuredClone(this.current);
  }

  async startSubscription(providerId: string): Promise<ProviderAccessState> {
    await this.initialize();
    if (providerId !== CHATGPT_PROVIDER_ID) {
      throw new Error("ChatGPT is the supported subscription provider.");
    }
    if (this.loginId) await this.codex.cancelChatGptLogin(this.loginId).catch(() => undefined);
    const login = await this.codex.startChatGptLogin();
    this.loginId = login.loginId;
    return this.update({
      status: "waiting",
      message: "Continue with ChatGPT in your browser.",
      authUrl: login.authUrl,
      deviceCode: undefined,
      prompt: undefined,
    });
  }

  cancel(): ProviderAccessState {
    const loginId = this.loginId;
    this.loginId = undefined;
    if (loginId) void this.codex.cancelChatGptLogin(loginId).catch(() => undefined);
    return this.update({
      status: "idle",
      message: undefined,
      authUrl: undefined,
      deviceCode: undefined,
      prompt: undefined,
    });
  }

  respond(_id?: string, _value?: string): ProviderAccessState {
    throw new Error("ChatGPT sign-in continues in the browser.");
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.request(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`Provider verification failed with HTTP ${response.status}.`);
      if (!response.body) throw new Error("Provider returned an empty response.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          controller.abort();
          throw new Error("Provider response is too large.");
        }
        chunks.push(value);
      }
      const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("Provider returned invalid JSON.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async verifyApiKey(provider: CatalogueProvider, apiKey: string): Promise<void> {
    const sample = provider.models.find((model) => model.baseUrl) ?? provider.models[0];
    const baseUrl = sample?.baseUrl || provider.baseUrl;
    if (!baseUrl || baseUrl.includes("{")) {
      throw new Error(
        `${provider.name} needs provider-specific settings. Add it as a custom endpoint for now.`,
      );
    }
    if (sample?.api === "google-generative-ai") {
      const url = new URL(`${baseUrl.replace(/\/$/, "")}/models`);
      url.searchParams.set("key", apiKey);
      await this.fetchJson(url.toString(), { method: "GET" });
      return;
    }
    if (sample?.api === "anthropic-messages" && provider.id === "anthropic") {
      await this.fetchJson(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
        method: "GET",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      return;
    }
    const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
    await this.fetchJson(modelsUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
  }

  async saveApiKey(providerId: string, apiKey: string): Promise<ProviderAccessState> {
    await this.initialize();
    const provider = PROVIDER_CATALOGUE.find((item) => item.id === providerId);
    if (!provider) throw new Error("Choose a supported API-key provider.");
    const key = apiKey.trim();
    if (!key || key.length > 8192) throw new Error("Enter a valid API key.");
    await this.verifyApiKey(provider, key);
    return this.serialize(async () => {
      const previous = structuredClone(this.credentials);
      try {
        this.credentials.providers[providerId] = { type: "api_key", key };
        await this.writePrivateJson(path.join(this.directory, "credentials.json"), this.credentials);
        await this.loadCredentials();
        if (this.credentials.providers[providerId]?.key !== key) {
          throw new Error("Provider key readback failed.");
        }
        await this.refreshProviders();
        return this.update({ status: "authenticated", message: "API key verified and saved." });
      } catch (cause) {
        this.credentials = previous;
        await this.writePrivateJson(path.join(this.directory, "credentials.json"), previous);
        throw cause;
      }
    });
  }

  async remove(providerId: string): Promise<ProviderAccessState> {
    await this.initialize();
    if (providerId === CHATGPT_PROVIDER_ID) {
      await this.codex.logout();
      this.account = null;
      this.codexModels = [];
      await this.refreshProviders();
      return this.update({ status: "idle", message: "ChatGPT signed out." });
    }
    return this.serialize(async () => {
      const credentials = structuredClone(this.credentials);
      const config = await this.readModelsConfig();
      delete this.credentials.providers[providerId];
      const next = structuredClone(config);
      if (providerId.startsWith("custom-") && next.providers) delete next.providers[providerId];
      try {
        await this.writePrivateJson(path.join(this.directory, "credentials.json"), this.credentials);
        await this.writeModelsConfig(next);
        await this.loadCredentials();
        await this.refreshProviders();
        return this.update({ status: "idle", message: "Provider removed." });
      } catch (cause) {
        this.credentials = credentials;
        await this.writePrivateJson(path.join(this.directory, "credentials.json"), credentials);
        await this.writeModelsConfig(config);
        throw cause;
      }
    });
  }

  private async discoverCustomModels(
    input: CustomProviderInput,
  ): Promise<CustomProviderVerification> {
    const baseUrl = normalizeCustomProviderBaseUrl(input.baseUrl);
    const apiKey = input.apiKey?.trim() ?? "";
    if (apiKey.length > 8192) throw new Error("API key is too long.");
    const modelsEndpoint = `${baseUrl}/models`;
    const body = await this.fetchJson(modelsEndpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    return { baseUrl, modelsEndpoint, models: parseCompatibleModels(body) };
  }

  async verifyCustom(input: CustomProviderInput): Promise<CustomProviderVerification> {
    if (!input.name.trim()) throw new Error("Enter a provider name.");
    return this.discoverCustomModels(input);
  }

  async addCustom(input: CustomProviderInput): Promise<ProviderAccessState> {
    const verification = await this.verifyCustom(input);
    if (input.modelId && !verification.models.some((model) => model.id === input.modelId)) {
      throw new Error("Choose a model returned by provider.");
    }
    await this.initialize();
    return this.serialize(async () => {
      const config = await this.readModelsConfig();
      const providers = config.providers ?? {};
      const name = input.name.trim();
      const existing = Object.entries(providers).find(([id, value]) => {
        if (!id.startsWith("custom-") || !value || typeof value !== "object") return false;
        const provider = value as CustomProviderConfig;
        return (
          provider.name?.toLowerCase() === name.toLowerCase() ||
          provider.baseUrl === verification.baseUrl
        );
      })?.[0];
      const slug =
        name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
        "provider";
      const preferred = `custom-${slug}`;
      const id = existing ?? (providers[preferred] ? `${preferred}-${randomUUID().slice(0, 8)}` : preferred);
      const apiKey = input.apiKey?.trim() ?? "";
      const previousCredentials = structuredClone(this.credentials);
      const previousConfig = structuredClone(config);
      config.providers = {
        ...providers,
        [id]: {
          name,
          baseUrl: verification.baseUrl,
          authHeader: true,
          models: verification.models.map((model) => ({
            id: model.id,
            name: model.name,
            api: "openai-completions",
            baseUrl: verification.baseUrl,
            input: ["text"],
            maxTokens: 16_384,
          })),
        },
      };
      if (apiKey) this.credentials.providers[id] = { type: "api_key", key: apiKey };
      else delete this.credentials.providers[id];
      try {
        await this.writePrivateJson(path.join(this.directory, "credentials.json"), this.credentials);
        await this.writeModelsConfig(config);
        await this.loadCredentials();
        await this.refreshProviders();
        return this.update({
          status: "authenticated",
          message: `${name} connected with ${verification.models.length} model${verification.models.length === 1 ? "" : "s"}.`,
        });
      } catch (cause) {
        this.credentials = previousCredentials;
        await this.writePrivateJson(path.join(this.directory, "credentials.json"), previousCredentials);
        await this.writeModelsConfig(previousConfig);
        throw cause;
      }
    });
  }

  async getProviderHttpModel(providerId: string, modelId: string): Promise<ProviderHttpModel> {
    await this.initialize();
    if (providerId === CHATGPT_PROVIDER_ID) {
      throw new Error("ChatGPT subscription requests use Codex app-server.");
    }
    const custom = ((await this.readModelsConfig()).providers?.[providerId] ?? null) as
      | CustomProviderConfig
      | null;
    const catalogue = PROVIDER_CATALOGUE.find((provider) => provider.id === providerId);
    const model = custom?.models?.find((item) => item.id === modelId)
      ?? catalogue?.models.find((item) => item.id === modelId);
    const baseUrl = custom?.baseUrl || catalogue?.baseUrl || model?.baseUrl;
    if (!model || !baseUrl) throw new Error("Choose an available model for this provider.");
    const credential = this.credentials.providers[providerId];
    if (!credential && !custom) throw new Error("Connect this provider first.");
    return {
      providerId,
      modelId,
      api: model.api || "openai-completions",
      baseUrl: baseUrl.replace(/\/$/, ""),
      ...(credential ? { apiKey: credential.key } : {}),
      headers: {},
    };
  }

  resolveHttpModel(providerId: string, modelId: string): Promise<ProviderHttpModel> {
    return this.getProviderHttpModel(providerId, modelId);
  }
}

export function getProviderAccessService(): ProviderAccessService {
  if (!singleton) {
    const root = process.env.YOUBOT_HOME || process.cwd();
    singleton = new ProviderAccessService(path.join(root, "provider-access"));
  }
  return singleton;
}
