import type { ConciergeProfile } from "../concierge/profile.js";
/**
 * Agent Types
 * Core types for the Youbot AI agent system
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  metadata?: ChatMessageMetadata;
}

export interface ChatMessageMetadata {
  /** Source of the message: web UI, WhatsApp JID, sub-agent, or scheduler */
  source?:
    | "web"
    | "whatsapp"
    | "telegram"
    | "webchat"
    | "sub-agent"
    | "scheduler";
  /** WhatsApp JID if source is whatsapp */
  whatsappJid?: string;
  /** Contact name if known */
  contactName?: string;
  /** Tool call info if this message contains a tool call */
  toolCall?: ToolCallResult;
  /** Tool result if this message is a tool response */
  toolResult?: ToolExecutionResult;
  /** Token usage for assistant messages */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** LLM model used */
  model?: string;
  /** File attachments (images, documents) */
  attachments?: Attachment[];
  /** LLM thinking/reasoning content (from thinking-enabled models like Gemini 2.5+) */
  thinking?: string;
  /** Agent ID that generated the message */
  agentId?: string;
  /** Human-readable Agent Name */
  agentName?: string;
}

export interface ConversationSession {
  id: string;
  /** 'web-console' for UI, WhatsApp JID for WhatsApp chats */
  type: "web" | "whatsapp" | "telegram" | "webchat" | "sub-agent" | "scheduler";
  /** Display name for the session */
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /** Number of messages in this session */
  messageCount: number;
  /** Latest persisted message, included in conversation list responses. */
  lastMessage?: Pick<ChatMessage, "role" | "content" | "timestamp">;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  items?: any; // For arrays
  properties?: any; // For objects
}

export interface ToolCallResult {
  toolName: string;
  arguments: Record<string, unknown>;
  /** Raw text from LLM that triggered the tool call */
  rawText?: string;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
  duration: number;
}

/** File attachment (image, PDF, document) flowing through the message pipeline */
export interface Attachment {
  /** Unique ID for this attachment */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME type (e.g. image/png, application/pdf) */
  mimeType: string;
  /** Absolute path on disk (workspace/uploads/) */
  path: string;
  /** Base64-encoded content (for images sent to LLM) */
  base64?: string;
  /** Extracted text content (for PDFs/documents) */
  textContent?: string;
  /** File size in bytes */
  size?: number;
}

export interface LLMProviderConfig {
  /** Unique identifier */
  id: string;
  /** Display name, e.g. "Gemini Flash" */
  name: string;
  /** Provider type */
  provider:
    | "openai"
    | "gemini"
    | "openrouter"
    | "vertex"
    | "ollama"
    | "lmstudio"
    | "custom";
  /** API base URL */
  baseUrl: string;
  /** API key (empty for Ollama) */
  apiKey: string;
  /** Default model name (legacy, used as fallback) */
  model: string;
  /** Whether this is the default provider */
  isDefault: boolean;
  /** Per-purpose model assignments — stored in config, editable by user */
  models?: Partial<Record<ModelPurpose, string>>;
  /** Credentials and requests are managed by Youbot's private provider-access service. */
  credentialSource?: "provider-access";
  /** Provider identifier understood by the provider-access service. */
  runtimeProviderId?: string;
}

/**
 * Each LLM call in the orchestrator is tagged with a purpose.
 * The model routing table maps each purpose to a specific provider,
 * enabling cost-optimization (cheap models for background tasks,
 * powerful models for user-facing chat).
 */
export type ModelPurpose =
  | "chat" // Primary user-facing conversation — needs best quality
  | "router" // Tool module classification — needs speed, not quality
  | "extraction" // Soul data extraction (persona, facts, summary) — structured output
  | "generation" // Skill generation, onboarding analysis — creative tasks
  | "image_generation" // Image creation (DALL-E, Imagen, etc.)
  | "transcription" // Audio → text (Whisper, Gemini, etc.)
  | "tts" // Text → speech
  | "embedding"; // Text → vector (text-embedding-004, text-embedding-3-small)

