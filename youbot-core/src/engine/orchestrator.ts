import { finalizeVisitorReply, VISITOR_REPLY_CONTRACT, VISITOR_REPLY_FORMAT, visitorReplyRepairMessages } from './visitor-reply.js';
import { documentRevision, readOwnerProfile } from '../concierge/owner-profile.js';
import { conciergeInstructions } from "../concierge/profile.js";

// --- DUMMY IMPLEMENTATIONS FOR REMOVED FEATURES ---
const runSubagent = async (...args: any[]): Promise<any> => ({ status: 'completed', result: 'Subagents are disabled.' });
const getTodos = async (...args: any[]): Promise<any[]> => [];
// --------------------------------------------------

/**
 * Agent Orchestrator
 * The core agent loop: message → LLM → tool execution → response
 *
 * Uses native OpenAI-compatible tool calling (works with Ollama, Gemini, OpenAI, etc.)
 */

import fs from "fs";
import OpenAI from "openai";
import path from "path";
import { TaskQueue } from "./task-queue.js";
import { TtlMap } from "./ttl-map.js";
import { Mutex } from "./mutex.js";
import type { SkillEngine } from "../agents/skills/skill-engine.js";
import type { SkillRepository } from "../agents/skills/skill-repository.js";
import type { DatabaseConnection } from "../data/database/types.js";
import { getHooks } from "../hooks/extensions.js";
import { log } from "../logger/ring-buffer.js";
import type { ConversationStore } from "../memory/conversation.js";
import type { FollowUpStore } from "../memory/followups.js";
import type { MemoryStore } from "../memory/memory-store.js";
import {
	FACT_EXTRACTION_PROMPT,
	mergeIntoOwnerDoc,
	OWNER_MERGE_PROMPT,
	OWNER_SOUL_ID,
	SOUL_REWRITE_PROMPT,
	type Soul,
	SUMMARY_UPDATE_PROMPT,
} from "../memory/soul.js";
import { metricsCollector } from "../metrics/index.js";
import { getAllToolsWithModules } from "../tools/registry.js";
import { type Blackboard, blackboard } from "./blackboard.js";
import { crewRegistry } from "./crew-registry.js";
import { EmbeddingPipeline } from "./embeddings.js";
import { LoopDetector } from "./loop-detector.js";
import { type MessageBus, messageBus } from "./message-bus.js";
import { filterStaleErrors } from "./message-filter.js";
import { getMetering } from "./metering.js";
import { MiddlewarePipeline } from "./middleware.js";
import {
	CircuitBreakerMiddleware,
	LoggingMiddleware,
	RetryMiddleware,
	SkillDetectorMiddleware,
} from "./middlewares/index.js";
import {
	getTaskPlan,
	saveTaskPlan,
	updatePlanStatus,
	updateStepStatus,
} from "./plan-store.js";
import { getPromptExperiments } from "./prompt-experiment.js";
import {
	createTaskPlan,
	getExecutionOrder,
	type TaskPlan,
	type TaskStep,
} from "./task-planner.js";
import { selectToolsForMessage } from "./tool-selector.js";
import {
	createToolRegistry,
	formatToolsForAPI,
	getToolAliases,
	getToolsForSource,
	VISITOR_SAFE_TOOL_NAMES,
	type ToolRegistry,
} from "./tools.js";
import type {
	AgentConfig,
	AgentDefinition,
	AgentResponse,
	Attachment,
	ChatMessageMetadata,
	LLMProviderConfig,
	ModelPurpose,
	ToolDefinition,
	ToolExecutionResult,
} from "./types.js";
import { getModelForPurpose } from "./types.js";
import { VectorStore } from "./vector-store.js";
import { getVertexAccessToken } from "./vertex-auth.js";
import { createProviderChatClient } from "../integrations/provider-chat-client.js";
import {
	requestStructuredCompletion,
	type StructuredGenerationResult,
	type StructuredOutputSpec,
} from "./structured-generation.js";

/**
 * Find recent outbound messages sent TO a specific contact by the owner.
 * Searches all sessions for send_message tool calls targeting this contact.
 * Also searches by contact name since LID-based contacts can't be matched by phone.
 */
async function findRecentOutboundMessages(
	contactSessionId: string,
	conversationStore: ConversationStore,
	contactName?: string,
): Promise<string[]> {
	const outbound: string[] = [];

	// Build search terms: phone number, LID number, contact name
	const searchTerms: string[] = [];
	const contactId = contactSessionId.replace(/@.*/, "");
	searchTerms.push(contactId);
	if (contactName && contactName !== contactId && !contactName.includes("@")) {
		searchTerms.push(contactName.toLowerCase());
	}

	try {
		const cutoffMs = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours
		const recentWebMessages = await conversationStore.getRecentWebMessages(cutoffMs);

		// Group by session to safely examine pairs
		const sessionGroups = new Map<string, any[]>();
		for (const msg of recentWebMessages) {
			if (msg.sessionId === contactSessionId) continue;
			if (!sessionGroups.has(msg.sessionId)) sessionGroups.set(msg.sessionId, []);
			sessionGroups.get(msg.sessionId)!.push(msg);
		}

		for (const history of sessionGroups.values()) {
			for (let i = 0; i < history.length; i++) {
				const msg = history[i];
				const content = msg.content || "";
				const contentLower = content.toLowerCase();

				if (msg.role === "assistant") {
					const mentionsContact = searchTerms.some((term) => contentLower.includes(term));
					if (mentionsContact) {
						const toolNames = msg.metadata?.toolCall?.toolName || "";
						if (toolNames.includes("send_message")) {
							outbound.push(content.slice(0, 300));
						}
					}
				} else if (msg.role === "user") {
					const nextMsg = history[i + 1];
					if (
						nextMsg?.role === "assistant" &&
						nextMsg.metadata?.toolCall?.toolName?.includes("send_message")
					) {
						const mentionsContact = searchTerms.some((term) =>
							(nextMsg.content || "").toLowerCase().includes(term)
						);
						if (mentionsContact) {
							outbound.push(`[Owner's request]: ${content.slice(0, 300)}`);
						}
					}
				}
			}
		}
	} catch (err: any) {
		console.error(
			"[Orchestrator] Failed to find outbound messages:",
			err.message,
		);
	}

	return outbound.slice(-5); // Return at most 5 recent context items
}

export interface AgentOrchestrator {
	/** Process a message and return the agent's response */
	chat(
		sessionId: string,
		message: string,
		source?: "web" | "whatsapp" | "telegram" | "webchat" | "sub-agent",
		contactName?: string,
		isOwner?: boolean,
		attachments?: Attachment[],
		skillContext?: string,
		onProgress?: (event: any) => void,
	): Promise<AgentResponse>;
	/** Direct LLM text generation (no tools) — for skill generation, etc. */
	generate(systemPrompt: string, userMessage: string): Promise<string>;
	/** Request one non-executing schema-only function call, with JSON text fallback. */
	generateStructured(
		systemPrompt: string,
		userMessage: string,
		spec: StructuredOutputSpec,
	): Promise<StructuredGenerationResult>;
	/** Direct LLM vision generation with one in-memory image and no tools/actions. */
  generateWithImage(
    systemPrompt: string,
    userMessage: string,
    image: {
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      bytes: Uint8Array;
      signal?: AbortSignal;
    },
  ): Promise<string>;
	/** Get the current config */
	getConfig(): AgentConfig;
	/** Update config */
	updateConfig(updates: Partial<AgentConfig>): AgentConfig;
	/** Get the tool registry for registering tool executors */
	getToolRegistry(): ToolRegistry;
	/** Get the conversation store */
	getConversationStore(): ConversationStore;
	/** Get the memory store */
	getMemoryStore(): MemoryStore;
	/** Get the soul */
	getSoul(): Soul;
	/** Switch the active specialized agent for a session */
	switchAgent(sessionId: string, agentId: string | null): void;
	/** List available specialized agents */
	listAgents(): AgentDefinition[];
	/** Get raw markdown for a specialized agent */
	getAgentMarkdown(agentId: string): string | null;
	/** Save raw markdown for a specialized agent and reload it */
	saveAgentMarkdown(agentId: string, content: string): void;
	/** Resume active task plans from the database (called at startup) */
	resumeActivePlans(): Promise<void>;
	/** Inject skill engine after initialization (needed because agent is created before skillEngine) */
	setSkillEngine(engine: SkillEngine): void;
	/** Get the Agent Message Bus for internal A2A communication */
	getMessageBus(): MessageBus;
	/** Get the Blackboard for shared agent memory */
	getBlackboard(): Blackboard;
	/** Get the Vector Store */
	getVectorStore(): VectorStore | undefined;
}

