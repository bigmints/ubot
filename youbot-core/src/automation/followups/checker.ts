import { parseVisitorReply, VISITOR_REPLY_CONTRACT } from '../../engine/visitor-reply.js';
/**
 * Follow-Up Checker
 *
 * Periodic service that checks for due follow-ups and executes them.
 * When a follow-up is due, it spawns an agent session with the conversation
 * context, allowing the agent to decide the best way to follow up.
 */

import type { FollowUpStore, FollowUp } from '../../memory/followups.js';
import type { ApprovalStore } from '../approvals/service.js';

interface FollowUpCheckerDeps {
  followUpStore: FollowUpStore;
  /** Capture recipient and ownership before model generation. Null leaves it for the owner. */
  prepare?: (followUp: FollowUp) => Promise<((channel:string, contactId:string, message:string)=>Promise<boolean>) | null>;
  /** Approval store — used to check approval status for approval-related follow-ups */
  approvalStore?: ApprovalStore;
  /** The orchestrator's chat function */
  chat: (sessionId: string, message: string, source: string, contactName?: string, isOwner?: boolean) => Promise<any>;
  /** Send a message to a contact via the appropriate channel. Returns true on success. */
  sendMessage: (channel: string, contactId: string, message: string) => Promise<boolean>;
}

let checkInterval: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Compatibility for older webchat approvals stored under the owner-UI channel. */
export function visitorFollowUpChannel(followUp: Pick<FollowUp, 'channel' | 'contactId'>): string {
  return followUp.channel === 'web' && followUp.contactId.startsWith('webchat:')
    ? 'webchat' : followUp.channel;
}

/**
 * Start the periodic follow-up checker.
 * Scans for due follow-ups every 15 minutes and processes them.
 */
export function startFollowUpChecker(deps: FollowUpCheckerDeps): () => void {
  console.log('[FollowUpChecker] Starting periodic follow-up checker (every 15 min)');

  // Run immediately once, then on interval
  processFollowUps(deps).catch(err => {
    console.error('[FollowUpChecker] Initial check failed:', err.message);
  });

  checkInterval = setInterval(() => {
    processFollowUps(deps).catch(err => {
      console.error('[FollowUpChecker] Periodic check failed:', err.message);
    });
  }, CHECK_INTERVAL_MS);

  return () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
      console.log('[FollowUpChecker] Stopped');
    }
  };
}

/**
 * Process all due follow-ups.
 */
async function processFollowUps(deps: FollowUpCheckerDeps): Promise<void> {
  const dueFollowUps = await deps.followUpStore.getDue();
  if (dueFollowUps.length === 0) return;

  console.log(`[FollowUpChecker] Found ${dueFollowUps.length} due follow-up(s)`);

  // Process in priority order (getDue already returns sorted by priority DESC, date ASC)
  for (const followUp of dueFollowUps) {
    try {
      const send = deps.prepare ? await deps.prepare(followUp) : deps.sendMessage;
      if (!send) continue;
      await processOneFollowUp(followUp, { ...deps, sendMessage: send });
    } catch (err: any) {
      console.error(`[FollowUpChecker] Failed to process follow-up ${followUp.id}:`, err.message);
      // Reschedule for 30 minutes later after failure
      const retryAt = new Date(Date.now() + 30 * 60 * 1000);
      await deps.followUpStore.recordAttempt(followUp.id, retryAt);
    }
  }
}

/**
 * Process a single follow-up by spawning an agent session.
 */
