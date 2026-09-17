/**
 * Test Helpers for Tool Modules
 *
 * Reusable mock ToolRegistry + mock ToolContext for unit testing
 * any tool module in isolation.
 */

import type { ToolRegistry, ToolExecutor, ToolContext, ToolExecutionContext, ToolModule } from '../types.js';
import type { ToolCallResult, ToolExecutionResult } from '../../engine/types.js';

// ─── Mock Registry ───────────────────────────────────────

export interface MockRegistry extends ToolRegistry {
  /** All registered executors, keyed by tool name */
  executors: Map<string, ToolExecutor>;
  /** Execute a tool by name with args (convenience wrapper) */
  call(toolName: string, args?: Record<string, unknown>, execution?: ToolExecutionContext): Promise<ToolExecutionResult>;
  /** Get list of registered tool names */
  registeredNames(): string[];
}

export function createMockRegistry(): MockRegistry {
  const executors = new Map<string, ToolExecutor>();

  return {
    executors,

    register(toolName: string, executor: ToolExecutor): void {
      executors.set(toolName, executor);
    },

    has(toolName: string): boolean {
      return executors.has(toolName);
    },

    async execute(toolCall: ToolCallResult, execution?: ToolExecutionContext): Promise<ToolExecutionResult> {
      const executor = executors.get(toolCall.toolName);
      if (!executor) {
        return { toolName: toolCall.toolName, success: false, error: `Unknown tool: ${toolCall.toolName}`, duration: 0 };
      }
      return executor(toolCall.arguments || {}, execution);
    },

    async call(
      toolName: string,
      args: Record<string, unknown> = {},
      execution?: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      const executor = executors.get(toolName);
      if (!executor) {
        throw new Error(`Tool "${toolName}" not registered`);
      }
      return executor(args, execution);
    },

    registeredNames(): string[] {
      return [...executors.keys()];
    },

    unregister(toolName: string): boolean {
      return executors.delete(toolName);
    },
  };
}

// ─── Mock Context ────────────────────────────────────────

export interface MockContextOptions {
  /** If true, all service getters return null (simulates uninitialized state) */
  allNull?: boolean;
  /** Override specific services */
  overrides?: Partial<Record<keyof ToolContext, () => any>>;
}

/**
 * Create a mock ToolContext with configurable services.
 * By default, provides stub implementations of all services.
 * Pass `allNull: true` to simulate services being unavailable.
 */
export function createMockContext(opts: MockContextOptions = {}): ToolContext {
  const { allNull = false, overrides = {} } = opts;

  const defaults: ToolContext = {
    getDatabase: () => null,
    getMessagingRegistry: () => allNull ? null : createMockMessagingRegistry(),
    getScheduler: () => allNull ? null : createMockScheduler(),
    getApprovalStore: () => allNull ? null : createMockApprovalStore(),
    getSkillEngine: () => allNull ? null : createMockSkillEngine(),
    getWhatsApp: () => allNull ? null : createMockWhatsApp(),
    getTelegram: () => allNull ? null : createMockTelegram(),
    getAgent: () => allNull ? null : createMockAgent(),
    getEventBus: () => allNull ? null : createMockEventBus(),
    getWorkspacePath: () => allNull ? null : '/tmp/youbot-test-workspace',
    getCliService: () => null,
    getFollowUpStore: () => null,
    getSpawnedSessionStore: () => null,
    getWorkspaceProvider: () => null,
    getContactStore: () => null,
  };

  return {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v])
    ),
  } as ToolContext;
}

// ─── Stub Service Factories ──────────────────────────────

export function createMockMessagingRegistry() {
  const messages: any[] = [];
  const contacts = [
    { id: '1234567890@s.whatsapp.net', displayName: 'Test User', phone: '+1234567890' },
    { id: '0987654321@s.whatsapp.net', displayName: 'Jane Doe', phone: '+0987654321' },
  ];
  const conversations = [
    {
      id: '1234567890@s.whatsapp.net',
      contact: { displayName: 'Test User', phone: '+1234567890' },
      lastMessage: { body: 'Hello', timestamp: new Date() },
      unread: 1,
    },
  ];

  const makeProvider = (channel: string) => ({
    channel,
    status: 'connected',
    sendMessage: async (to: string, body: string) => {
      messages.push({ to, body, channel, timestamp: new Date() });
      return { id: `msg-${Date.now()}`, success: true };
    },
    searchMessages: async (_opts: any) => messages,
    getContacts: async (_query?: string) => contacts,
    getConversations: async (_limit?: number) => conversations,
    deleteMessage: async (_id: string) => true,
    replyToMessage: async (_id: string, _body: string) => ({ id: `reply-${Date.now()}` }),
    forwardMessage: async (_to: string, _text: string) => ({ id: `fwd-${Date.now()}` }),
    getConnectionStatus: () => ({ status: 'connected', channel }),
  });

  return {
    resolveProvider: (channel?: string) => makeProvider(channel || 'whatsapp'),
    getProvider: (name: string) => makeProvider(name),
    getAllProviders: () => [makeProvider('whatsapp')],
    getProviders: () => ['whatsapp'],
    _messages: messages,
  };
}

