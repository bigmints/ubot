<p align="center">
  <img src="youbot-core/web/public/youbot.svg" width="80" alt="Youbot Logo" />
</p>

<h1 align="center">Youbot</h1>
<p align="center"><strong>Your AI concierge for visitors</strong></p>
<p align="center">
  Open-source, self-hosted concierge that helps visitors on behalf of you or your organization.<br/>
  Runs locally. Privacy-first. Extensible via MCP.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%E2%89%A522-green" alt="Node.js ≥22" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" /></a>
</p>

---

## Start here

Want to use Youbot without learning terminal commands? Open [START HERE.md](START%20HERE.md). It walks through the Mac and Windows launchers, your first AI connection, and troubleshooting.

- **Self-hosted:** free software; you manage your computer and AI account.
- **Version 1:** self-hosted on Mac and Windows. Paid managed hosting is planned for phase two and is not part of this release.

The instructions below are for developers and existing installations.

## What is Youbot?

Youbot is a **self-hosted AI concierge** that helps visitors using the information and boundaries its owner supplies. The owner configures the concierge, connects supported channels, follows visitor conversations, and takes over when a decision or personal reply is needed. Channel integrations and available actions depend on configuration and authorization.

Youbot's server runs on your own computer. Connected messaging services and configured AI providers receive the information needed for the requests you send through them.

### Planned: reusable collection engine

The next proposed capability is a reusable headless collection engine with LLM-callable tools. Youbot will be its first integration: owners add catalogues or written information, review organized items through cards or schedules, and keep visitor answers current through conversational updates. Other projects can use the same package with their own model, authentication and interface. This is a documented implementation plan, not a released feature. Start with the [collections planning package](docs/collections/README.md) for the specification, architecture, assigned stories, and verification plan.

### Key Capabilities

