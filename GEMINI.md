# ⛔ THIS IS THE PRIMARY YOUBOT REPOSITORY

## Golden Rule

**This repo (`youbot/youbot-core/`) is the single source of truth for ALL YOUBOT code.**

- ALL changes to YOUBOT core functionality MUST be made HERE
- The SaveADay fork (`saveaday/apps/youbot/`) is a downstream mirror via git subtree
- SaveADay syncs FROM here, never the other way around
- All behavior differences between upstream and downstream are driven by `config.json` — never by code forks

## What Lives Here

Everything generic to the YOUBOT AI engine platform:
- Engine: orchestrator, handler, tools, LLM client, prompt builder
- Channels: WhatsApp, Telegram, iMessage, webchat
- Capabilities: browser, scheduler, skills, CLI, filesystem
- Web UI: Next.js dashboard (all pages in `web-ui/`)
- API: REST endpoints, middleware, auth
- Memory: conversation store, memory store, soul/personas
- Database: connection, types, migrations

## What Does NOT Live Here

SaveADay-specific business logic (bookings, CRM, rewards, etc.) — that lives in `saveaday/apps/youbot/src/capabilities/saveaday/` and `saveaday/apps/youbot/web-ui/app/saveaday/` in the downstream fork.

## Config-Driven Architecture

YOUBOT uses `config.json` to drive all deployment-specific behavior:
- Auth mode (`local` vs `sso`)
- Port numbers
- Database provider (`sqlite` vs `supabase`)
- Channel enablement
- LLM providers and routing
- Theme and branding

**Never hardcode deployment-specific values. Always use config.json or environment variables.**

## Extension System

Downstream forks customize YOUBOT via:
1. `youbot.extensions.ts` — registerHooks() for backend plugins
2. `web-ui/lib/extensions.tsx` — UI extension loader (upstream provides a no-op default)
3. `config.json` — all behavioral configuration
4. `custom/themes/` — theme files (nav.json, theme.ts)

## After Making Changes

If SaveADay needs these changes, run the sync workflow:
```bash
# In this repo
git subtree split --prefix=youbot-core -b youbot-core-flat --rejoin

# In SaveADay
cd /path/to/saveaday
git subtree pull --prefix=apps/youbot /path/to/youbot youbot-core-flat --squash
```