async function processOneFollowUp(followUp: FollowUp, deps: FollowUpCheckerDeps): Promise<void> {
  console.log(`[FollowUpChecker] Processing follow-up ${followUp.id}`);

  // Safety: auto-expire stale follow-ups to prevent infinite loops
  const ageMs = Date.now() - new Date(followUp.createdAt).getTime();
  const maxAgeMs = 48 * 60 * 60 * 1000; // 48 hours
  if (followUp.attempts >= 3 && ageMs > maxAgeMs) {
    await deps.followUpStore.expire(followUp.id, `Auto-expired: ${followUp.attempts} attempts over ${Math.round(ageMs / 3600000)}h`);
    console.log(`[FollowUpChecker] Auto-expired stale follow-up ${followUp.id} (${followUp.attempts} attempts, ${Math.round(ageMs / 3600000)}h old)`);
    return;
  }

  // Handle approval-related follow-ups with a dedicated flow
  if (followUp.approvalId && deps.approvalStore) {
    await processApprovalFollowUp(followUp, deps);
    return;
  }

  // Build the agent prompt with full context
  const prompt = buildFollowUpPrompt(followUp) + '\n\n' + VISITOR_REPLY_CONTRACT + '\nFor scheduler controls only, return exactly [NO_ACTION_NEEDED] or [RESCHEDULE], with no explanation. Otherwise use the reply JSON object.';
  const sessionId = `followup-${followUp.id}-${Date.now()}`;

  try {
    // Spawn an agent session to handle the follow-up
    const result = await deps.chat(sessionId, prompt, 'web', 'follow-up-agent', true);
    const response = result.content || '';

    // Check if the agent determined the follow-up should be sent
    if (response.trim().toLowerCase() === '[no_action_needed]') {
      // Agent decided no follow-up is needed — mark as completed
      await deps.followUpStore.complete(followUp.id, 'Agent determined no follow-up needed: ' + response.slice(0, 200));
      console.log(`[FollowUpChecker] Follow-up ${followUp.id} — no action needed`);
    } else if (response.trim().toLowerCase() === '[reschedule]') {
      // Agent wants to reschedule — push back by an hour
      const nextAt = new Date(Date.now() + 60 * 60 * 1000);
      await deps.followUpStore.recordAttempt(followUp.id, nextAt);
      console.log(`[FollowUpChecker] Follow-up ${followUp.id} rescheduled to ${nextAt.toISOString()}`);
    } else {
      // Agent produced a follow-up message — extract and send it
      const messageText = parseVisitorReply(response);
      if (!messageText) {
        await deps.followUpStore.recordAttempt(followUp.id, new Date(Date.now() + 30 * 60 * 1000));
        console.warn(`[FollowUpChecker] Follow-up ${followUp.id} held: visitor reply validation failed`);
      } else {
        const sent = await deps.sendMessage(followUp.channel, followUp.contactId, messageText);
        if (sent) await deps.followUpStore.complete(followUp.id, `Sent follow-up: ${messageText.slice(0, 200)}`);
        else await deps.followUpStore.recordAttempt(followUp.id, new Date(Date.now() + 30 * 60 * 1000));
      }
    }
  } catch (err: any) {
    console.error(`[FollowUpChecker] Agent session failed for follow-up ${followUp.id}:`, err.message);
    // Reschedule
    const retryAt = new Date(Date.now() + 30 * 60 * 1000);
    await deps.followUpStore.recordAttempt(followUp.id, retryAt);
  }
}

/**
 * Process an approval-related follow-up with a dedicated flow.
 * Checks if the owner has responded to the approval and either:
 * - Sends the owner's response to the requester (if resolved)
 * - Sends a reminder to the owner (if still pending)
 */
