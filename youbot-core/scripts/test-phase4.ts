import { createConnection, createDefaultConfig } from '../src/data/database/connection.js';
import { createConversationStore } from '../src/memory/conversation.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createFollowUpStore } from '../src/memory/followups.js';
import { createSoul } from '../src/memory/soul.js';
import { createAgentOrchestrator } from '../src/engine/orchestrator.js';
import { DEFAULT_AGENT_CONFIG } from '../src/engine/types.js';

import { loadYoubotConfig } from '../src/data/config.js';

async function main() {
  console.log("🛠️  Initializing core dependencies...");
  const config = loadYoubotConfig();
  
  console.log("🛠️  Initializing mocks for test environment...");
  // Use pure in-memory mocks to test engine logic rapidly
  const conversationStore = {
    getHistory: async () => [],
    addMessage: async () => ({}),
    getOrCreateSession: async (id: string) => ({ id, name: id })
  } as any;
  const memoryStore = { 
    getMemories: async () => [],
    getDocument: async () => null,
    saveDocument: async () => {},
    saveKnowledge: async () => {} 
  } as any;
  const followUpStore = { getFollowUp: async () => null } as any;
  const db = { 
    get_client: () => null,
    on: () => {},
    off: () => {}
  } as any;
  
  // Minimal mocks
  const mockWorkspace = { rootPath: './workspace' };
  const soul = createSoul(memoryStore, './workspace', mockWorkspace as any);
  const mockSkillRepo = { getSkill: () => null, listSkills: () => [] };
  const mockSkillEngine = { executeSkill: async () => ({}) };

  console.log("🤖 Initializing Multi-Agent Orchestrator (Nexus)...");
  const agent = createAgentOrchestrator(
    DEFAULT_AGENT_CONFIG,
    conversationStore,
    memoryStore,
    followUpStore,
    soul,
    db as any,
    './workspace',
    mockSkillRepo as any,
    mockSkillEngine as any
  );

  console.log("================================================");
  console.log("📨 Sending Owner Task Request: 'Write a python script that needs T2 Coder approval'");
  console.log("================================================\n");

  const response = await agent.chat(
    'nexus-test-session', 
    'Please write a complex Python API using the coder agent.', 
    'web', 
    'Owner', 
    true // isOwner = true
  );

  console.log("\n================================================");
  console.log("✅ AGENT RESPONSE:");
  console.log(response.response);
  console.log("================================================");
  
  const history = await conversationStore.getHistory('nexus-test-session');
  console.log("Message History Count:", history.length);
}

main().catch(console.error);