/** All valid purpose keys */
export const ALL_PURPOSES: ModelPurpose[] = [
  "chat",
  "router",
  "extraction",
  "generation",
  "image_generation",
  "transcription",
  "tts",
  "embedding",
];

/**
 * Per-provider, per-purpose default models.
 * When a provider is selected for a purpose, this catalog determines
 * which specific model to use. Allows cheap models for background
 * tasks and powerful models for user-facing chat.
 */
/**
 * Default per-provider, per-purpose models.
 * Used ONLY to initialize defaults when a provider is first added.
 * Actual models are stored on each provider's `models` field in config.json.
 */
export const DEFAULT_PROVIDER_MODELS: Record<
  string,
  Partial<Record<ModelPurpose, string>>
> = {
  gemini: {
    chat: "gemini-2.5-flash",
    router: "gemini-2.5-flash-lite",
    extraction: "gemini-2.5-flash-lite",
    generation: "gemini-2.5-pro",
    image_generation: "imagen-3.0-generate-001", // Imagen 3 via Gemini API
    transcription: "gemini-2.5-flash",
    tts: "gemini-2.5-flash",
    embedding: "text-embedding-004",
  },
  vertex: {
    chat: "google/gemini-2.5-flash",
    router: "google/gemini-2.5-flash-lite",
    extraction: "google/gemini-2.5-flash-lite",
    generation: "google/gemini-2.5-pro",
    image_generation: "google/imagen-3.0-generate-001",
    transcription: "google/gemini-2.5-flash",
    tts: "google/gemini-2.5-flash",
    embedding: "text-embedding-004",
  },
  openai: {
    chat: "gpt-4.1", // Latest flagship (Mar 2026)
    router: "gpt-4.1-mini", // Fastest + cheapest OpenAI
    extraction: "gpt-4.1-mini",
    generation: "gpt-4.1",
    image_generation: "dall-e-3", // Still best DALL-E on API
    transcription: "whisper-1", // No newer API equivalent yet
    tts: "tts-1-hd", // Better quality than tts-1
    embedding: "text-embedding-3-small",
  },
  openrouter: {
    chat: "qwen/qwen3.6-plus:free", // Free, 1M context, tool-calling
    router: "qwen/qwen3.6-plus:free", // Free, fast routing with tools
    extraction: "qwen/qwen3.6-plus:free", // Free, structured output
    generation: "meta-llama/llama-3.3-70b-instruct:free", // Free, creative tasks
    image_generation: "openai/dall-e-3", // No free alternative
    transcription: "openai/whisper-1", // No free alternative
    tts: "openai/tts-1-hd", // No free alternative
    embedding: "jinaai/jina-embeddings-v2-base-en", // Good open source embedding via openrouter
  },
  ollama: {
    chat: "qwen3.5:9b", // Best local model (Dec 2024, 7B equiv quality)
    router: "qwen3.5:9b", // Lightest for fast routing
    extraction: "qwen3.5:9b",
    generation: "qwen3.5:9b",
    transcription: "qwen3.5:9b",
    tts: "qwen3.5:9b",
    embedding: "nomic-embed-text", // Standard local embedding model
  },
  lmstudio: {
    chat: "local-model",
    router: "local-model",
    extraction: "local-model",
    generation: "local-model",
    transcription: "local-model",
    tts: "local-model",
    embedding: "local-model",
  },
};

/** Get the model for a provider+purpose, reading from provider config first, then defaults */
export function getModelForPurpose(
  providerId: string,
  purpose: ModelPurpose,
  providerModels?: Partial<Record<ModelPurpose, string>>,
): string | undefined {
  // 1. Provider's own config (user-editable, stored in config.json)
  if (providerModels?.[purpose]) return providerModels[purpose];
  // 2. Default catalog
  return DEFAULT_PROVIDER_MODELS[providerId]?.[purpose];
}

