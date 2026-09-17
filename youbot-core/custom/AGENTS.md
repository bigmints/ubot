# Building Custom Capabilities for YOUBOT

This guide explains how to build new capabilities (apps and integrations) for YOUBOT using the custom module system. Custom modules live in `custom/modules/` and are **automatically discovered, loaded, and registered** at startup — no core code changes needed.

---

## Architecture Overview

```
custom/
├── AGENTS.md              ← You are here
├── tsconfig.json           ← TypeScript config (extends root)
├── templates/
│   └── tool-module.ts.tmpl ← Starter boilerplate
├── staging/                ← Modules under development / testing
│   └── my-module/
└── modules/                ← Live modules (auto-loaded on startup)
        ├── index.ts        ← Entry point (must export default ToolModule)
        ├── tools.ts        ← Tool definitions + executors
        └── client.ts       ← HTTP client / business logic
```

### How It Works

1. On startup, YOUBOT scans `custom/modules/` for directories containing an `index.ts`
2. Each module is dynamically imported and validated against the `ToolModule` interface
3. Valid modules have their tools registered into the live tool registry
4. If the module includes a `ui` property, a sidebar menu item is **automatically injected** into the dashboard
5. The LLM can immediately use the registered tools — no restart needed for staging → modules promotion

### Lifecycle: Staging → Live

| Directory          | Purpose                                    |
|--------------------|---------------------------------------------|
| `custom/staging/`  | Development sandbox. Not auto-loaded.        |
| `custom/modules/`  | Production. Auto-discovered and loaded.      |

Use `custom_module_promote` tool (via CLI agent) to copy from staging to modules and hot-reload.

---

## Quick Start: Create a New Module

### 1. Create the module directory

```bash
mkdir -p custom/modules/my-app
```

### 2. Create `index.ts` (entry point)

```typescript
// custom/modules/my-app/index.ts
import myAppModule from './tools.js';
export default myAppModule;
```

### 3. Create `tools.ts` (tools + executors)

```typescript
// custom/modules/my-app/tools.ts
import type {
  ToolModule,
  ToolRegistry,
  ToolContext,
  ToolDefinition,
} from '../../../src/tools/types.js';

// ── Tool Definitions (exposed to the LLM) ──────────────

const TOOLS: ToolDefinition[] = [
  {
    name: 'myapp_items_list',
    description: 'List all items in MyApp.',
    parameters: [],
  },
  {
    name: 'myapp_item_create',
    description: 'Create a new item.',
    parameters: [
      { name: 'title', type: 'string', description: 'Item title', required: true },
      { name: 'tags',  type: 'string', description: 'Comma-separated tags', required: false },
    ],
  },
];

// ── Tool Executors (implementation) ─────────────────────

function registerExecutors(registry: ToolRegistry): void {
  const safe = (
    toolName: string,
    fn: (args: Record<string, unknown>) => Promise<string>,
  ) => {
    registry.register(toolName, async (args) => {
      try {
        const result = await fn(args);
        return { toolName, success: true, result, duration: 0 };
      } catch (err: any) {
        console.error(`[MyApp] ${toolName} error:`, err.message);
        return { toolName, success: false, error: err.message, duration: 0 };
      }
    });
  };

  safe('myapp_items_list', async () => {
    // Call your API, query a DB, etc.
    return 'No items yet.';
  });

  safe('myapp_item_create', async (args) => {
    const title = String(args.title);
    return `Created item: ${title}`;
  });
}

// ── Module Export ────────────────────────────────────────

const myAppModule: ToolModule = {
  name: 'my-app',
  tools: TOOLS,
  register(registry: ToolRegistry, _ctx: ToolContext) {
    registerExecutors(registry);
  },

  // ── UI Manifest (optional) ────────────────────────────
  // If provided, a sidebar menu item is auto-injected into the dashboard.
  ui: {
    title: 'My App',       // Sidebar label
    icon: 'Sparkles',      // Lucide icon name (see list below)
    href: '/my-app',       // Frontend route (must match web/app/my-app/page.tsx)
    group: 'Capabilities', // Sidebar group (default: "Capabilities")
  },
};

export default myAppModule;
```

### 4. (Optional) Create `client.ts` for API integrations

```typescript
// custom/modules/my-app/client.ts

const BASE_URL = process.env.MYAPP_BASE_URL || 'http://localhost:3000';
const API_TOKEN = process.env.MYAPP_API_TOKEN || '';

export async function apiGet(path: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`MyApp API error: ${resp.status}`);
  return resp.json();
}

export async function apiPost(path: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`MyApp API error: ${resp.status}`);
  return resp.json();
}
```

