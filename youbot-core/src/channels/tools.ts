/**
 * Messaging Tool Module
 *
 * Tools for sending, searching, and managing messages
 * across all connected messaging platforms (WhatsApp, Telegram, etc.)
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../tools/types.js';

const MESSAGING_TOOLS: ToolDefinition[] = [

  {
    name: 'crm_search_contacts',
    description: 'Search the Universal Contact database by name, ID, or attributes.',
    parameters: [
      { name: 'query', type: 'string', description: 'Name or term to search for', required: true }
    ],
  },
  {
    name: 'crm_update_contact',
    description: 'Update the attributes of a universal contact.',
    parameters: [
      { name: 'contactId', type: 'string', description: 'The UUID of the universal contact', required: true },
      { name: 'name', type: 'string', description: 'New name', required: false },
      { name: 'attributes', type: 'string', description: 'JSON string of attributes', required: false }
    ],
  },
  {
    name: 'crm_merge_contacts',
    description: 'Merge a source universal contact into a target universal contact.',
    parameters: [
      { name: 'targetId', type: 'string', description: 'The UUID of the target contact to keep', required: true },
      { name: 'sourceId', type: 'string', description: 'The UUID of the source contact to merge and delete', required: true }
    ],
  },

  {
    name: 'send_message',
    description: 'Send a message immediately to a contact or group on any connected messaging platform. IMPORTANT: When sending messages on behalf of the user, keep your conversational text response extremely brief (e.g. "Sent."). DO NOT echo or quote the drafted message back to the user to avoid double messaging them.',
    parameters: [
      { name: 'to', type: 'string', description: 'Phone number with country code (e.g. +971501234567) or contact/group ID', required: true },
      { name: 'body', type: 'string', description: 'The message text to send', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel (whatsapp, telegram). Defaults to the connected one.', required: false },
      { name: 'as_voice_note', type: 'boolean', description: 'If true, synthesizes the text into speech and sends it as an authentic voice note.', required: false },
    ],
  },
  {
    name: 'search_messages',
    description: 'Find past messages and conversations. Use this to check what was discussed, find schedules, look up details mentioned in previous chats, or verify what was said before.',
    parameters: [
      { name: 'from', type: 'string', description: 'Filter by sender phone number or ID', required: false },
      { name: 'to', type: 'string', description: 'Filter by recipient phone number or ID', required: false },
      { name: 'query', type: 'string', description: 'Text to search for in message body', required: false },
      { name: 'limit', type: 'number', description: 'Max results to return (default 20)', required: false },
      { name: 'channel', type: 'string', description: 'Filter by messaging channel', required: false },
    ],
  },
  {
    name: 'get_contacts',
    description: 'Look up contact information by name or number. Use this to find someone\'s phone number, check if a contact exists, or look up group membership.',
    parameters: [
      { name: 'query', type: 'string', description: 'Search by name, phone number, or ID', required: false },
      { name: 'channel', type: 'string', description: 'Filter by messaging channel', required: false },
    ],
  },
  {
    name: 'get_conversations',
    description: 'List recent conversations across all connected platforms',
    parameters: [
      { name: 'limit', type: 'number', description: 'Max conversations to return (default 20)', required: false },
      { name: 'channel', type: 'string', description: 'Filter by messaging channel', required: false },
    ],
  },
  {
    name: 'delete_message',
    description: 'Delete a specific message by its ID',
    parameters: [
      { name: 'messageId', type: 'string', description: 'The ID of the message to delete', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel the message is on', required: false },
    ],
  },
  {
    name: 'reply_to_message',
    description: 'Reply to a specific message by its ID (quotes the original message)',
    parameters: [
      { name: 'messageId', type: 'string', description: 'The ID of the message to reply to', required: true },
      { name: 'body', type: 'string', description: 'The reply text', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel', required: false },
    ],
  },
  {
    name: 'get_connection_status',
    description: 'Get the connection status of messaging platforms',
    parameters: [
      { name: 'channel', type: 'string', description: 'Specific channel to check, or omit for all', required: false },
    ],
  },
  {
    name: 'forward_message',
    description: 'Forward a message to another contact. Finds the message in history and sends its content to the specified recipient.',
    parameters: [
      { name: 'to', type: 'string', description: 'Recipient phone number with country code or contact ID', required: true },
      { name: 'text', type: 'string', description: 'The text to forward. Use search_messages first to find the exact content.', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel (whatsapp, telegram). Defaults to connected one.', required: false },
    ],
  },
  {
    name: 'react_to_message',
    description: 'React to a message with an emoji. Supported on WhatsApp (emoji) and Telegram (emoji).',
    parameters: [
      { name: 'messageId', type: 'string', description: 'The ID of the message to react to', required: true },
      { name: 'emoji', type: 'string', description: 'Emoji reaction (e.g. "👍", "❤️", "😂")', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel', required: false },
    ],
  },
  {
    name: 'edit_message',
    description: 'Edit a previously sent message. Supported on WhatsApp and Telegram.',
    parameters: [
      { name: 'messageId', type: 'string', description: 'The ID of the message to edit', required: true },
      { name: 'body', type: 'string', description: 'New message text', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel', required: false },
    ],
  },
  {
    name: 'pin_message',
    description: 'Pin a message in a conversation. Supported on Telegram.',
    parameters: [
      { name: 'messageId', type: 'string', description: 'The ID of the message to pin', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel', required: false },
    ],
  },
  {
    name: 'create_poll',
    description: 'Create a poll in a conversation. Supported on WhatsApp and Telegram.',
    parameters: [
      { name: 'to', type: 'string', description: 'Chat/group ID to send the poll to', required: true },
      { name: 'question', type: 'string', description: 'Poll question', required: true },
      { name: 'options', type: 'string', description: 'Comma-separated poll options', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel', required: false },
    ],
  },
  {
    name: 'wa_respond_to_bot',
    description: 'Send a response to a WhatsApp bot\'s interactive message (menu selections, button taps, text choices). Use this when the bot presents options like "type A for appointments" or shows interactive buttons/lists. Send the exact option text the bot expects.',
    parameters: [
      { name: 'to', type: 'string', description: 'The WhatsApp JID of the bot to respond to (the rawJid from the incoming message)', required: true },
      { name: 'response', type: 'string', description: 'The exact text/option to send back to the bot (e.g. "A" for booking, or the button label)', required: true },
      { name: 'delay_seconds', type: 'number', description: 'Optional delay before responding to simulate human typing/reading time (e.g. 5 or 10)', required: false },
    ],
  },
];

const messagingToolModule: ToolModule = {
  name: 'messaging',
  tools: MESSAGING_TOOLS,
  register(registry: ToolRegistry, ctx: ToolContext) {
    const mr = ctx.getMessagingRegistry();

    registry.register('send_message', async (args) => {
      const to = String(args.to || '');
      // Defensive: small models sometimes send args as {description, type, value} objects
      const rawBody = args.body || args.message || '';
      const body = typeof rawBody === 'object' && rawBody !== null
        ? String((rawBody as any).value || (rawBody as any).text || JSON.stringify(rawBody))
        : String(rawBody);
      if (!to || !body) return { toolName: 'send_message', success: false, error: 'Missing "to" or "body" parameter', duration: 0 };

      const asVoiceNote = args.as_voice_note === true || args.as_voice_note === 'true';

      try {
        let channel = args.channel as string | undefined;

        // Smart channel detection: if no channel specified and the recipient looks like
        // an international phone number, prefer WhatsApp (if connected) over other providers.
        if (!channel && /^\+\d{10,}$/.test(to.replace(/\s/g, ''))) {
          try {
            const waProvider = mr.getProvider('whatsapp');
            if (waProvider.status === 'connected') {
              channel = 'whatsapp';
            }
          } catch {
            // WhatsApp not registered — fall through to default
          }
        }

        const provider = mr.resolveProvider(channel);

        let finalTo = to;
        const contactStore = ctx.getContactStore();
        if (contactStore && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(to)) {
          const identities = await contactStore.getIdentities(to);
          if (identities.length > 0) {
            const identity = channel ? identities.find((i: any) => i.channel === channel) : identities[0];
            if (identity) {
              finalTo = identity.platformId;
              if (!channel) channel = identity.channel;
            } else {
              return { toolName: 'send_message', success: false, error: `Contact has no identity for channel ${channel || 'any'}`, duration: 0 };
            }
          }
        }

        let sendOpts: any = {};
        let resultMessage = `Message sent to ${finalTo} via ${provider.channel}: "${body}"`;

        if (asVoiceNote) {
          try {
            const { isTtsAvailable, textToSpeech } = await import('../capabilities/tts/service.js');
            if (isTtsAvailable()) {
              const result = textToSpeech(body, { speed: 1.0 });
              sendOpts = {
                mediaType: 'audio',
                mediaPath: result.audioPath,
                ptt: true,
                mimetype: 'audio/wav',
              };
              resultMessage = `Voice note generated and sent to ${to} via ${provider.channel}. text: "${body}"`;
            } else {
              console.warn("TTS requested but not available. Sending as text.");
            }
          } catch (err: any) {
            console.error("Failed to generate voice note:", err.message);
            // Will gracefully fall back to text because sendOpts remains empty
          }
        }

        await provider.sendMessage(finalTo, body, sendOpts);

        // Setup deferred cleanup if a temporary audio file was created
        if (sendOpts.mediaPath) {
          setTimeout(async () => {
             const { unlinkSync } = await import('fs');
             try { unlinkSync(sendOpts.mediaPath); } catch {}
          }, 60000); // 1-minute delay before cleanup to ensure Baileys transmits it
        }

        return { toolName: 'send_message', success: true, result: resultMessage, duration: 0 };
      } catch (err: any) {
        return { toolName: 'send_message', success: false, error: err.message, duration: 0 };
      }
    });


    registry.register('crm_search_contacts', async (args) => {
      const contactStore = ctx.getContactStore();
      if (!contactStore) return { toolName: 'crm_search_contacts', success: false, error: 'Contact store not available', duration: 0 };
      try {
        const contacts = await contactStore.searchContacts(String(args.query || ''));
        if (contacts.length === 0) return { toolName: 'crm_search_contacts', success: true, result: 'No contacts found.', duration: 0 };
        return { toolName: 'crm_search_contacts', success: true, result: JSON.stringify(contacts, null, 2), duration: 0 };
      } catch (e: any) {
        return { toolName: 'crm_search_contacts', success: false, error: e.message, duration: 0 };
      }
    });

    registry.register('crm_update_contact', async (args) => {
      const contactStore = ctx.getContactStore();
      if (!contactStore) return { toolName: 'crm_update_contact', success: false, error: 'Contact store not available', duration: 0 };
      try {
        const updates: any = {};
        if (args.name) updates.name = String(args.name);
        if (args.attributes) {
          updates.attributes = typeof args.attributes === 'string' ? JSON.parse(args.attributes) : args.attributes;
        }
        const updated = await contactStore.updateContact(String(args.contactId), updates);
        return { toolName: 'crm_update_contact', success: true, result: `Contact updated: ${JSON.stringify(updated)}`, duration: 0 };
      } catch (e: any) {
        return { toolName: 'crm_update_contact', success: false, error: e.message, duration: 0 };
      }
    });

    registry.register('crm_merge_contacts', async (args) => {
      const contactStore = ctx.getContactStore();
      if (!contactStore) return { toolName: 'crm_merge_contacts', success: false, error: 'Contact store not available', duration: 0 };
      try {
        await contactStore.mergeContacts(String(args.targetId), String(args.sourceId));
        return { toolName: 'crm_merge_contacts', success: true, result: `Successfully merged contact ${args.sourceId} into ${args.targetId}.`, duration: 0 };
      } catch (e: any) {
        return { toolName: 'crm_merge_contacts', success: false, error: e.message, duration: 0 };
      }
    });

    registry.register('search_messages', async (args) => {
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        const messages = await provider.searchMessages({
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          query: args.query as string | undefined,
          limit: args.limit ? Number(args.limit) : 20,
        });
        if (messages.length === 0) return { toolName: 'search_messages', success: true, result: 'No messages found matching the filter.', duration: 0 };
        const formatted = messages.map((m: any) => `[${m.timestamp.toISOString()}] ${m.isFromMe ? 'Me' : m.from} → ${m.to}: ${m.body}`).join('\n');
        return { toolName: 'search_messages', success: true, result: `Found ${messages.length} messages:\n${formatted}`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'search_messages', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('get_contacts', async (args) => {
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        const contacts = await provider.getContacts(args.query as string | undefined);
        if (contacts.length === 0) return { toolName: 'get_contacts', success: true, result: 'No contacts found.', duration: 0 };
        const formatted = contacts.map((c: any) => `${c.displayName || c.name || c.phone || c.id}${c.isGroup ? ' (group)' : ''}`).join('\n');
        return { toolName: 'get_contacts', success: true, result: `Found ${contacts.length} contacts:\n${formatted}`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'get_contacts', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('get_conversations', async (args) => {
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        const convos = await provider.getConversations(args.limit ? Number(args.limit) : 20);
        if (convos.length === 0) return { toolName: 'get_conversations', success: true, result: 'No conversations found.', duration: 0 };
        const formatted = convos.map((c: any) => `${c.contact.displayName || c.contact.name || c.contact.phone || c.id}: ${c.lastMessage?.body?.slice(0, 50) || '(no messages)'}`).join('\n');
        return { toolName: 'get_conversations', success: true, result: `${convos.length} conversations:\n${formatted}`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'get_conversations', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('delete_message', async (args) => {
      const messageId = String(args.messageId || '');
      if (!messageId) return { toolName: 'delete_message', success: false, error: 'Missing messageId', duration: 0 };
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        await provider.deleteMessage(messageId);
        return { toolName: 'delete_message', success: true, result: `Message ${messageId} deleted.`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'delete_message', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('reply_to_message', async (args) => {
      const messageId = String(args.messageId || '');
      const body = String(args.body || '');
      if (!messageId || !body) return { toolName: 'reply_to_message', success: false, error: 'Missing messageId or body', duration: 0 };
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        await provider.replyToMessage(messageId, body);
        return { toolName: 'reply_to_message', success: true, result: `Replied to message ${messageId}: "${body}"`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'reply_to_message', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('get_connection_status', async (args) => {
      if (args.channel) {
        try {
          const provider = mr.getProvider(args.channel as any);
          return { toolName: 'get_connection_status', success: true, result: JSON.stringify({ channel: provider.channel, status: provider.status }), duration: 0 };
        } catch (err: any) {
          return { toolName: 'get_connection_status', success: false, error: err.message, duration: 0 };
        }
      }
      const providers = mr.getAllProviders();
      const statuses = providers.map((p: any) => ({ channel: p.channel, status: p.status }));
      return { toolName: 'get_connection_status', success: true, result: statuses.length > 0 ? JSON.stringify(statuses) : 'No messaging providers registered.', duration: 0 };
    });

    registry.register('forward_message', async (args) => {
      const to = String(args.to || '');
      const text = String(args.text || '');
      const channel = String(args.channel || '');
      if (!to || !text) return { toolName: 'forward_message', success: false, error: 'Missing required parameters (to, text)', duration: 0 };
      try {
        const provider = mr.resolveProvider(channel || undefined);
        await provider.sendMessage(to, `↩️ Forwarded:\n\n${text}`);
        return { toolName: 'forward_message', success: true, result: `Message forwarded to ${to}.`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'forward_message', success: false, error: `Failed to forward message: ${err.message}`, duration: 0 };
      }
    });

    registry.register('react_to_message', async (args) => {
      const messageId = String(args.messageId || '');
      const emoji = String(args.emoji || '');
      if (!messageId || !emoji) return { toolName: 'react_to_message', success: false, error: 'Missing messageId or emoji', duration: 0 };
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        if (typeof provider.reactToMessage !== 'function') {
          return { toolName: 'react_to_message', success: false, error: `Reactions not supported on ${provider.channel}`, duration: 0 };
        }
        await provider.reactToMessage(messageId, emoji);
        return { toolName: 'react_to_message', success: true, result: `Reacted ${emoji} to message ${messageId}`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'react_to_message', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('edit_message', async (args) => {
      const messageId = String(args.messageId || '');
      const body = String(args.body || '');
      if (!messageId || !body) return { toolName: 'edit_message', success: false, error: 'Missing messageId or body', duration: 0 };
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        if (typeof provider.editMessage !== 'function') {
          return { toolName: 'edit_message', success: false, error: `Edit not supported on ${provider.channel}`, duration: 0 };
        }
        await provider.editMessage(messageId, body);
        return { toolName: 'edit_message', success: true, result: `Message ${messageId} edited`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'edit_message', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('pin_message', async (args) => {
      const messageId = String(args.messageId || '');
      if (!messageId) return { toolName: 'pin_message', success: false, error: 'Missing messageId', duration: 0 };
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        if (typeof provider.pinMessage !== 'function') {
          return { toolName: 'pin_message', success: false, error: `Pin not supported on ${provider.channel}`, duration: 0 };
        }
        await provider.pinMessage(messageId);
        return { toolName: 'pin_message', success: true, result: `Message ${messageId} pinned`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'pin_message', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('create_poll', async (args) => {
      const to = String(args.to || '');
      const question = String(args.question || '');
      const optionsStr = String(args.options || '');
      if (!to || !question || !optionsStr) return { toolName: 'create_poll', success: false, error: 'Missing to, question, or options', duration: 0 };
      const options = optionsStr.split(',').map(o => o.trim()).filter(Boolean);
      if (options.length < 2) return { toolName: 'create_poll', success: false, error: 'At least 2 options required', duration: 0 };
      try {
        const provider = mr.resolveProvider(args.channel as string | undefined);
        if (typeof provider.createPoll !== 'function') {
          return { toolName: 'create_poll', success: false, error: `Polls not supported on ${provider.channel}`, duration: 0 };
        }
        await provider.createPoll(to, question, options);
        return { toolName: 'create_poll', success: true, result: `Poll created: "${question}" with ${options.length} options`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'create_poll', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('wa_respond_to_bot', async (args) => {
      let to = String(args.to || '');
      const response = String(args.response || '');
      if (!to || !response) {
        return { toolName: 'wa_respond_to_bot', success: false, error: 'Missing "to" (bot JID) or "response" (text to send)', duration: 0 };
      }
      try {
        const waConn = ctx.getWhatsApp();
        if (!waConn || !waConn.isConnected) {
          return { toolName: 'wa_respond_to_bot', success: false, error: 'WhatsApp is not connected', duration: 0 };
        }
        // Normalize JID — LLM may pass phone numbers like "+97143020600" instead of JIDs
        if (!to.includes('@')) {
          const digits = to.replace(/\D/g, '');
          to = `${digits}@s.whatsapp.net`;
        }
        const delaySeconds = args.delay_seconds ? Number(args.delay_seconds) : 0;
        if (delaySeconds > 0) {
          console.log(`[wa_respond_to_bot] Waiting ${delaySeconds}s before responding...`);
          await new Promise(r => setTimeout(r, delaySeconds * 1000));
        }

        // Send as plain text — WhatsApp bots accept text replies for menu selections
      console.log('[wa_respond_to_bot] Sending response');
        await waConn.sendMessage(to, { text: response });
        console.log(`[wa_respond_to_bot] ✅ Message sent successfully`);
        return { toolName: 'wa_respond_to_bot', success: true, result: `Sent "${response}" to bot ${to}`, duration: 0 };
      } catch (err: any) {
        console.log(`[wa_respond_to_bot] ❌ Failed: ${err.message}`);
        return { toolName: 'wa_respond_to_bot', success: false, error: `Failed to respond to bot: ${err.message}`, duration: 0 };
      }
    });
  },
};

export default messagingToolModule;