- 🗣️ **LLM-First Architecture** — Every message goes through the LLM orchestrator. It analyzes intent, calls tools, follows skill instructions, or responds conversationally.
- 📱 **Multi-Channel** — WhatsApp, Telegram, iMessage — all normalized into a unified message flow.
- 🧠 **Soul System** — Evolving personality profiles for you and every contact. The bot learns and remembers.
- ⚡ **80+ Native Tools** — Messaging, Google Workspace, file management, web search, scheduling, CLI agents, and more.
- 🔌 **MCP Extensible** — Connect any [Model Context Protocol](https://modelcontextprotocol.io/) server to add new capabilities.
- 🤖 **Multi-LLM** — Works with OpenAI, Anthropic, Google Gemini, Ollama (local), or any OpenAI-compatible API.
- 🛡️ **Safety & Security** — Configurable guardrails, visitor-safe tool restrictions, approval workflows for sensitive actions.
- 📊 **Dashboard** — Beautiful Next.js + shadcn/ui control center with real-time processing indicators.

---

## Tool Modules

| Module               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| **Messaging**        | Send, search, forward messages across WhatsApp, Telegram, iMessage |
| **Google Workspace** | Gmail, Drive, Sheets, Docs, Contacts, Calendar, Places             |
| **CLI Agents**       | Delegate coding tasks to Gemini CLI, Claude Code, or Codex         |
| **File System**      | Read, write, list, search files & folders (sandboxed)              |
| **Scheduler**        | Cron jobs, reminders, one-time tasks with persistent storage       |
| **Skills**           | Custom automations with triggers, conditions & outcomes            |
| **Memory**           | Store & recall memories, manage contact personas                   |
| **Web Search**       | Serper API + direct fetch fallback                                 |
| **Approvals**        | Owner approval flow for sensitive visitor actions                  |
| **Follow-ups**       | Schedule conversation follow-ups and closure checks                |
| **Vault**            | Secure credential storage for API keys and secrets                 |
| **Apple**            | Calendar, Reminders, Notes integration (macOS)                     |

---

## Quick Start

```bash
# Clone
git clone https://github.com/Bigmints-com/youbot.git
cd youbot

# Install dependencies + build + install
make install

# Start
youbot start
```

Dashboard: **http://localhost:11490**

### Connect Your Channels

1. Open the dashboard
2. Go to **LLMs** → add your LLM provider (Gemini, OpenAI, Ollama, etc.)
3. Go to **WhatsApp** → scan the QR code
4. Go to **Telegram** → enter your bot token
5. Go to **iMessage** → enter your BlueBubbles server URL and password
6. Go to **Google** → connect your Google account

---

## Architecture

```
youbot/
├── Makefile                  # Build + install pipeline
├── start.sh / stop.sh        # Dev mode scripts
└── youbot-core/                # Main application
    ├── src/
    │   ├── api/              # REST API (custom HTTP router)
    │   ├── engine/           # LLM orchestrator, tool routing, unified handler
    │   ├── channels/         # WhatsApp (Baileys), Telegram, iMessage adapters
    │   ├── capabilities/     # Google, Apple, CLI, web-search, filesystem
    │   ├── agents/           # Skills engine, vault, specialized agents
    │   ├── automation/       # Scheduler, approvals, follow-ups
    │   ├── memory/           # Soul system, conversation store, personas
    │   ├── data/             # SQLite database & config management
    │   └── logger/           # Ring-buffer structured logging
    └── web/                  # Next.js 16 + shadcn/ui dashboard
```

### Message Flow (LLM-First)

```
Message → Input Filters → Owner Detection → Orchestrator (LLM)
                                              ├─ Tools & MCP
                                              ├─ Skill context
                                              ├─ Conversational reply
                                              └─ Ask for details
```

All valid messages — from both the owner and visitors — go through the LLM orchestrator. Skills are injected as context, not a separate gating pipeline. See [`.agents/specs/message-flow.md`](.agents/specs/message-flow.md) for the full architectural contract.

### Data Storage

| What     | Where                                 |
| -------- | ------------------------------------- |
| Config   | `~/.youbot/config.json`                 |
| Database | `~/.youbot/data/youbot.db` (SQLite)       |
| Skills   | `~/.youbot/skills/<name>/SKILL.md`      |
| Identity | `~/.youbot/data/SOUL.md`, `IDENTITY.md` |
| Backend  | `~/.youbot/lib/` (compiled JS)          |
| Web UI   | `~/.youbot/web/` (Next.js static)       |
| Logs     | `~/.youbot/logs/`                       |

---

## CLI

```bash
youbot start             # Start on port 11490
youbot stop              # Graceful shutdown
youbot restart           # Stop + start
youbot status            # Show PID, port, dashboard URL
youbot logs              # Last 50 log lines
youbot logs -f           # Follow logs in real-time
youbot backup            # Create a verified private backup
youbot backup-verify DIR # Verify hashes and SQLite integrity
youbot restore DIR       # Offline, recoverable restore
youbot config            # Show current config
youbot config edit       # Open config in $EDITOR
youbot config set k v    # Set a config value
youbot config get k      # Get a config value
youbot doctor            # Health check
youbot open              # Open dashboard in browser
```

The supported production profile is one loopback-bound process on one trusted host with local SQLite storage. Read the [operations guide](youbot-core/docs/operations.md) before using real visitor data; it covers permissions, backups, restore drills, updates, monitoring, and the boundary for broader deployments.

---

## Development

```bash
# Dev mode (hot reload for both backend + frontend)
./start.sh             # Backend on :4081 + Next.js on :4080

# Stop dev servers
./stop.sh

# Run tests
cd youbot-core && npx vitest

# Build + deploy to runtime
make install           # Builds and copies to ~/.youbot/; restart separately
```

> **Important**: `npm run build` only compiles to `youbot-core/dist/`. The runtime loads from `~/.youbot/lib/`. Always use `make install` to deploy changes.

---

## Configuration

Config lives at `~/.youbot/config.json`:

```json
{
  "server": { "port": 11490 },
  "database": { "path": "data/youbot.db" },
  "owner": {
    "phone": "",
    "telegram_id": "",
    "telegram_username": ""
  },
  "capabilities": {
    "models": {
      "default": "gemini",
      "providers": {
        "gemini": {
          "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/",
          "model": "gemini-2.0-flash",
          "apiKey": "YOUR_API_KEY"
        }
      }
    }
  },
  "channels": {
    "whatsapp": { "enabled": true, "auto_reply": true },
    "telegram": { "enabled": true, "token": "", "auto_reply": true },
    "imessage": { "enabled": false, "server_url": "", "password": "" }
  },
  "filesystem": {
    "allowed_paths": ["~/Documents", "~/Downloads", "~/Desktop"]
  },
  "mcp_servers": {}
}
```

### Supported LLM Providers

| Provider                  | Base URL                                                   | Notes                         |
| ------------------------- | ---------------------------------------------------------- | ----------------------------- |
| **Google Gemini**         | `https://generativelanguage.googleapis.com/v1beta/openai/` | Recommended. Fast + cheap.    |
| **OpenAI**                | `https://api.openai.com/v1`                                | GPT-4o, GPT-4, etc.           |
| **Anthropic**             | Via OpenAI-compatible proxy                                | Claude 3.5 Sonnet, etc.       |
| **Ollama**                | `http://localhost:11434/v1`                                | Local models. Free.           |
| **Any OpenAI-compatible** | Your provider's URL                                        | OpenRouter, Together AI, etc. |

---

## Skills

Skills are custom automations defined as Markdown files:

```yaml
---
name: Greeting
description: Respond to greetings warmly
triggers: [message]
filter_dms_only: true
condition: "the message is a greeting like hi, hello, hey"
outcome: reply
enabled: true
---
# Instructions
Respond warmly and ask how you can help today.
Mention the person's name if you know it.
```

Skills are stored in `~/.youbot/skills/<skill-name>/SKILL.md` and are injected as LLM context when their fast filters match an incoming message. The LLM decides whether and how to follow them.

Create skills via the web dashboard (**Skills** page), the `create_skill` tool, or by writing the files directly.

---

## Requirements

- **Node.js** ≥ 22 (via [nvm](https://github.com/nvm-sh/nvm))
- **npm** (comes with Node.js)
- **make** (pre-installed on macOS/Linux)
- **macOS** recommended (required for iMessage & Apple integrations)

---

## Contributing

Contributions welcome! Please open an issue first for major changes.

## License

MIT — Built by [Bigmints](https://bigmints.com)
