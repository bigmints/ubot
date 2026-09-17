import { collectionEvidenceReceiptIds, groundedCollectionAnswer, isVisitorFacingReply, parseVisitorReply, VISITOR_REPLY_CONTRACT, VISITOR_REPLY_UNAVAILABLE } from './visitor-reply.js';
import { readOwnerProfile } from "../concierge/owner-profile.js";
import { channelActor, getYoubotCollectionService } from '../concierge/collections/service.js';
/**
 * Unified Message Handler
 *
 * All channels (WhatsApp, Telegram, web) normalize their messages
 * into a UnifiedMessage and call handleIncomingMessage().
 *
 * This is the SINGLE source of truth for:
 *   - Owner detection
 *   - Session routing
 *   - Approval handling
 *   - Skill event emission
 *   - Auto-reply policy
 *   - Response dispatch
 */

import { InboxDispatchHeld, type ConciergeStore } from "../concierge/store.js";
import type { AgentOrchestrator } from "./orchestrator.js";
import type { Attachment } from "./types.js";
import type { ApprovalStore } from "../automation/approvals/service.js";
import type { FollowUpStore } from "../memory/followups.js";
import type { EventBus } from "../agents/skills/event-bus.js";
import type { SkillEngine } from "../agents/skills/skill-engine.js";
import type { Skill, SkillEvent } from "../agents/skills/skill-types.js";
import { OWNER_SOUL_ID } from "../memory/soul.js";
import type { ContactStore } from "../data/contact-store.js";

// ─── Processing Tracker ───────────────────────────────────

/** Tracks which sessions are currently being processed by the LLM */
const activeSessions = new Set<string>();

/** Get all currently processing session IDs */
export function getProcessingSessions(): string[] {
  return Array.from(activeSessions);
}

