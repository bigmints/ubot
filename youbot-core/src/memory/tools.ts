/**
 * Memory Tool Module
 *
 * Explicit tools for the agent to manage profiles and memory facts synchronously.
 * While Youbot has a robust background "Soul Extraction" feature, these tools
 * allow the agent to confirm to the user that it explicitly saved or retrieved data.
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../tools/types.js';

const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'save_memory',
    description: 'Remember a fact, preference, or note about a person. Use this to save things you learn during conversation so you can recall them later (e.g. their job, preferences, relationship to the owner).',
    parameters: [
      { name: 'contactId', type: 'string', description: 'The phone number, Telegram ID, or "__owner__" for the owner profile', required: true },
      { name: 'category', type: 'string', description: 'Memory category: "identity", "preference", "fact", "relationship", or "note"', required: true },
      { name: 'key', type: 'string', description: 'Short standardized key for the fact (e.g. "favorite_drink", "occupation", "company")', required: true },
      { name: 'value', type: 'string', description: 'The value to save (e.g. "Matcha Latte", "Software Engineer")', required: true },
    ],
  },
  {
    name: 'get_profile',
    description: 'Look up everything you know about a person — their name, job, preferences, and past notes. Use this before answering questions about someone, or to personalize your responses.',
    parameters: [
      { name: 'contactId', type: 'string', description: 'The phone number, Telegram ID, or "__owner__" for the owner profile', required: true },
    ],
  },
  {
    name: 'delete_memory',
    description: 'Delete a specific memory fact from a contact profile or the owner profile by its ID. First use get_profile to find the ID of the memory you want to delete.',
    parameters: [
      { name: 'memoryId', type: 'string', description: 'The unique ID of the memory to delete', required: true },
    ],
  },
];

const memoryToolModule: ToolModule = {
  name: 'personas',
  tools: MEMORY_TOOLS,
  register(registry: ToolRegistry, ctx: ToolContext) {
    const memoryStore = ctx.getAgent()?.getMemoryStore();

    registry.register('save_memory', async (args) => {
      if (!memoryStore) return { toolName: 'save_memory', success: false, error: 'Memory store not initialized', duration: 0 };
      
      const contactId = String(args.contactId || '');
      const category = String(args.category || '');
      const key = String(args.key || '');
      const value = String(args.value || '');

      if (!contactId || !category || !key || !value) {
        return { toolName: 'save_memory', success: false, error: 'Missing required parameters (contactId, category, key, value)', duration: 0 };
      }

      // Allowed categories to prevent polluting system tables
      const allowedCategories = ['identity', 'preference', 'fact', 'relationship', 'note'];
      if (!allowedCategories.includes(category)) {
        return { toolName: 'save_memory', success: false, error: `Invalid category. Must be one of: ${allowedCategories.join(', ')}`, duration: 0 };
      }

      try {
        const memory = memoryStore.saveMemory(
          contactId,
          category,
          key,
          value,
          'manual_tool',
          1.0
        );
        return { 
          toolName: 'save_memory', 
          success: true, 
          result: `Saved memory fact to ${contactId === '__owner__' ? 'your owner profile' : contactId}: [${category}] ${key} = ${value}. Memory ID: ${memory.id}`, 
          duration: 0 
        };
      } catch (err: any) {
        return { toolName: 'save_memory', success: false, error: `Failed to save memory: ${err.message}`, duration: 0 };
      }
    });

    registry.register('get_profile', async (args) => {
      if (!memoryStore) return { toolName: 'get_profile', success: false, error: 'Memory store not initialized', duration: 0 };
      
      const contactId = String(args.contactId || '');
      if (!contactId) return { toolName: 'get_profile', success: false, error: 'Missing required parameter: contactId', duration: 0 };

      try {
        const memories = memoryStore.getMemories(contactId);
        // Exclude internal system summaries like 'chat_digest' (but allow other summary types)
        const visibleMemories = memories.filter((m: any) => !(m.category === 'summary' && m.key === 'chat_digest'));
        
        if (visibleMemories.length === 0) {
          return { toolName: 'get_profile', success: true, result: `No profile data found for ${contactId}.`, duration: 0 };
        }

        const formatted = visibleMemories.map((m: any) => 
          `ID: ${m.id} | Category: ${m.category} | Key: ${m.key} | Value: ${m.value}`
        ).join('\n');

        return { 
          toolName: 'get_profile', 
          success: true, 
          result: `Found ${visibleMemories.length} facts for ${contactId}:\n${formatted}`, 
          duration: 0 
        };
      } catch (err: any) {
        return { toolName: 'get_profile', success: false, error: `Failed to get profile: ${err.message}`, duration: 0 };
      }
    });

    registry.register('delete_memory', async (args) => {
      if (!memoryStore) return { toolName: 'delete_memory', success: false, error: 'Memory store not initialized', duration: 0 };
      
      const memoryId = String(args.memoryId || '');
      if (!memoryId) return { toolName: 'delete_memory', success: false, error: 'Missing required parameter: memoryId', duration: 0 };

      try {
        const deleted = memoryStore.deleteMemory(memoryId);
        if (deleted) {
          return { toolName: 'delete_memory', success: true, result: `Successfully deleted memory ${memoryId}.`, duration: 0 };
        } else {
          return { toolName: 'delete_memory', success: false, error: `Memory ${memoryId} not found.`, duration: 0 };
        }
      } catch (err: any) {
        return { toolName: 'delete_memory', success: false, error: `Failed to delete memory: ${err.message}`, duration: 0 };
      }
    });
  },
};

export default memoryToolModule;