async function processApprovalFollowUp(followUp: FollowUp, deps: FollowUpCheckerDeps): Promise<void> {
  const approvalId = followUp.approvalId!;
  console.log(`[FollowUpChecker] Approval follow-up ${followUp.id} — checking approval ${approvalId}`);

  const approvalStore = deps.approvalStore;
  if (!approvalStore) {
    await deps.followUpStore.recordAttempt(followUp.id, new Date(Date.now() + 30 * 60 * 1000));
    console.warn(`[FollowUpChecker] Approval store unavailable for follow-up ${followUp.id}; rescheduled`);
    return;
  }

  const approval = await approvalStore.getById(approvalId);
  if (!approval) {
    // Approval was deleted — cancel the follow-up
    await deps.followUpStore.cancel(followUp.id, `Approval ${approvalId} no longer exists`);
    console.log(`[FollowUpChecker] Approval follow-up ${followUp.id} — approval not found, cancelled`);
    return;
  }

  if (approval.status === 'resolved' && approval.ownerResponse) {
    // Owner already responded — relay the response to the requester
    console.log(`[FollowUpChecker] Approval ${approvalId} already resolved; preparing relay`);

    // Use the agent to compose a natural relay message
    const sessionId = `followup-${followUp.id}-${Date.now()}`;
    const prompt = `You are relaying the owner's response to a visitor who asked a question that required approval.

## Context
- **Original question:** "${approval.question}"
- **Owner's response:** "${approval.ownerResponse}"
- **Requester:** ${followUp.contactId} (via ${followUp.channel})

## Instructions
Compose a natural, friendly reply to send to the requester. Incorporate the owner's response. Do NOT mention "approval", "system", or internal processes.

Return the finished visitor reply in the required JSON object, without reasoning.`;

    try {
      const result = await deps.chat(sessionId, prompt + '\n\n' + VISITOR_REPLY_CONTRACT, 'web', 'follow-up-agent', true);
      const messageText = parseVisitorReply(result.content || '');

      if (messageText && messageText.length > 0) {
        const sent = await deps.sendMessage(followUp.channel, followUp.contactId, messageText);
        if (sent) {
          await deps.followUpStore.complete(followUp.id, `Owner response relayed: ${approval.ownerResponse.slice(0, 200)}`);
          console.log(`[FollowUpChecker] Approval follow-up ${followUp.id} — owner response relayed and completed`);
        } else {
          await deps.followUpStore.recordAttempt(followUp.id);
          console.log(`[FollowUpChecker] Approval follow-up ${followUp.id} — send failed, rescheduled`);
        }
      } else {
        await deps.followUpStore.recordAttempt(followUp.id, new Date(Date.now() + 30 * 60 * 1000));
        console.warn(`[FollowUpChecker] Approval follow-up ${followUp.id} held: visitor reply validation failed`);
      }
    } catch (err: any) {
      console.error(`[FollowUpChecker] Approval follow-up ${followUp.id} failed:`, err.message);
      // Never substitute raw owner context or model working text on generation failure.
      await deps.followUpStore.recordAttempt(followUp.id, new Date(Date.now() + 30 * 60 * 1000));
    }
    return;
  }

  // Approval still pending — send reminder to owner
  console.log(`[FollowUpChecker] Approval ${approvalId} still pending — sending reminder to owner`);

  const reminder = `Reminder: You have a pending approval request. Please respond.\n\n*Question:* ${approval.question}\n*Context:* ${approval.context || 'No additional context'}`;

  // Determine where to send the reminder (owner's channel)
  const config = (deps as any).getConfig?.();
  const rawOwnerPhone = (config?.ownerPhone || '').split(',')[0] || '';
  const ownerPhone = rawOwnerPhone.replace(/\D/g, '');
  const ownerTelegramId = config?.ownerTelegramId || '';
  const escalationChannel = config?.primaryEscalationChannel || 'both';

  let sent = false;

  // Try Telegram if preferred or both
  if ((escalationChannel === 'telegram' || escalationChannel === 'both') && ownerTelegramId) {
    try {
      const tg = (deps as any).getTelegram?.();
      if (tg?.isConnected) {
        sent = await tg.sendMessage(Number(ownerTelegramId), reminder);
        if (sent) {
          console.log(`[FollowUpChecker] Approval follow-up ${followUp.id} — reminder sent to owner via Telegram`);
        }
      }
    } catch (err: any) {
      console.error(`[FollowUpChecker] Failed to send Telegram reminder: ${err.message}`);
    }
  }

  // Try WhatsApp if preferred or if both and telegram wasn't sent
  if (!sent && (escalationChannel === 'whatsapp' || escalationChannel === 'both') && ownerPhone) {
    try {
      const wa = (deps as any).getWhatsApp?.();
      if (wa?.isConnected) {
        const ownerJid = `${ownerPhone}@s.whatsapp.net`;
        sent = await deps.sendMessage('whatsapp', ownerJid, reminder);
        if (sent) {
          console.log(`[FollowUpChecker] Approval follow-up ${followUp.id} — reminder sent to owner via WhatsApp`);
        }
      }
    } catch (err: any) {
      console.error(`[FollowUpChecker] Failed to send WhatsApp reminder: ${err.message}`);
    }
  }

  if (sent) {
    await deps.followUpStore.recordAttempt(followUp.id);
  } else {
    console.error(`[FollowUpChecker] Could not send reminder for ${followUp.id} to any owner channel`);
    await deps.followUpStore.recordAttempt(followUp.id);
  }
}