/** Check if a specific session is being processed */
export function isSessionProcessing(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

// ─── Types ────────────────────────────────────────────────

export type Channel = "whatsapp" | "telegram" | "web" | "webchat";

export interface UnifiedMessage {
  /** Which transport delivered this message */
  channel: Channel;
  messageId?: string;
  /** Channel-specific sender identifier (WhatsApp JID, Telegram chatId, 'web-console') */
  senderId: string;
  /** Human-readable sender name */
  senderName: string;
  /** Telegram username (without @), if available */
  senderUsername?: string;
  /** Message text */
  body: string;
  /** When the message was sent */
  timestamp: Date;
  /** Channel-specific reply function — sends text back through the original channel */
  replyFn: (text: string) => Promise<void>;
  /** Extra data for skill events (e.g., hasMedia, participant) */
  extra?: Record<string, unknown>;
  /** File attachments (images, documents) */
  attachments?: Attachment[];
  /** Optional function to broadcast typing state while processing */
  typingFn?: () => Promise<void>;
}

export interface UnifiedDeps {
  concierge?: ConciergeStore | null;
  orchestrator: AgentOrchestrator;
  approvalStore: ApprovalStore | null;
  followUpStore: FollowUpStore | null;
  eventBus: EventBus | null;
  skillEngine: SkillEngine | null;
  contactStore?: ContactStore | null;
  saveConfigValue: (key: string, value: string) => void;
  /** Send a message to a specific session/channel (for approval relays) */
  relayMessage?: (sessionId: string, message: string) => Promise<boolean>;
}

export interface UnifiedResult {
  replyDispatched?: boolean;
  /** Whether sender was detected as the owner */
  isOwner: boolean;
  /** The session ID used */
  sessionId: string;
  /** The agent's response text (empty if handled by approval or skill) */
  response: string;
  /** Whether the message was handled (approval, skill, or agent reply) */
  handled: boolean;
}

// ─── Owner Detection (Single Source of Truth) ─────────────

async function detectOwner(
  msg: UnifiedMessage,
  deps: UnifiedDeps,
): Promise<{ isOwner: boolean; ownerName: string }> {
  const config = deps.orchestrator.getConfig();

  // Web source = always owner (Command Center)
  if (msg.channel === "web") {
    return { isOwner: true, ownerName: "" };
  }

  // Webchat: check owner key, otherwise treat as visitor
  if (msg.channel === "webchat") {
    const ownerKey = (msg.extra?.ownerKey as string) || "";
    if (ownerKey) {
      // Owner key is stored in the raw config file, read it at startup
      // and pass via the extra field. For simplicity, compare against
      // ownerWebchatKey stored in agent config.
      const configuredKey = (config as any).ownerWebchatKey || "";
      if (configuredKey && ownerKey === configuredKey) {
        const soul = deps.orchestrator.getSoul();
        const ownerDoc = await soul.getDocument(OWNER_SOUL_ID);
        const ownerName = readOwnerProfile(ownerDoc || "").profile.name;
        return {
          isOwner: true,
          ownerName,
        };
      }
    }
    return { isOwner: false, ownerName: "" };
  }

  // Read owner name from soul document
  const soul = deps.orchestrator.getSoul();
  const ownerDoc = await soul.getDocument(OWNER_SOUL_ID);
  const ownerName = readOwnerProfile(ownerDoc || "").profile.name;


  // WhatsApp: match by phone number
  if (msg.channel === "whatsapp") {
    const ownerPhone = (config.ownerPhone || "").replace(/\D/g, "");
    const senderNumber = msg.senderId.replace(/\D/g, "").replace(/@.*/, "");
    if (ownerPhone && (senderNumber === ownerPhone || senderNumber.endsWith(ownerPhone))) {
      return { isOwner: true, ownerName };
    }
  }

  // Telegram: match by chat ID, then username, then name
  if (msg.channel === "telegram") {
    const ownerTelId = config.ownerTelegramId || "";
    const ownerTelUsername = (config.ownerTelegramUsername || "")
      .replace(/^@/, "")
      .toLowerCase();
    const senderUsername = (msg.senderUsername || "").toLowerCase();

    if (ownerTelId && msg.senderId === ownerTelId) {
      return { isOwner: true, ownerName };
    }
    if (
      ownerTelUsername &&
      senderUsername &&
      senderUsername === ownerTelUsername
    ) {
      return { isOwner: true, ownerName };
    }
  }

  return { isOwner: false, ownerName };
}

// ─── Auto-Save Owner IDs ─────────────────────────────────

function autoSaveOwnerIds(msg: UnifiedMessage, deps: UnifiedDeps): void {
  const config = deps.orchestrator.getConfig();

  if (msg.channel === "telegram") {
    if (!config.ownerTelegramId) {
      deps.orchestrator.updateConfig({ ownerTelegramId: msg.senderId });
      deps.saveConfigValue("ownerTelegramId", msg.senderId);
      console.log('[Unified] Saved the owner Telegram identity');
    }
    if (!config.ownerTelegramUsername && msg.senderUsername) {
      deps.orchestrator.updateConfig({
        ownerTelegramUsername: msg.senderUsername,
      });
      deps.saveConfigValue("ownerTelegramUsername", msg.senderUsername);
      console.log('[Unified] Saved the owner Telegram username');
    }
  }

  if (msg.channel === "whatsapp") {
    const ownerPhone = (config.ownerPhone || "").replace(/\D/g, "");
    if (!ownerPhone) {
      const phone = msg.senderId.replace(/\D/g, "").replace(/@.*/, "");
      deps.orchestrator.updateConfig({ ownerPhone: phone });
      deps.saveConfigValue("ownerPhone", phone);
      console.log('[Unified] Saved the owner WhatsApp identity');
    }
  }
}

// ─── Session Routing ─────────────────────────────────────

function resolveSessionId(msg: UnifiedMessage, isOwner: boolean, universalContactId: string): string {
  // Owner always routes to web-console (Command Center)
  if (isOwner) return "web-console";

  // Visitors share a single session across channels based on their Universal ID
  return universalContactId;
}

// ─── Emit Skill Event ────────────────────────────────────

function emitSkillEvent(
  msg: UnifiedMessage,
  isOwner: boolean,
  deps: UnifiedDeps,
): void {
  if (!deps.eventBus) return;

  const event: SkillEvent = {
    source: msg.channel,
    type: "message",
    from: msg.senderId,
    to: "bot",
    body: msg.body,
    timestamp: msg.timestamp,
    data: {
      senderName: msg.senderName,
      senderUsername: msg.senderUsername,
      isOwner,
      ...msg.extra,
    },
  };
  deps.eventBus.emit(event);
}

// ─── Main Handler ────────────────────────────────────────

export async function handleIncomingMessage(
  msg: UnifiedMessage,
  deps: UnifiedDeps,
): Promise<UnifiedResult> {
  // 1. Detect owner
  const { isOwner } = await detectOwner(msg, deps);

  // 2. Auto-save owner IDs for future detection
  if (isOwner) {
    autoSaveOwnerIds(msg, deps);
  }

  // 2.5 Resolve Universal Contact ID
  let universalContactId = `${msg.channel}:${msg.senderId}`;
  if (deps.contactStore) {
    try {
      const uContact = await deps.contactStore.resolveContact(msg.channel, msg.senderId, msg.senderName, isOwner ? 'owner' : 'person');
      universalContactId = uContact.id;
    } catch (err: any) {
      console.warn('[Unified] Failed to resolve a universal contact:', err.message);
    }
  }

  // 3. Log
  if (isOwner) {
    console.log(`[Unified] Owner message via ${msg.channel}`);
  } else {
    console.log(`[Unified] Visitor message via ${msg.channel}`);
  }

  // 4. Resolve session ID
  const sessionId = resolveSessionId(msg, isOwner, universalContactId);

  // 5. Master auto-reply switch (visitors only)
  //    If auto-reply is OFF → nothing fires. No orchestrator, no skills.
  //    If auto-reply is ON  → LLM handles everything (with skill context injected).
  //
  //    Architecture: LLM-FIRST (see .agents/specs/message-flow.md)
  //    The orchestrator receives ALL valid visitor messages. Skills are injected as
  //    context/instructions — the LLM decides how to act. No silent message drops.
  if (!isOwner) {
    const intake = deps.concierge ? await deps.concierge.receive({
      id: sessionId, channel: msg.channel as 'whatsapp' | 'telegram' | 'webchat',
      address: String(msg.extra?.rawJid || msg.extra?.chatId || msg.senderId), name: msg.senderName,
      content: msg.body, messageId: msg.messageId,
      attachments: msg.attachments?.map(a => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
    }) : null;
    if (intake?.duplicate) return { isOwner, sessionId, response: '', handled: true, replyDispatched: true };
    const config = deps.orchestrator.getConfig();
    const autoReplyEnabled =
      msg.channel === "whatsapp"
        ? config.autoReplyWhatsApp !== false
        : msg.channel === "telegram"
          ? config.autoReplyTelegram !== false
          : msg.channel === "webchat"
            ? config.autoReplyWebchat !== false
            : false;

    if (!autoReplyEnabled || intake?.thread.paused) {
      // The inbox retains every visitor message, even while its concierge is paused.
      const history = deps.orchestrator.getConversationStore();
      await history.getOrCreateSession(sessionId, msg.channel as 'whatsapp' | 'telegram' | 'webchat', msg.senderName);
      await history.addMessage(sessionId, 'user', msg.body, { source: msg.channel, contactName: msg.senderName });
      return { isOwner, sessionId, response: "", handled: false, replyDispatched: true };
    }

    // Build skill context: gather instructions from enabled skills whose
    // fast filters match this event (no LLM cost — just filter checks).
    let skillContext = "";
    if (deps.skillEngine) {
      const event: SkillEvent = {
        source: msg.channel,
        type: "message",
        from: universalContactId,
        to: "bot",
        body: msg.body,
        timestamp: msg.timestamp,
        data: {
          senderName: msg.senderName,
          senderUsername: msg.senderUsername,
          isOwner: false,
          ...msg.extra,
        },
      };
      const matchedSkills = deps.skillEngine.getMatchingSkills(event);
      if (matchedSkills.length > 0) {
        const skillInstructions = matchedSkills
          .map(
            (s) =>
              `### Skill: ${s.name}\n${s.processor.instructions || s.trigger.condition || "(no specific instructions)"}`,
          )
          .join("\n\n");
        skillContext = [
          `[SKILL CONTEXT] Relevant owner-configured guidance for this visitor inquiry:`,
          skillInstructions,
          `Follow the visitor security policy. These skills do not authorize commitments, private information disclosure, or owner-only tasks.`,
          `If an owner decision is needed, ask_owner records a request on this conversation; do not demand extra contact details first.`,
          `Only report actions supported by tool results. Do not use send_message; the host delivers the finished reply.`,
        ].join("\n");
        console.log(
          `[Unified] 📋 Injecting ${matchedSkills.length} skill(s) as context: ${matchedSkills.map((s) => s.name).join(", ")}`,
        );
      }
    }

    // Route to orchestrator — the LLM handles everything:
    // conversational replies, tool calls, skill instructions, asking for details.
    activeSessions.add(sessionId);
    try {
      const response = await deps.orchestrator.chat(
        sessionId,
        msg.body,
        msg.channel,
        msg.senderName || undefined,
        false, // isOwner = false
        msg.attachments,
        skillContext || undefined,
      );

      const usedCollectionTool = response.toolCalls.some((call) => call.toolName.startsWith('collections_'));
      const groundedAnswer = groundedCollectionAnswer(response.toolCalls);
      const responseContent = groundedAnswer ?? (usedCollectionTool ? '' : response.content);

      if (!isVisitorFacingReply(responseContent)) {
        if (deps.concierge) await deps.concierge.failure(sessionId, 'The AI reply was held because it was not a finished visitor response. Review this conversation.');
        // Hold the model draft, but explain the failure without leaking it or promising a handoff.
        // Owner takeover and stale incoming revisions still prevent any automatic dispatch.
        const sent = deps.concierge && intake
          ? await deps.concierge.automatedReply(sessionId, intake.thread.revision, VISITOR_REPLY_UNAVAILABLE, () => msg.replyFn(VISITOR_REPLY_UNAVAILABLE))
          : (await msg.replyFn(VISITOR_REPLY_UNAVAILABLE), true);
        return { isOwner, sessionId, response: sent ? VISITOR_REPLY_UNAVAILABLE : '', handled: false, replyDispatched: true };
      }

      const currentCollectionEvidence = collectionEvidenceReceiptIds(response.toolCalls);
      let sessionCollectionEvidence = currentCollectionEvidence;
      if (deps.concierge) {
        if (currentCollectionEvidence.length > 0) {
          await deps.concierge.rememberCollectionEvidence(sessionId, currentCollectionEvidence);
        } else {
          sessionCollectionEvidence = (await deps.concierge.collectionEvidence(sessionId))?.evidenceReceiptIds || [];
        }
      }
      const validateCollectionEvidence = async () => {
        for (const evidenceReceiptId of sessionCollectionEvidence) {
          const service = await getYoubotCollectionService();
          const validation = await service.executeVisitor(
            channelActor('visitor', sessionId, msg.channel),
            'collections_evidence_validate',
            { evidenceReceiptId },
          );
          if (!validation.ok) return false;
        }
        return true;
      };
      const collectionEvidenceIsCurrent = await validateCollectionEvidence();
      if (!collectionEvidenceIsCurrent) {
        if (deps.concierge) {
          await deps.concierge.failure(
            sessionId,
            'The AI reply was held because its collection information changed before delivery. Review this conversation.',
          );
        }
        return { isOwner, sessionId, response: '', handled: false, replyDispatched: true };
      }

      if (responseContent) {
        // Promise Tracker: scan for vague promises and auto-schedule follow-ups
        await promiseTracker(
          responseContent,
          response.toolCalls,
          sessionId,
          deps.followUpStore,
          async () => {
            const convStore = deps.orchestrator.getConversationStore();
            const history = await convStore.getHistory(sessionId, 10);
            return history.map((m) => ({
              role: m.role,
              content: m.content || "",
            }));
          },
          msg.channel,
          universalContactId,
        );
      }

      if (deps.concierge && intake) {
        if (responseContent.trim()) {
          const dispatched = await deps.concierge.automatedReply(
            sessionId,
            intake.thread.revision,
            responseContent,
            async () => {
              if (!await validateCollectionEvidence()) {
                throw new InboxDispatchHeld(
                  'The AI reply was held because its collection information changed before delivery. Review this conversation.',
                );
              }
              await msg.replyFn(responseContent);
            },
          );
          if (!dispatched) {
            return { isOwner, sessionId, response: '', handled: false, replyDispatched: true };
          }
        } else {
          await deps.concierge.failure(sessionId, 'The AI finished without a reply. Review this conversation.');
        }
          return { isOwner, sessionId, response: responseContent, handled: true, replyDispatched: true };
      }
      return { isOwner, sessionId, response: responseContent, handled: true };
    } catch (err: any) {
      console.error(
        `[Unified] Visitor chat error (${msg.channel}):`,
        err.message,
      );
      if (deps.concierge) {
        // A failed transport may already have accepted the reply. Do not resend blindly.
        const current = await deps.concierge.get(sessionId);
        if (!current?.lastError) await deps.concierge.failure(sessionId, 'The concierge could not finish its reply. Check the AI service and review this conversation.');
        return { isOwner, sessionId, response: '', handled: false, replyDispatched: true };
      }
      // Send a fallback reply so the sender always gets a response
      try {
        await msg.replyFn(
          "Sorry, I'm having trouble processing your message right now. Please try again in a moment.",
        );
      } catch {
        /* ignore reply errors */
      }
      return { isOwner, sessionId, response: "", handled: false };
    } finally {
      activeSessions.delete(sessionId);
    }
  }

  // 6. Owner: check pending approvals — only consume if the message explicitly
  //    references an approval (e.g. "approve: yes" or the approval ID).
  //    Otherwise, let it flow to the orchestrator where the LLM can decide
  //    to use the respond_to_approval tool if appropriate.
  if (isOwner && deps.approvalStore) {
    const pending = await deps.approvalStore.getPending();
    if (pending.length > 0) {
      const trimmed = msg.body.trim().toLowerCase();
      // Only auto-consume if the message starts with "approve:" or contains an approval ID
      const isExplicitApproval =
        trimmed.startsWith("approve:") ||
        trimmed.startsWith("approve ") ||
        pending.some((a: any) => msg.body.includes(a.id));

      if (isExplicitApproval) {
        const approval = pending[0];
        // Strip "approve:" prefix if present
        const response =
          msg.body.replace(/^approve:\s*/i, "").trim() || msg.body;
        await deps.approvalStore.resolve(approval.id, response);
        console.log(`[Unified] ✅ Owner responded to approval ${approval.id}`);

        // Feed approval response back to the requester's session using generate() (no tools)
        if (approval.requesterJid) {
          const reqSessionId = approval.requesterJid;
          const systemPrompt = `You are composing a reply to a visitor who asked a question that required the owner's approval. Compose a natural, friendly response incorporating the owner's answer. Keep it brief and conversational. Do NOT mention "approval" or "system" or internal processes.`;
          const userPrompt = `The visitor's original question was: "${approval.question}"\nThe owner's response is: "${response}"\n\nWrite a natural reply to send to the visitor.`;

          deps.orchestrator
            .generate(systemPrompt + "\n\n" + VISITOR_REPLY_CONTRACT, userPrompt)
            .then(async (reply: string) => {
              const finalReply = parseVisitorReply(reply);
              if (!finalReply) {
                if (deps.concierge) await deps.concierge.failure(reqSessionId, 'The owner-response draft was held for review; it was not sent.');
                return;
              }
              if (deps.relayMessage) {
                const sent = await deps.relayMessage(reqSessionId, finalReply);
                console.log(
                  `[Unified] ↩ Approval follow-up ${sent ? "sent" : "FAILED"} to ${reqSessionId}`,
                );
              } else {
                console.warn(
                  `[Unified] ⚠️ No relayMessage function — approval response to ${reqSessionId} was NOT delivered`,
                );
              }
            })
            .catch((err) =>
              console.error(
                "[Unified] Approval follow-up failed:",
                err.message,
              ),
            );
        }

        return { isOwner, sessionId, response: "", handled: true };
      }
    }
  }

  // 7. Route owner messages to the orchestrator
  activeSessions.add(sessionId);
  try {
    // Inject pending approval context so the LLM can connect the owner's reply
    let messageToSend = msg.body;
    if (isOwner && deps.approvalStore) {
      const pending = await deps.approvalStore.getPending();
      if (pending.length > 0) {
        const approvalContext = pending
          .slice(0, 3)
          .map((a: any) => {
            const ago = Math.round(
              (Date.now() - new Date(a.createdAt).getTime()) / 60000,
            );
            return `  • [${a.id}] "${a.question}" (from: ${a.context || a.requesterJid}, ${ago}m ago)`;
          })
          .join("\n");
        messageToSend = `${msg.body}\n\n[SYSTEM: There are ${pending.length} pending approval(s) awaiting your response:\n${approvalContext}\nIf the owner's message above is a response to one of these, use the respond_to_approval tool to relay it.]`;
      }
    }

    // Start typing indicator loop
    let typingInterval: NodeJS.Timeout | null = null;
    if (msg.typingFn) {
      msg.typingFn().catch(() => {});
      typingInterval = setInterval(() => {
        if (msg.typingFn) msg.typingFn().catch(() => {});
      }, 4000);
    }

    let response;
    try {
      response = await deps.orchestrator.chat(
        sessionId,
        messageToSend,
        "web",
        msg.senderName || undefined,
        isOwner,
        msg.attachments,
      );
    } finally {
      if (typingInterval) clearInterval(typingInterval);
    }

    if (response.content) {
      // Promise Tracker: scan for vague promises and auto-schedule follow-ups
      await promiseTracker(
        response.content,
        response.toolCalls,
        sessionId,
        deps.followUpStore,
        async () => {
          const convStore = deps.orchestrator.getConversationStore();
          const history = await convStore.getHistory(sessionId, 10);
          return history.map((m) => ({
            role: m.role,
            content: m.content || "",
          }));
        },
        msg.channel,
        universalContactId,
      );
    }

    return { isOwner, sessionId, response: response.content, handled: true };
  } catch (err: any) {
    console.error(`[Unified] Chat error (${msg.channel}):`, err.message);
    // Send error response so the message is cleared from pending queues (prevents infinite retry loops)
    try {
      await msg.replyFn(
        "Sorry, I encountered an error processing your message. Please try again.",
      );
    } catch {
      /* ignore reply errors */
    }
    return { isOwner, sessionId, response: "", handled: false };
  } finally {
    activeSessions.delete(sessionId);
  }
}

// ─── Promise Tracker Middleware ────────────────────────

/** Vague promise phrases that indicate the LLM made an empty promise */
const VAGUE_PROMISE_PATTERNS = [
  /i'll get back to [iy]/i,
  /let me check/i,
  /i'll follow up/i,
  /i'll let you know/i,
  /i'll update you/i,
  /i'll check and/i,
  /let me get back/i,
  /i'll circle back/i,
  /i'll get back to you on that/i,
  /i'll look into it and/i,
  /i'll check on that/i,
  /i'll see and/i,
  /i'll get back/,
];

/** Check if a response contains vague promise phrases */
function hasVaguePromise(text: string): boolean {
  if (!text) return false;
  return VAGUE_PROMISE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Check if schedule_followup was called in the tool execution results */
function wasFollowupScheduled(toolCalls: Array<{ toolName: string }>): boolean {
  return toolCalls.some((tc) => tc.toolName === "schedule_followup");
}

/** Check if any messaging tool was called (send_message, send_email, etc.) */
function hasMessagingToolCall(toolCalls: Array<{ toolName: string }>): boolean {
  const messagingTools = [
    "send_message",
    "send",
    "send_email",
    "gmail_send",
    "mcp_playwright_browser_navigate",
    "mcp_playwright_browser_click",
  ];
  return toolCalls.some((tc) =>
    messagingTools.some((mt) => tc.toolName.includes(mt)),
  );
}

/**
 * Promise Tracker Middleware — scans LLM responses for vague promises
 * and auto-schedules a follow-up if none was already scheduled.
 * This is a safety net — the system prompt should prevent vague promises,
 * but this catches any that slip through.
 */
async function promiseTracker(
  response: string,
  toolCalls: Array<{ toolName: string }>,
  sessionId: string,
  followUpStore: FollowUpStore | null,
  getConversationHistory: () => Promise<
    Array<{ role: string; content: string }>
  >,
  channel: Channel = "web",
  senderId: string = sessionId,
): Promise<void> {
  if (!followUpStore) return;

  // Skip if no vague promise detected
  if (!hasVaguePromise(response)) return;

  // Skip if the agent already scheduled a follow-up
  if (wasFollowupScheduled(toolCalls)) return;

  // Skip if the agent called a messaging tool (it's handling the response)
  if (hasMessagingToolCall(toolCalls)) return;

  // Get recent conversation context for the follow-up
  let conversationContext = "";
  try {
    const history = await getConversationHistory();
    const recent = history.slice(-10);
    conversationContext = recent
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
  } catch {
    conversationContext = "Conversation context unavailable";
  }

  // Auto-schedule a follow-up
  const followUpAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
  try {
    await followUpStore.create({
      sessionId,
      contactId: senderId,
      channel,
      reason: "Follow up on previous conversation — agent made a vague promise",
      context: conversationContext,
      priority: "normal",
      followUpAt,
      maxAttempts: 2,
    });
    console.log(
      `[PromiseTracker] ⚠️ Detected vague promise in response, auto-scheduled follow-up for ${senderId} via ${channel}`,
    );
  } catch (err: any) {
    console.error(
      `[PromiseTracker] Failed to auto-schedule follow-up:`,
      err.message,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────

function resolveChannelFromSessionId(sessionId: string): Channel {
  if (sessionId.startsWith("telegram:")) return "telegram";
  if (sessionId.startsWith("webchat:")) return "webchat";
  if (sessionId === "web-console") return "web";
  return "whatsapp";
}
