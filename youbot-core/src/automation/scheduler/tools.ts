/**
 * Scheduler Tool Module
 *
 * Tools for scheduling messages, creating reminders,
 * listing/deleting/triggering scheduled tasks.
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../../tools/types.js';
import * as chrono from 'chrono-node';

const SCHEDULER_TOOLS: ToolDefinition[] = [
  {
    name: 'schedule_message',
    description: 'Schedule a message to be sent at a specific future time. Use ONLY when the user explicitly requests a delay or future time. For immediate messages, ALWAYS use send_message instead. IMPORTANT: Keep your text response brief and do not quote the drafted message back to the user.',
    parameters: [
      { name: 'to', type: 'string', description: 'Phone number with country code', required: true },
      { name: 'body', type: 'string', description: 'The message text to send', required: true },
      { name: 'time', type: 'string', description: 'When to send, e.g. "in 30 minutes", "tomorrow at 9am", or ISO date string', required: true },
      { name: 'channel', type: 'string', description: 'Messaging channel', required: false },
    ],
  },
  {
    name: 'set_auto_reply',
    description: 'Set up automatic replies for specific contacts.',
    parameters: [
      { name: 'contacts', type: 'string', description: 'Comma-separated phone numbers to monitor, or "all" for all contacts', required: true },
      { name: 'instructions', type: 'string', description: 'Instructions for how to reply', required: true },
      { name: 'enabled', type: 'boolean', description: 'true to enable, false to disable', required: true },
    ],
  },
  {
    name: 'create_reminder',
    description: 'Create a reminder for the owner. Will be sent via their connected messaging channel. IMPORTANT: NEVER call this multiple times to simulate a recurring pattern — use recurrence or interval_minutes instead. For "every X minutes/hours", use interval_minutes. For daily/weekly/monthly, use recurrence.',
    parameters: [
      { name: 'message', type: 'string', description: 'What to remind about', required: true },
      { name: 'time', type: 'string', description: 'When to start. Supports natural language: "in 30 minutes", "at 3:00pm", "tomorrow at 9am", "now"', required: true },
      { name: 'recurrence', type: 'string', description: 'How often: "once" (default), "daily", "weekly", "monthly". For sub-daily intervals use interval_minutes instead.', required: false },
      { name: 'interval_minutes', type: 'number', description: 'Repeat every N minutes (e.g. 10 for every 10 minutes). Takes priority over recurrence. Use duration_minutes to limit how long it runs.', required: false },
      { name: 'duration_minutes', type: 'number', description: 'Only used with interval_minutes. Stop repeating after this many minutes total (e.g. 60 to run for 1 hour).', required: false },
    ],
  },
  {
    name: 'list_schedules',
    description: 'List all active scheduled tasks, reminders, and scheduled messages.',
    parameters: [
      { name: 'status', type: 'string', description: 'Filter by status: "pending", "running", "completed", "failed", "cancelled", "paused".', required: false },
    ],
  },
  {
    name: 'delete_schedule',
    description: 'Delete/cancel a scheduled task or reminder by its ID.',
    parameters: [
      { name: 'task_id', type: 'string', description: 'The ID of the scheduled task to delete', required: true },
    ],
  },
  {
    name: 'trigger_schedule',
    description: 'Run a scheduled task immediately, regardless of its next scheduled time.',
    parameters: [
      { name: 'task_id', type: 'string', description: 'The ID of the scheduled task to trigger now', required: true },
    ],
  },
  {
    name: 'schedule_agent_task',
    description: 'Schedule a recurring agent task that runs tools and sends dynamic results. Unlike create_reminder (static text), this spawns a full agent at the scheduled time that can search the web, read emails, check calendar, fetch data, and compose a dynamic message. Use this for daily briefs, reports, monitoring, or any task that needs live data.',
    parameters: [
      { name: 'task', type: 'string', description: 'The task prompt for the agent. Be specific: "Search for top Dubai news, get weather for Dubai, get AAPL stock price, compose a morning brief, and send it to me on telegram."', required: true },
      { name: 'time', type: 'string', description: 'When to run: "every day at 9am", "weekdays at 8am", "tomorrow at 6pm"', required: true },
      { name: 'recurrence', type: 'string', description: 'How often: "once", "daily", "weekly", "monthly". Default: "daily"', required: false },
      { name: 'channel', type: 'string', description: 'Delivery channel for results: "telegram", "whatsapp". Agent will send via this channel.', required: false },
    ],
  },
];

const schedulerToolModule: ToolModule = {
  name: 'scheduler',
  tools: SCHEDULER_TOOLS,
  register(registry: ToolRegistry, ctx: ToolContext) {
    const mr = ctx.getMessagingRegistry();

    // ── Register handler factories for task persistence ──
    const sched = ctx.getScheduler();
    if (sched && typeof sched.registerHandlerFactory === 'function') {
      // Factory for scheduled_message tasks
      sched.registerHandlerFactory('scheduled_message', (data: any) => {
        return async (_ctx: any, d: any) => {
          const provider = mr.resolveProvider(d.channel || undefined);
          await provider.sendMessage(d.to, d.body);
          console.log(`[Scheduler] Sent scheduled message to ${d.to}`);
          return { sent: true, to: d.to };
        };
      });

      // Factory for reminder tasks
      sched.registerHandlerFactory('reminder', (data: any) => {
        return async (_ctx: any, d: any) => {
          const reminderText = `⏰ **Reminder:** ${d.message}`;
          const tg = ctx.getTelegram();
          const wa = ctx.getWhatsApp();
          const agent = ctx.getAgent();
          const config = agent?.getConfig();
          const escalationChannelPref = config?.primaryEscalationChannel || 'both';
          if ((escalationChannelPref === 'telegram' || escalationChannelPref === 'both') && d.ownerTelegramId && tg) {
            try { await tg.sendMessage(Number(d.ownerTelegramId), reminderText); return { sent: true, channel: 'telegram' }; } catch {}
          }
          const rawOwnerPhone = (config?.ownerPhone || '').split(',')[0] || '';
          const ownerPhone = rawOwnerPhone.replace(/\D/g, '');
          if ((escalationChannelPref === 'whatsapp' || escalationChannelPref === 'both') && wa?.isConnected && ownerPhone) {
            try {
              const jid = `${ownerPhone}@s.whatsapp.net`;
              await wa.sendMessage(jid, { text: reminderText });
              return { sent: true, channel: 'whatsapp' };
            } catch {}
          }
          return { sent: false, stored: true };
        };
      });

      // Factory for agent_task tasks
      sched.registerHandlerFactory('agent_task', (data: any) => {
        return async (_ctx: any, d: any) => {
          const orchestrator = ctx.getAgent() as any;
          if (!orchestrator?.chat) throw new Error('Agent orchestrator not available');
      console.log('[Scheduler] Running agent task');
          const sessionId = `sched-${Date.now()}`;
          const result = await orchestrator.chat(sessionId, d.prompt, 'web', 'scheduler', true);
      console.log('[Scheduler] Agent task completed');
          return { success: true, content: result.content, tools: result.toolCalls?.length || 0 };
        };
      });

      // Load persisted tasks now that factories are registered
      sched.loadPersistedTasks();
    }

    registry.register('schedule_message', async (args) => {
      const to = String(args.to || '');
      const body = String(args.body || args.message || '');
      const time = String(args.time || '');
      if (!to || !body || !time) return { toolName: 'schedule_message', success: false, error: 'Missing required parameters (to, body/message, time)', duration: 0 };

      const scheduledDate = chrono.parseDate(time, new Date()) || new Date(time);
      if (!scheduledDate || isNaN(scheduledDate.getTime())) return { toolName: 'schedule_message', success: false, error: `Could not parse time: "${time}".`, duration: 0 };
      if (scheduledDate.getTime() <= Date.now()) return { toolName: 'schedule_message', success: false, error: `Scheduled time "${time}" resolves to the past.`, duration: 0 };

      const sched = ctx.getScheduler();
      if (!sched) return { toolName: 'schedule_message', success: false, error: 'Scheduler service not initialized', duration: 0 };

      try {
        const safeTo = to.replace(/[^a-zA-Z0-9_\-.\s]/g, '');
        const task = await sched.createTask({
          name: `Send message to ${safeTo || 'recipient'}`,
          description: `Send "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}" to ${to}`,
          schedule: { recurrence: 'once', startDate: scheduledDate },
          data: { to, body, channel: String(args.channel || '') },
          tags: ['scheduled_message'],
          metadata: { createdBy: 'chat', to, body },
          handler: async (_ctx: any, data: { to: string; body: string; channel: string }) => {
            const provider = mr.resolveProvider(data.channel || undefined);
            await provider.sendMessage(data.to, data.body);
          console.log('[Scheduler] Sent scheduled message');
            return { sent: true, to: data.to };
          },
        });
        return { toolName: 'schedule_message', success: true, result: `Scheduled message to ${to}: "${body}" at ${scheduledDate.toLocaleString()}. Task ID: ${task.id}`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'schedule_message', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('set_auto_reply', async (args) => {
      const contacts = String(args.contacts || '');
      const instructions = String(args.instructions || '');
      const enabled = args.enabled !== false;
      const agent = ctx.getAgent();
      if (agent) {
        const contactList = contacts === 'all' ? [] : contacts.split(',').map(c => c.trim());
        agent.updateConfig({ autoReplyWhatsApp: enabled, autoReplyContacts: contactList });
      }
      return { toolName: 'set_auto_reply', success: true, result: `Auto-reply ${enabled ? 'enabled' : 'disabled'} for ${contacts === 'all' ? 'all contacts' : contacts}. Instructions: ${instructions}`, duration: 0 };
    });

    registry.register('create_reminder', async (args) => {
      const message = String(args.message || '');
      const time = String(args.time || '');
      const recurrence = String(args.recurrence || 'once') as 'once' | 'daily' | 'weekly' | 'monthly';
      const intervalMinutes = args.interval_minutes ? Number(args.interval_minutes) : undefined;
      const durationMinutes = args.duration_minutes ? Number(args.duration_minutes) : undefined;
      if (!message || !time) return { toolName: 'create_reminder', success: false, error: 'Missing required parameters (message, time)', duration: 0 };

      // Parse start time — allow "now" for interval-based reminders
      const startDate = time.toLowerCase() === 'now' ? new Date() : (chrono.parseDate(time, new Date()) || new Date(time));
      if (!startDate || isNaN(startDate.getTime())) return { toolName: 'create_reminder', success: false, error: `Could not parse time: "${time}".`, duration: 0 };
      if (startDate.getTime() <= Date.now() && recurrence === 'once' && !intervalMinutes) return { toolName: 'create_reminder', success: false, error: `Time "${time}" resolves to the past.`, duration: 0 };

      const sched = ctx.getScheduler();
      if (!sched) return { toolName: 'create_reminder', success: false, error: 'Scheduler service not initialized', duration: 0 };

      try {
        const agent = ctx.getAgent();
        const config = agent?.getConfig();
        const ownerTelegramId = config?.ownerTelegramId;
        const tg = ctx.getTelegram();
        const wa = ctx.getWhatsApp();

        const reminderHandler = async (_ctx: any, data: { message: string; ownerTelegramId?: string }) => {
          const reminderText = `⏰ **Reminder:** ${data.message}`;
          const escalationChannelPref = config?.primaryEscalationChannel || 'both';
          if ((escalationChannelPref === 'telegram' || escalationChannelPref === 'both') && data.ownerTelegramId && tg) {
            try { await tg.sendMessage(Number(data.ownerTelegramId), reminderText); return { sent: true, channel: 'telegram' }; } catch {}
          }
          const rawOwnerPhone = (config?.ownerPhone || '').split(',')[0] || '';
          const ownerPhone = rawOwnerPhone.replace(/\D/g, '');
          if ((escalationChannelPref === 'whatsapp' || escalationChannelPref === 'both') && wa?.isConnected && ownerPhone) {
            try {
              const jid = `${ownerPhone}@s.whatsapp.net`;
              await wa.sendMessage(jid, { text: reminderText });
              return { sent: true, channel: 'whatsapp' };
            } catch {}
          }
          return { sent: false, stored: true };
        };

        // ── Interval-based recurrence (e.g. every 10 minutes) ──
        if (intervalMinutes && intervalMinutes > 0) {
          const endTime = durationMinutes ? new Date(Date.now() + durationMinutes * 60 * 1000) : undefined;
          const taskIds: string[] = [];
          let current = new Date(startDate.getTime() <= Date.now() ? Date.now() + 60000 : startDate.getTime());
          const limit = endTime ? Math.floor((endTime.getTime() - current.getTime()) / (intervalMinutes * 60 * 1000)) + 1 : 1;
          const maxTasks = Math.min(limit, 100); // safety cap

          for (let i = 0; i < maxTasks; i++) {
            const task = await sched.createTask({
              name: `Reminder: ${message.slice(0, 50)} [${i + 1}/${maxTasks}]`,
              description: `Interval reminder every ${intervalMinutes}min`,
              schedule: { recurrence: 'once', startDate: new Date(current) },
              data: { message, ownerTelegramId },
              tags: ['reminder', 'interval'],
              metadata: { createdBy: 'chat', message, intervalGroup: true },
              handler: reminderHandler,
            });
            taskIds.push(task.id);
            current = new Date(current.getTime() + intervalMinutes * 60 * 1000);
            if (endTime && current.getTime() > endTime.getTime()) break;
          }

          const durationStr = durationMinutes ? ` for ${durationMinutes} minutes` : '';
          return { toolName: 'create_reminder', success: true, result: `✅ Set ${taskIds.length} reminders every ${intervalMinutes} minutes${durationStr}: "${message}". First fires at ${new Date(Date.now() + (startDate.getTime() <= Date.now() ? 60000 : startDate.getTime() - Date.now())).toLocaleTimeString()}.`, duration: 0 };
        }

        // ── Standard single/recurring reminder ──
        const task = await sched.createTask({
          name: `Reminder: ${message.slice(0, 50)}`,
          description: `Remind owner: "${message}" at ${startDate.toLocaleString()}`,
          schedule: { recurrence, startDate },
          data: { message, ownerTelegramId },
          tags: ['reminder'],
          metadata: { createdBy: 'chat', message },
          handler: reminderHandler,
        });
        return { toolName: 'create_reminder', success: true, result: `Reminder set: "${message}" at ${startDate.toLocaleString()}${recurrence !== 'once' ? ` (${recurrence})` : ''}. Task ID: ${task.id}`, duration: 0 };
      } catch (err: any) {
        return { toolName: 'create_reminder', success: false, error: err.message, duration: 0 };
      }
    });

    registry.register('list_schedules', async (args) => {
      const sched = ctx.getScheduler();
      if (!sched) return { toolName: 'list_schedules', success: false, error: 'Scheduler service not initialized', duration: 0 };
      const statusFilter = args.status ? String(args.status) as any : undefined;
      const filter = statusFilter ? { status: statusFilter } : { enabled: true };
      const result = sched.listTasks(filter, { field: 'createdAt', direction: 'desc' });
      if (result.tasks.length === 0) return { toolName: 'list_schedules', success: true, result: 'No scheduled tasks found.', duration: 0 };
      const lines = result.tasks.map((t: any) => {
        const nextRun = t.nextRunAt ? t.nextRunAt.toLocaleString() : 'N/A';
        const tags = t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : '';
        return `• **${t.name}** (ID: ${t.id})\n  Status: ${t.status} | Next run: ${nextRun} | Recurrence: ${t.schedule.recurrence}${tags}`;
      });
      return { toolName: 'list_schedules', success: true, result: `Found ${result.tasks.length} scheduled task(s):\n\n${lines.join('\n\n')}`, duration: 0 };
    });

    registry.register('delete_schedule', async (args) => {
      const taskId = String(args.task_id || '');
      if (!taskId) return { toolName: 'delete_schedule', success: false, error: 'Missing required parameter: task_id', duration: 0 };
      const sched = ctx.getScheduler();
      if (!sched) return { toolName: 'delete_schedule', success: false, error: 'Scheduler service not initialized', duration: 0 };
      const deleted = await sched.deleteTask(taskId);
      if (deleted) return { toolName: 'delete_schedule', success: true, result: `Deleted scheduled task ${taskId}.`, duration: 0 };
      return { toolName: 'delete_schedule', success: false, error: `Task ${taskId} not found.`, duration: 0 };
    });

    registry.register('trigger_schedule', async (args) => {
      const taskId = String(args.task_id || '');
      if (!taskId) return { toolName: 'trigger_schedule', success: false, error: 'Missing required parameter: task_id', duration: 0 };
      const sched = ctx.getScheduler();
      if (!sched) return { toolName: 'trigger_schedule', success: false, error: 'Scheduler service not initialized', duration: 0 };
      try {
        const result = await sched.runTaskNow(taskId);
        return { toolName: 'trigger_schedule', success: result.success, result: result.success ? `Task ${taskId} executed successfully.` : `Task ${taskId} failed: ${result.error}`, duration: result.duration };
      } catch (err: any) {
        return { toolName: 'trigger_schedule', success: false, error: err.message, duration: 0 };
      }
    });
    // ── schedule_agent_task ────────────────────────────────
    registry.register('schedule_agent_task', async (args) => {
      const task = String(args.task || '').trim();
      const time = String(args.time || '');
      const recurrence = String(args.recurrence || 'daily') as 'once' | 'daily' | 'weekly' | 'monthly';
      const channel = args.channel ? String(args.channel) : undefined;
      if (!task || !time) return { toolName: 'schedule_agent_task', success: false, error: 'Missing required parameters (task, time)', duration: 0 };

      const scheduledDate = chrono.parseDate(time, new Date()) || new Date(time);
      if (!scheduledDate || isNaN(scheduledDate.getTime())) return { toolName: 'schedule_agent_task', success: false, error: `Could not parse time: "${time}".`, duration: 0 };

      const sched = ctx.getScheduler();
      if (!sched) return { toolName: 'schedule_agent_task', success: false, error: 'Scheduler service not initialized', duration: 0 };

      const orchestrator = ctx.getAgent() as any;
      if (!orchestrator?.chat) return { toolName: 'schedule_agent_task', success: false, error: 'Agent orchestrator not available', duration: 0 };

      try {
        // Build the agent prompt — append channel delivery instruction if specified
        let agentPrompt = task;
        if (channel) {
          agentPrompt += `\n\nIMPORTANT: Send the final result to the owner via ${channel} using the send_message tool.`;
        }

        const scheduledTask = await sched.createTask({
          name: `Agent Task: ${task.slice(0, 60)}`,
          description: `Scheduled agent run: "${task}"`,
          schedule: { recurrence, startDate: scheduledDate },
          data: { prompt: agentPrompt, channel },
          tags: ['agent_task'],
          metadata: { createdBy: 'chat', task, channel },
          handler: async (_ctx: any, data: { prompt: string; channel?: string }) => {
          console.log('[Scheduler] Running agent task');
            const sessionId = `sched-${Date.now()}`;
            try {
              const result = await orchestrator.chat(sessionId, data.prompt, 'web', 'scheduler', true);
          console.log('[Scheduler] Agent task completed');
              return { success: true, content: result.content, tools: result.toolCalls?.length || 0 };
            } catch (err: any) {
              console.error(`[Scheduler] Agent task failed: ${err.message}`);
              return { success: false, error: err.message };
            }
          },
        });

        return {
          toolName: 'schedule_agent_task',
          success: true,
          result: `Scheduled agent task: "${task.slice(0, 80)}" at ${scheduledDate.toLocaleString()} (${recurrence})${channel ? ` → ${channel}` : ''}. Task ID: ${scheduledTask.id}. The agent will run tools and compose dynamic content at the scheduled time.`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'schedule_agent_task', success: false, error: err.message, duration: 0 };
      }
    });
  },
};

export default schedulerToolModule;