export function createAgentOrchestrator(
	config: AgentConfig,
	conversationStore: ConversationStore,
	memoryStore: MemoryStore,
	followUpStore: FollowUpStore,
	soul: Soul,
	db?: DatabaseConnection,
	workspacePath?: string,
	skillRepo?: SkillRepository,
	skillEngine?: SkillEngine,
): AgentOrchestrator {
	let currentConfig = { ...config };

	// ── Apply engine hook extensions at creation time ──────
	// Custom apps inject extra providers and routing via EngineHook.
	// This keeps all product-specific provider config out of the engine core.
	const engineHook = getHooks().engine;
	if (engineHook) {
		const extraProviders = engineHook.getExtraProviders?.() ?? [];
		if (extraProviders.length > 0) {
			const existingIds = new Set(
				(currentConfig.llmProviders ?? []).map((p) => p.id),
			);
			const newProviders = extraProviders.filter((p) => !existingIds.has(p.id));
			currentConfig.llmProviders = [
				...(currentConfig.llmProviders ?? []),
				...newProviders,
			];
			console.log(
				`[Orchestrator] 🔌 Engine hook: ${newProviders.length} extra provider(s) injected: ${newProviders.map((p) => p.id).join(", ")}`,
			);
		}

		const extraRouting = engineHook.getDefaultModelRouting?.() ?? {};
		// Only apply hook routing if the config has no routing set (hook = default, user config = override)
		if (
			Object.keys(extraRouting).length > 0 &&
			Object.keys(currentConfig.modelRouting ?? {}).length === 0
		) {
			currentConfig.modelRouting = { ...extraRouting };
			console.log(
				`[Orchestrator] 🗺  Engine hook: applied default routing: ${JSON.stringify(extraRouting)}`,
			);
		}
	}

	const toolRegistry = createToolRegistry();
	const continuationCount = new TtlMap<string, number>(10 * 60 * 1000); // 10 minutes TTL

	// Initialize Vector Store if DB is attached
	let vectorStore: VectorStore | undefined;
	if (db) {
		vectorStore = new VectorStore(db);
		log.info(
			"System",
			"VectorStore initialized with Supabase pgvector backend",
		);
	}

	// Forward-declare orchestrator for tool closure capture
	const orchestrator = {} as AgentOrchestrator;

	// Register core orchestrator tools
	toolRegistry.register("list_agents", async () => {
		const list = crewRegistry.listAgents();
		if (list.length === 0)
			return {
				toolName: "list_agents",
				success: true,
				result: "No specialized agents found in workspace/agents/",
				duration: 0,
			};
		const formatted = list
			.map((a) => `- ${a.id}: ${a.name} (${a.description})`)
			.join("\n");
		return {
			toolName: "list_agents",
			success: true,
			result: `Available agents:\n${formatted}`,
			duration: 0,
		};
	});

	toolRegistry.register("switch_agent", async (args) => {
		const agentId = String(args.agentId || "");
		const sessionId = String(args.sessionId || "");

		if (!sessionId)
			return {
				toolName: "switch_agent",
				success: false,
				error: "sessionId is required",
				duration: 0,
			};

		if (!agentId || agentId === "main" || agentId === "none") {
			sessionAgents.delete(sessionId);
			return {
				toolName: "switch_agent",
				success: true,
				result: "Switched back to main Ubot persona.",
				duration: 0,
			};
		}

		if (!crewRegistry.hasAgent(agentId)) {
			return {
				toolName: "switch_agent",
				success: false,
				error: `Agent "${agentId}" not found.`,
				duration: 0,
			};
		}

		sessionAgents.set(sessionId, agentId);
		const agent = crewRegistry.getAgent(agentId)!;
		return {
			toolName: "switch_agent",
			success: true,
			result: `Successfully switched to ${agent.name}. Instructions updated.`,
			duration: 0,
		};
	});

	toolRegistry.register("delegate_to_agent", async (args, context) => {
		const agentId = String(args.agentId || "");
		const task = String(args.task || "");
		const timeoutSeconds = Number(args.timeoutSeconds || 120);

		if (!agentId)
			return {
				toolName: "delegate_to_agent",
				success: false,
				error: "agentId is required",
				duration: 0,
			};
		if (!task)
			return {
				toolName: "delegate_to_agent",
				success: false,
				error: "task is required",
				duration: 0,
			};

		const agentDef = crewRegistry.getAgent(agentId);
		if (!agentDef) {
			const available = crewRegistry
				.listAgents()
				.map((a) => a.id)
				.join(", ");
			return {
				toolName: "delegate_to_agent",
				success: false,
				error: `Agent "${agentId}" not found. Available: ${available}`,
				duration: 0,
			};
		}

		const sid = `subagent-${agentDef.name}-${Date.now()}`;
		sessionAgents.set(sid, agentDef.id);

		// Filter tools based on the subagent's autonomy tier
		const filteredTools = filterToolsByTier(
			agentDef.allowedTools || [],
			agentDef.autonomyTier || "T3",
		);

		const subConfig = {
			name: agentDef.name,
			systemPrompt: agentDef.systemPrompt,
			allowedTools: filteredTools,
			timeoutMs: timeoutSeconds * 1000,
		};

		const orchestratorInterface = {
			chat: (_ignoredSid: string, msg: string, spo?: string) =>
				orchestrator.chat(
					sid,
					msg,
					"sub-agent",
					context?.contactName,
					context?.isOwner,
					undefined,
					spo,
					context?.reportProgress,
				),
		};
		if (db) {
			try {
				await db.execute(
					`INSERT INTO ubot_spawned_sessions (id, agent_id, task, status, start_time) VALUES (?, ?, ?, 'running', ?)`,
					[sid, agentDef.id, task.slice(0, 500), new Date().toISOString()]
				);
			} catch (e: any) {
				console.error(
					"[Orchestrator] Failed to insert subagent session:",
					e.message,
				);
			}
		}

		const result = await runSubagent(subConfig, task, orchestratorInterface);

		if (db) {
			try {
				await db.execute(
					`UPDATE ubot_spawned_sessions SET status = ?, result = ?, error = ?, end_time = ? WHERE id = ?`,
					[result.status === "completed" ? "completed" : "failed", result.result || null, result.error || null, new Date().toISOString(), sid]
				);

				// Ensure no lingering history chunks clog the main DB memory array
				await db.execute(`DELETE FROM ubot_sessions WHERE id = ?`, [sid]);
			} catch (e: any) {
				console.error(
					"[Orchestrator] Failed to update/cleanup subagent session:",
					e.message,
				);
			}
		}

		if (result.status === "completed") {
			return {
				toolName: "delegate_to_agent",
				success: true,
				result: `Agent '${agentDef.name}' completed: ${result.result}`,
				duration: 0,
			};
		} else {
			return {
				toolName: "delegate_to_agent",
				success: false,
				error: `Agent '${agentDef.name}' failed: ${result.error}`,
				duration: 0,
			};
		}
	});

	toolRegistry.register("broadcast_message", async (args, context) => {
		const topic = String(args.topic || "");
		const payload = args.payload;
		const targetAgentId = args.targetAgentId
			? String(args.targetAgentId)
			: undefined;
		const sourceAgent = sessionAgents.get(context?.sessionId || "") || "main";

		if (!topic)
			return {
				toolName: "broadcast_message",
				success: false,
				error: "topic is required",
				duration: 0,
			};
		if (payload === undefined)
			return {
				toolName: "broadcast_message",
				success: false,
				error: "payload is required",
				duration: 0,
			};

		messageBus.publish(sourceAgent, topic, payload, targetAgentId);

		const targetMsg = targetAgentId ? `to ${targetAgentId}` : "to all agents";
		return {
			toolName: "broadcast_message",
			success: true,
			result: `Successfully broadcast message on topic '${topic}' ${targetMsg}.`,
			duration: 0,
		};
	});

	toolRegistry.register("blackboard_write", async (args, context) => {
		const key = String(args.key || "");
		const value = args.value;
		const ttlSeconds = args.ttlSeconds ? Number(args.ttlSeconds) : undefined;
		const author = sessionAgents.get(context?.sessionId || "") || "main";

		if (!key)
			return {
				toolName: "blackboard_write",
				success: false,
				error: "key is required",
				duration: 0,
			};
		if (value === undefined)
			return {
				toolName: "blackboard_write",
				success: false,
				error: "value is required",
				duration: 0,
			};

		blackboard.write(key, value, author, ttlSeconds);
		return {
			toolName: "blackboard_write",
			success: true,
			result: `Successfully wrote '${key}' to blackboard.`,
			duration: 0,
		};
	});

	toolRegistry.register("blackboard_read", async (args) => {
		const key = String(args.key || "");
		if (!key)
			return {
				toolName: "blackboard_read",
				success: false,
				error: "key is required",
				duration: 0,
			};

		const value = blackboard.read(key);
		if (value === undefined) {
			return {
				toolName: "blackboard_read",
				success: false,
				error: `Key '${key}' not found or expired on blackboard.`,
				duration: 0,
			};
		}

		const resultStr =
			typeof value === "string" ? value : JSON.stringify(value, null, 2);
		return {
			toolName: "blackboard_read",
			success: true,
			result: resultStr,
			duration: 0,
		};
	});

	toolRegistry.register("store_insight", async (args, context) => {
		if (!vectorStore)
			return {
				toolName: "store_insight",
				success: false,
				error: "VectorStore is not configured (requires Supabase)",
				duration: 0,
			};

		const insight = String(args.insight || "");
		const sessionId = context?.sessionId || "default";
		const agentId = sessionAgents.get(sessionId) || "main";

		if (!insight)
			return {
				toolName: "store_insight",
				success: false,
				error: "insight is required",
				duration: 0,
			};

		try {
			const { client, model } = await getClientForPurpose("embedding");
			const embedding = await EmbeddingPipeline.generateEmbedding(
				client,
				model,
				insight,
			);
			await vectorStore.storeMemory(sessionId, agentId, insight, embedding);
			return {
				toolName: "store_insight",
				success: true,
				result: `Insight successfully recorded to long-term memory.`,
				duration: 0,
			};
		} catch (err: any) {
			return {
				toolName: "store_insight",
				success: false,
				error: `Failed to store insight: ${err.message}`,
				duration: 0,
			};
		}
	});

	toolRegistry.register("recall_memory", async (args, context) => {
		if (!vectorStore)
			return {
				toolName: "recall_memory",
				success: false,
				error: "VectorStore is not configured (requires Supabase)",
				duration: 0,
			};

		const query = String(args.query || "");
		const sessionId = context?.sessionId || "default";

		if (!query)
			return {
				toolName: "recall_memory",
				success: false,
				error: "query is required",
				duration: 0,
			};

		try {
			const { client, model } = await getClientForPurpose("embedding");
			const embedding = await EmbeddingPipeline.generateEmbedding(
				client,
				model,
				query,
			);
			const matches = await vectorStore.findSimilar(
				embedding,
				0.7,
				5,
				sessionId,
			);

			if (matches.length === 0) {
				return {
					toolName: "recall_memory",
					success: true,
					result: "No relevant memories found.",
					duration: 0,
				};
			}

			const formatted = matches
				.map(
					(m) =>
						`- [Agent: ${m.agentId}]: ${m.content} (similarity: ${m.similarity.toFixed(2)})`,
				)
				.join("\n");
			return {
				toolName: "recall_memory",
				success: true,
				result: `Found ${matches.length} matching memories:\n${formatted}`,
				duration: 0,
			};
		} catch (err: any) {
			return {
				toolName: "recall_memory",
				success: false,
				error: `Search failed: ${err.message}`,
				duration: 0,
			};
		}
	});

	async function runPlan(plan: TaskPlan, context: any): Promise<string> {
		const stepResults = new Map<string, string>();
		const executionOrder = getExecutionOrder(plan.steps);
		const db = context?.getDatabase?.();

		// Fill in results for already completed steps
		for (const step of plan.steps) {
			if (step.status === "completed" && step.result) {
				stepResults.set(step.id, step.result);
			}
		}

		try {
			updatePlanStatus(plan.id, "executing", db as any);

			for (const group of executionOrder) {
				// Only run steps that are not already completed or failed
				const stepsToRun = group.filter(
					(s) => s.status === "pending" || s.status === "running",
				);
				if (stepsToRun.length === 0) continue;

				let groupRequiresApproval = false;

				await Promise.all(
					stepsToRun.map(async (step) => {
						// Inject results from previous steps
						let prompt = step.prompt || step.description;
						for (const [id, res] of stepResults.entries()) {
							prompt = prompt.replace(
								new RegExp(`\\{${id}.result\\}`, "g"),
								res,
							);
						}

						const agentDef = crewRegistry.getAgent(step.agentType);

						// Phase 5: Governance Check
						if (
							agentDef &&
							["T2", "T3"].includes(agentDef.autonomyTier || "T0")
						) {
							if (step.status !== "running") {
								step.status = "awaiting_approval";
								updateStepStatus(
									plan.id,
									step.id,
									"awaiting_approval",
									undefined,
									undefined,
									db as any,
								);
								groupRequiresApproval = true;
								return; // Skip execution until approved
							}
						}

						const subConfig = agentDef
							? {
									name: agentDef.name,
									systemPrompt: agentDef.systemPrompt,
									allowedTools: agentDef.allowedTools,
									timeoutMs: 120000,
								}
							: {
									name: "General",
									timeoutMs: 120000,
								};

						const sid = `subplan-${step.id}-${Date.now()}`;
						sessionAgents.set(sid, step.agentType);

						const orchestratorInterface = {
							chat: (_ignoredSid: string, msg: string, spo?: string) =>
								orchestrator.chat(
									sid,
									msg,
									"sub-agent",
									context?.contactName,
									context?.isOwner,
									undefined,
									spo,
									context?.reportProgress,
								),
						};

						step.status = "running";
						updateStepStatus(
							plan.id,
							step.id,
							"running",
							undefined,
							undefined,
							db as any,
						);

						const result = await runSubagent(
							subConfig,
							prompt,
							orchestratorInterface,
						);

						if (db) {
							try {
								await db.execute(`DELETE FROM ubot_sessions WHERE id = ?`, [sid]);
							} catch (e: any) {
								console.error(
									"[Orchestrator] Failed to cleanup plan subagent session:",
									e.message,
								);
							}
						}

						if (result.status === "completed") {
							step.status = "completed";
							step.result = result.result;
							stepResults.set(step.id, result.result || "");
							updateStepStatus(
								plan.id,
								step.id,
								"completed",
								result.result,
								undefined,
								db as any,
							);
						} else {
							step.status = "failed";
							step.error = result.error;
							updateStepStatus(
								plan.id,
								step.id,
								"failed",
								undefined,
								result.error,
								db as any,
							);
							throw new Error(`Step ${step.id} failed: ${result.error}`);
						}
					}),
				);

				if (groupRequiresApproval) {
					updatePlanStatus(plan.id, "awaiting_approval", db as any);
					throw new Error(
						"Plan paused awaiting Owner approval (T2/T3 Agent Request).",
					);
				}
			}

			updatePlanStatus(plan.id, "completed", db as any);
			const summary = plan.steps
				.map(
					(s: TaskStep) =>
						`- ${s.description}: ${s.status === "completed" ? "Success" : `Failed (${s.error})`}`,
				)
				.join("\n");
			return `Plan executed successfully:\n${summary}`;
		} catch (err: any) {
			updatePlanStatus(plan.id, "failed", db as any);
			const summary = plan.steps
				.map((s: TaskStep) => `- ${s.description}: ${s.status}`)
				.join("\n");
			return `Plan failed: ${err.message}\n\nProgress:\n${summary}`;
		}
	}

	toolRegistry.register("execute_plan", async (args, context) => {
		const request = String(args.request || "");
		if (!request)
			return {
				toolName: "execute_plan",
				success: false,
				error: "request is required",
				duration: 0,
			};

		const availableAgentTypes = [
			...crewRegistry
				.listAgents()
				.map((a) => `${a.id} [${a.autonomyTier || "T0"}]: ${a.description}`),
			"nexus [T1]: Chief Orchestrator for delegation or complex routing",
		];
		const db = context?.getDatabase?.();
		const sessionId = context?.sessionId || "default";

		const plan = await createTaskPlan(
			sessionId,
			request,
			availableAgentTypes,
			(sys, user) => orchestrator.generate(sys, user),
		);

		if (db) {
			saveTaskPlan(sessionId, plan, db);
		}

		const result = await runPlan(plan, context);
		return {
			toolName: "execute_plan",
			success: !result.includes("failed"),
			result,
			duration: 0,
		};
	});

	toolRegistry.register("save_suggested_skill", async (args, context) => {
		const sessionId = context?.sessionId || "default";
		const suggestion = SkillDetectorMiddleware.getPendingSuggestion(sessionId);

		if (!suggestion) {
			return {
				toolName: "save_suggested_skill",
				success: false,
				error: "No suggested skill found for this session.",
				duration: 0,
			};
		}

		const repo = (context as any).skillRepo as any;
		if (!repo) {
			return {
				toolName: "save_suggested_skill",
				success: false,
				error: "Skill repository not available.",
				duration: 0,
			};
		}

		const name = String(args.name || suggestion.name);
		const description = String(args.description || suggestion.description);

		try {
			const skill = repo.create({
				name,
				description,
				enabled: true,
				trigger: {
					events: ["manual:run"], // Can be triggered manually or via other means
					condition: "",
				},
				processor: {
					instructions: suggestion.suggestedPrompt,
				},
				outcome: {
					action: "reply",
				},
			});

			SkillDetectorMiddleware.clearSuggestion(sessionId);
			return {
				toolName: "save_suggested_skill",
				success: true,
				result: `Successfully saved skill: ${skill.name} (ID: ${skill.id})`,
				duration: 0,
			};
		} catch (err: any) {
			return {
				toolName: "save_suggested_skill",
				success: false,
				error: `Failed to save skill: ${err.message}`,
				duration: 0,
			};
		}
	});

	// Multi-agent state
	const sessionAgents = new TtlMap<string, string>(60 * 60 * 1000); // 1 hour TTL
	const sessionLocks = new TtlMap<string, Mutex>(10 * 60 * 1000); // 10 minutes TTL

	// Initialize CrewRegistry (loads specialized agents from workspace)
	if (workspacePath) {
		crewRegistry.initialize(workspacePath);
	}

	function createLLMClient(): OpenAI {
		let baseUrl = currentConfig.llmBaseUrl || "";
		if (baseUrl.includes("://localhost:"))
			baseUrl = baseUrl.replace("://localhost:", "://127.0.0.1:");
		return new OpenAI({
			apiKey: currentConfig.llmApiKey,
			baseURL: baseUrl,
			timeout: 60000,
		});
	}

	function createConfiguredClient(provider: LLMProviderConfig, baseUrl: string, apiKey: string): OpenAI {
		if (provider.credentialSource === "provider-access") {
			return createProviderChatClient(provider.runtimeProviderId || provider.id);
		}
		return new OpenAI({ apiKey, baseURL: baseUrl, timeout: 60000 });
	}

	/**
	 * Create an OpenAI client routed to the best provider for a given purpose.
	 * Falls back to the default provider if no routing is configured.
	 * Vertex AI uses OAuth2 tokens instead of static API keys.
	 */
	async function getClientForPurpose(
		purpose: ModelPurpose,
	): Promise<{ client: OpenAI; model: string; providerId: string }> {
		const routing = currentConfig.modelRouting || {};
		let routedProviderId = routing[purpose];
		let specifiedModel = "";

		if (routedProviderId && routedProviderId.includes("/")) {
			const parts = routedProviderId.split("/");
			routedProviderId = parts[0];
			specifiedModel = parts.slice(1).join("/");
		}

		if (routedProviderId) {
			const provider = currentConfig.llmProviders.find(
				(p) => p.id === routedProviderId,
			);
			if (provider) {
				let baseUrl = provider.baseUrl;
				let apiKey = provider.apiKey;

				// Vertex AI: generate OAuth2 token from service account
				if (routedProviderId === "vertex" || provider.provider === "vertex") {
					const token = await getVertexAccessToken();
					if (token) {
						apiKey = token;
					} else {
						console.warn(
							"[Orchestrator] Failed to get Vertex access token, falling back to default",
						);
						return {
							client: createLLMClient(),
							model: currentConfig.llmModel,
							providerId: currentConfig.defaultLlmProviderId,
						};
					}
				}

				// Auto-fix: Gemini's OpenAI-compatible endpoint requires /openai/ suffix
				if (
					baseUrl.includes("generativelanguage.googleapis.com") &&
					!baseUrl.includes("/openai")
				) {
					baseUrl = baseUrl.replace(/\/?$/, "") + "/openai/";
				}

				// Auto-fix: IPv6 localhost resolution issues
				if (baseUrl.includes("://localhost:")) {
					baseUrl = baseUrl.replace("://localhost:", "://127.0.0.1:");
				}

				// Use strict override, then per-purpose config, falling back to catalog defaults, then provider.model
				const purposeModel =
					specifiedModel ||
					getModelForPurpose(routedProviderId, purpose, provider.models) ||
					provider.model;

				return {
					client: createConfiguredClient(provider, baseUrl, apiKey),
					model: purposeModel,
					providerId: provider.id,
				};
			}
		}

		// Fallback to default provider — still use catalog if available
		const defaultProvider = currentConfig.llmProviders.find(
			(p) => p.id === currentConfig.defaultLlmProviderId,
		);
		if (
			defaultProvider?.credentialSource === "provider-access" &&
			!["chat", "router", "extraction", "generation"].includes(purpose)
		) {
			const fallback = currentConfig.llmProviders.find(
				(provider) =>
					provider.credentialSource !== "provider-access" &&
					Boolean(provider.models?.[purpose]),
			);
			if (!fallback) {
				throw new Error(
					`The active subscription provider does not support ${purpose}. Configure a separate provider for that capability.`,
				);
			}
			let baseUrl = fallback.baseUrl;
			let apiKey = fallback.apiKey;
			if (fallback.provider === "vertex") {
				apiKey = (await getVertexAccessToken()) || "";
				if (!apiKey) throw new Error("Vertex credentials are unavailable.");
			}
			if (baseUrl.includes("generativelanguage.googleapis.com") && !baseUrl.includes("/openai")) {
				baseUrl = baseUrl.replace(/\/?$/, "") + "/openai/";
			}
			if (baseUrl.includes("://localhost:")) {
				baseUrl = baseUrl.replace("://localhost:", "://127.0.0.1:");
			}
			return {
				client: createConfiguredClient(fallback, baseUrl, apiKey),
				model: getModelForPurpose(fallback.provider, purpose, fallback.models) || fallback.model,
				providerId: fallback.id,
			};
		}
		const defaultProviderId =
			defaultProvider?.provider || currentConfig.defaultLlmProviderId;
		const catalogModel = getModelForPurpose(
			defaultProviderId,
			purpose,
			defaultProvider?.models,
		);

		// For Vertex default provider, generate access token
		if (
			defaultProvider &&
			(defaultProviderId === "vertex" || defaultProvider.provider === "vertex")
		) {
			const token = await getVertexAccessToken();
			if (token) {
				let baseUrl = defaultProvider.baseUrl || "";
				if (
					baseUrl.includes("generativelanguage.googleapis.com") &&
					!baseUrl.includes("/openai")
				) {
					baseUrl = baseUrl.replace(/\/?$/, "") + "/openai/";
				}
				if (baseUrl.includes("://localhost:")) {
					baseUrl = baseUrl.replace("://localhost:", "://127.0.0.1:");
				}
				return {
					client: createConfiguredClient(defaultProvider, baseUrl, token),
					model: catalogModel || defaultProvider.model,
					providerId: defaultProvider.id,
				};
			}
		}

		return {
			client: defaultProvider?.credentialSource === "provider-access"
				? createConfiguredClient(defaultProvider, defaultProvider.baseUrl, defaultProvider.apiKey)
				: createLLMClient(),
			model: catalogModel || currentConfig.llmModel,
			providerId: currentConfig.defaultLlmProviderId,
		};
	}

	function buildSystemPrompt(agentId?: string, isOwner: boolean = true): string {
		let basePrompt = currentConfig.systemPrompt;

		if (!isOwner) {
			basePrompt = "You are an AI assistant representing the owner to a guest/visitor. Follow your defined persona instructions carefully. You do not have access to any system tools or code execution capabilities.";
		}

		// Override with specialized agent prompt if applicable
		if (isOwner && agentId && crewRegistry.hasAgent(agentId)) {
			const agent = crewRegistry.getAgent(agentId)!;
			if (agent.systemPrompt) {
				basePrompt = agent.systemPrompt;
			}
		}

		if (!isOwner && currentConfig.concierge) basePrompt += conciergeInstructions(currentConfig.concierge);

		return basePrompt.replace(
			"{{tools}}",
			"Tools are provided natively via the API. Use function calls to execute them.",
		);
	}

	type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

	/**
	 * Trim the messages array so the estimated token count fits within the
	 * model's context window. Oldest history messages are dropped first;
	 * the system prompt and the final user message are always preserved.
	 *
	 * Token estimate: chars / 4 (conservative — real BPE varies but this is
	 * safe for English/Arabic mixed content).
	 *
	 * Context limits by model prefix (tokens):
	 *   gemma*          4 096
	 *   llama3*:3b      8 192
	 *   qwen*:3b        8 192
	 *   phi4*           16 384
	 *   (default)       32 768  — safe fallback for unknown models
	 */
	function trimMessagesToContextWindow(
		messages: ChatMsg[],
		model: string,
	): ChatMsg[] {
		// Reserve 20% for output tokens and tool call overhead
		const CTX_LIMITS: Array<[RegExp, number]> = [
			[/^gemma/i, 4_096],
			[/llama3[.\d]*:3b/i, 8_192],
			[/qwen[.\d]*:3b/i, 8_192],
			[/phi4-mini/i, 16_384],
		];
		const DEFAULT_CTX = 32_768;
		let ctxLimit = DEFAULT_CTX;
		for (const [pattern, limit] of CTX_LIMITS) {
			if (pattern.test(model)) {
				ctxLimit = limit;
				break;
			}
		}
		const budget = Math.floor(ctxLimit * 0.8); // keep 20% for output

		const estimateTokens = (msgs: ChatMsg[]) =>
			msgs.reduce(
				(sum, m) =>
					sum +
					Math.ceil(
						(typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content ?? "")
						).length / 4,
					),
				0,
			);

		if (estimateTokens(messages) <= budget) return messages;

		// Split: system (index 0) + middle history + final user message (last)
		const system = messages[0];
		const lastUser = messages[messages.length - 1];
		let history = messages.slice(1, -1);

		// Drop oldest pairs until we fit
		while (
			history.length > 0 &&
			estimateTokens([system, ...history, lastUser]) > budget
		) {
			history = history.slice(Math.min(2, history.length)); // drop oldest turn pair
		}

		const trimmed = [system, ...history, lastUser];
		const dropped = messages.length - trimmed.length;
		if (dropped > 0) {
			log.warn(
				"Orchestrator",
				`Context trim: dropped ${dropped} messages to fit ${model} (${ctxLimit} ctx, budget ${budget} tokens)`,
			);
		}
		return trimmed;
	}

	async function buildMessages(
		sessionId: string,
		userMessage: string,
		isOwner: boolean = false,
		attachments?: Attachment[],
		contactName?: string,
	): Promise<ChatMsg[]> {
		const rawHistory = await conversationStore.getHistory(
			sessionId,
			currentConfig.maxHistoryMessages,
		);
		const history = filterStaleErrors(rawHistory);
		let activeAgentId = sessionAgents.get(sessionId);

		// Phase 4: Nexus defaults for Owner
		if (isOwner && !activeAgentId && crewRegistry.hasAgent("nexus")) {
			activeAgentId = "nexus";
			sessionAgents.set(sessionId, "nexus");
		}

		// Build system prompt with soul data (bot persona + owner + contact)
		let systemPrompt = buildSystemPrompt(activeAgentId, isOwner);

		// Check for pending skill suggestions
		const suggestion = SkillDetectorMiddleware.getPendingSuggestion(sessionId);
		if (isOwner && suggestion) {
			systemPrompt += `\n\n## SKILL SUGGESTION
You just completed a successful complex workflow. You can offer the user to save it as a reusable skill.
Suggested Name: ${suggestion.name}
Description: ${suggestion.description}
Workflow: ${suggestion.toolSequence.join(" -> ")}

If the user wants to save this, you can use the 'save_suggested_skill' tool.
Inform the user about this possibility if it's relevant to the current conversation.`;
			SkillDetectorMiddleware.markAsShown(sessionId);
		}

		const soulPrompt = await soul.buildSoulPrompt(sessionId, isOwner);
		if (soulPrompt) {
			systemPrompt += "\n\n" + soulPrompt;
		}

		if (contactName) {
			systemPrompt += `\n\n## Current Contact\nYou are currently speaking with: ${contactName}`;
		}

		const messages: ChatMsg[] = [{ role: "system", content: systemPrompt }];

		// Inject session-level rolling summary as context preamble
		// This provides long-term memory beyond the message history window
		const memories = await soul.getStore().getMemories(sessionId, "summary");
		const sessionSummary = memories.find((m: any) => m.key === "chat_digest");
		if (sessionSummary && sessionSummary.value.trim()) {
			messages.push({
				role: "user",
				content: `[Previous conversation context — DO NOT reference this message directly, use it as background knowledge]\n${sessionSummary.value}`,
			});
			messages.push({
				role: "assistant",
				content: "Understood, I have context from our previous conversations.",
			});
		}

		// Add conversation history with tool call context
		for (const msg of history) {
			if (msg.role === "user") {
				messages.push({ role: "user", content: msg.content });
			} else if (msg.role === "assistant") {
				messages.push({ role: "assistant", content: msg.content || "" });
			}
		}

		// Build multimodal user message if attachments are present
		if (attachments && attachments.length > 0) {
			const contentParts: Array<{
				type: string;
				text?: string;
				image_url?: { url: string; detail?: string };
			}> = [];

			// Add document text content as context before the user message
			const docTexts: string[] = [];
			for (const att of attachments) {
				if (att.textContent) {
					if (att.mimeType.startsWith("audio/")) {
						docTexts.push(
							`[Audio message attached at: ${att.path}]\n[Auto-transcription]:\n${att.textContent}\n(Note: This was already transcribed for you. Only use transcribe_audio tool if you explicitly need to re-transcribe it.)`,
						);
					} else {
						docTexts.push(
							`[Content of ${att.filename} at ${att.path}]:\n${att.textContent}`,
						);
					}
				} else if (att.path) {
					docTexts.push(
						`[File attached: ${att.filename}. Absolute path on disk: ${att.path}]`,
					);
				}
			}

			// User message text (with document context prepended if any)
			const fullText =
				docTexts.length > 0
					? `${docTexts.join("\n\n")}\n\n${userMessage}`
					: userMessage;
			contentParts.push({ type: "text", text: fullText });

			// Add image attachments as image_url content parts
			for (const att of attachments) {
				if (att.base64 && att.mimeType.startsWith("image/")) {
					contentParts.push({
						type: "image_url",
						image_url: {
							url: `data:${att.mimeType};base64,${att.base64}`,
							detail: "auto",
						},
					});
				}
			}

			messages.push({ role: "user", content: contentParts as any });
		} else {
			// Plain text message (no attachments)
			messages.push({ role: "user", content: userMessage });
		}

		return messages;
	}

	const soulTaskQueue = new TaskQueue(3); // Process up to 3 soul extractions concurrently

	/** Extract/update all three data layers from a conversation turn */
	async function extractSoulData(
		sessionId: string,
		userMessage: string,
		assistantResponse: string,
		source?:
			| "web"
			| "whatsapp"
			| "telegram"
			| "webchat"
			| "sub-agent"
			| "scheduler",
		contactName?: string,
		isOwner: boolean = false,
		toolResults: ToolExecutionResult[] = [],
	): Promise<void> {
		soulTaskQueue.add(async () => {
			if (!userMessage || !assistantResponse) return;

		// Build action-aware conversation text for memory extraction
		let conversationText = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
		if (toolResults.length > 0) {
			const toolSummary = toolResults
				.map(
					(r) =>
						`  - ${r.toolName}: ${r.success ? r.result?.slice(0, 150) || "Success" : `Failed: ${r.error}`}`,
				)
				.join("\n");
			conversationText += `\n[Actions taken:\n${toolSummary}]`;
		}

		try {
			const { client, model: extractionModel } =
				await getClientForPurpose("extraction");

			if (isOwner) {
				// ── OWNER: persona merge + fact extraction + summary ──
				const currentDoc = soul.getDocument(OWNER_SOUL_ID);
				if (!currentDoc) return;

				// Run all three layers in parallel (same as contacts)
				const [mergeResult, factsResult, summaryResult] =
					await Promise.allSettled([
						// Layer 1: Persona merge (append-only)
						(() => {
							const prompt = `CURRENT OWNER PROFILE:\n${currentDoc}\n\nOWNER'S MESSAGE:\n${userMessage}`;
							return client.chat.completions.create({
								model: extractionModel,
								messages: [
									{ role: "system", content: OWNER_MERGE_PROMPT },
									{ role: "user", content: prompt },
								],
								temperature: 0.1,
								max_tokens: 800,
							});
						})(),

						// Layer 2: Structured facts (personal details)
						client.chat.completions.create({
							model: extractionModel,
							messages: [
								{ role: "system", content: FACT_EXTRACTION_PROMPT },
								{ role: "user", content: `User: ${userMessage}` },
							],
							temperature: 0.0,
							max_tokens: 300,
						}),

						// Layer 3: Chat summary (rolling digest)
						(async () => {
							const memories = await memoryStore.getMemories(
								OWNER_SOUL_ID,
								"summary",
							);
							const existingSummary = memories.find(
								(m: any) => m.key === "chat_digest",
							);
							return client.chat.completions.create({
								model: extractionModel,
								messages: [
									{ role: "system", content: SUMMARY_UPDATE_PROMPT },
									{
										role: "user",
										content: existingSummary
											? `CURRENT SUMMARY:\n${existingSummary.value}\n\nNEW CONVERSATION:\n${conversationText}`
											: `CURRENT SUMMARY:\n(empty - first conversation)\n\nNEW CONVERSATION:\n${conversationText}`,
									},
								],
								temperature: 0.1,
								max_tokens: 300,
							});
						})(),
					]);

				// Process Layer 1: Persona merge
				if (mergeResult.status === "fulfilled") {
					const newFacts = mergeResult.value.choices[0]?.message?.content || "";
					if (newFacts.trim() && newFacts.trim() !== "NO_NEW_FACTS") {
						const merged = mergeIntoOwnerDoc(await currentDoc, newFacts);
						if (merged !== (await currentDoc)) {
							await soul.saveDocument(OWNER_SOUL_ID, merged, documentRevision(await currentDoc));
							console.log(
								`[Soul] ✏️ Merged new facts into owner profile (${merged.length} chars)`,
							);
						}
					} else {
						console.log("[Soul] Owner conversation — no new persona facts");
					}
				} else {
					console.error(
						"[Soul] Owner merge failed:",
						mergeResult.reason?.message,
					);
				}

				// Process Layer 2: Structured facts
				if (factsResult.status === "fulfilled") {
					const factsRaw =
						factsResult.value.choices[0]?.message?.content || "{}";
					try {
						const cleaned = factsRaw
							.replace(/```json\n?/g, "")
							.replace(/```\n?/g, "")
							.trim();
						const facts = JSON.parse(cleaned);
						let count = 0;
						for (const [key, value] of Object.entries(facts)) {
							if (typeof value === "string" && value.trim()) {
								memoryStore.saveMemory(
									OWNER_SOUL_ID,
									"identity",
									key,
									value.trim(),
									"extracted",
								);
								count++;
							}
						}
						if (count > 0)
							console.log(
								`[Soul] 📋 Saved ${count} owner facts to agent_memories`,
							);
					} catch {
						console.log(
							"[Soul] Owner fact extraction — no valid JSON returned",
						);
					}
				} else {
					console.error(
						"[Soul] Owner fact extraction failed:",
						factsResult.reason?.message,
					);
				}

				// Process Layer 3: Summary
				if (summaryResult.status === "fulfilled") {
					const summary =
						summaryResult.value.choices[0]?.message?.content || "";
					if (summary.trim()) {
						memoryStore.saveMemory(
							OWNER_SOUL_ID,
							"summary",
							"chat_digest",
							summary.trim(),
							"system",
						);
						console.log(
							`[Soul] 📝 Updated owner chat summary (${summary.length} chars)`,
						);
					}
				} else {
					console.error(
						"[Soul] Owner summary update failed:",
						summaryResult.reason?.message,
					);
				}
			} else {
				// ── CONTACT: three-layer extraction ───────────────────
				const personaId = sessionId;
				const currentDoc = soul.getDocument(personaId);

				// Read owner name for context
				const ownerDoc = await soul.getDocument(OWNER_SOUL_ID);

				const ownerName = readOwnerProfile(ownerDoc || "").profile.name;

				const ownerContext = ownerName
					? `\nCONTEXT: The owner of this AI assistant is "${ownerName}". The user in this conversation is "${contactName || "unknown"}". Only record facts about the USER.`
					: "";

				// Save contact details from metadata immediately (no LLM needed)
				if (contactName) {
					memoryStore.saveMemory(
						personaId,
						"identity",
						"name",
						contactName,
						"metadata",
					);
				}
				if (source === "whatsapp" && sessionId.includes("@")) {
					// Only save phone if it's a real phone JID, not a LID
					if (sessionId.endsWith("@s.whatsapp.net")) {
						const phone = "+" + sessionId.replace(/@.*/, "");
						memoryStore.saveMemory(
							personaId,
							"identity",
							"phone",
							phone,
							"metadata",
						);
					}
					memoryStore.saveMemory(
						personaId,
						"identity",
						"channel",
						"whatsapp",
						"metadata",
					);
				}
				if (source === "telegram" && sessionId.startsWith("telegram:")) {
					memoryStore.saveMemory(
						personaId,
						"identity",
						"telegram_id",
						sessionId.replace("telegram:", ""),
						"metadata",
					);
					memoryStore.saveMemory(
						personaId,
						"identity",
						"channel",
						"telegram",
						"metadata",
					);
				}

				// Run three LLM calls in parallel for efficiency
				const [personaResult, factsResult, summaryResult] =
					await Promise.allSettled([
						// Layer 1: Persona (qualitative personality profile)
						client.chat.completions.create({
							model: extractionModel,
							messages: [
								{ role: "system", content: SOUL_REWRITE_PROMPT },
								{
									role: "user",
									content: currentDoc
										? `CURRENT DOCUMENT:\n${currentDoc}\n\nMETADATA:\nname: ${contactName || "unknown"}${ownerContext}\n\nNEW CONVERSATION:\n${conversationText}`
										: `CURRENT DOCUMENT:\n(empty - this is a new person)\n\nMETADATA:\nname: ${contactName || "unknown"}${ownerContext}\n\nNEW CONVERSATION:\n${conversationText}`,
								},
							],
							temperature: 0.1,
							max_tokens: 1000,
						}),

						// Layer 2: Structured facts (personal details as JSON)
						client.chat.completions.create({
							model: extractionModel,
							messages: [
								{ role: "system", content: FACT_EXTRACTION_PROMPT },
								{ role: "user", content: conversationText },
							],
							temperature: 0.0,
							max_tokens: 300,
						}),

						// Layer 3: Chat summary (rolling digest)
						(async () => {
							const memories = await memoryStore.getMemories(
								personaId,
								"summary",
							);
							const existingSummary = memories.find(
								(m: any) => m.key === "chat_digest",
							);
							return client.chat.completions.create({
								model: extractionModel,
								messages: [
									{ role: "system", content: SUMMARY_UPDATE_PROMPT },
									{
										role: "user",
										content: existingSummary
											? `CURRENT SUMMARY:\n${existingSummary.value}\n\nNEW CONVERSATION:\n${conversationText}`
											: `CURRENT SUMMARY:\n(empty - first conversation)\n\nNEW CONVERSATION:\n${conversationText}`,
									},
								],
								temperature: 0.1,
								max_tokens: 300,
							});
						})(),
					]);

				// Process Layer 1: Persona document
				if (personaResult.status === "fulfilled") {
					const updatedDoc =
						personaResult.value.choices[0]?.message?.content || "";
					if (updatedDoc.trim()) {
						await soul.saveDocument(personaId, updatedDoc.trim(), documentRevision(await currentDoc));
						console.log(
							`[Soul] 🧠 Updated persona for ${personaId} (${updatedDoc.length} chars)`,
						);
					}
				} else {
					console.error(
						"[Soul] Persona extraction failed:",
						personaResult.reason?.message,
					);
				}

				// Process Layer 2: Structured facts
				if (factsResult.status === "fulfilled") {
					const factsRaw =
						factsResult.value.choices[0]?.message?.content || "{}";
					try {
						// Strip markdown code fences if present
						const cleaned = factsRaw
							.replace(/```json\n?/g, "")
							.replace(/```\n?/g, "")
							.trim();
						const facts = JSON.parse(cleaned);
						let count = 0;
						for (const [key, value] of Object.entries(facts)) {
							if (typeof value === "string" && value.trim()) {
								memoryStore.saveMemory(
									personaId,
									"identity",
									key,
									value.trim(),
									"extracted",
								);
								count++;
							}
						}
						if (count > 0) {
							console.log(
								`[Soul] 📋 Extracted ${count} facts for ${personaId}`,
							);
						}
					} catch {
						// JSON parse failed — skip silently
					}
				}

				// Process Layer 3: Chat summary
				if (summaryResult.status === "fulfilled") {
					const summary =
						summaryResult.value.choices[0]?.message?.content || "";
					if (summary.trim()) {
						memoryStore.saveMemory(
							personaId,
							"summary",
							"chat_digest",
							summary.trim(),
							"extracted",
						);
						console.log(`[Soul] 💬 Updated chat summary for ${personaId}`);
					}
				} else {
					console.error(
						"[Soul] Summary update failed:",
						summaryResult.reason?.message,
					);
				}
			}
		} catch (err: any) {
			console.error("[Soul] Data extraction error:", err.message);
		}
		});
	}

	/**
	 * Filter tools by autonomy tier for delegation to subagents.
	 *
	 * T1: Only safe tools. Blocks cli_triage, exec, and mcp_playwright_browser_ tools.
	 * T2: Allows everything except cli_triage and tools starting with exec.
	 * T3: Allows all tools unchanged.
	 *
	 * @param allowedTools - The list of tools allowed for the agent
	 * @param tier - The autonomy tier (T1, T2, or T3)
	 * @returns Filtered array of tool names
	 */
	function filterToolsByTier(allowedTools: string[], tier: string): string[] {
		// T3: No restrictions
		if (tier === "T3") return allowedTools;

		// T1: Only safe, non-destructive tools
		if (tier === "T1") {
			return allowedTools.filter((t) => {
				// Block cli_triage, exec tools, and browser automation tools
				if (t === "cli_triage") return false;
				if (t.startsWith("exec_")) return false;
				if (t.startsWith("mcp_playwright_browser_")) return false;
				return true;
			});
		}

		// T2: Everything except cli_triage and exec tools
		return allowedTools.filter((t) => {
			if (t === "cli_triage") return false;
			if (t.startsWith("exec_")) return false;
			return true;
		});
	}

	/**
	 * Runtime enforcement of agent autonomy tiers.
	 *
	 * T1 (Read-only / Non-destructive): Safe tools only.
	 *   - Messaging, contacts, search, memory, personas, vault, sessions, todo
	 *   - Google tools (Gmail, Drive, Sheets, Docs, Calendar, Contacts, Places)
	 *   - Web search / fetch, file read, scheduler (read-only actions)
	 *   - Approvals (ask_owner, respond, list_pending)
	 *   - BLOCKED: cli_triage, cli_run, exec, browser automation (mcp_playwright_*),
	 *              skill creation/deletion, module management, delegate_to_agent
	 *
	 * T2 (Operational): Everything except system-level modification tools.
	 *   - All T1 tools PLUS: browser automation, skill CRUD, file write/delete
	 *   - BLOCKED: cli_triage, cli_run, exec, promote_module, delete_module,
	 *              cli_test_module, cli_delete_module (self-modification tools)
	 *
	 * T3 (Full): All tools unrestricted.
	 */
	function enforceAutonomyTier(
		tools: ToolDefinition[],
		tier: "T1" | "T2" | "T3",
	): ToolDefinition[] {
		// T3: No restrictions
		if (tier === "T3") return tools;

		// T1: Only safe, read-only tools
		if (tier === "T1") {
			// Block all CLI/system tools
			const BLOCKED_T1_PREFIXES = ["cli_triage", "cli_run", "cli_", "exec_"];
			// Block all browser automation tools
			const BLOCKED_T1_PREFIXES_BROWSER = ["mcp_playwright_"];
			// Block skill/module management (write operations)
			const BLOCKED_T1_EXACT = new Set([
				"create_skill",
				"delete_skill",
				"update_skill",
				"promote_module",
				"test_module",
				"delete_module",
				"cli_test_module",
				"cli_promote_module",
				"cli_delete_module",
				"delegate_to_agent",
				"execute_plan",
			]);

			return tools.filter((t) => {
				// Block by exact name
				if (BLOCKED_T1_EXACT.has(t.name)) return false;
				// Block by prefix (cli_*, exec_*, mcp_playwright_*)
				if (BLOCKED_T1_PREFIXES.some((p) => t.name.startsWith(p))) return false;
				if (BLOCKED_T1_PREFIXES_BROWSER.some((p) => t.name.startsWith(p)))
					return false;
				return true;
			});
		}

		// T2: Everything except self-modification / system-level tools
		// Block: cli_triage, cli_run, exec, module management
		const BLOCKED_T2 = new Set([
			"cli_triage",
			"cli_run",
			"cli_test_module",
			"cli_promote_module",
			"cli_delete_module",
			"promote_module",
			"delete_module",
			"test_module",
		]);

		return tools.filter((t) => !BLOCKED_T2.has(t.name));
	}

	async function callLLM(
		messages: ChatMsg[],
		isOwner: boolean = true,
		agentId?: string,
		preSelectedTools?: ToolDefinition[],
		purpose: ModelPurpose = "chat",
		source?: string,
		responseFormat?: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming['response_format'],
	): Promise<{
		content: string;
		toolCalls: Array<{
			id: string;
			toolName: string;
			arguments: Record<string, unknown>;
		}>;
		usage?: {
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
		};
		model?: string;
		thinking?: string;
	}> {
		const {
			client,
			model: routedModel,
			providerId,
		} = await getClientForPurpose(purpose);

		// Per-agent model override: if the agent defines a model, use it instead of the global route
		let activeModel = routedModel;

		// Use pre-selected tools if provided (from Phase 1 tool selection),
		// otherwise fall back to the full tool set.
		//
		// Fast Lane + Dynamic Merge:
		// If the active agent has `allowedTools`, those are the "Fast Lane" — always guaranteed.
		// We then MERGE those with the Phase 1 dynamically-selected tools so that orphaned
		// tools (e.g. gmail, vault, apple) become accessible when the request needs them.
		// This prevents the 90% of tools that aren't statically mapped to any agent from
		// being permanently invisible.
		let filteredTools: ToolDefinition[];
		const agent =
			agentId && crewRegistry.hasAgent(agentId)
				? crewRegistry.getAgent(agentId)!
				: undefined;

		if (agent && agent.allowedTools && agent.allowedTools.length > 0) {
			const allTools = await getToolsForSource(isOwner);
			const allToolsWithMods = await getAllToolsWithModules();
			const toolModuleMap = new Map(
				allToolsWithMods.map((t: { module: string; tool: ToolDefinition }) => [
					t.tool.name,
					t.module,
				]),
			);
			const fastLane = allTools.filter((t) =>
				agent.allowedTools!.includes(t.name),
			);
			if (preSelectedTools && preSelectedTools.length > 0) {
				// Modules safe to dynamically inject into any agent.
				// Excludes dangerous/build-only modules: cli, exec, patch — these must be
				// explicitly granted via allowedTools and should never come from Phase 1 selection.
				const SAFE_DYNAMIC_MODULES = new Set([
					"google",
					"apple",
					"messaging",
					"vault",
					"sessions",
					"personas",
					"media",
					"transcription",
					"web-search",
					"web-fetch",
					"files",
					"approvals",
					"followups",
					"scheduler",
					"browser",
					"mcp",
				]);
				const fastLaneNames = new Set(fastLane.map((t) => t.name));
				const dynamicExtras = preSelectedTools.filter((t) => {
					if (fastLaneNames.has(t.name)) return false; // already in fast lane
					const mod = toolModuleMap.get(t.name) || "";
					return SAFE_DYNAMIC_MODULES.has(mod); // only safe modules
				});
				filteredTools = [...fastLane, ...dynamicExtras];
				log.info(
					"Agent",
					`Fast Lane: ${fastLane.length} fixed + ${dynamicExtras.length} dynamic = ${filteredTools.length} total`,
				);
			} else {
				// No Phase 1 result (e.g. pure chat) — just the fast lane
				filteredTools = fastLane;
			}
		} else if (preSelectedTools) {
			filteredTools = preSelectedTools;
		} else {
			filteredTools = await getToolsForSource(isOwner);
		}

		// CRITICAL: Sub-agents must NEVER be allowed to spawn deeper sub-agents or re-plan,
		// which prevents recursive infinity loops in the multi-agent execution hierarchy.
		if (source === "sub-agent") {
			filteredTools = filteredTools.filter(
				(t) =>
					!["delegate_to_agent", "execute_plan", "switch_agent"].includes(
						t.name,
					),
			);
		}

		// ── Autonomy Tier Enforcement ─────────────────────────────
		// Runtime enforcement of agent autonomy tiers (T1/T2/T3).
		// This prevents lower-tier agents from accessing dangerous tools
		// regardless of what the LLM or Phase 1 tool selection wants.
		if (agent && agent.autonomyTier) {
			filteredTools = enforceAutonomyTier(filteredTools, agent.autonomyTier);
			if (filteredTools.length < (agent.allowedTools?.length || 0)) {
				log.info(
					"Agent",
					`Autonomy tier ${agent.autonomyTier}: filtered to ${filteredTools.length} tools for agent ${agentId}`,
				);
			}
		}

		if (agent) {
			// Model override — agent-specific model takes priority over global routing
			if (agent.model) {
				activeModel = agent.model;
				log.info(
					"Agent",
					`Model override for ${agentId}: ${activeModel} (was ${routedModel})`,
				);
			}
		}

		const tools =
			filteredTools.length > 0 ? formatToolsForAPI(filteredTools) : undefined;
		log.info(
			"Agent",
			`Calling LLM: ${activeModel} [${purpose}] (via ${providerId})`,
		);
		log.info(
			"Agent",
			`Tools available: ${filteredTools.length} (isOwner: ${isOwner}${preSelectedTools ? ", phase-2 selected" : ""})`,
		);

		// Build provider-specific thinking config for chat purpose
		// Each provider has its own way of requesting thinking content:
		//   - Gemini/Vertex: google.thinking_config.include_thoughts
		//   - Ollama (Qwen3, etc.): think: true → returns reasoning_content
		//   - OpenAI o-series: built-in, no extra config needed
		let thinkingConfig: Record<string, unknown> = {};
		const isGeminiProvider = ["gemini", "vertex"].includes(providerId);
		const isOllamaProvider = providerId === "ollama";

		if (isGeminiProvider) {
			thinkingConfig = {
				extra_body: {
					google: {
						thinking_config: {
							include_thoughts: isOwner,
						},
					},
				},
			};
		} else if (isOllamaProvider) {
			// Ollama exposes thinking via think: true in the request body
			thinkingConfig = { think: isOwner };
		}

		try {
			const completion = await client.chat.completions.create({
				model: activeModel,
				messages: isOwner ? messages : [...messages, { role: "system" as const, content: VISITOR_REPLY_CONTRACT }],
				temperature: responseFormat ? 0 : currentConfig.temperature,
				max_tokens: currentConfig.maxTokens,
				...(responseFormat ? { response_format: responseFormat } : {}),
				...(tools ? { tools } : {}),
				...thinkingConfig,
			} as any);

			const choice = completion.choices?.[0];
			if (!choice) {
				log.error(
					"Agent",
					`No choices in LLM response: ${JSON.stringify(completion).slice(0, 500)}`,
				);
				return { content: "", toolCalls: [], usage: undefined };
			}
			const content = choice.message?.content || "";
			const nativeToolCalls = choice.message?.tool_calls || [];

			const toolCalls = nativeToolCalls
				.filter((tc: any) => tc.type === "function" && tc.function)
				.map((tc: any) => {
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(tc.function.arguments || "{}");
					} catch {
						// Invalid JSON — pass empty args
					}
					return {
						id: tc.id,
						toolName: tc.function.name,
						arguments: args,
					};
				});

			const usage = completion.usage
				? {
						promptTokens: completion.usage.prompt_tokens,
						completionTokens: completion.usage.completion_tokens,
						totalTokens: completion.usage.total_tokens,
					}
				: undefined;

			log.info(
				"Agent",
				`LLM response: ${content.length} chars text, ${toolCalls.length} tool calls`,
			);
			if (toolCalls.length > 0 && purpose === "chat") {
				log.info(
					"Agent",
					`Tool calls: ${toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.arguments)})`).join(", ")}`,
				);
			}

			// ── Extract thinking/reasoning content ──────────────────────
			// Different providers surface thinking content differently via the OpenAI compat layer:
			//   - Gemini: returns thought summaries via include_thoughts (extra field or inline)
			//   - OpenAI o-series: returns reasoning in reasoning_content
			//   - DeepSeek R1: returns reasoning_content
			//   - Qwen3 (thinking mode): wraps in <think> tags
			// We normalize all of these into a single 'thinking' field.
			let thinking: string | undefined;

			// 1. Check for reasoning_content on the message (OpenAI o-series, DeepSeek, Gemini)
			const rawMessage = choice.message as any;
			if (
				rawMessage?.reasoning_content &&
				typeof rawMessage.reasoning_content === "string"
			) {
				thinking = rawMessage.reasoning_content;
			}

			// 2. Check for <think> or <thought> tags in the content (Qwen3, DeepSeek inline, etc.)
			if (!thinking && content) {
				const thinkMatch =
					content.match(/<think>([\s\S]*?)<\/think>/i) ||
					content.match(/<thought>([\s\S]*?)<\/thought>/i);
				if (thinkMatch) {
					thinking = thinkMatch[1].trim();
				}
			}

			if (thinking) {
				log.info(
					"Agent",
					`Thinking content captured: ${thinking.length} chars`,
				);
			}

			// Strip <think>/<thought> blocks from the visible content
			let cleanContent = content;
			if (content) {
				cleanContent = content
					.replace(/<think>[\s\S]*?<\/think>/gi, "")
					.replace(/<thought>[\s\S]*?<\/thought>/gi, "")
					.trim();
			}

			// Record metering
			try {
				const meter = getMetering();
				if (meter && usage) {
					meter.record(
						activeModel,
						purpose,
						providerId,
						usage.promptTokens,
						usage.completionTokens,
					);
				}
			} catch {
				/* metering should never block LLM calls */
			}

			return {
				content: cleanContent,
				toolCalls,
				usage,
				model: activeModel,
				thinking,
			};
		} catch (err: any) {
			log.error(
				"Agent",
				`LLM call failed [${purpose}/${activeModel}]: ${err.message}`,
			);
			throw new Error(`LLM call failed: ${err.message}`);
		}
	}

	Object.assign(orchestrator, {
		async chat(
			sessionId: string,
			message: string,
			source?: "web" | "whatsapp" | "telegram" | "webchat" | "sub-agent",
			contactName?: string,
			isOwner: boolean = false,
			attachments?: Attachment[],
			skillContext?: string,
			onProgress?: (event: any) => void,
		): Promise<AgentResponse> {
			let lock = sessionLocks.get(sessionId);
			if (!lock) {
				lock = new Mutex();
				sessionLocks.set(sessionId, lock);
			}
			const unlock = await lock.acquire();
			try {
				const startTime = Date.now();
			const toolResults: ToolExecutionResult[] = [];

			// Reset continuation count on new manual user message (not a sub-agent or automated check)
			if (source !== "sub-agent" && (source as string) !== "scheduler") {
				continuationCount.set(sessionId, 0);
			}

			const pipeline = new MiddlewarePipeline()
				.use(new LoggingMiddleware())
				.use(new CircuitBreakerMiddleware())
				.use(new SkillDetectorMiddleware())
				.use(
					new RetryMiddleware(async (ctx) => {
						const preResult = await pipeline.runBeforeTool(ctx);
						if (preResult?.skipExecution) return preResult.skipExecution;

						if (sessionId.startsWith("followup-") || (!isOwner && !VISITOR_SAFE_TOOL_NAMES.has(ctx.toolName))) {
							return {
								toolName: ctx.toolName,
								success: false,
								error: `Security Policy Violation: Tool ${ctx.toolName} is restricted for visitors. Unauthorized.`,
								duration: 0,
							};
						}

						return await toolRegistry.execute(
							{
								toolName: ctx.toolName,
								arguments: ctx.toolArgs,
								rawText: "",
							},
							ctx.toolContext || { sessionId: ctx.sessionId }
						);
					})
				);

			// Track incoming message
			metricsCollector.recordMessage(source || "web", "in");

			// Ensure session exists
			const session = await conversationStore.getOrCreateSession(
				sessionId,
				source || "web",
				source === "web" ? "Command Center" : contactName || sessionId,
			);
			// Update session name if we now have a better name (e.g. pushName resolved)
			if (
				contactName &&
				session.name !== contactName &&
				source !== "web" &&
				!session.name?.startsWith(contactName)
			) {
				await conversationStore.renameSession(sessionId, contactName);
			}

			// Store the user message
			const userMetadata: ChatMessageMetadata = {
				source,
				whatsappJid: source === "whatsapp" ? sessionId : undefined,
				contactName,
				attachments,
			};
			await conversationStore.addMessage(
				sessionId,
				"user",
				message,
				userMetadata,
			);

			// isOwner is now passed in by the unified message handler.
			// Fallback: if not explicitly provided, assume web === owner (backward compat)
			const ownerFlag = isOwner ?? source === "web";

			// Build the messages array with history (pass isOwner for soul prompt framing)
			let messages = await buildMessages(
				sessionId,
				message,
				ownerFlag,
				attachments,
				contactName,
			);

			// Trim history to fit the active model's context window.
			// Prevents "n_keep >= n_ctx" errors on small local models (gemma4:e4b = 4K ctx).
			// Must run after buildMessages so we know the final system prompt size.
			try {
				const { model: chatModel } = await getClientForPurpose("chat");
				messages = trimMessagesToContextWindow(messages, chatModel);
			} catch {
				/* ignore — trimming is best-effort */
			}

			// ── Prompt Experiment A/B Testing ───────────────────────
			const experiments = getPromptExperiments();
			let activeExperiment = null;
			let assignedVariant = null;
			if (ownerFlag && experiments) {
				activeExperiment = await experiments.getActiveExperiment();
				if (activeExperiment) {
					assignedVariant = experiments.assignVariant(
						sessionId,
						activeExperiment,
					);
					const systemMsg = messages.find((m) => m.role === "system");
					if (systemMsg) {
						if (assignedVariant.isPartial) {
							systemMsg.content += "\n\n" + assignedVariant.promptOverride;
						} else {
							systemMsg.content = assignedVariant.promptOverride;
						}
					}
				}
			}

			// If skill context is provided, inject it as a system directive right before the user message.
			// This keeps skill instructions out of conversation history while giving the LLM context.
			if (skillContext) {
				// Find recent outbound messages TO this contact for thread context
				const recentOutbound = await findRecentOutboundMessages(
					sessionId,
					conversationStore,
					contactName,
				);

				// Insert skill context as a system message before the last user message
				const lastUserMsgIdx = messages.length - 1;
				const contextParts = [skillContext];

				if (recentOutbound.length > 0) {
					contextParts.push("");
					contextParts.push(
						"## Recent messages the owner sent TO this person:",
					);
					for (const msg of recentOutbound) {
						contextParts.push(`- "${msg}"`);
					}
					contextParts.push("");
					contextParts.push(
						"Use this context to understand what the person is replying to.",
					);
				}

				messages.splice(lastUserMsgIdx, 0, {
					role: "system",
					content: contextParts.join("\n"),
				} as ChatMsg);
			}
			let lastUsage:
				| {
						promptTokens: number;
						completionTokens: number;
						totalTokens: number;
				  }
				| undefined;

			// ── Phase 1: Tool Selection ──────────────────────────────
			// For owner sessions, classify which tool modules are needed
			// to avoid sending all 100+ tool schemas (~12k tokens) on every call.
			// Visitor sessions already have a small filtered set, so skip Phase 1.
			let selectedTools: ToolDefinition[] | undefined;

			if (ownerFlag && !skillContext && source !== "sub-agent") {
				// Skill-driven messages need full tool access (skills are automations)
				try {
					// Use getClientForPurpose('router') so Vertex AI gets a fresh OAuth2 token.
					// createLLMClient() uses the static llmApiKey which is empty for Vertex → 401.
					const { client: chatClient, model: chatModel } =
						await getClientForPurpose("router");
					const toolsWithModules = await getAllToolsWithModules();
					// Include MCP tools under a synthetic module name
					let mcpToolDefs: Array<{ module: string; tool: ToolDefinition }> = [];
					try {
						const {
							getMcpServerManager,
						} = require("../capabilities/mcp/mcp-manager.js");
						const mgr = getMcpServerManager();
						const mcpTools = mgr.getMcpToolDefinitions() as ToolDefinition[];
						mcpToolDefs = mcpTools.map((t: ToolDefinition) => {
							// Derive module from tool name prefix (e.g. mcp_playwright_* → browser)
							const mod = t.name.startsWith("mcp_playwright_")
								? "browser"
								: t.name.startsWith("mcp_tavily_")
									? "web-search"
									: "mcp";
							return { module: mod, tool: t };
						});
					} catch {
						/* MCP not available */
					}

					const allWithModules = [...toolsWithModules, ...mcpToolDefs];

					// Use purpose-based routing for the router model if configured.
					// Default: pass chatClient as the routerOverride so Vertex tokens are always used.
					// This prevents the tool selector from falling back to createLLMClient() which
					// uses a static/empty API key and causes 401 errors with Vertex AI.
					let routerOverride: { client: OpenAI; model: string } = {
						client: chatClient,
						model: chatModel,
					};
					const routerRouting = currentConfig.modelRouting?.router;
					if (routerRouting) {
						const { client: rClient, model: rModel } =
							await getClientForPurpose("router");
						routerOverride = { client: rClient, model: rModel };
					}

					const selection = await selectToolsForMessage(
						chatClient,
						chatModel,
						message,
						allWithModules.map((t) => ({ module: t.module, tool: t.tool })),
						ownerFlag,
						undefined, // don't pass llmBaseUrl — we already handle auth via routerOverride
						routerOverride,
					);
					selectedTools = selection.tools;

					// Meter Phase 1 (tool selection) separately so usage dashboard shows 'router' cost
					try {
						const meter = getMetering();
						if (meter && !selection.skipped) {
							// Estimate: compact catalog (~300 tokens) + message (~50) + response (~50) = ~400 prompt, 50 completion
							const catalogTokens = Math.round(
								JSON.stringify(allWithModules.map((t) => t.module)).length / 4,
							);
							meter.record(
								routerOverride.model,
								"router",
								"vertex",
								catalogTokens + 100,
								50,
							);
						}
					} catch {
						/* metering never blocks */
					}

					if (!selection.skipped) {
						log.info(
							"ToolSelector",
							`Selected ${selectedTools.length} tools (saved ~${selection.tokensSaved} tokens)`,
						);
					}
				} catch (err: any) {
					log.warn(
						"ToolSelector",
						`Phase 1 failed, using all tools: ${err.message}`,
					);
					// selectedTools stays undefined → callLLM will use full set
				}
			}
			// ── Skill-First Routing ──────────────────────────────────
			// Check if any saved skills match this request.
			// If so, inject a STRONG directive avoiding manual execution for agents.
			// CRITICAL: Nexus is pure orchestration. It gets a dictionary, not a directive.
			const currentAgentId = sessionAgents.get(sessionId);
			const isNexus =
				!currentAgentId ||
				currentAgentId === "nexus" ||
				currentAgentId.toLowerCase() === "nexus";

			if (ownerFlag && skillEngine && !skillContext) {
				try {
					const skills = skillEngine.getSkills();
					const enabledSkills = skills.filter((s: any) => s.enabled);
					if (enabledSkills.length > 0) {
						// Build keyword index from each skill's name, description, and instructions
						const messageLower = message.toLowerCase();
						const messageWords = messageLower.split(/\s+/);

						// Score each skill by keyword overlap with the user's message
						const scored = enabledSkills.map((s: any) => {
							const haystack = [
								s.name || "",
								s.description || "",
								(s.processor?.instructions || "").slice(0, 300),
							]
								.join(" ")
								.toLowerCase();

							// Extract meaningful keywords (skip common words)
							const skipWords = new Set([
								"a",
								"an",
								"the",
								"to",
								"and",
								"or",
								"in",
								"on",
								"for",
								"of",
								"is",
								"it",
								"this",
								"that",
								"with",
								"from",
								"at",
								"by",
								"as",
								"if",
								"new",
								"use",
								"all",
							]);
							const skillWords = haystack
								.split(/[\s\-_/]+/)
								.filter((w) => w.length > 2 && !skipWords.has(w));

							let score = 0;
							for (const word of messageWords) {
								if (word.length <= 2) continue;
								if (
									skillWords.some(
										(sw) => sw.includes(word) || word.includes(sw),
									)
								) {
									score++;
								}
								// Bonus for exact name match
								if (s.name && s.name.toLowerCase().includes(word)) {
									score += 2;
								}
							}
							// Bonus for skill ID appearing in message (e.g. user says "substack")
							if (s.id && messageLower.includes(s.id.replace(/-/g, " "))) {
								score += 5;
							}
							// Also check hyphenated form (e.g. "substack-writer" keywords individually)
							for (const part of (s.id || "").split("-")) {
								if (part.length > 2 && messageLower.includes(part)) {
									score += 3;
								}
							}
							return { skill: s, score };
						});

						// Sort by score descending
						scored.sort((a, b) => b.score - a.score);
						const bestMatch = scored[0];

						const skillSummary = enabledSkills
							.map(
								(s: any) =>
									`• "${s.name}" (${s.id}) — ${s.processor?.instructions?.slice(0, 80) || "no description"}`,
							)
							.join("\n");

						const insertIdx = messages.length - 1;

						if (isNexus) {
							messages.splice(insertIdx, 0, {
								role: "system",
								content: `## Available Skills Dictionary
The following automation skills exist in the workspace:
${skillSummary}

As the Orchestrator, be aware these skills exist. DO NOT use them to answer basic queries (e.g. weather). You may use \`run_skill\` if the user explicitly asks to run one, or delegate related tasks to specialized agents who will use them.`,
							} as ChatMsg);
							log.info(
								"Agent",
								`Skill-first: injected Dictionary for Nexus (${enabledSkills.length} skills max score ${bestMatch?.score || 0})`,
							);
						} else if (bestMatch && bestMatch.score >= 3) {
							// STRONG match — inject a mandatory directive
							const s = bestMatch.skill;
							messages.splice(insertIdx, 0, {
								role: "system",
								content: `## MANDATORY: Use Skill for This Task
You have a pre-built skill that handles this exact type of request:

**"${s.name}" (ID: ${s.id})**
Instructions: ${(s.processor?.instructions || "").slice(0, 200)}...

⚠️ You MUST call \`run_skill\` with skill_id="${s.id}" and pass the user's request as the message.
Do NOT attempt this task manually with browser tools, CLI, or other tools.
The skill contains tested, step-by-step instructions that are more reliable than ad-hoc execution.

Other available skills:
${skillSummary}`,
							} as ChatMsg);
							log.info(
								"Agent",
								`Skill-first: STRONG match → "${s.name}" (${s.id}) with score ${bestMatch.score}`,
							);
						} else {
							// No strong match — inject a softer hint
							messages.splice(insertIdx, 0, {
								role: "system",
								content: `## Available Skills
You have pre-built automation skills. Before doing a task manually, check if a skill already handles it and use run_skill:
${skillSummary}

If a skill matches the user's request, call run_skill with the skill ID. Otherwise, proceed normally.`,
							} as ChatMsg);
							log.info(
								"Agent",
								`Skill-first: injected ${enabledSkills.length} skill hints (no strong match, best score: ${bestMatch?.score || 0})`,
							);
						}
					}
				} catch {
					/* skills not available */
				}
			}

			// Agent loop with tool calling
			let iteration = 0;
			let finalContent = "";
			let lastModel = currentConfig.llmModel;
			let thinkingContent: string | undefined;
			const loopDetector = new LoopDetector();

			while (iteration < currentConfig.maxToolIterations) {
				iteration++;

				const activeAgentId = sessionAgents.get(sessionId);
				const llmResult = await callLLM(
					messages,
					ownerFlag,
					activeAgentId,
					selectedTools,
					"chat",
					source,
				);

				log.info(
					"Orchestrator",
					`RAW LLM RESPONSE: ${JSON.stringify({
						text: llmResult.content.substring(0, 500),
						toolCalls: llmResult.toolCalls,
					})}`,
				);

				lastUsage = llmResult.usage;
				lastModel = llmResult.model || currentConfig.llmModel;
				// Capture thinking from the first iteration (where real reasoning happens)
				if (llmResult.thinking && !thinkingContent) {
					thinkingContent = llmResult.thinking;
				}

				if (llmResult.toolCalls.length === 0) {
					// No tool calls — check if this is an "I can't" response
					// If so, auto-triage to see if we have tools or could build one
					const cantPhrases = [
						"i can't",
						"i cannot",
						"i don't have",
						"i'm unable",
						"not available",
						"no tool",
						"don't currently",
						"not supported",
						"beyond my",
						"outside my",
						"i lack",
						"not possible for me",
						"i'm not able",
					];
					const lowerContent = llmResult.content.toLowerCase();
					const signalsInability = cantPhrases.some((p) =>
						lowerContent.includes(p),
					);

					if (signalsInability && iteration === 1) {
						// LLM signalled it can't do something.
						// Log it for debugging but do NOT auto-invoke cli_triage —
						// that tool is for the Coder agent only and costs 9000+ tokens.
						// The Nexus system prompt explicitly instructs the agent to use
						// delegate_to_agent or available tools instead of giving up.
						log.info(
							"Agent",
							`LLM signalled inability — letting agent handle via delegation or available tools`,
						);
					}

					// Truly the final response
					finalContent = llmResult.content;
					break;
				}

				// Add assistant message with tool_calls to context
				messages.push({
					role: "assistant",
					content: llmResult.content || null,
					tool_calls: llmResult.toolCalls.map((tc) => ({
						id: tc.id,
						type: "function" as const,
						function: {
							name: tc.toolName,
							arguments: JSON.stringify(tc.arguments),
						},
					})),
				} as ChatMsg);

				// Execute tool calls and add results
				for (const toolCall of llmResult.toolCalls) {
					// Resolve tool aliases (e.g. browser_click → mcp_playwright_browser_click)
					let resolvedToolName = toolCall.toolName;
					const aliases = getToolAliases();
					if (aliases.has(toolCall.toolName)) {
						resolvedToolName = aliases.get(toolCall.toolName)!;
						log.info(
							"ToolRouter",
							`Alias: ${toolCall.toolName} → ${resolvedToolName}`,
						);
					}

      const toolContext = {
        sessionId,
        isOwner: ownerFlag,
        contactName,
        source,
        userMessage: message,
        getDatabase: () => db,
						getAgent: () => orchestrator,
						skillRepo,
						skillEngine,
						reportProgress: onProgress,
					};

					const middlewareCtx = {
						messages: messages.map((m) => ({
							role: m.role,
							content: m.content as string,
						})),
						toolName: resolvedToolName,
						toolArgs: toolCall.arguments,
						toolCallId: toolCall.id,
						sessionId,
						iteration,
						maxIterations: currentConfig.maxToolIterations,
						toolContext,
					};

					if (onProgress) {
						onProgress({
							agent: sessionAgents.get(sessionId) || "Nexus",
							action: `Using \`${resolvedToolName}\``,
							tool: resolvedToolName,
							args: toolCall.arguments,
						});
					}

					const beforeResult = await pipeline.runBeforeTool(middlewareCtx);
					let result: ToolExecutionResult;

					if (beforeResult?.skipExecution) {
						result = beforeResult.skipExecution;
					} else if (sessionId.startsWith("followup-") || (!isOwner && !VISITOR_SAFE_TOOL_NAMES.has(resolvedToolName))) {
						result = {
							toolName: resolvedToolName,
							success: false,
							error: `Security Policy Violation: Tool ${resolvedToolName} is restricted for visitors. Unauthorized.`,
							duration: 0,
						};
					} else {
						result = await toolRegistry.execute(
							{
								toolName: resolvedToolName,
								arguments: toolCall.arguments,
								rawText: "",
							},
							toolContext,
						);

						const afterResult = await pipeline.runAfterTool(
							middlewareCtx,
							result,
						);
						if (afterResult?.skipExecution) {
							result = afterResult.skipExecution;
						}
					}

					toolResults.push(result);
					metricsCollector.recordTool(
						toolCall.toolName,
						result.success,
						result.duration,
						sessionId,
					);

					// Add tool result as a "tool" role message (OpenAI format)
					const rawToolContent = result.success
						? result.result || "Completed (no details returned)."
						: isOwner
							? `❌ TOOL FAILED: ${toolCall.toolName}\nError: ${result.error}\nIMPORTANT: This tool call FAILED — do NOT tell the user it succeeded. Report the actual error. If you are using write_todos to track progress, mark this step as "failed" (not "completed"). Continue with the next step.`
							: "The requested internal action could not be completed right now. Do not mention technical errors, tools, databases, or system details to the visitor. State that the action could not be confirmed. Do not promise a handoff or follow-up.";

					// ── Token guard: truncate large tool results ──────────────
					// browser_snapshot returns full DOM accessibility trees (10k+ tokens).
					// Other tools (web_fetch, cli) can also return large content.
					// Cap to prevent context explosion across multi-step agent turns.
					const isBrowserTool = resolvedToolName.startsWith("mcp_playwright_");
					const MAX_TOOL_CHARS = isBrowserTool ? 6000 : 3000;
					const toolResultContent =
						rawToolContent.length > MAX_TOOL_CHARS
							? rawToolContent.slice(0, MAX_TOOL_CHARS) +
								`\n\n[...truncated ${rawToolContent.length - MAX_TOOL_CHARS} chars to save tokens]`
							: rawToolContent;

					messages.push({
						role: "tool",
						tool_call_id: toolCall.id,
						content: toolResultContent,
					} as ChatMsg);

					// Check for loop detection
					const loopCheck = loopDetector.record(
						toolCall.toolName,
						toolCall.arguments,
						toolResultContent,
					);
					if (loopCheck.shouldStop) {
						log.warn("Agent", `Loop detected: ${loopCheck.reason}`);
						messages.push({
							role: "system",
							content: `⚠️ LOOP DETECTED: ${loopCheck.reason}\n\nStop repeating the same tool calls. Respond with what you have so far, or try a different approach.`,
						} as ChatMsg);
						// Don't break — let the LLM see the warning and self-correct.
						// But if critical, force break.
						if (loopCheck.severity === "critical") {
							finalContent =
								"I was repeating the same action without making progress. Let me try a different approach.";
							break;
						}
					}
				}

				// If this was the last iteration, use whatever text we have
				if (iteration >= currentConfig.maxToolIterations) {
					finalContent =
						llmResult.content || "I completed the requested actions.";

					const todos = ownerFlag ? await getTodos(sessionId, db) : [];
					const pendingCount = todos.filter(
						(t: any) => t.status === "pending" || t.status === "in_progress",
					).length;

					if (pendingCount > 0) {
						const currentCount = continuationCount.get(sessionId) || 0;
						if (currentCount < 3) {
							continuationCount.set(sessionId, currentCount + 1);
							log.info(
								"Agent",
								`Task continuation scheduled: ${pendingCount} todos remaining (Attempt ${currentCount + 1}/3)`,
							);

							messages.push({
								role: "system",
								content:
									"You've used all available iterations. Summarize what you've completed so far and what remains. A continuation message will be sent automatically.",
							} as ChatMsg);

							// Schedule follow-up after 5 seconds
							if (followUpStore) {
								followUpStore.create({
									sessionId,
									contactId: sessionId,
									channel: (source as string) || "web",
									reason: "Automatic task continuation",
									context: `The agent used all available iterations. ${pendingCount} tasks remain.`,
									priority: "normal",
									followUpAt: new Date(Date.now() + 5000),
								});
							}
						} else {
							log.warn(
								"Agent",
								`Max continuations (3) reached for session ${sessionId}. Stopping.`,
							);
						}
					}
				}
			}

			// ── Task Completion Enforcement ──────────────────────
			// If the task used tools (actionable request) but ended without
			// clear evidence of completion, give the agent a few more tries
			// to either complete it or explain the failure explicitly.
			if (ownerFlag && toolResults.length > 0 && finalContent) {
				const failureSignals = [
					"unable to",
					"couldn't",
					"could not",
					"failed to",
					"was not able",
					"i apologize",
					"unfortunately",
					"i was repeating",
					"loop detected",
					"encountered an error",
					"didn't work",
					"not successful",
				];
				const evidenceSignals = [
					"http://",
					"https://",
					"✓",
					"✅",
					"successfully",
					"published",
					"posted",
					"saved",
					"created",
					"completed",
					"confirmed",
					"done",
					"here is",
					"here's the",
					"the result",
				];
				const lower = finalContent.toLowerCase();
				const hasFailure = failureSignals.some((s) => lower.includes(s));
				const hasEvidence = evidenceSignals.some((s) => lower.includes(s));
				const hasFailedTools = toolResults.some((r) => !r.success);

				if (
					(hasFailure || hasFailedTools) &&
					!hasEvidence &&
					iteration < currentConfig.maxToolIterations
				) {
					log.info(
						"Agent",
						`Completion enforcement: task ended without evidence. Giving ${Math.min(3, currentConfig.maxToolIterations - iteration)} more iterations.`,
					);

					messages.push({
						role: "assistant",
						content: finalContent || null,
					} as ChatMsg);
					messages.push({
						role: "system",
						content: `⚠️ TASK NOT COMPLETE — You attempted this task but did not provide evidence of completion.

Your response suggests failure ("${failureSignals.find((s) => lower.includes(s)) || "tool errors"}") but you haven't exhausted your options.

REQUIREMENTS:
1. Try a DIFFERENT approach. If browser automation failed, try a different selector, scroll, wait, or use web_fetch instead.
2. If the task truly cannot be completed, explain EXACTLY what failed and why (specific error, specific element not found, etc.)
3. NEVER respond with vague failure messages like "I was unable to complete the task." — specify WHAT failed.
4. If you succeed, provide EVIDENCE: a URL, a screenshot, a confirmation message, or specific data from the result.`,
					} as ChatMsg);

					// Give 3 more iterations for completion
					const extraMax = Math.min(
						3,
						currentConfig.maxToolIterations - iteration,
					);
					for (let extra = 0; extra < extraMax; extra++) {
						iteration++;
						const retryResult = await callLLM(
							messages,
							ownerFlag,
							sessionAgents.get(sessionId),
							selectedTools,
							"chat",
							source,
						);
						lastUsage = retryResult.usage;
						lastModel = retryResult.model || currentConfig.llmModel;

						if (retryResult.toolCalls.length === 0) {
							finalContent = retryResult.content;
							break;
						}

						// Process tool calls
						messages.push({
							role: "assistant",
							content: retryResult.content || null,
							tool_calls: retryResult.toolCalls.map((tc) => ({
								id: tc.id,
								type: "function" as const,
								function: {
									name: tc.toolName,
									arguments: JSON.stringify(tc.arguments),
								},
							})),
						} as ChatMsg);

						for (const tc of retryResult.toolCalls) {
							let resolvedName = tc.toolName;
							const als = getToolAliases();
							if (als.has(tc.toolName)) resolvedName = als.get(tc.toolName)!;

							if (onProgress) {
								onProgress({
									agent: sessionAgents.get(sessionId) || "Nexus",
									action: `Recovering with \`${resolvedName}\``,
									tool: resolvedName,
									args: tc.arguments,
								});
							}

							let result: ToolExecutionResult;
							if (sessionId.startsWith("followup-") || (!isOwner && !VISITOR_SAFE_TOOL_NAMES.has(resolvedName))) {
								result = {
									toolName: resolvedName,
									success: false,
									error: `Security Policy Violation: Tool ${resolvedName} is restricted for visitors. Unauthorized.`,
									duration: 0,
								};
							} else {
								result = await toolRegistry.execute(
									{
										toolName: resolvedName,
										arguments: tc.arguments,
										rawText: "",
									},
								{
            sessionId,
            isOwner: ownerFlag,
            contactName,
            source,
            userMessage: message,
            getDatabase: () => db,
									getAgent: () => orchestrator,
									skillRepo,
									skillEngine,
									reportProgress: onProgress,
								},
							);
							}

							toolResults.push(result);
							metricsCollector.recordTool(
								tc.toolName,
								result.success,
								result.duration,
								sessionId,
							);

							const raw = result.success
								? result.result || "Completed."
								: ownerFlag
									? `❌ TOOL FAILED: ${tc.toolName}\nError: ${result.error}`
									: "The requested internal action could not be completed right now. Do not mention technical errors, tools, databases, or system details to the visitor. State that the action could not be confirmed. Do not promise a handoff or follow-up.";
							const maxC = resolvedName.startsWith("mcp_playwright_")
								? 6000
								: 3000;
							const content =
								raw.length > maxC
									? raw.slice(0, maxC) + "\n[...truncated]"
									: raw;

							messages.push({
								role: "tool",
								tool_call_id: tc.id,
								content,
							} as ChatMsg);
						}

						finalContent = retryResult.content;
					}
				}
			}

			// ── Turn summary ──────────────────────────────────────
			await pipeline.runAfterTurn({
				iterations: iteration,
				toolResults,
				sessionId,
			});

			// Sanitize: strip any "[Used tools: ...]" the LLM may have mimicked from history
			finalContent = finalContent
				.replace(/\n?\[Used tools?:.*?\]/gi, "")
				.trimEnd();

			// Store the assistant response
			const activeAgentId = sessionAgents.get(sessionId) || "nexus";
			const activeAgent = crewRegistry.hasAgent(activeAgentId)
				? crewRegistry.getAgent(activeAgentId)
				: undefined;

			const assistantMetadata: ChatMessageMetadata = {
				source: "web",
				toolCall:
					toolResults.length > 0
						? {
								toolName: toolResults.map((r) => r.toolName).join(", "),
								arguments: {},
							}
						: undefined,
				usage: lastUsage,
				model: lastModel,
				thinking: thinkingContent,
				agentId: activeAgentId,
				agentName: activeAgent?.name || "Nexus",
			};
			// ── Empty Content Guard ────────────────────────────────
			// If the LLM produced no text content (e.g. tool-only response that ran out
			// of iterations, or a tool failed and the model returned nothing), synthesize
			// a meaningful fallback from the tool results rather than emitting a blank bubble.
			if (!finalContent || finalContent.trim() === "") {
				if (toolResults.length > 0) {
					const failures = toolResults.filter((r) => !r.success);
					const successes = toolResults.filter((r) => r.success);

					if (failures.length > 0 && successes.length === 0) {
						// All tools failed. Keep raw details in logs, not in user-facing chat.
						finalContent =
							"I'm sorry, I couldn't complete that just now. I've noted the issue and will try again shortly.";
					} else if (successes.length > 0 && failures.length === 0) {
						// All tools succeeded but no text was generated — give a brief summary
						const summary = successes
							.map(
								(r) =>
									`• \`${r.toolName}\`: ${(r.result || "Completed").toString().slice(0, 150)}`,
							)
							.join("\n");
						finalContent = `✅ Done! Here's what I completed:\n\n${summary}`;
					} else {
						// Mixed results. Avoid exposing tool names or backend errors to visitors.
						finalContent =
							"I handled part of that, but couldn't finish everything just now. I'll keep it noted and follow up when I can.";
					}
					log.warn(
						"Agent",
						`Empty content guard triggered — synthesized fallback from ${toolResults.length} tool results`,
					);
				} else {
					// No tools, no content — generic fallback
					finalContent =
						"I'm sorry, I wasn't able to generate a response. Please try rephrasing your request.";
					log.warn(
						"Agent",
						"Empty content guard triggered — no tools, no content",
					);
				}
			}
        if (!ownerFlag) {
          const safeReply = await finalizeVisitorReply(finalContent, async () => {
        const corrected = await callLLM(visitorReplyRepairMessages(message, finalContent), false, undefined, [], "chat", source, VISITOR_REPLY_FORMAT);
            return corrected.toolCalls.length ? "" : corrected.content;
          });
          if (safeReply === null) {
            log.warn("Agent", "Visitor reply held: final response validation failed");
            return { content: "", toolCalls: toolResults, usage: lastUsage, model: lastModel, duration: Date.now() - startTime };
          }
          finalContent = safeReply;
        }


			await conversationStore.addMessage(
				sessionId,
				"assistant",
				finalContent,
				assistantMetadata,
			);

			// Track outgoing message
			metricsCollector.recordMessage(source || "web", "out");

			// Extract soul data in the background (don't block the response)
			extractSoulData(
				sessionId,
				message,
				finalContent,
				source,
				contactName,
				ownerFlag,
				toolResults,
			).catch((err: any) => {
				console.error("[Soul] Background extraction failed:", err.message);
			});

			const duration = Date.now() - startTime;

			// ── Record Experiment Results ─────────────────────────
			if (experiments && activeExperiment && assignedVariant) {
				experiments.recordResult({
					experimentId: activeExperiment.id,
					variantId: assignedVariant.id,
					sessionId,
					toolCalls: toolResults.length,
					toolSuccesses: toolResults.filter((r) => r.success).length,
					toolFailures: toolResults.filter((r) => !r.success).length,
					responseTimeMs: duration,
				});
			}

			return {
				content: finalContent,
				toolCalls: toolResults,
				usage: lastUsage,
				model: lastModel,
				duration,
				attachments,
				thinking: thinkingContent,
			};
			} finally {
				unlock();
			}
		},

		async generate(systemPrompt: string, userMessage: string): Promise<string> {
			const { client, model: genModel } =
				await getClientForPurpose("generation");
			// Vertex rejects empty string content — use a space as placeholder
			const safeUserMessage = userMessage || " ";
			try {
				const completion = await client.chat.completions.create({
					model: genModel,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: safeUserMessage },
					],
					temperature: currentConfig.temperature,
					max_tokens: currentConfig.maxTokens,
				});
				return completion.choices[0]?.message?.content || "";
			} catch (err: any) {
				log.error(
					"Agent",
					`Generate call failed [generation/${genModel}]: ${err.message} — falling back to chat model`,
				);
				try {
					const { client: fallbackClient, model: fallbackModel } =
						await getClientForPurpose("chat");
					const fallback = await fallbackClient.chat.completions.create({
						model: fallbackModel,
						messages: [
							{ role: "system", content: systemPrompt },
							{ role: "user", content: safeUserMessage },
						],
						temperature: currentConfig.temperature,
						max_tokens: currentConfig.maxTokens,
					});
					return fallback.choices[0]?.message?.content || "";
				} catch (fallbackErr: any) {
					log.error(
						"Agent",
						`Generate fallback also failed [chat]: ${fallbackErr.message}`,
					);
					throw new Error(`LLM generate failed: ${err.message}`);
				}
			}
		},

		async generateStructured(
			systemPrompt: string,
			userMessage: string,
			spec: StructuredOutputSpec,
		): Promise<StructuredGenerationResult> {
			for (const purpose of ["generation", "chat"] as const) {
				try {
					const { client, model } = await getClientForPurpose(purpose);
					return await requestStructuredCompletion(
						client,
						model,
						systemPrompt,
						userMessage,
						spec,
						{
							temperature: 0,
							maxTokens: currentConfig.maxTokens,
						},
					);
				} catch {
					log.warn("Agent", `Structured generation was unavailable for ${purpose}; trying a compatible fallback.`);
				}
			}
			return {
				content: await this.generate(systemPrompt, userMessage),
				transport: "text",
				finishReason: "unknown",
			};
		},

		async generateWithImage(
      systemPrompt: string,
      userMessage: string,
      image: {
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
        bytes: Uint8Array;
        signal?: AbortSignal;
      },
    ): Promise<string> {
      const safeUserMessage = userMessage || " ";
      const base64 = Buffer.from(image.bytes).toString("base64");
      const userContent = [
				{ type: "text", text: safeUserMessage },
				{
					type: "image_url",
					image_url: {
            url: `data:${image.mimeType};base64,${base64}`,
						detail: "high",
					},
				},
			] as any;
			const invoke = async (purpose: "generation" | "chat") => {
				const { client, model } = await getClientForPurpose(purpose);
        const completion = await client.chat.completions.create({
					model,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userContent },
					],
					temperature: currentConfig.temperature,
					max_tokens: currentConfig.maxTokens,
        } as any, { signal: image.signal });
				return completion.choices[0]?.message?.content || "";
			};
			try {
				return await invoke("generation");
			} catch (err: any) {
				log.error("Agent", `Vision generate call failed: ${err.message} — falling back to chat model`);
				try {
					return await invoke("chat");
				} catch (fallbackErr: any) {
					log.error("Agent", `Vision generate fallback also failed: ${fallbackErr.message}`);
					throw new Error(`LLM vision generate failed: ${err.message}`);
				}
			}
		},

		getConfig(): AgentConfig {
			return { ...currentConfig };
		},

		updateConfig(updates: Partial<AgentConfig>): AgentConfig {
			currentConfig = { ...currentConfig, ...updates };

			// Derive flat LLM fields from the active provider
			if (currentConfig.llmProviders?.length > 0) {
				const activeProvider =
					currentConfig.llmProviders.find(
						(p) => p.id === currentConfig.defaultLlmProviderId,
					) ||
					currentConfig.llmProviders.find((p) => p.isDefault) ||
					currentConfig.llmProviders[0];

				if (activeProvider) {
					currentConfig.llmBaseUrl = activeProvider.baseUrl;
					currentConfig.llmModel = activeProvider.model;
					currentConfig.llmApiKey = activeProvider.apiKey;
					currentConfig.defaultLlmProviderId = activeProvider.id;
				}
			}

			return { ...currentConfig };
		},

		getToolRegistry(): ToolRegistry {
			return toolRegistry;
		},

		getConversationStore(): ConversationStore {
			return conversationStore;
		},

		getMemoryStore(): MemoryStore {
			return memoryStore;
		},

		getSoul(): Soul {
			return soul;
		},

		switchAgent(sessionId: string, agentId: string | null): void {
			if (!agentId || agentId === "main") {
				sessionAgents.delete(sessionId);
			} else {
				sessionAgents.set(sessionId, agentId);
			}
		},

		listAgents(): AgentDefinition[] {
			return crewRegistry.listAgents();
		},

		getAgentMarkdown(agentId: string): string | null {
			if (!workspacePath) return null;
			const yamlPath = path.join(
				workspacePath,
				"agents",
				`${agentId}.agent.yaml`,
			);
			const ymlPath = path.join(
				workspacePath,
				"agents",
				`${agentId}.agent.yml`,
			);
			const mdPath = path.join(workspacePath, "agents", `${agentId}.agent.md`);

			let filePath = "";
			if (fs.existsSync(yamlPath)) filePath = yamlPath;
			else if (fs.existsSync(ymlPath)) filePath = ymlPath;
			else if (fs.existsSync(mdPath)) filePath = mdPath;
			else return null;

			try {
				return fs.readFileSync(filePath, "utf8");
			} catch (err: any) {
				console.error(
					`[Orchestrator] Error reading agent file ${filePath}:`,
					err.message,
				);
				return null;
			}
		},

		saveAgentMarkdown(agentId: string, content: string): void {
			if (!workspacePath) return;
			const agentsDir = path.join(workspacePath, "agents");
			if (!fs.existsSync(agentsDir))
				fs.mkdirSync(agentsDir, { recursive: true });

			const isYaml =
				content.trim().startsWith("id:") || content.trim().startsWith("name:");
			const ext = isYaml ? ".agent.yaml" : ".agent.md";
			const filePath = path.join(agentsDir, `${agentId}${ext}`);

			try {
				fs.writeFileSync(filePath, content, "utf8");
				crewRegistry.reloadAgents();
			} catch (err: any) {
				console.error(
					`[Orchestrator] Error writing agent file ${filePath}:`,
					err.message,
				);
			}
		},

		async resumeActivePlans(): Promise<void> {
			if (!db) return;
			try {
				const rows = await db.query(
					`SELECT id FROM youbot_task_plans WHERE status IN ('executing', 'planning')`
				);
				if (!rows || rows.length === 0) return;

				console.log(
					`[Orchestrator] 🔄 Resuming ${rows.length} interrupted task plans...`,
				);

				for (const row of rows) {
					try {
						const plan = await getTaskPlan(row.id, db);
						if (!plan) continue;

						console.log(
							`[Orchestrator]   - Resuming plan: ${plan.id} (${plan.originalRequest.substring(0, 50)}...)`,
						);

						// Reconstruct minimal context for runPlan
						const resumeContext = {
							sessionId: plan.sessionId || "resumed",
							getDatabase: () => db,
						};

						// Run the plan (it will skip completed steps automatically)
						runPlan(plan, resumeContext)
							.then((result) => {
								console.log(
									`[Orchestrator] ✅ Resumed plan ${plan.id} finished: ${result.split("\n")[0]}`,
								);
							})
							.catch((err) => {
								console.error(
									`[Orchestrator] ❌ Resumed plan ${plan.id} failed:`,
									err.message,
								);
							});
					} catch (err: any) {
						console.error(
							`[Orchestrator] Error resuming plan ${row.id}:`,
							err.message,
						);
					}
				}
			} catch (err: any) {
				// Table might not exist yet if no plans were ever created
				if (!err.message.includes("no such table")) {
					console.error(
						"[Orchestrator] Error in resumeActivePlans:",
						err.message,
					);
				}
			}
		},

		setSkillEngine(engine: SkillEngine) {
			skillEngine = engine;
			log.info(
				"Agent",
				`SkillEngine injected (${engine.getSkills().length} skills available)`,
			);
		},

		getMessageBus(): MessageBus {
			return messageBus;
		},

		getBlackboard(): Blackboard {
			return blackboard;
		},

		getVectorStore(): VectorStore | undefined {
			return vectorStore;
		},
	});

	return orchestrator;
}
