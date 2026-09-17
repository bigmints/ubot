# Youbot Core — Agent Instructions

Current product/planning guidance (2026-09-14): Youbot is an owner-configured concierge serving visitors. Root `AGENTS.md` defines Factory authority and Spacecrew integration. Read `../docs/collections/README.md` for the conversational collections proposal and assigned work; it is not yet implemented. Preserve the visitor inbox and do not restore a general owner-chat dashboard as part of content authoring.

> Personal AI assistant platform — manages messaging, automation, and contacts
> across WhatsApp, Telegram, iMessage, and web.
> Last updated: 2026-04-04

## ⛔ THIS IS THE PRIMARY REPOSITORY — ALL CHANGES GO HERE

**This repo is the single source of truth for ALL YOUBOT code.**

SaveADay (`saveaday/apps/youbot/`) is a downstream mirror synced via git subtree.
- ALL core changes (engine, UI, tools, channels, API) MUST be made HERE
- SaveADay syncs FROM here using `/sync-youbot-upstream`
- ALL behavioral differences are driven by `config.json`, NOT code forks
- NEVER add `if (isSaveADay)` or similar checks — use config and extension hooks

## Stack

| Layer              | Technology                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js (ES2022)                                                                                          |
| Language           | TypeScript (strict)                                                                                       |
| Package Manager    | npm                                                                                                       |
| LLM Client         | OpenAI SDK (compatible with Gemini, Ollama, OpenAI)                                                       |
| Database           | SQLite via `better-sqlite3`                                                                               |
| Messaging          | WhatsApp (`@whiskeysockets/baileys`), Telegram (`node-telegram-bot-api`), iMessage (BlueBubbles REST API) |
| Browser Automation | Puppeteer                                                                                                 |
| Scheduler          | `node-cron`                                                                                               |
| Email              | `nodemailer`                                                                                              |
| Logging            | Winston + Pino + Ring Buffer                                                                              |
| Testing            | Vitest                                                                                                    |
| Linter             | ESLint                                                                                                    |
| CSS                | Tailwind CSS v4                                                                                           |
| Web UI             | Next.js + shadcn/ui (separate `web/` directory)                                                           |
| CLI                | Bash (`cli/youbot`)                                                                                         |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     HTTP Server (:11490)                         │
│  src/index.ts — serves static files + routes /api/* to api      │
├─────────────────────────────────────────────────────────────────┤
│                    REST API (api/index.ts)                       │
│  All /api/* endpoints — config, chat, WhatsApp, Telegram,       │
│  skills, scheduler, safety, personas, approvals, Google         │
├─────────────┬───────────────┬───────────────────────────────────┤
│  Unified    │   Agent       │   Skill Engine                    │
│  Message    │   Orchestrator│   Event → Trigger → Processor     │
│  Handler    │   (LLM loop)  │   → Outcome                      │
├─────────────┴───────────────┴───────────────────────────────────┤
│  Tool Registry (tools/)                                          │
│  77 tools across 10 modules: messaging, approvals,                │
│  web-search, skills, browser, scheduler, google, cli, files,      │
│  memory                                                           │
├──────────────┬───────────────┬──────────────────────────────────┤
│  WhatsApp    │  Telegram     │  iMessage (BlueBubbles)          │
│  Connection  │  Connection   │  Connection                      │
├──────────────┴───────────────┴──────────────────────────────────┤
│  Google Workspace  │  Filesystem (allowed_paths)                │
├──────────────┴───────────────┴──────────────────────────────────┤
│  SQLite Database  │  Soul (Personas)  │  Memory Store           │
└───────────────────┴───────────────────┴─────────────────────────┘
```

## Project Structure

```
youbot/                                  # Monorepo root
├── Makefile                           # Build + install pipeline
├── start.sh                           # Dev mode launcher (backend :4081 + web :4080)
├── stop.sh                            # Dev mode stopper
├── cli/                               # CLI packaging
│   ├── youbot                           # CLI entry point (start/stop/status/logs/version)
│   └── default-config.json            # Default config template
│
├── youbot-core/                         # Main application
│   ├── package.json
│   ├── tsconfig.json                  # ES2022, NodeNext modules, strict
│   ├── vitest.config.ts
│   │
│   ├── src/
│   │   ├── index.ts                   # HTTP server, app bootstrap, static file serving
│   │   ├── types.ts                   # Shared top-level types
│   │   │
│   │   ├── api/                       # REST API layer
│   │   │   ├── index.ts               # State management, initialization, channel routes
│   │   │   ├── context.ts             # Shared ApiContext type + utility functions
│   │   │   └── routes/                # Route handlers (split from monolithic index.ts)
│   │   │       ├── chat.ts            # /api/chat/*, /api/llm-providers/*
│   │   │       ├── skills.ts          # /api/skills/*
│   │   │       ├── safety.ts          # /api/safety/*
│   │   │       ├── memory.ts          # /api/personas/*, /api/memories/*, /api/scheduler/*, /api/approvals/*
│   │   │       ├── integrations.ts    # /api/google/*
│   │   │       └── cli.ts             # /api/cli/* (status, toggle, install, auth, sessions)
│   │   │
│   │   ├── engine/                    # Core AI engine
│   │   │   ├── orchestrator.ts        # Main agent loop: message → LLM → tools → response
│   │   │   ├── handler.ts             # Unified message handler (all channels → single pipeline)
│   │   │   ├── llm.ts                 # LLM API client wrapper
│   │   │   ├── tools.ts               # Tool formatting + registry factory
│   │   │   ├── types.ts               # Engine types (AgentConfig, ToolDefinition, etc.)
│   │   │   ├── prompt-builder/        # System prompt construction
│   │   │   │   ├── builder.ts         # Dynamic system prompts with variable interpolation
│   │   │   │   ├── templates.ts       # Prompt templates
│   │   │   │   └── types.ts
│   │   │   └── agents/                # Agent utility types
│   │   │       └── types.ts
│   │   │
│   │   ├── memory/                    # Memory, identity & state management
│   │   │   ├── soul.ts                # Soul module — personas, identity docs
│   │   │   ├── conversation.ts        # Conversation session storage
│   │   │   ├── memory-store.ts        # Key-value memory store
│   │   │   └── pending-approvals.ts   # Owner approval request queue
│   │   │
│   │   ├── tools/                     # Modular tool registry (LLM-callable functions)
│   │   │   ├── registry.ts            # Central tool registry + module loader
│   │   │   ├── types.ts               # ToolModule, ToolRegistry interfaces
│   │   │   ├── messaging.ts           # 8 tools: send, search, contacts, conversations, etc.
│   │   │   ├── approvals.ts           # 3 tools: ask_owner, respond, list_pending
│   │   │   ├── web-search.ts          # 1 tool: web_search (SearXNG + Puppeteer fallback)
│   │   │   ├── skills.ts              # 4 tools: CRUD skills
│   │   │   ├── browser.ts             # 8 tools: browse, click, type, read, screenshot, etc.
│   │   │   ├── scheduler.ts           # 6 tools: schedule, remind, list, delete, trigger, set_auto_reply
│   │   │   ├── google.ts              # 29 tools: Gmail, Drive, Sheets, Docs, Contacts, Calendar, Places
│   │   │   ├── files.ts               # 5 tools: read, write, list, delete, search (sandbox + allowed_paths)
│   │   │   ├── memory.ts              # 3 tools: store, recall, manage memory
│   │   │   └── cli.ts                 # 10 tools: cli_run, cli_status, cli_stop, cli_list_sessions, cli_send_input, etc.

│   │   ├── channels/                  # Messaging channels (bidirectional chat pipes)
│   │   │   ├── registry.ts            # Provider registry (WhatsApp, Telegram, iMessage)
│   │   │   ├── types.ts               # MessagingProvider, ChannelType, Message interfaces
│   │   │   ├── whatsapp/              # WhatsApp (Baileys)
│   │   │   │   ├── connection.ts      # QR auth + session management
│   │   │   │   ├── adapter.ts         # Message format adapter
│   │   │   │   ├── messaging-provider.ts
│   │   │   │   ├── rate-limiter.ts    # Anti-ban rate limiting
│   │   │   │   ├── types.ts
│   │   │   │   └── utils.ts
│   │   │   ├── telegram/              # Telegram (node-telegram-bot-api)
│   │   │   │   ├── connection.ts
│   │   │   │   ├── messaging-provider.ts
│   │   │   │   └── types.ts
│   │   │   └── imessage/              # iMessage (BlueBubbles REST API)
│   │   │       ├── connection.ts      # HTTP connection to BlueBubbles server
│   │   │       ├── messaging-provider.ts  # Platform-agnostic messaging provider
│   │   │       ├── types.ts           # BlueBubbles config, message, chat, handle types
│   │   │       └── index.ts
│   │   │
│   │   ├── integrations/              # External service integrations (API-based)
│   │   │   ├── registry.ts            # IntegrationRegistry
│   │   │   ├── types.ts               # Integration, IntegrationType interfaces
│   │   │   ├── google/                # Google Workspace APIs (OAuth2)
│   │   │   │   ├── auth.ts            # OAuth2 flow + token management
│   │   │   │   ├── gmail.ts
│   │   │   │   ├── calendar.ts
│   │   │   │   ├── drive.ts
│   │   │   │   ├── sheets.ts
│   │   │   │   ├── docs.ts
│   │   │   │   ├── contacts.ts
│   │   │   │   └── places.ts

│   │   │
│   │   ├── capabilities/              # Built-in system capabilities
│   │   │   ├── browser/               # Puppeteer browser automation
│   │   │   │   └── service.ts         # BrowserService class with self-healing
│   │   │   ├── scheduler/             # Task scheduler (cron-based)
│   │   │   │   ├── service.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── utils.ts
│   │   │   └── skills/                # Universal Skill Engine (user-created automations)
│   │   │       ├── skill-engine.ts    # Event → Trigger → Processor → Outcome
│   │   │       ├── skill-types.ts
│   │   │       ├── skill-repository.ts
│   │   │       ├── service.ts
│   │   │       ├── event-bus.ts       # Pub/sub for skill triggers
│   │   │       ├── browsing-playbooks.ts
│   │   │       ├── memory/            # Skill memory subsystem
│   │   │       ├── file-management/   # File operations skill
│   │   │       └── web-search/        # Web search skill
│   │   │   └── cli/                   # CLI agent integration
│   │   │       ├── service.ts         # CliService (session management, install, auth)
│   │   │       ├── types.ts           # CLI types, provider binaries, packages
│   │   │       ├── custom-loader.ts   # Dynamic loader for custom tool modules
│   │   │       └── test-pipeline.ts   # Test/promote/delete pipeline for custom modules
│   │   │
│   ├── custom/                        # Custom tool modules (CLI-generated)
│   │   ├── tsconfig.json              # TypeScript config for custom modules
│   │   ├── templates/                 # Boilerplate templates for CLI agents
│   │   │   └── tool-module.ts.tmpl    # ToolModule boilerplate with proper types
│   │   ├── staging/                   # Modules being built/tested (not yet live)
│   │   └── modules/                   # Promoted live modules (hot-loaded at startup)
│   │   │
│   │   ├── data/                      # Data & persistence
│   │   │   ├── database/              # SQLite connection + migrations
│   │   │   │   ├── connection.ts
│   │   │   │   ├── migrations.ts
│   │   │   │   └── types.ts
│   │   │   └── config/                # Configuration management
│   │   │       ├── index.ts
│   │   │       └── types.ts
│   │   │
│   │   ├── safety/                    # Safety rules & guardrails
│   │   │   ├── service.ts
│   │   │   ├── types.ts
│   │   │   └── utils.ts
│   │   │
│   │   ├── logger/                    # Logging
│   │   │   ├── index.ts
│   │   │   ├── ring-buffer.ts         # In-memory log ring buffer
│   │   │   └── types.ts
│   │   │
│   │   └── metrics/                   # Runtime metrics
│   │       └── index.ts
│   │
│   ├── web/                           # Next.js shadcn/ui Dashboard
│   │   ├── app/
│   │   │   ├── page.tsx               # Home / dashboard
│   │   │   ├── chat/page.tsx          # Chat console
│   │   │   ├── personas/page.tsx      # Persona management
│   │   │   ├── skills/page.tsx        # Skills CRUD
│   │   │   ├── scheduler/page.tsx     # Scheduled tasks
│   │   │   ├── safety/page.tsx        # Safety rules
│   │   │   ├── settings/page.tsx      # App settings
│   │   │   ├── whatsapp/page.tsx      # WhatsApp connection
│   │   │   ├── telegram/page.tsx      # Telegram bot
│   │   │   ├── google/page.tsx        # Google Apps
│   │   │   ├── approvals/page.tsx     # Owner approvals
│   │   │   ├── cli/page.tsx           # CLI agent configuration & monitoring
│   │   │   └── logs/page.tsx          # Log viewer
│   │   └── components/
│   │       ├── app-sidebar.tsx
│   │       └── ui/                    # shadcn/ui primitives
│   │
│   └── public/                        # Static assets
│
└── ~/.youbot/                           # Runtime directory (created by CLI)
    ├── config.json                    # Unified config (LLM, port, etc.)
    ├── lib/                           # Compiled backend (from dist/)
    ├── web/                           # Static web export
    ├── data/youbot.db                   # SQLite database
    ├── logs/youbot.log                  # Application logs
    ├── sessions/                      # WhatsApp session data
    ├── creds/                         # Google OAuth tokens
    └── browser-profile/               # Puppeteer user data
```

## Architecture Taxonomy

Youbot's architecture is organized into 5 clearly defined layers:

| Layer           | Definition                                                              | Location                   | Examples                                          |
| --------------- | ----------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| **Channel**     | Bidirectional communication pipe through which users interact with youbot | `src/channels/`            | WhatsApp, Telegram, iMessage                      |
| **Integration** | Connection to an external third-party service via API                   | `src/integrations/`        | Google Workspace                                  |
| **Capability**  | Built-in system capability that powers tools (internal)                 | `src/capabilities/`        | Browser (Puppeteer), Scheduler, Skill Engine, CLI |
| **Tool**        | LLM-callable function exposed to the AI engine                          | `src/tools/`               | `send_message`, `gmail_search`, `browse_url`      |
| **Skill**       | User-created automation rule (Event→Trigger→Processor→Outcome)          | `src/capabilities/skills/` | "Auto-reply to John", "Forward invoices"          |

## Key Concepts

### Agent Orchestrator (`src/engine/orchestrator.ts`)

The core AI loop: receives a message → builds a system prompt (with soul context) → calls the LLM with tool definitions → executes tool calls → returns response. Supports multi-turn tool calling (up to `maxToolIterations`).

### Unified Message Handler (`src/engine/handler.ts`)

All channels (WhatsApp, Telegram, iMessage, web) normalize their messages into a `UnifiedMessage` and pass through `handleIncomingMessage()`. This is the single source of truth for owner detection, session routing, approval handling, and skill event emission.

### Tool Registry (`src/tools/registry.ts`)

Modular tool system. Each module (e.g., `messaging.ts`, `google.ts`) exports a `ToolModule` with tool definitions and executor registrations. The registry loads all modules at boot, providing tools to the LLM.

### Soul Module (`src/engine/soul.ts`)

Youbot's identity and memory system. Three document types:

1. **Bot Soul** (`__bot__`) — personality, tone, boundaries
2. **Owner Soul** (`__owner__`) — owner profile, preferences, context
3. **Contact Souls** — auto-updated profiles for each contact

Each contact has a **three-layer data architecture**:

- **Persona layer** — qualitative YAML document (personality, preferences, relationship context)
- **Chat history layer** — structured conversation logs stored in SQLite
- **Personal details layer** — key-value facts (birthday, phone, etc.) for quick retrieval

### Skill Engine (`src/capabilities/skills/skill-engine.ts`)

User-created automations following: **Event → Trigger → Processor → Outcome**

- **Two-phase matching**: Phase 1 = fast filters (contacts, groups, pattern), Phase 2 = LLM intent check
- **Outcomes**: reply (to sender), send (to target), store (save), silent (tools handled it)
- Skills are stored in SQLite, not in code

### Tool Modules (`src/tools/`)

| Module       | Tools | Description                                                                                                                                            |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `messaging`  | 8     | send, search, contacts, conversations, delete, reply                                                                                                   |
| `approvals`  | 3     | ask_owner, respond, list_pending                                                                                                                       |
| `web-search` | 1     | web_search (SearXNG + Puppeteer fallback)                                                                                                              |
| `skills`     | 4     | CRUD skills                                                                                                                                            |
| `browser`    | 8     | browse, click, type, read, screenshot, scroll, emails                                                                                                  |
| `scheduler`  | 6     | schedule, remind, list, delete, trigger, auto_reply                                                                                                    |
| `google`     | 29    | Gmail, Drive, Sheets, Docs, Contacts, Calendar, Places                                                                                                 |
| `files`      | 5     | read_file, write_file, list_files, delete_file, search_files (workspace + allowed_paths)                                                               |
| `memory`     | 3     | store, recall, manage memories and personas                                                                                                            |
| `cli`        | 10    | cli_run, cli_status, cli_stop, cli_list_sessions, cli_send_input, cli_test_module, cli_promote_module, cli_list_modules, cli_triage, cli_delete_module |
| `custom_*`   | var.  | CLI-generated custom modules — hot-loaded from `custom/modules/`                                                                                       |

### Owner Approval System (`src/engine/pending-approvals.ts`)

When a third-party asks something sensitive, the bot escalates via `ask_owner` tool. The owner sees pending approvals in the dashboard and can respond.

### Custom Capabilities Pipeline (Self-Extending Architecture)

YOUBOT can autonomously extend itself with new tools. The pipeline is:

```
User request → Agent tries existing tools → Can't handle it?
                                              ↓
                                     AUTO-TRIAGE (fallback)
                                     Checks all 78+ tools
                                              ↓
                              ┌───────┬───────┬───────┐
                           EXISTS   SKILL   TOOL   REJECT
                              │       │       │       │
                           Use it  Create   Build   Explain
                           directly skill   module  why not
                                            ↓
                                   cli_run (in custom/staging/)
                                            ↓
                                   cli_test_module (tsc + shape)
                                            ↓
                                   cli_promote_module (hot-load)
                                            ↓
                                   Tool immediately available ✅
```

**Key files:**

- `src/engine/orchestrator.ts` — Fallback triage wired into the chat loop (line ~505)
- `src/tools/cli.ts` — All CLI tools including `cli_triage`, `cli_delete_module`
- `src/capabilities/cli/custom-loader.ts` — Dynamic module discovery, loading, validation, hot-reload
- `src/capabilities/cli/test-pipeline.ts` — Test, promote, delete, list modules
- `custom/templates/tool-module.ts.tmpl` — Boilerplate for CLI agents
- `custom/tsconfig.json` — TypeScript config for custom modules (extends main tsconfig)

**Triage verdicts:**
| Verdict | Meaning | Action |
|---------|---------|--------|
| EXISTS | Tools already handle this | Use them directly |
| SKILL | Composable from existing tools | Create skill with stages |
| TOOL | Genuinely new capability | Build via CLI pipeline |
| REJECT | Impossible or out of scope | Explain why |

**Auto-triage trigger:** When the LLM responds with "I can't" / "not available" / "no tool" without calling any tools, the orchestrator automatically invokes `cli_triage` and feeds the result back to the LLM for reconsideration.

## CLI & Installation

```bash
# From source
git clone https://github.com/Bigmints-com/ubot.git
cd youbot && make deps
make install         # Builds + installs to ~/.youbot + CLI to ~/.local/bin

# Manage
youbot start           # Start on port 11490
youbot stop            # Graceful shutdown
youbot status          # Show PID, port, dashboard URL
youbot logs            # Last 50 log lines
youbot logs -f         # Follow logs
youbot version         # Version info
```

Config: `~/.youbot/config.json` — LLM provider, port, API keys.

## Conventions

- **Build & Install**: `make install` (builds backend + web UI, installs to `~/.youbot`)
- **Development**: `./start.sh` (backend on :4081 + Next.js UI on :4080 with hot reload)
- **Production**: `youbot start` (runs from `~/.youbot/lib/` on port 11490)
- **Test**: `npx vitest run`
- **Lint**: `npx eslint .`
- TypeScript strict mode — no `any` where avoidable
- Factory pattern for modules: `createXxx()` returns an interface (no classes)
- All messaging goes through `engine/handler.ts` — never handle messages directly in adapters
- Skills are stored in DB, not in code — use CRUD APIs
- Config in `~/.youbot/config.json` (production) or `.env` (development)
- Database migrations in `data/database/migrations.ts` and inline in modules
- Copy compiled code with `rm -rf lib && cp -R dist lib` (macOS `cp -r` doesn't reliably overwrite)

## Environment Variables

| Variable         | Description                       | Default            |
| ---------------- | --------------------------------- | ------------------ |
| `PORT`           | Backend HTTP port                 | `11490`            |
| `LLM_BASE_URL`   | OpenAI-compatible API endpoint    | Gemini API         |
| `LLM_MODEL`      | Model name                        | `gemini-2.0-flash` |
| `LLM_API_KEY`    | API key for LLM provider          | —                  |
| `GOOGLE_API_KEY` | Google API key (fallback for LLM) | —                  |
| `DATABASE_PATH`  | SQLite database file path         | `./data/youbot.db`   |
| `NODE_ENV`       | Environment mode                  | `development`      |
| `YOUBOT_HOME`      | Runtime directory override        | `~/.youbot`          |
