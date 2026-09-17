# Youbot Core

> The backend engine and API for Youbot — a self-hosted AI assistant.

This is the main application package containing the AI orchestrator, tool registry, messaging channels, integrations, and REST API.

## Stack

| Layer      | Technology                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Runtime    | Node.js (ES2022)                                                                                 |
| Language   | TypeScript (strict)                                                                              |
| LLM Client | OpenAI SDK (compatible with Gemini, Ollama, OpenAI, Anthropic)                                   |
| Database   | SQLite via `better-sqlite3`                                                                      |
| Messaging  | WhatsApp (`@whiskeysockets/baileys`), Telegram (`node-telegram-bot-api`), iMessage (BlueBubbles) |
| Browser    | Puppeteer                                                                                        |
| Scheduler  | `node-cron`                                                                                      |
| Email      | `nodemailer`                                                                                     |
| Testing    | Vitest                                                                                           |
| Web UI     | Next.js + shadcn/ui (in `web/`)                                                                  |

## Architecture

```
src/
├── index.ts              # HTTP server + app bootstrap
├── api/                  # REST API layer & context management
├── engine/               # Core AI engine
│   ├── orchestrator.ts   # Main agent loop: message → LLM → tools → response
│   ├── handler.ts        # Unified message handler (all channels)
│   ├── task-planner.ts   # Breaks down complex requests into steps
│   ├── crew-registry.ts  # Multi-agent crew management
│   ├── tool-router.ts    # Smart tool selection & semantic routing
│   └── prompt-builder/   # Dynamic system prompt construction
├── tools/                # Global tools registry and generic tools
├── agents/               # Multi-agent system sub-agents
│   ├── safety/           # Safety and guardrail enforcement agent
│   ├── skills/           # Skill execution agent
│   └── vault/            # Secure credential & memory agent
├── channels/             # Messaging channels
│   ├── whatsapp/         # WhatsApp (Baileys)
│   ├── telegram/         # Telegram (node-telegram-bot-api)
│   └── webchat/          # Next.js web dashboard socket
├── automation/           # Autonomous backend features
│   ├── scheduler/        # Cron-based task scheduler & reminders
│   ├── followups/        # Automated follow-up management
│   └── approvals/        # Owner permission approval flow
├── capabilities/         # External service integrations
│   ├── google/           # Google Workspace tools
│   ├── mcp/              # Model Context Protocol support
│   └── transcription/    # Audio transcription & TTS
├── memory/               # Short/Long-term storage
│   ├── soul.ts           # Evolving personality profiles
│   └── memory-store.ts   # Vector DB / SQLite memory
├── data/                 # SQLite database + config management
└── logger/               # Structured logging (Winston + Pino)
```

## Message Flow

```
Incoming Message (WhatsApp / Telegram / iMessage / Web)
    ↓
Unified Handler → detect owner vs visitor
    ↓
┌─────────────────┐    ┌──────────────────┐
│  Owner           │    │  Visitor          │
│  All 77 tools    │    │  ask_owner tool   │
│  Full access     │    │  Safety rules     │
└────────┬────────┘    └────────┬─────────┘
         ↓                      ↓
    Orchestrator (LLM loop)
         ↓
    Tool calls → Response
         ↓
    Soul extraction (update contact profiles)
```

## Development

```bash
# TypeScript check
npx tsc --noEmit

# Run tests
npx vitest run

# Watch mode
npx vitest

# Build backend
npm run build

# Build dashboard
cd web && npm run build
```

## Key Concepts

- **Orchestrator** — Multi-turn agent loop: message → LLM → tools → response
- **Multi-Agent Crew** — Complex tasks are delegated to specialized sub-agents (e.g. Vault Agent, Safety Agent, Skills Agent) coordinated by a crew registry.
- **Soul System** — Evolving personality profiles (bot soul, owner soul, contact souls)
- **Skill Engine** — User-created automations: Event → Trigger → Processor → Outcome
- **Tool Registry** — Modular tool system, each module exports a `ToolModule`
- **Safety Rules** — Configurable guardrails for content and actions
- **MCP Support** — Extend with any Model Context Protocol server

## License

MIT
