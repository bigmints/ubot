import type { AgentConfig, ModelPurpose } from "../engine/types.js";
import { getProviderAccessService } from "./provider-access.js";

export interface RoutedHttpModel {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
}

export function splitRoutingTarget(target?: string): { providerId: string; modelId: string } | undefined {
  if (!target) return undefined;
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1) return undefined;
  return { providerId: target.slice(0, slash), modelId: target.slice(slash + 1) };
}

export async function resolveRoutedHttpModel(
  config: Pick<AgentConfig, "llmProviders" | "defaultLlmProviderId" | "modelRouting">,
  purpose: ModelPurpose,
  fallbackModelId: string,
): Promise<RoutedHttpModel | undefined> {
  const explicit = splitRoutingTarget(config.modelRouting?.[purpose]);
  const providerId = explicit?.providerId || config.defaultLlmProviderId;
  const provider = config.llmProviders.find((item) => item.id === providerId)
    ?? config.llmProviders.find((item) => item.isDefault)
    ?? config.llmProviders[0];
  if (!provider) return undefined;

  const modelId = explicit?.modelId || provider.model || fallbackModelId;
  if (provider.credentialSource === "provider-access") {
    return getProviderAccessService().resolveHttpModel(
      provider.runtimeProviderId || provider.id,
      modelId,
    );
  }

  return {
    providerId: provider.id,
    modelId,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: {},
  };
}
