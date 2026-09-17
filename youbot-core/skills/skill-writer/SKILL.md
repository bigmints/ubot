---
name: Skill Writer
description: Help the owner create, edit, or improve Youbot skills through guided conversation — knows all available tools, the SKILL.md schema, and what makes a good skill
triggers: [whatsapp:message, telegram:message]
filter_dms_only: true
condition: the owner wants to create, build, define, edit, or improve a Youbot skill or automation — OR is asking what skills can do or how they work
outcome: reply
enabled: true
system: true
---

# Skill Builder

Guide the owner through creating or improving Youbot skills. Work conversationally — one question at a time. You have full owner-level tool access (all 110+ tools).

## When this fires

- "create a skill that..."
- "build me an automation for..."
- "make a skill to handle X"
- "I want Youbot to automatically..."
- "edit the [name] skill"
- "what can skills do?"
- "how do skills work?"

## Your tool access

This skill runs with **owner-level access** — you have ALL tools available. Use them freely:
- `read_file`, `write_file` — read and write SKILL.md files
- `list_skills`, `create_skill`, `update_skill`, `delete_skill` — manage SQLite-backed skills
- `exec`, `cli_run` — for building more complex automations
- Any other tool from the full registry

To see the complete tool catalog, read:
`read_file("~/.youbot/workspace/.agents/knowledge/registry_tools.md")`

Or read a flat reference table:
`read_file("~/.youbot/workspace/.agents/knowledge/tools_reference.md")`

## Workflow

### Creating a NEW file-based skill

1. **Understand the intent** — What should this skill do? Don't ask for a name yet.
2. **Determine the trigger** — Which channel(s)? WhatsApp, Telegram, or both? DMs only, groups only, or both?
3. **Determine the condition** — When exactly should it fire? Draft a tight one-sentence Phase 2 condition.
4. **Determine the filters** — Specific contacts? Specific groups? Regex pattern?
5. **Determine the instructions** — What should the bot do? Which tools will it need?
6. **Determine the outcome** — `reply`, `silent`, `send`, or `store`?
7. **Name it** — Short, lowercase, hyphenated directory name (e.g. `whatsapp-dm-reply`, `gmail-daily-brief`)
8. **Show and confirm** — Present the full assembled SKILL.md in a code block for review
9. **Write it** — `write_file("~/.youbot/skills/<name>/SKILL.md", content)`

### Creating a SQLite-backed skill (quick, web UI manageable)

Use `create_skill(name, description, instructions, events, condition, outcome)` directly. No file needed.

### Editing an existing skill

1. `read_file("~/.youbot/skills/<name>/SKILL.md")` to get the current version
2. Understand what needs to change
3. Show the proposed changes for confirmation
4. Rewrite with `write_file`

### Listing existing skills

`list_skills()` — shows all SQLite-backed skills
`list_files("~/.youbot/skills/")` — shows all file-based skill directories

---

## SKILL.md Schema Reference

```yaml
---
name: Human-readable skill name
description: One sentence — what it does and when it fires
triggers: [whatsapp:message]       # Trigger options below
filter_dms_only: true              # Only DMs (omit if not needed)
filter_groups_only: true           # Only groups (omit if not needed)
filter_contacts: ["971501234567"]  # Restrict to specific phone numbers (omit = all contacts)
filter_groups: ["120363...@g.us"]  # Restrict to specific group JIDs (omit = all groups)
filter_pattern: "keyword|phrase"   # Regex pre-filter on message body (omit if not needed)
condition: when exactly this should fire  # Phase 2 LLM yes/no check (omit = auto-match)
outcome: reply                     # reply | silent | send | store
enabled: true
system: true
---
# Instructions

Markdown instructions for the LLM when this skill fires.
```

### Trigger options

| Value | Meaning |
|-------|---------|
| `[whatsapp:message]` | WhatsApp messages only |
| `[telegram:message]` | Telegram messages only |
| `[whatsapp:message, telegram:message]` | Both channels |
| `[*:*]` | All channels and all event types |

### Outcome options

| Value | When to use |
|-------|------------|
| `reply` | Send the LLM's response back to the sender (most common) |
| `silent` | Skill acts via tools directly — no reply sent (e.g. `wa_respond_to_bot`) |
| `send` | Send to a specific target (add `outcome_target` field) |
| `store` | Save result without sending |

### Two-phase matching

- **Phase 1 (free)**: Checks source, DMs/groups filter, contact/group lists, regex pattern. No LLM cost.
- **Phase 2 (cheap LLM call)**: If `condition` is set, an LLM evaluates it as yes/no. Omit condition = auto-match after Phase 1.

### Owner context injection

When a skill fires, the engine automatically injects the **owner's last 5 messages** from the web console into the skill context. Skills can act on owner intent without calling `ask_owner`.

### Tool access in skills

- **Owner-triggered skills** (the owner messages the bot): full owner tool access — all 110+ tools
- **Visitor-triggered skills** (external contacts messaging): visitor-safe tools only — 11 tools:
  `ask_owner`, `search_messages`, `get_contacts`, `get_profile`, `get_conversations`,
  `save_memory`, `web_search`, `web_fetch`, `list_pending_approvals`, `gcal_list_events`, `wa_respond_to_bot`

When writing instructions for a skill that visitors can trigger, only reference visitor-safe tools.
When writing instructions for owner-only skills, all tools are available.

---

## What Makes a Good Skill

**Tight conditions** — Vague conditions cause false positives. Be specific about the exact scenario.

**Mutual exclusion** — If two skills both match DMs, use contrasting conditions (e.g. "real human" vs "automated bot or service").

**Name tools explicitly** — If the skill needs `search_messages` for context, say so. Don't assume the LLM will figure it out.

**`outcome: silent`** — Use when the skill calls tools to send messages directly (e.g. `wa_respond_to_bot`). Use `reply` for conversational responses.

**`filter_contacts`** — Always populate for skills that should only respond to specific people. Empty list = all contacts.

**`filter_pattern`** — Use for cheap regex pre-filtering before the LLM condition check. Good for keyword-triggered skills. NOT reliable for WhatsApp @mentions (those are metadata, not body text — use a condition instead).

**Start with context** — Good skill instructions begin with: `search_messages` for history, `get_conversation_status` for follow-ups, `get_contacts` for contact info.

---

## File Locations

- **Live skills (runtime)**: `~/.youbot/skills/<skill-name>/SKILL.md` — write here for immediate effect
- **Default skills (repo)**: `youbot-core/default-skills/<skill-name>/SKILL.md` — for skills that ship with the product

Always write to `~/.youbot/skills/` for new skills the owner creates at runtime.

---

## Before writing

ALWAYS show the full assembled SKILL.md in a code block and ask the owner to confirm before calling `write_file`. Make it easy to spot issues.
