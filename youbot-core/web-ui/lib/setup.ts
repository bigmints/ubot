export interface ModelProvider {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  authType?: string;
}

export interface ModelSettings {
  default: string;
  providers: Record<string, ModelProvider>;
}

export function hasConfiguredModel(settings: ModelSettings): boolean {
  const provider = settings.providers?.[settings.default];
  if (!provider || provider.enabled === false || !provider.model?.trim()) return false;
  if (provider.authType === "vertex-sa") return true;
  if (provider.apiKey?.trim()) return true;
  try {
    const host = new URL(provider.baseUrl || "").hostname;
    return ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(host);
  } catch {
    return false;
  }
}
