import type http from "node:http";

import { loadYoubotConfig, saveYoubotConfig, type ProviderConfig } from "../../data/config.js";
import {
	getProviderAccessService,
	type CustomProviderInput,
	type ProviderAccessProvider,
	type ProviderAccessState,
} from "../../integrations/provider-access.js";
import type { ApiContext } from "../context.js";
import { error, json, parseBody } from "../context.js";
import { syncModelsToAgent } from "./integrations-providers.js";

const TEXT_PURPOSES = ["chat", "router", "extraction", "generation"] as const;
const ROUTING_PURPOSES = ["chat", "transcription", "tts"] as const;
type RoutingPurpose = (typeof ROUTING_PURPOSES)[number];
export interface ProviderRoutingSelection { providerId: string; modelId: string }
type ProviderRouting = Partial<Record<RoutingPurpose, ProviderRoutingSelection>>;

export function validateProviderRouting(
	input: unknown,
	providers: ProviderAccessProvider[],
	enabledProviderIds: string[],
): ProviderRouting {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Choose models for routing.");
	}
	const source = input as Record<string, unknown>;
	const enabled = new Set(enabledProviderIds);
	const result: ProviderRouting = {};
	for (const purpose of ROUTING_PURPOSES) {
		const value = source[purpose];
		if (value === undefined || value === null || value === "") continue;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`Choose a valid ${purpose} model.`);
		}
		const { providerId, modelId } = value as Record<string, unknown>;
		if (typeof providerId !== "string" || typeof modelId !== "string") {
			throw new Error(`Choose a valid ${purpose} model.`);
		}
		const provider = providers.find((item) =>
			item.id === providerId && item.connected && enabled.has(item.id));
		if (!provider) throw new Error(`Connect and enable the ${purpose} provider first.`);
		if (!provider.models.some((model) => model.id === modelId)) {
			throw new Error(`Choose an available ${purpose} model.`);
		}
		result[purpose] = { providerId, modelId };
	}
	return result;
}

