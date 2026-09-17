/**
 * Follow-Up Tools Module
 *
 * Tools for scheduling and managing conversation follow-ups.
 * Ensures every conversation reaches closure by tracking pending items,
 * scheduling check-ins, and auto-following-up via the scheduler.
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../../tools/types.js';
import * as chrono from 'chrono-node';
import type { FollowUpStore, FollowUpPriority } from '../../memory/followups.js';

// ─── Tool Definitions ─────────────────────────────────────

const FOLLOWUP_TOOLS: ToolDefinition[] = [
  {
    name: 'schedule_followup',
    description: 'Schedule a follow-up for a conversation that needs closure. Use this when: (1) you used ask_owner and are waiting for a response, (2) you promised to get back to someone, (3) a visitor\'s question couldn\'t be fully resolved, (4) any conversation has unfinished business. This ensures no conversation is forgotten.',
    parameters: [
      { name: 'session_id', type: 'string', description: 'The session ID of the conversation to follow up on', required: true },
      { name: 'contact_id', type: 'string', description: 'The contact ID (phone number, telegram ID, etc.) to follow up with', required: true },
      { name: 'channel', type: 'string', description: 'The messaging channel: "whatsapp", "telegram", or "web"', required: true },
      { name: 'reason', type: 'string', description: 'Why this follow-up is needed. Be specific: "Waiting for owner approval on meeting request", "Need to send pricing info once owner responds"', required: true },
      { name: 'context', type: 'string', description: 'Brief summary of the conversation for context when the follow-up fires', required: true },
      { name: 'time', type: 'string', description: 'When to follow up: "in 2 hours", "tomorrow at 9am", "in 30 minutes". Default: "in 1 hour"', required: false },
      { name: 'priority', type: 'string', description: 'Priority level: "low", "normal", "high", "urgent". Default: "normal"', required: false },
      { name: 'max_attempts', type: 'number', description: 'Maximum number of follow-up attempts before auto-cancelling. Default: 3', required: false },
    ],
  },
  {
    name: 'list_followups',
    description: 'List all pending follow-ups across conversations. Use this to check what conversations need attention, what follow-ups are overdue, and what\'s coming up.',
    parameters: [
      { name: 'status', type: 'string', description: 'Filter by status: "pending", "completed", "cancelled", "expired", or "all". Default: "pending"', required: false },
      { name: 'contact_id', type: 'string', description: 'Filter to a specific contact', required: false },
      { name: 'channel', type: 'string', description: 'Filter by channel: "whatsapp", "telegram", "web"', required: false },
    ],
  },
  {
    name: 'complete_followup',
    description: 'Mark a follow-up as completed when the matter has been resolved. Always call this when a pending follow-up is no longer needed — e.g., the owner responded, the visitor got their answer, or the issue was otherwise resolved.',
    parameters: [
      { name: 'followup_id', type: 'string', description: 'The ID of the follow-up to complete', required: true },
      { name: 'result', type: 'string', description: 'What happened — how was this resolved? E.g., "Owner approved the meeting, sent confirmation to visitor"', required: true },
    ],
  },
  {
    name: 'cancel_followup',
    description: 'Cancel a pending follow-up that is no longer needed.',
    parameters: [
      { name: 'followup_id', type: 'string', description: 'The ID of the follow-up to cancel', required: true },
      { name: 'reason', type: 'string', description: 'Why is this follow-up being cancelled?', required: false },
    ],
  },
  {
    name: 'get_conversation_status',
    description: 'Check the continuity status of a conversation. Returns whether there are pending follow-ups, unresolved items, or if the conversation has reached closure. Use this at the start of a conversation with a returning contact to see if there\'s unfinished business.',
    parameters: [
      { name: 'session_id', type: 'string', description: 'The session ID to check (e.g. a WhatsApp JID or telegram chat ID)', required: true },
    ],
  },
];

// ─── Module ───────────────────────────────────────────────

const followupToolModule: ToolModule = {
  name: 'followups',
  tools: FOLLOWUP_TOOLS,
  register(registry: ToolRegistry, ctx: ToolContext) {
    // Helper to get the follow-up store from context
    function getStore(): FollowUpStore | null {
      try {
        return (ctx as any).getFollowUpStore?.() || null;
      } catch {
        return null;
      }
    }

    // ── schedule_followup ──────────────────────────────────
    registry.register('schedule_followup', async (args) => {
      const store = getStore();
      if (!store) return { toolName: 'schedule_followup', success: false, error: 'Follow-up store not initialized', duration: 0 };

      const sessionId = String(args.session_id || '');
      const contactId = String(args.contact_id || '');
      const channel = String(args.channel || 'whatsapp');
      const reason = String(args.reason || '');
      const context = String(args.context || '');
      const timeStr = String(args.time || 'in 1 hour');
      const priority = (String(args.priority || 'normal')) as FollowUpPriority;
      const maxAttempts = Number(args.max_attempts) || 3;

      if (!sessionId || !contactId || !reason) {
        return { toolName: 'schedule_followup', success: false, error: 'Missing required parameters: session_id, contact_id, and reason are required', duration: 0 };
      }

      // ⛔ Hard guard: prevent re-entrant follow-up loops
      // If called from within a follow-up or sub-agent session, refuse
      if (sessionId.startsWith('followup-') || sessionId.startsWith('sub-')) {
        console.warn(`[FollowUp] ⛔ Blocked schedule_followup from re-entrant session: ${sessionId}`);
        return {
          toolName: 'schedule_followup',
          success: false,
          error: 'Cannot schedule follow-ups from within a follow-up or sub-agent session. This would cause infinite loops. Complete the current task instead.',
          duration: 0,
        };
      }

      // Parse the follow-up time
      const followUpAt = chrono.parseDate(timeStr, new Date()) || new Date(timeStr);
      if (!followUpAt || isNaN(followUpAt.getTime())) {
        return { toolName: 'schedule_followup', success: false, error: `Could not parse time: "${timeStr}"`, duration: 0 };
      }
      if (followUpAt.getTime() <= Date.now()) {
        return { toolName: 'schedule_followup', success: false, error: `Follow-up time "${timeStr}" resolves to the past`, duration: 0 };
      }

      try {
        const followUp = await store.create({
          sessionId,
          contactId,
          channel,
          reason,
          context,
          priority,
          followUpAt,
          maxAttempts,
        });

        return {
          toolName: 'schedule_followup',
          success: true,
          result: `Follow-up scheduled (ID: ${followUp.id}):\n• Contact: ${contactId}\n• Channel: ${channel}\n• Reason: ${reason}\n• Follow-up at: ${followUpAt.toLocaleString()}\n• Priority: ${priority}\n• Max attempts: ${maxAttempts}\n\nThe system will automatically follow up at the scheduled time. If the contact writes back before then, use complete_followup to close it.`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'schedule_followup', success: false, error: err.message, duration: 0 };
      }
    });

    // ── list_followups ─────────────────────────────────────
    registry.register('list_followups', async (args) => {
      const store = getStore();
      if (!store) return { toolName: 'list_followups', success: false, error: 'Follow-up store not initialized', duration: 0 };

      const statusFilter = String(args.status || 'pending');
      const contactId = args.contact_id ? String(args.contact_id) : undefined;
      const channel = args.channel ? String(args.channel) : undefined;

      const filter: any = {};
      if (statusFilter !== 'all') {
        filter.status = statusFilter;
      }
      if (contactId) filter.contactId = contactId;
      if (channel) filter.channel = channel;

      const followups = await store.list(filter);
      if (followups.length === 0) {
        return { toolName: 'list_followups', success: true, result: 'No follow-ups found matching the criteria.', duration: 0 };
      }

      const now = new Date();
      const lines = followups.map(f => {
        const isOverdue = f.status === 'pending' && f.followUpAt <= now;
        const overdueBadge = isOverdue ? ' ⚠️ OVERDUE' : '';
        const dueStr = f.followUpAt.toLocaleString();
        return `• **${f.reason}** (ID: ${f.id})${overdueBadge}\n  Contact: ${f.contactId} via ${f.channel}\n  Status: ${f.status} | Due: ${dueStr} | Priority: ${f.priority} | Attempts: ${f.attempts}/${f.maxAttempts}${f.result ? `\n  Result: ${f.result}` : ''}`;
      });

      const stats = await store.getStats();
      const summary = `📋 Follow-ups (${stats.pending} pending, ${stats.overdue} overdue, ${stats.completed} completed):\n\n${lines.join('\n\n')}`;

      return { toolName: 'list_followups', success: true, result: summary, duration: 0 };
    });

    // ── complete_followup ──────────────────────────────────
    registry.register('complete_followup', async (args) => {
      const store = getStore();
      if (!store) return { toolName: 'complete_followup', success: false, error: 'Follow-up store not initialized', duration: 0 };

      const followupId = String(args.followup_id || '');
      const result = String(args.result || '');

      if (!followupId) return { toolName: 'complete_followup', success: false, error: 'Missing required parameter: followup_id', duration: 0 };
      if (!result) return { toolName: 'complete_followup', success: false, error: 'Missing required parameter: result (describe how this was resolved)', duration: 0 };

      const completed = await store.complete(followupId, result);
      if (completed) {
        return { toolName: 'complete_followup', success: true, result: `Follow-up ${followupId} marked as completed: ${result}`, duration: 0 };
      }
      return { toolName: 'complete_followup', success: false, error: `Follow-up ${followupId} not found or already completed`, duration: 0 };
    });

    // ── cancel_followup ────────────────────────────────────
    registry.register('cancel_followup', async (args) => {
      const store = getStore();
      if (!store) return { toolName: 'cancel_followup', success: false, error: 'Follow-up store not initialized', duration: 0 };

      const followupId = String(args.followup_id || '');
      const reason = args.reason ? String(args.reason) : undefined;

      if (!followupId) return { toolName: 'cancel_followup', success: false, error: 'Missing required parameter: followup_id', duration: 0 };

      const cancelled = await store.cancel(followupId, reason);
      if (cancelled) {
        return { toolName: 'cancel_followup', success: true, result: `Follow-up ${followupId} cancelled${reason ? ': ' + reason : ''}`, duration: 0 };
      }
      return { toolName: 'cancel_followup', success: false, error: `Follow-up ${followupId} not found or already completed`, duration: 0 };
    });

    // ── get_conversation_status ────────────────────────────
    registry.register('get_conversation_status', async (args) => {
      const store = getStore();
      if (!store) return { toolName: 'get_conversation_status', success: false, error: 'Follow-up store not initialized', duration: 0 };

      const sessionId = String(args.session_id || '');
      if (!sessionId) return { toolName: 'get_conversation_status', success: false, error: 'Missing required parameter: session_id', duration: 0 };

      const pending = await store.getForSession(sessionId);
      const now = new Date();
      const overdue = pending.filter((f: any) => f.followUpAt <= now);
      const upcoming = pending.filter((f: any) => f.followUpAt > now);

      if (pending.length === 0) {
        return {
          toolName: 'get_conversation_status',
          success: true,
          result: `✅ Conversation ${sessionId} has no pending follow-ups. All clear.`,
          duration: 0,
        };
      }

      const parts: string[] = [];
      parts.push(`📊 Conversation Status for ${sessionId}:`);
      parts.push(`• Pending follow-ups: ${pending.length}`);

      if (overdue.length > 0) {
        parts.push(`\n⚠️ **OVERDUE (${overdue.length}):**`);
        for (const f of overdue) {
          parts.push(`  • ${f.reason} (ID: ${f.id}) — was due ${f.followUpAt.toLocaleString()}, ${f.attempts} attempts so far`);
        }
      }

      if (upcoming.length > 0) {
        parts.push(`\n⏰ **Upcoming (${upcoming.length}):**`);
        for (const f of upcoming) {
          parts.push(`  • ${f.reason} (ID: ${f.id}) — due ${f.followUpAt.toLocaleString()}`);
        }
      }

      return {
        toolName: 'get_conversation_status',
        success: true,
        result: parts.join('\n'),
        duration: 0,
      };
    });
  },
};

export default followupToolModule;
