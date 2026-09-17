import { parseVisitorReply, VISITOR_REPLY_CONTRACT } from '../../engine/visitor-reply.js';
/**
 * Approvals Tool Module
 *
 * Tools for the owner approval system — ask_owner, respond, list pending.
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../../tools/types.js';

const APPROVAL_TOOLS: ToolDefinition[] = [
  {
    name: 'ask_owner',
    description: 'Ask the owner for approval or guidance. Use when a third party requests specific private information, wants to make financial or scheduling commitments, or asks for anything sensitive. You MUST actually call this tool — do not just say you will check with the owner.',
    parameters: [
      { name: 'question', type: 'string', description: 'The specific sensitive question requiring owner input', required: true },
      { name: 'context', type: 'string', description: 'Who is asking and why this cannot be answered from persona', required: true },
      { name: 'requester_jid', type: 'string', description: 'Return address for an owner request. For visitors the host supplies the current conversation; omit this field and never ask them for a routing ID.', required: false },
    ],
  },
  {
    name: 'respond_to_approval',
    description: 'Respond to a pending approval request. The response will be relayed back to the original requester.',
    parameters: [
      { name: 'approval_id', type: 'string', description: 'The approval ID. If not provided, responds to the most recent pending approval.', required: false },
      { name: 'response', type: 'string', description: "The owner's response message to relay to the requester", required: true },
    ],
  },
  {
    name: 'list_pending_approvals',
    description: "List all pending approval requests that are waiting for the owner's response.",
    parameters: [],
  },
  {
    name: 'delete_approval',
    description: 'Delete an approval request. Can delete a specific approval by ID, or delete all resolved approvals at once.',
    parameters: [
      { name: 'approval_id', type: 'string', description: 'The approval ID to delete. Use "all_resolved" to delete all resolved approvals.', required: true },
    ],
  },
];

const approvalsToolModule: ToolModule = {
  name: 'approvals',
  tools: APPROVAL_TOOLS,
  register(registry: ToolRegistry, ctx: ToolContext) {
    registry.register('ask_owner', async (args, execution) => {
      const store = ctx.getApprovalStore();
      if (!store) return { toolName: 'ask_owner', success: false, error: 'Approval system not initialized', duration: 0 };

      const question = String(args.question || '');
      const context = String(args.context || '');
      // Bind visitor approval replies to the trusted active conversation, not model arguments.
      let requesterJid = execution?.isOwner === false
        ? execution.sessionId || '' : String(args.requester_jid || execution?.sessionId || '');
      if (!requesterJid && question) return { toolName: 'ask_owner', success: false, error: 'No trusted return conversation is available', duration: 0 };
      if (!question) return { toolName: 'ask_owner', success: false, error: 'Missing "question" parameter', duration: 0 };

      // Normalize: if the LLM provides a raw Telegram ID (no prefix), check if
      // we have a telegram: session for it so the relay goes to the right channel.
      const agent = ctx.getAgent();
      if (execution?.isOwner !== false && requesterJid && agent && !requesterJid.includes('@') && !requesterJid.startsWith('telegram:') && !requesterJid.startsWith('webchat:')) {
        const convStore = agent.getConversationStore();
        const telegramSession = await convStore.getSession(`telegram:${requesterJid}`);
        if (telegramSession) {
          requesterJid = `telegram:${requesterJid}`;
        }
      }

      const approval = await store.create({ question, context, requesterJid, sessionId: requesterJid });
      console.log(`[Approvals] Created approval ${approval.id}`);

      // Auto-schedule follow-up in case the owner takes a long time to respond.
      // This ensures the contact isn't left hanging indefinitely.
      const followUpStore = ctx.getFollowUpStore?.();
      let followUpId: string | null = null;
      let delayHours = 2;
      if (followUpStore && requesterJid) {
        // Determine channel from requesterJid format
        let channel = 'whatsapp';
        if (requesterJid.startsWith('telegram:')) channel = 'telegram';
        else if (requesterJid.startsWith('webchat:')) channel = 'webchat';

        // Read delay from config (default: 2 hours)
        const agent = ctx.getAgent();
        const config = agent?.getConfig?.() || {};
        delayHours = Number(config.approvalFollowUpDelayHours) || 2;
        const followUpAt = new Date(Date.now() + delayHours * 60 * 60 * 1000);
        const reason = `Waiting for owner response on: ${question.slice(0, 100)}`;
        const context = `Approval ID: ${approval.id}. An owner decision has been requested and is still pending. Follow up with the contact.`;

        const followUp = await followUpStore.create({
          sessionId: requesterJid,
          contactId: requesterJid,
          channel,
          reason,
          context,
          priority: 'high',
          followUpAt,
          maxAttempts: 3,
          approvalId: approval.id,
        });
        followUpId = followUp.id;
        console.log(`[Approvals] Auto-scheduled follow-up ${followUp.id} for approval ${approval.id} in ${delayHours}h`);
      }

      // Inject into Command Center
      if (agent) {
        const convStore = agent.getConversationStore();
        convStore.getOrCreateSession('web-console', 'web', 'Command Center');
        const notification = `🔔 **Approval Request** (ID: ${approval.id})\n\n**From:** ${context || 'Unknown'}\n**Requester:** ${requesterJid}\n**Question:** ${question}\n\n👉 Go to the Approvals page to respond, or reply here with your answer.`;
        convStore.addMessage('web-console', 'assistant', notification, { source: 'web' });

        // Check escalation channel preference
        const config = agent.getConfig();
        const escalationChannel = config.primaryEscalationChannel || 'both';

        // Notify owner via WhatsApp
        const rawOwnerPhone = (config.ownerPhone || '').split(',')[0] || '';
        const ownerPhone = rawOwnerPhone.replace(/\D/g, '');
        const wa = ctx.getWhatsApp();
        if ((escalationChannel === 'whatsapp' || escalationChannel === 'both') && ownerPhone && wa?.isConnected) {
          try {
            const ownerJid = `${ownerPhone}@s.whatsapp.net`;
            await wa.sendMessage(ownerJid, { text: `🔔 *Approval Request*\n\n${context}\n\n*Question:* ${question}\n\nReply to this message with your response.` });
          } catch (err: any) {
            console.error('[Approvals] Failed to notify owner via WhatsApp:', err.message);
          }
        }

        // Notify owner via Telegram
        const tg = ctx.getTelegram();
        if ((escalationChannel === 'telegram' || escalationChannel === 'both') && tg && config.ownerTelegramId) {
          try {
            const chatId = Number(config.ownerTelegramId);
            if (!isNaN(chatId)) {
              await tg.sendMessage(chatId, `🔔 *Approval Request*\n\n${context}\n\n*Question:* ${question}\n\nReply to this message with your response.`);
            }
          } catch (err: any) {
            console.error('[Approvals] Failed to notify owner via Telegram:', err.message);
          }
        }

        const ownerName = config.ownerName || 'owner';
        const followUpInfo = followUpId
          ? ` Follow-up scheduled in ${delayHours}h (ID: ${followUpId}).`
          : '';
        return { toolName: 'ask_owner', success: true, result: `Request recorded for ${ownerName} in the owner inbox (ID: ${approval.id}).${followUpInfo} This does not confirm notification delivery, an owner decision, availability, or a future reply.`, duration: 0 };
      }

      const followUpInfo = followUpId
        ? ` Follow-up scheduled in ${delayHours}h (ID: ${followUpId}).`
        : '';
      return { toolName: 'ask_owner', success: true, result: `Approval request created (ID: ${approval.id}).${followUpInfo}`, duration: 0 };
    });

    registry.register('respond_to_approval', async (args) => {
      const store = ctx.getApprovalStore();
      if (!store) return { toolName: 'respond_to_approval', success: false, error: 'Approval system not initialized', duration: 0 };

      const response = String(args.response || '');
      if (!response) return { toolName: 'respond_to_approval', success: false, error: 'Missing "response" parameter', duration: 0 };

      let approvalId = String(args.approval_id || '');
      if (!approvalId) {
        const pending = await store.getPending();
        if (pending.length === 0) return { toolName: 'respond_to_approval', success: true, result: 'No pending approvals to respond to.', duration: 0 };
        approvalId = pending[0].id;
      }

      const approval = await store.getById(approvalId);
      if (!approval) return { toolName: 'respond_to_approval', success: false, error: `Approval not found: ${approvalId}`, duration: 0 };
      if (approval.status === 'resolved') return { toolName: 'respond_to_approval', success: true, result: `Approval ${approvalId} was already resolved.`, duration: 0 };

      await store.resolve(approvalId, response);
      console.log(`[Approvals] Owner responded to approval ${approvalId}`);

      // A recorded decision is distinct from a validated and delivered visitor reply.
      const agent = ctx.getAgent();
      if (!approval.requesterJid || !agent) return { toolName: 'respond_to_approval', success: false, error: 'Decision recorded, but no return conversation or reply service is available.', duration: 0 };
      const systemPrompt = 'Compose a brief reply incorporating the explicit owner answer. Do not invent additional availability or commitments.';
      const userPrompt = JSON.stringify({ visitorQuestion: approval.question, ownerAnswer: response });
      try {
        const draft = await agent.generate(systemPrompt + '\n\n' + VISITOR_REPLY_CONTRACT, userPrompt);
        const finalReply = parseVisitorReply(draft);
        if (!finalReply) return { toolName: 'respond_to_approval', success: false, error: 'Decision recorded; generated visitor reply held for review. Nothing was sent.', duration: 0 };
        let sent = false;
        if (ctx.relayMessage) sent = await ctx.relayMessage(approval.requesterJid, finalReply);
        else if (/^telegram:-?\d+$/.test(approval.requesterJid)) {
          const tg = ctx.getTelegram();
          if (tg) { await tg.sendMessage(Number(approval.requesterJid.slice(9)), finalReply); sent = true; }
        } else if (/^\d+@s\.whatsapp\.net$/.test(approval.requesterJid)) {
          const wa = ctx.getWhatsApp();
          if (wa?.isConnected) { await wa.sendMessage(approval.requesterJid, { text: finalReply }); sent = true; }
        }
        if (!sent) return { toolName: 'respond_to_approval', success: false, error: 'Decision recorded, but visitor reply delivery was not confirmed. Review the conversation before retrying.', duration: 0 };
        return { toolName: 'respond_to_approval', success: true, result: `Approval ${approvalId} resolved and the visitor reply sent.`, duration: 0 };
      } catch {
        return { toolName: 'respond_to_approval', success: false, error: 'Decision recorded, but visitor reply delivery was not confirmed. Do not retry blindly.', duration: 0 };
      }
    });

    registry.register('list_pending_approvals', async () => {
      const store = ctx.getApprovalStore();
      if (!store) return { toolName: 'list_pending_approvals', success: false, error: 'Approval system not initialized', duration: 0 };
      const pending = await store.getPending();
      if (pending.length === 0) return { toolName: 'list_pending_approvals', success: true, result: 'No pending approvals.', duration: 0 };
      const summary = pending.map((a: any) => {
        const ago = Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000);
        return `• [${a.id}] "${a.question}" — from: ${a.context || a.requesterJid} (${ago}m ago)`;
      }).join('\n');
      return { toolName: 'list_pending_approvals', success: true, result: `${pending.length} pending approval(s):\n${summary}`, duration: 0 };
    });

    registry.register('delete_approval', async (args) => {
      const store = ctx.getApprovalStore();
      if (!store) return { toolName: 'delete_approval', success: false, error: 'Approval system not initialized', duration: 0 };

      const approvalId = String(args.approval_id || '');
      if (!approvalId) return { toolName: 'delete_approval', success: false, error: 'Missing "approval_id" parameter', duration: 0 };

      if (approvalId === 'all_resolved') {
        const all = await store.getAll();
        const resolved = all.filter((a: any) => a.status === 'resolved');
        if (resolved.length === 0) return { toolName: 'delete_approval', success: true, result: 'No resolved approvals to delete.', duration: 0 };
        let deleted = 0;
        for (const a of resolved) {
          if (await store.delete(a.id)) deleted++;
        }
        return { toolName: 'delete_approval', success: true, result: `Deleted ${deleted} resolved approval(s).`, duration: 0 };
      }

      const deleted = await store.delete(approvalId);
      if (!deleted) return { toolName: 'delete_approval', success: false, error: `Approval not found: ${approvalId}`, duration: 0 };
      console.log(`[Approvals] Deleted approval ${approvalId}`);
      return { toolName: 'delete_approval', success: true, result: `Approval ${approvalId} deleted.`, duration: 0 };
    });
  },
};

export default approvalsToolModule;