### 5. (Optional) Create a frontend page

If your module has a `ui.href` of `/my-app`, create a Next.js page at:

```
web/app/my-app/page.tsx
```

> **Note:** Add `web/app/my-app/` to `.gitignore` if you don't want it tracked in the public repo.

---

## ToolModule Interface Reference

```typescript
interface ToolModule {
  /** Unique module name (e.g. 'my-app') */
  name: string;

  /** Tool definitions — the LLM reads these to decide when to call your tools */
  tools: ToolDefinition[];

  /** Wire up executor functions for each tool */
  register(registry: ToolRegistry, ctx: ToolContext): void;

  /** Optional: auto-inject a sidebar menu item into the dashboard */
  ui?: {
    title: string;    // Display name in sidebar
    icon: string;     // Lucide icon name
    href: string;     // Frontend route path
    group?: string;   // Sidebar group (default: "Capabilities")
  };
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}
```

---

## ToolContext — Accessing YOUBOT Services

The `ctx` argument passed to `register()` gives you access to core YOUBOT services:

| Method                      | Returns           | Use Case                                    |
|-----------------------------|-------------------|---------------------------------------------|
| `ctx.getAgent()`            | AgentOrchestrator | Send messages through the AI agent           |
| `ctx.getScheduler()`        | TaskScheduler     | Schedule recurring tasks                     |
| `ctx.getSkillEngine()`      | SkillEngine       | Run or manage skills                         |
| `ctx.getWorkspacePath()`    | string            | Get the workspace directory path             |
| `ctx.getMessagingRegistry()`| MessagingRegistry | Send messages via WhatsApp/Telegram          |
| `ctx.getWhatsApp()`         | WhatsAppConnection| Direct WhatsApp access                      |
| `ctx.getTelegram()`         | TelegramConnection| Direct Telegram access                      |
| `ctx.getEventBus()`         | EventBus          | Emit/listen to system events                 |
| `ctx.getApprovalStore()`    | ApprovalStore     | Create approval workflows                   |
| `ctx.getFollowUpStore()`    | FollowUpStore     | Schedule follow-up messages                  |
| `ctx.getCliService()`       | CliService        | Interact with CLI agent sessions             |

---

## Available Lucide Icons for `ui.icon`

Use any of these icon names in your module's `ui.icon` property:

| Icon Name       | Visual        | Good For                  |
|-----------------|---------------|---------------------------|
| `Sparkles`      | ✨            | AI, magic, creative tools  |
| `Bot`           | 🤖            | AI agents, automation      |
| `Globe`         | 🌐            | Web services, APIs         |
| `Database`      | 🗄️            | Data, storage              |
| `FolderOpen`    | 📂            | File management            |
| `Plug`          | 🔌            | Integrations, connectors   |
| `Search`        | 🔍            | Search, discovery          |
| `Calendar`      | 📅            | Scheduling, events         |
| `Terminal`      | 💻            | CLI, developer tools       |
| `Zap`           | ⚡            | Automation, speed          |
| `Apple`         | 🍎            | Apple services             |

---

## Environment Variables

Custom modules can read environment variables for API keys and config.
Define them in your `.env` file:

```bash
# .env (gitignored)
MYAPP_BASE_URL=https://api.myapp.com
MYAPP_API_TOKEN=sk-abc123
```

Access them in your module:
```typescript
const BASE_URL = process.env.MYAPP_BASE_URL || 'http://localhost:3000';
```

---

## Best Practices

### Naming Conventions

| What            | Convention                    | Example                    |
|-----------------|-------------------------------|----------------------------|
| Module dir      | lowercase kebab-case          | `custom/modules/my-app/`   |
| Module name     | kebab-case                    | `name: 'my-app'`          |
| Tool names      | snake_case, prefixed          | `myapp_items_list`         |
| Tool descriptions | Clear, action-oriented      | `'List all items in MyApp'`|

### Tool Design

1. **Prefix all tool names** with your module name to avoid collisions: `myapp_`, `xtara_`, etc.
2. **Descriptions matter** — the LLM reads them to decide when to call your tool. Be specific.
3. **Return strings** — tool results are passed back to the LLM as text. Format them readably.
4. **Handle errors gracefully** — always catch and return `{ success: false, error: message }`.
5. **Keep tools focused** — one tool per action. Don't make Swiss Army knife tools.

### Security

- Never hardcode secrets — use environment variables
- Validate all inputs from the LLM (they can be arbitrary strings)
- Use the `safe()` wrapper pattern to catch all errors consistently

---