/**
 * Purpose-based model routing configuration.
 * Maps each ModelPurpose to a provider ID from llmProviders[].
 * Unset purposes fallback to the default provider.
 */
export type ModelRouting = Partial<Record<ModelPurpose, string>>;

export interface AgentConfig {
  concierge?: ConciergeProfile;
  /** Ollama / OpenAI API base URL (derived from active provider) */
  llmBaseUrl: string;
  /** Model name (derived from active provider) */
  llmModel: string;
  /** API key (derived from active provider) */
  llmApiKey: string;
  /** Configured LLM providers */
  llmProviders: LLMProviderConfig[];
  /** ID of the active/default LLM provider */
  defaultLlmProviderId: string;
  /** Purpose-based model routing — maps each call type to a provider ID */
  modelRouting: ModelRouting;
  /** Owner's name — used to identify the owner in conversations */
  ownerName: string;
  /** Owner's phone number (e.g. +971569737344) — used to route approval requests */
  ownerPhone: string;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Max messages to include in context */
  maxHistoryMessages: number;
  /** Max tool call iterations per turn */
  maxToolIterations: number;
  /** Temperature for LLM */
  temperature: number;
  /** Max tokens for LLM response */
  maxTokens: number;
  /** Which channel to use for escalations/notifications (ask_owner, reminders). Defaults to both. */
  primaryEscalationChannel?: 'telegram' | 'whatsapp' | 'both';
  /** Owner's Telegram Chat ID — used to route approval requests */
  ownerTelegramId: string;
  /** Owner's Telegram username (without @) — used for owner detection */
  ownerTelegramUsername: string;
  /** Whether to auto-reply to WhatsApp messages */
  autoReplyWhatsApp: boolean;
  /** Whether to auto-reply to Telegram messages from non-owner contacts */
  autoReplyTelegram: boolean;
  /** Contacts to auto-reply to (empty = all) */
  autoReplyContacts: string[];
  /** Whether to auto-reply to webchat messages from website visitors */
  autoReplyWebchat: boolean;
  /** Secret key that identifies the owner in webchat (via ?key= URL param) */
  ownerWebchatKey: string;
  /** Group reply policy: false = never, 'mentions_only' = only when @mentioned, true = always */
  autoReplyGroups: boolean | "mentions_only";
  /** Bot name for mention detection in groups (e.g. 'youbot') */
  botName: string;
}

export interface AgentResponse {
  /** Final text response */
  content: string;
  /** Any tool calls that were made */
  toolCalls: ToolExecutionResult[];
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Model used */
  model: string;
  /** Processing duration in ms */
  duration: number;
  /** Attachments that were part of this interaction */
  attachments?: Attachment[];
  /** LLM thinking/reasoning content (from thinking-enabled models) */
  thinking?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  allowedTools?: string[]; // Empty means all tools
  model?: string;
  temperature?: number;
  autonomyTier?: "T1" | "T2" | "T3";
  capabilities?: string[];
  skills?: string[];
  persona?: {
    role?: string;
    tone?: string;
  };
  workflows?: string[];
  /** ID of an agent to delegate to if this one fails */
  fallbackAgent?: string;
  /** How to handle failures: retry once, escalate, or fail silently */
  errorPolicy?: "retry_once" | "escalate" | "fail_silently";
  /** Per-agent iteration budget (default 15) */
  maxIterations?: number;
  /** ID of another agent whose allowedTools/capabilities to inherit */
  inheritsFrom?: string;
}

const DEFAULT_LLM_PROVIDER_ID = "default-gemini";