export function createMockScheduler() {
  const tasks: any[] = [];

  return {
    createTask: async (task: any) => {
      const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const t = { ...task, id, status: 'pending', createdAt: new Date(), nextRunAt: task.schedule?.startDate };
      tasks.push(t);
      return t;
    },
    listTasks: (filter?: any, _sort?: any) => {
      let filtered = tasks;
      if (filter?.status) filtered = filtered.filter(t => t.status === filter.status);
      return { tasks: filtered, total: filtered.length };
    },
    getStats: () => ({ totalTasks: tasks.length, runningTasks: 0, completedTasks: 0, failedTasks: 0 }),
    deleteTask: async (id: string) => {
      const idx = tasks.findIndex((t: any) => t.id === id);
      if (idx >= 0) { tasks.splice(idx, 1); return true; }
      return false;
    },
    runTaskNow: async (id: string) => {
      const task = tasks.find((t: any) => t.id === id);
      if (!task) return { success: false, error: 'Task not found', duration: 0 };
      return { success: true, duration: 100 };
    },
    _tasks: tasks,
  };
}

export function createMockApprovalStore() {
  const approvals: any[] = [];

  return {
    create: (data: any) => {
      const approval = { ...data, id: `approval-${Date.now()}`, status: 'pending', createdAt: new Date() };
      approvals.push(approval);
      return approval;
    },
    getPending: () => approvals.filter(a => a.status === 'pending'),
    getAll: () => approvals,
    getById: (id: string) => approvals.find(a => a.id === id) || null,
    resolve: (id: string, response: string) => {
      const a = approvals.find(ap => ap.id === id);
      if (a) { a.status = 'resolved'; a.response = response; }
      return a;
    },
    _approvals: approvals,
  };
}

export function createMockSkillEngine() {
  const skills: any[] = [
    {
      id: 'skill-1',
      name: 'Test Skill',
      description: 'A test skill',
      enabled: true,
      trigger: { events: ['whatsapp:message'], condition: undefined, filters: {} },
      processor: { instructions: 'Process incoming messages' },
      outcome: { action: 'reply', target: undefined },
    },
  ];

  return {
    getSkills: () => skills,
    getSkill: (id: string) => skills.find(s => s.id === id),
    saveSkill: (data: any) => {
      const skill = {
        ...data,
        id: `skill-${Date.now()}`,
        trigger: data.trigger || { events: ['whatsapp:message'], filters: {} },
        processor: data.processor || { instructions: '' },
        outcome: data.outcome || { action: 'reply' },
      };
      skills.push(skill);
      return skill;
    },
    updateSkill: (id: string, data: any) => {
      const idx = skills.findIndex(s => s.id === id);
      if (idx >= 0) { skills[idx] = { ...skills[idx], ...data }; return skills[idx]; }
      return null;
    },
    deleteSkill: (id: string) => {
      const idx = skills.findIndex(s => s.id === id);
      if (idx >= 0) { skills.splice(idx, 1); return true; }
      return false;
    },
    _skills: skills,
  };
}

export function createMockWhatsApp() {
  return {
    isConnected: true,
    sendMessage: async (_jid: string, _msg: any) => ({ key: { id: `wa-${Date.now()}` } }),
  };
}

export function createMockTelegram() {
  return {
    sendMessage: async (_chatId: number, _text: string) => ({ message_id: Date.now() }),
    botUsername: 'test_bot',
    botName: 'Test Bot',
  };
}

export function createMockAgent() {
  return {
    getConfig: () => ({
      ownerPhone: '1234567890',
      ownerTelegramId: '99999',
      ownerName: 'Test Owner',
      autoReplyWhatsApp: false,
      autoReplyTelegram: false,
      autoReplyContacts: [],
    }),
    updateConfig: (updates: any) => updates,
    getConversationStore: () => ({
      getOrCreateSession: () => ({}),
      addMessage: () => {},
      getSession: () => null,
    }),
    getMemoryStore: () => ({
      getMemories: () => [],
      saveMemory: () => ({ id: 'mem-1' }),
      deleteMemory: () => true,
    }),
    getSoul: () => ({
      listPersonas: () => [],
      getDocument: () => '',
      saveDocument: () => {},
      deleteDocument: () => true,
    }),
    chat: async () => ({ content: 'Mock response', toolCalls: [] }),
    generate: async () => 'Generated text',
  };
}

export function createMockEventBus() {
  const listeners: any[] = [];
  return {
    on: (fn: any) => listeners.push(fn),
    emit: async (event: any) => {
      for (const fn of listeners) await fn(event);
    },
    _listeners: listeners,
  };
}

// ─── Test Helpers ────────────────────────────────────────

/**
 * Register a module and return all its executor names.
 */
export function registerModule(mod: ToolModule, ctx?: ToolContext): MockRegistry {
  const registry = createMockRegistry();
  mod.register(registry, ctx || createMockContext());
  return registry;
}

/**
 * Assert a tool result is successful.
 */
export function expectSuccess(result: ToolExecutionResult): void {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${result.error}`);
  }
}

/**
 * Assert a tool result is a failure with an expected error message substring.
 */
export function expectError(result: ToolExecutionResult, substring?: string): void {
  if (result.success) {
    throw new Error(`Expected error but got success: ${result.result}`);
  }
  if (substring && !result.error?.includes(substring)) {
    throw new Error(`Expected error containing "${substring}" but got: ${result.error}`);
  }
}
