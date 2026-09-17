# Youbot Dashboard

> Next.js + shadcn/ui dashboard for managing and monitoring your Youbot instance.

## Stack

- **Next.js 16** with App Router
- **shadcn/ui** components
- **Tailwind CSS v4**
- **Geist** font family

## Pages

| Page           | Description                          |
| -------------- | ------------------------------------ |
| `/`            | Dashboard — overview and status      |
| `/chat`        | Command Center — chat with your bot  |
| `/approvals`   | Owner approval queue                 |
| `/skills`      | Skill management (CRUD automations)  |
| `/personas`    | Persona/soul management              |
| `/safety`      | Safety rules configuration           |
| `/scheduler`   | Scheduled tasks & reminders          |
| `/logs`        | Real-time log viewer                 |
| `/whatsapp`    | WhatsApp connection (QR code)        |
| `/telegram`    | Telegram bot connection              |
| `/google`      | Google Workspace integration         |
| `/mcp-servers` | MCP server management                |
| `/settings`    | App settings (LLM providers, config) |

## Development

```bash
npm install
npm run dev      # Runs on :3000 (or :4080 via start.sh)
```

## Build

```bash
npm run build    # Static export for production
```

The build output is served by the Youbot backend at port 11490.