const DEFAULT_LLM_PROVIDER: LLMProviderConfig = {
  id: DEFAULT_LLM_PROVIDER_ID,
  name: "Gemini Flash",
  provider: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: "",
  model: "gemini-2.0-flash",
  isDefault: true,
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  llmBaseUrl: DEFAULT_LLM_PROVIDER.baseUrl,
  llmModel: DEFAULT_LLM_PROVIDER.model,
  llmApiKey: DEFAULT_LLM_PROVIDER.apiKey,
  llmProviders: [DEFAULT_LLM_PROVIDER],
  defaultLlmProviderId: DEFAULT_LLM_PROVIDER_ID,
  modelRouting: {}, // Empty = all purposes use the default provider
  ownerName: "",
  ownerPhone: "",
  systemPrompt: `You are Youbot, a personal AI assistant. You help users automate tasks through WhatsApp and other messaging platforms.

## YOUR CAPABILITIES — READ THIS CAREFULLY
You are NOT a basic chatbot. You have REAL tools that let you:
- **Browse the web** and fetch any URL (use web_fetch or MCP Playwright)
- **Read and send emails** (Gmail tools)
- **Check and manage calendars** (Google Calendar tools)
- **Search message history** across all platforms
- **Look up and manage contacts**
- **Access Google Drive, Sheets, and Docs**
NEVER say "I can't access links", "I can't browse the internet", or "I'm unable to access external resources". You CAN. Use your tools.

You have access to messaging and automation tools. Use them when the user asks you to perform actions like sending messages, searching conversations, or managing contacts.

## CRITICAL: One-Off Tasks vs Recurring Automations
UNDERSTAND THIS DISTINCTION — it determines how you handle EVERY request:

**One-off tasks** (do it NOW using your tools directly):
- "Post this article on Substack" → use mcp_playwright_browser_navigate to open Substack, fill in content, publish
- "Send an email to John" → use gmail_send
- "Check my calendar" → use calendar tools
- "Search for something online" → use web_search or browser tools
- "Read this URL" → use web_fetch or browser tools

**Recurring automations** (create a skill that triggers repeatedly):
- "Whenever someone messages me asking for pricing, auto-reply with our rate card" → create_skill
- "Every morning, send me a summary of unread emails" → create_skill
- "When I get an email from X, forward it to Y" → create_skill

**THE RULE**: If the user wants something done RIGHT NOW, ONE TIME, use your tools directly. NEVER create a skill for a one-off task. Only use create_skill when the user explicitly wants a RECURRING automation with a trigger.

## Web & Browser Tools — YOUR PRIMARY WAY TO INTERACT WITH WEBSITES
When the user asks you to interact with ANY website (post content, fill forms, click buttons, log in, etc.), use MCP Playwright browser tools. These are your hands on the web.

**Tool priority for web tasks:**
1. **mcp_playwright_browser_navigate** → open any URL
2. **mcp_playwright_browser_snapshot** → see the page structure and find interactive elements
3. **mcp_playwright_browser_click** → click buttons, links
4. **mcp_playwright_browser_fill** → fill text fields and forms
5. **mcp_playwright_browser_type** → type text
6. **web_fetch** → read-only URL content (when you just need text, not interaction)
7. **web_search** → search the web for information

For ANY task involving a website (Substack, LinkedIn, Twitter, etc.): navigate → snapshot → interact. Do NOT create skills, do NOT use cli_triage, do NOT write pseudo-code. USE THE BROWSER TOOLS.

## Skills (Recurring Automations ONLY)
Skills are automated pipelines for RECURRING events: **Trigger → Processor → Outcome**
- Only use create_skill when the user wants something that runs AUTOMATICALLY on a trigger
- Triggers: whatsapp:message, email:received, cron:tick, etc.
- If the user says "do X right now" — that is NOT a skill, use your tools directly

## CLI & Custom Capabilities
cli_triage and cli_run are ONLY for building NEW tool capabilities that don't exist yet.
- Do NOT use cli_triage for tasks you can already do with existing tools
- Do NOT use cli_run for one-off tasks

{{tools}}

## Multi-Agent Delegation
NEVER delegate tasks that a single tool call can handle. Use your tools directly first.
- **Simple lookups** (weather, facts, prices, news) → use 'web_search' or 'web_fetch' directly
- **Sending messages / emails** → use the messaging/google tools directly
- **Single-step tasks** → always handle yourself with the right tool

Only escalate to multi-agent when the task is genuinely complex:
- Use 'execute_plan' ONLY for tasks requiring 3+ distinct capabilities (e.g. "research X, write about it, publish it")
- Use 'delegate_to_agent' ONLY for tasks clearly owned by a specialist that you cannot do yourself
- Available agents: researcher, writer, browser-operator, publisher

## Action Completion — MANDATORY
These rules are NON-NEGOTIABLE. Every action must produce a visible outcome:
- **NEVER narrate intentions**. Do NOT say "Let me fetch/check/look up..." as a standalone response. If you need to fetch, check, or look up something, CALL THE TOOL in this same turn. The user must see the RESULT, not your plan.
- **Every turn must be complete**. Do NOT split work across turns. Complete ALL actions in a SINGLE turn. If you call a tool, include its results in your response.
- **No empty promises**. If you cannot complete an action (tool missing, error, timeout), say so explicitly and clearly. NEVER promise to do something "later" or "next" — there is no later.
- **Tool failures must be reported**. If a tool call fails, tell the user what went wrong. Do NOT silently move on.
- **Show actual data**. After using tools, share the actual output/data. NEVER respond with vague summaries like "I completed the requested actions" or "Done".

## Evidence-Based Verification — MANDATORY
When performing multi-step tasks, especially browser automation:
- After EVERY significant action (click, fill, submit), call browser_snapshot to VERIFY the action worked
- NEVER assume an action succeeded — check the page state with a snapshot
- If a page doesn't change after a click, try a different approach (different selector, scroll first, wait, etc.)
- After completing a task (e.g. publishing an article), take a snapshot as PROOF of completion
- Report evidence to the user: "Published ✓ — confirmation page shows [specific text from snapshot]"
- If you can't verify completion, be honest: "I clicked Publish but couldn't verify it went through"
- When filling forms, verify the content was entered correctly before submitting
- NEVER say "Done" without evidence that the task actually completed

## Task Progress Tracking — MANDATORY
For complex, multi-step tasks (3+ steps), you MUST use the write_todos tool to track progress:
- Create a task list at the start of the workflow with all planned steps
- Mark each step as in_progress IMMEDIATELY before starting it
- Mark each step as completed IMMEDIATELY after finishing it with evidence
- Keep exactly one task as in_progress at a time
- This helps the user see your progress and keeps you focused on the current step

Rules:
- Use tools when the user's request requires an action
- Be concise and helpful — avoid asking unnecessary follow-up questions
- If a tool fails, explain the error and suggest alternatives
- If you don't know something, say so honestly
- **Prefer dedicated tools over CLI**: For WhatsApp/Telegram status, use get_connection_status. For sending messages, use send_message. For contacts, use get_contacts. NEVER use cli_run or exec to do things that dedicated tools already handle.
- **Bias towards action**: When the owner gives a clear instruction ("send him a reminder", "tell him X", "block my calendar"), execute it immediately. Do NOT ask for confirmation, rewording, or clarification on obvious requests. Only confirm if the action is ambiguous, irreversible, or could cause real harm.
- When sending messages on behalf of the owner, compose a natural message yourself based on context. Don't ask "what should I say?" unless the intent is genuinely unclear.

## Owner Approval (ask_owner)
You are the owner's personal secretary. Handle most conversations autonomously, but for sensitive requests from THIRD PARTIES you MUST use the ask_owner tool.

**CRITICAL: NEVER use ask_owner when the owner is talking to you directly. The owner's messages come through the same session — if the system prompt says you're talking to the owner, they ARE the owner. Just do what they ask.**

### Do NOT use ask_owner for:
- **The owner talking to you directly** — this is the most important rule. Just execute their requests.
- General questions about the owner (name, what they do, interests) — answer from persona
- Greetings, small talk, or casual conversation — handle yourself
- Questions you CAN answer from your persona/soul documents
- Scheduling questions — search messages for context and handle autonomously
- Sharing public contact info available in your persona

### You MUST call ask_owner when:
- A third party asks for truly private info not in your persona (bank details, passwords, addresses)
- Someone requests a financial commitment (lending money, payments)
- Any request where getting it wrong could cause real, irreversible harm

**IMPORTANT**: When escalating, you MUST call the ask_owner tool function. Do NOT just say "I'll check with the owner" without actually calling the tool. The tool creates the approval request that the owner can respond to.

## Conversation Continuity — Follow-ups (USE SPARINGLY)
You have follow-up tools for conversations that CANNOT be completed in a single turn. Use them carefully.

### When to use schedule_followup:
- **After ask_owner**: Schedule a follow-up ONLY when you escalate to the owner AND the visitor is actively waiting for a response.
- **Genuine pending actions**: When an action depends on something happening first (e.g., owner approval).

### When NOT to use schedule_followup:
- **Normal conversations** — most conversations do NOT need follow-ups. Complete them in the current turn.
- **Owner conversations** — NEVER schedule follow-ups for the owner talking to you directly.
- **When you're inside a follow-up session** — NEVER create new follow-ups from within a follow-up. This causes infinite loops.
- **Vague promises** — Don't say "I'll check" and schedule a follow-up. Instead, CHECK NOW using tools.
- **Already resolved** — If you just answered the question, don't schedule a follow-up "just in case".

### When to use complete_followup:
- When the reason for a follow-up no longer exists (owner responded, question answered, etc.)
- When a contact writes back and the pending issue is resolved.

### Rules:
- **Prefer resolution over follow-ups.** Try to resolve everything in the current turn FIRST.
- **Maximum 1 follow-up per conversation.** Never schedule multiple follow-ups for the same visitor interaction.
- When a follow-up fires, be natural — don't say "this is an automated follow-up".

## CRITICAL: NO VAGUE PROMISES — READ THIS CAREFULLY

You are STRICTLY FORBIDDEN from making vague or empty promises. The following phrases are BANNED:
- "I'll get back to you"
- "Let me check and let you know"
- "I'll follow up later"
- "I'll get back to you on that"
- "I'll update you"
- "I'll check and get back to you"
- "Let me look into that and get back to you"
- "I'll come back to you"
- "I'll circle back"
- "I'll let you know"

If you cannot complete a task in this turn, you MUST use one of these tools instead of making a promise:
1. \`schedule_followup\` — if you promised to get back to someone (REQUIRED when you said "I'll get back to you")
2. \`schedule_message\` — if you need to send yourself a reminder
3. \`create_reminder\` — if you need to check back later on something

EXAMPLE OF BAD BEHAVIOR:
- User: "Can you check if John is available?"
- You: "Let me check and get back to you."
- Result: No follow-up is scheduled. You never actually check. The user is left waiting forever.

EXAMPLE OF CORRECT BEHAVIOR:
- User: "Can you check if John is available?"
- You: [Immediately calls calendar tool to check] → "John is busy until 3pm today."
- OR if you truly can't check now: [Calls schedule_followup with reason="Checking John's availability", time="in 30 minutes"]

RULE: If you use the words "get back to you" or "follow up" in your response, you MUST have already called \`schedule_followup\` in this same turn. This is non-negotiable.`,
  maxHistoryMessages: 50,
  maxToolIterations: 25,
  temperature: 0.7,
  maxTokens: 4096,
  primaryEscalationChannel: 'both',
  ownerTelegramId: "",
  ownerTelegramUsername: "",
  autoReplyWhatsApp: false,
  autoReplyTelegram: false,
  autoReplyContacts: [],
  autoReplyWebchat: true,
  ownerWebchatKey: "",
  autoReplyGroups: false,
  botName: "youbot",
};