/**
 * Build a prompt for the follow-up agent session.
 */
function buildFollowUpPrompt(followUp: FollowUp): string {
  // Include approval context if this is an approval-related follow-up
  const approvalContext = followUp.approvalId
    ? `\n\n## Approval Context (for reference only — this follow-up is handled by the checker)
- **Approval ID:** ${followUp.approvalId}
- **Status:** This follow-up was auto-scheduled because the owner hasn't responded yet.
  The checker will handle the approval status check. Use this information for context only.`
    : '';

  return `You are following up on a conversation that needs closure.${approvalContext}

## ⚠️ CRITICAL: NO NEW FOLLOW-UPS
You are inside a follow-up session. You MUST NOT call schedule_followup or create any new follow-ups.
This is an automated follow-up execution — creating new follow-ups from here causes infinite loops.
Your ONLY options are: send a message, mark as [NO_ACTION_NEEDED], or [RESCHEDULE].

## Follow-Up Details
- **Follow-Up ID:** ${followUp.id}
- **Contact:** ${followUp.contactId} (via ${followUp.channel})
- **Reason:** ${followUp.reason}
- **Priority:** ${followUp.priority}
- **Attempt:** ${followUp.attempts + 1}/${followUp.maxAttempts}
- **Originally scheduled at:** ${followUp.followUpAt.toISOString()}
- **Created:** ${followUp.createdAt.toISOString()}

## Conversation Context
${followUp.context}

## Instructions
1. Review the context and determine the best course of action.
2. If the issue has already been resolved (check recent messages using search_messages), respond with exactly [NO_ACTION_NEEDED], without an explanation.
3. If you need more time (e.g., owner still hasn't responded to the original ask_owner), respond with exactly [RESCHEDULE], without an explanation.
4. Otherwise, return only the visitor-facing message. The host sends it after checking conversation ownership.
5. Do not call tools or claim the message was sent; the host records delivery.
6. DO NOT call schedule_followup. This session is restricted.

## Follow-Up Message Guidelines
- Be natural and conversational — don't make it obvious this is an automated follow-up
- Reference the original conversation context
- If checking on a pending request: "Hi! Just following up on your earlier question about..."
- If delivering information: "Great news! I have an update regarding..."
- Keep it brief and actionable`;
}

/**
 * Get retry delay based on follow-up priority.
 */
function getRetryDelay(followUp: FollowUp): number {
  switch (followUp.priority) {
    case 'urgent':  return 30 * 60 * 1000;  // 30 minutes
    case 'high':    return 2 * 60 * 60 * 1000;  // 2 hours
    case 'normal':  return 4 * 60 * 60 * 1000;  // 4 hours
    case 'low':     return 24 * 60 * 60 * 1000; // 24 hours
    default:        return 4 * 60 * 60 * 1000;
  }
}
