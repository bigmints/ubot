import re

with open('src/channels/tools.ts', 'r') as f:
    content = f.read()

# Add CRM tools definitions
crm_tools = """
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
"""
content = content.replace("const MESSAGING_TOOLS: ToolDefinition[] = [", "const MESSAGING_TOOLS: ToolDefinition[] = [\n" + crm_tools)

# Patch send_message to resolve universal ID
send_message_patch = """        const provider = mr.resolveProvider(channel);
        
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
        let resultMessage = `Message sent to ${finalTo} via ${provider.channel}: "${body}"`;"""

content = content.replace("        const provider = mr.resolveProvider(channel);\n        \n        let sendOpts: any = {};\n        let resultMessage = `Message sent to ${to} via ${provider.channel}: \"${body}\"`;", send_message_patch)
content = content.replace("provider.sendMessage(to,", "provider.sendMessage(finalTo,")

# Add CRM tool implementations
crm_impls = """
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
"""
content = content.replace("registry.register('search_messages', async (args) => {", crm_impls + "\n    registry.register('search_messages', async (args) => {")

with open('src/channels/tools.ts', 'w') as f:
    f.write(content)