function managedKey(providerId: string): string {
	return `managed-${providerId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function providerAccessConfig(access: ProviderAccessState): {
	activeProviderId?: string;
	activeModelId?: string;
	enabledProviderIds: string[];
	routing: ProviderRouting;
} {
	const cfg = loadYoubotConfig();
	const section = cfg.capabilities?.models;
	const entries = Object.entries(section?.providers ?? {}).filter(
		([, provider]) => provider.credentialSource === "provider-access",
	);
	const active = entries.find(([key, provider]) => key === section?.default && provider.enabled !== false);
	const enabledProviderIds = entries
		.filter(([, provider]) => provider.enabled !== false)
		.flatMap(([, provider]) =>
			typeof provider.runtimeProviderId === "string" ? [provider.runtimeProviderId] : [],
		);
	const runtimeByManagedKey = new Map(entries.flatMap(([key, provider]) =>
		typeof provider.runtimeProviderId === "string" ? [[key, provider.runtimeProviderId] as const] : [],
	));
	const routing: ProviderRouting = {};
	const rawRouting = (cfg as unknown as { modelRouting?: Record<string, string> }).modelRouting ?? {};
	for (const purpose of ROUTING_PURPOSES) {
		const target = rawRouting[purpose];
		if (!target) continue;
		const slash = target.indexOf("/");
		if (slash <= 0 || slash === target.length - 1) continue;
		const providerId = runtimeByManagedKey.get(target.slice(0, slash));
		const modelId = target.slice(slash + 1);
		const provider = access.providers.find((item) =>
			item.id === providerId && item.connected && item.models.some((model) => model.id === modelId));
		if (provider) routing[purpose] = { providerId: provider.id, modelId };
	}
	return {
		activeProviderId:
			typeof active?.[1].runtimeProviderId === "string"
				? active[1].runtimeProviderId
				: undefined,
		activeModelId: typeof active?.[1].model === "string" ? active[1].model : undefined,
		enabledProviderIds,
		routing,
	};
}

async function state() {
	const access = await getProviderAccessService().state();
	return { ...access, ...providerAccessConfig(access) };
}

async function saveProviderRouting(input: unknown, ctx: ApiContext): Promise<void> {
	const access = await getProviderAccessService().state();
	const current = providerAccessConfig(access);
	const routing = validateProviderRouting(input, access.providers, current.enabledProviderIds);
	const cfg = loadYoubotConfig();
	const next = {
		...((cfg as unknown as { modelRouting?: Record<string, string> }).modelRouting ?? {}),
	};
	for (const purpose of ROUTING_PURPOSES) delete next[purpose];
	for (const [purpose, selection] of Object.entries(routing)) {
		next[purpose] = `${managedKey(selection.providerId)}/${selection.modelId}`;
	}
	(cfg as unknown as { modelRouting: Record<string, string> }).modelRouting = next;
	saveYoubotConfig(cfg);
	syncModelsToAgent(ctx);
}

function saveActiveProvider(
	providerId: string,
	modelId: string,
	ctx: ApiContext,
): void {
	const cfg = loadYoubotConfig();
	const key = managedKey(providerId);
	if (!cfg.capabilities) cfg.capabilities = {};
	if (!cfg.capabilities.models) cfg.capabilities.models = {};
	const section = cfg.capabilities.models;
	if (!section.providers) section.providers = {};
	const existing = section.providers[key] ?? {};
	const modelMap = Object.fromEntries(TEXT_PURPOSES.map((purpose) => [purpose, modelId]));
	const provider: ProviderConfig = {
		...existing,
		enabled: true,
		baseUrl: "",
		apiKey: "",
		model: modelId,
		models: modelMap,
		credentialSource: "provider-access",
		runtimeProviderId: providerId,
	};
	section.providers[key] = provider;
	section.default = key;
	const routing = ((cfg as unknown as { modelRouting?: Record<string, string> }).modelRouting ?? {});
	for (const purpose of TEXT_PURPOSES) routing[purpose] = `${key}/${modelId}`;
	(cfg as unknown as { modelRouting: Record<string, string> }).modelRouting = routing;
	saveYoubotConfig(cfg);
	syncModelsToAgent(ctx);
}

function disableProvider(providerId: string, ctx: ApiContext): void {
	const cfg = loadYoubotConfig();
	const section = cfg.capabilities?.models;
	if (!section?.providers) return;
	const key = managedKey(providerId);
	const provider = section.providers[key];
	if (!provider || provider.credentialSource !== "provider-access") return;
	provider.enabled = false;
	if (section.default === key) {
		section.default =
			Object.entries(section.providers).find(
				([otherKey, item]) => otherKey !== key && item.enabled !== false,
			)?.[0] ?? "";
	}
	const routing = (cfg as unknown as { modelRouting?: Record<string, string> }).modelRouting;
	if (routing) {
		for (const [purpose, target] of Object.entries(routing)) {
			if (target === key || target.startsWith(`${key}/`)) delete routing[purpose];
		}
	}
	saveYoubotConfig(cfg);
	syncModelsToAgent(ctx);
}

function removeProviderConfig(providerId: string, ctx: ApiContext): void {
	const cfg = loadYoubotConfig();
	const section = cfg.capabilities?.models;
	if (!section?.providers) return;
	const key = managedKey(providerId);
	if (section.providers[key]?.credentialSource !== "provider-access") return;
	delete section.providers[key];
	if (section.default === key) {
		section.default =
			Object.entries(section.providers).find(([, provider]) => provider.enabled !== false)?.[0] ?? "";
	}
	const routing = (cfg as unknown as { modelRouting?: Record<string, string> }).modelRouting;
	if (routing) {
		for (const [purpose, target] of Object.entries(routing)) {
			if (target === key || target.startsWith(`${key}/`)) delete routing[purpose];
		}
	}
	saveYoubotConfig(cfg);
	syncModelsToAgent(ctx);
}

export async function handleProviderAccessRoutes(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	url: string,
	method: string,
	ctx: ApiContext,
): Promise<boolean> {
	if (!url.startsWith("/api/provider-access")) return false;
	const access = getProviderAccessService();
	try {
		if (url === "/api/provider-access" && method === "GET") {
			json(res, await state());
			return true;
		}
		if (url === "/api/provider-access/routing" && method === "PUT") {
			const body = await parseBody(req) as { routing?: unknown };
			await saveProviderRouting(body.routing, ctx);
			json(res, await state());
			return true;
		}
		if (url === "/api/provider-access/subscription" && method === "POST") {
			const body = await parseBody(req) as { providerId?: string };
			if (!body.providerId) throw new Error("Choose a subscription provider.");
			await access.startSubscription(body.providerId);
			json(res, await state(), 202);
			return true;
		}
		if (url === "/api/provider-access/respond" && method === "POST") {
			const body = await parseBody(req) as { id?: string; value?: string };
			if (!body.id || typeof body.value !== "string") throw new Error("This sign-in response is invalid.");
			access.respond(body.id, body.value);
			json(res, await state());
			return true;
		}
		if (url === "/api/provider-access/cancel" && method === "POST") {
			access.cancel();
			json(res, await state());
			return true;
		}
		if (url === "/api/provider-access/api-key" && method === "POST") {
			const body = await parseBody(req) as { providerId?: string; apiKey?: string };
			if (!body.providerId || typeof body.apiKey !== "string") throw new Error("Choose a provider and enter its API key.");
			await access.saveApiKey(body.providerId, body.apiKey);
			json(res, await state());
			return true;
		}
		if (url === "/api/provider-access/custom/verify" && method === "POST") {
			const body = await parseBody(req) as CustomProviderInput;
			json(res, await access.verifyCustom(body));
			return true;
		}
		if (url === "/api/provider-access/custom" && method === "POST") {
			const body = await parseBody(req) as CustomProviderInput;
			const next = await access.addCustom(body);
			if (body.modelId) {
				const provider = next.providers.find((item) =>
					item.custom &&
					item.name.toLocaleLowerCase() === body.name.trim().toLocaleLowerCase() &&
					item.models.some((model) => model.id === body.modelId),
				);
				if (!provider) throw new Error("Could not activate the selected model.");
				saveActiveProvider(provider.id, body.modelId, ctx);
			}
			json(res, await state(), 201);
			return true;
		}
		if (url === "/api/provider-access/active" && method === "PUT") {
			const body = await parseBody(req) as { providerId?: string; modelId?: string };
			const snapshot = await access.state();
			const provider = snapshot.providers.find((item) => item.id === body.providerId && item.connected);
			if (!provider) throw new Error("Connect this provider before using it.");
			const model = provider.models.find((item) => item.id === body.modelId);
			if (!model) throw new Error("Choose an available model.");
			saveActiveProvider(provider.id, model.id, ctx);
			json(res, await state());
			return true;
		}
		const providerMatch = url.match(/^\/api\/provider-access\/([^/]+)$/);
		if (providerMatch && method === "DELETE") {
			const providerId = decodeURIComponent(providerMatch[1]);
			await access.remove(providerId);
			removeProviderConfig(providerId, ctx);
			json(res, await state());
			return true;
		}
		const disableMatch = url.match(/^\/api\/provider-access\/([^/]+)\/disable$/);
		if (disableMatch && method === "POST") {
			disableProvider(decodeURIComponent(disableMatch[1]), ctx);
			json(res, await state());
			return true;
		}
		return false;
	} catch (cause) {
		error(res, cause instanceof Error ? cause.message : "Provider request failed.");
		return true;
	}
}
