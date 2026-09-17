import { readOwnerProfile, writeOwnerProfile, documentRevision } from '../../concierge/owner-profile.js';
import type { RouteHandler, ApiContext } from '../context.js';
import { json, parseBody } from '../context.js';
import { getConciergeStore, InboxConflict, type InboxThread } from '../../concierge/store.js';
import { DEFAULT_CONCIERGE, parseConciergeProfile } from '../../concierge/profile.js';
import { loadYoubotConfig, saveYoubotConfig } from '../../data/config.js';
import { handleCollectionRoutes } from '../../concierge/collections/routes.js';
import { randomUUID } from 'node:crypto';

export function replyAvailability(ctx: ApiContext, t: InboxThread): string | null {
  if (!t.address) return 'This older conversation has no verified reply address.';
  if (t.channel === 'whatsapp') return ctx.waConnection?.isConnected ? null : 'Reconnect WhatsApp in Connections before replying.';
  if (t.channel === 'telegram') return ctx.tgConnection?.status === 'connected' ? null : 'Reconnect Telegram in Connections before replying.';
  if (t.channel === 'webchat') {
    if (ctx.webchatConnection?.status !== 'connected') return 'Reconnect Website in Connections before replying.';
    return ctx.webchatConnection.supportsSessionReplies ? null : 'Update the website relay to enable manual replies.';
  }
  return 'Manual replies are not supported by this website connection yet.';
}
export async function sendVisitorReply(ctx: ApiContext, t: InboxThread, content: string, requestId: string = randomUUID()) {
  const unavailable = replyAvailability(ctx, t);
  if (unavailable) throw new InboxConflict(unavailable);
  if (t.channel === 'whatsapp') return ctx.waConnection!.sendMessage(t.address, { text: content });
  if (t.channel === 'telegram') return ctx.tgConnection!.sendMessage(Number(t.address), content);
  if (t.channel === 'webchat') return ctx.webchatConnection!.sendMessage(t.address, content, requestId);
  throw new InboxConflict('This connection cannot send manual replies.');
}
export const handleConciergeRoutes: RouteHandler = async (req,res,url,method,ctx) => {
  const u = new URL(req.url || url,'http://localhost');
  if (!u.pathname.startsWith('/api/concierge')) return false;
  if (ctx.auth && !ctx.auth.isOwner) { json(res,{error:'Owner access required.'},403); return true; }
  try {
    if (await handleCollectionRoutes(req, res, u, method, ctx)) return true;
    if (!ctx.coreDb) throw new InboxConflict('Youbot is still starting. Try again shortly.',503);
    const db = ctx.coreDb, store = getConciergeStore(db); await store.ready;
    const body = method === 'GET' ? {} : await parseBody(req) as Record<string,unknown>;
    if (u.pathname === '/api/concierge/workspace-settings') {
      const read=()=>({maxHistoryMessages:loadYoubotConfig().agent?.max_history_messages || 20});
      if(method==='PUT') {
        if(body.revision!==documentRevision(JSON.stringify(read())))throw new InboxConflict('Workspace settings changed in another window. Reload before saving.');
        const value=(body.settings as Record<string,unknown>)?.maxHistoryMessages;
        if(!Number.isInteger(value)||Number(value)<5||Number(value)>200)throw new InboxConflict('Conversation history must be between 5 and 200 messages.',400);
        const cfg=loadYoubotConfig();cfg.agent={...cfg.agent,max_history_messages:Number(value)};saveYoubotConfig(cfg);
        if(read().maxHistoryMessages!==value)throw new InboxConflict('Workspace settings could not be saved.',500);
        ctx.agentOrchestrator?.updateConfig({maxHistoryMessages:Number(value)});
      } else if(method!=='GET')throw new InboxConflict('Method not allowed.',405);
      const settings=read();json(res,{settings,revision:documentRevision(JSON.stringify(settings))});return true;
    }
    if (u.pathname === '/api/concierge/owner-settings') {
      const read = () => { const c=loadYoubotConfig();return {ownerPhone:c.owner?.phone || '',ownerTelegramId:c.owner?.telegram_id || '',ownerTelegramUsername:c.owner?.telegram_username || '',primaryEscalationChannel:c.agent?.primary_escalation_channel || 'both'}; };
      if(method==='PUT') {
        const current=read();if(body.revision!==documentRevision(JSON.stringify(current)))throw new InboxConflict('These settings changed in another window. Reload before saving.');
        const input=body.settings as Record<string,unknown>;
        if(!input||['ownerPhone','ownerTelegramId','ownerTelegramUsername'].some(k=>typeof input[k]!=='string')||!['both','telegram','whatsapp'].includes(String(input.primaryEscalationChannel)))throw new InboxConflict('Review your notification details.',400);
        const settings={ownerPhone:String(input.ownerPhone).trim(),ownerTelegramId:String(input.ownerTelegramId).trim(),ownerTelegramUsername:String(input.ownerTelegramUsername).trim().replace(/^@/,''),primaryEscalationChannel:input.primaryEscalationChannel as 'both'|'telegram'|'whatsapp'};
        if(!/^[+0-9 ()-]{0,40}$/.test(settings.ownerPhone)||!/^(-?\d{1,20})?$/.test(settings.ownerTelegramId)||!/^([a-zA-Z0-9_]{1,32})?$/.test(settings.ownerTelegramUsername))throw new InboxConflict('Enter a valid phone number, Telegram username and numeric Telegram chat ID.',400);
        const c=loadYoubotConfig();c.owner={...c.owner,phone:settings.ownerPhone,telegram_id:settings.ownerTelegramId,telegram_username:settings.ownerTelegramUsername};c.agent={...c.agent,primary_escalation_channel:settings.primaryEscalationChannel};saveYoubotConfig(c);
        if(JSON.stringify(read())!==JSON.stringify(settings))throw new InboxConflict('The notification settings could not be saved. Your entries are still in the form.',500);
        ctx.agentOrchestrator?.updateConfig(settings);
      }else if(method!=='GET')throw new InboxConflict('Method not allowed.',405);
      const settings=read();json(res,{settings,revision:documentRevision(JSON.stringify(settings))});return true;
    }
    if (u.pathname === '/api/concierge/owner-profile') {
      if (!ctx.agentOrchestrator) throw new InboxConflict('The agent is still starting. Try again shortly.',503);
      const soul = ctx.agentOrchestrator.getSoul();
      if (method === 'PUT') {
        if (typeof body.revision !== 'string') throw new InboxConflict('Reload the profile before saving.',400);
        let content:string;
        try { content=writeOwnerProfile(body.profile,body.additionalContext); } catch(e) { throw new InboxConflict((e as Error).message,400); }
        try { await soul.saveDocument('__owner__',content,body.revision); }
        catch(e) { throw new InboxConflict((e as Error).name==='ProfileConflict'?(e as Error).message:'The profile could not be saved. Your changes are still in the form.',(e as Error).name==='ProfileConflict'?409:500); }
      } else if (method !== 'GET') throw new InboxConflict('Method not allowed.',405);
      json(res,readOwnerProfile(await soul.getDocument('__owner__')));return true;
    }
    if (u.pathname === '/api/concierge/profile') {
      const config = loadYoubotConfig();
      if (method === 'PUT') {
        if (body.revision !== (config.conciergeRevision || 0)) throw new InboxConflict('Your concierge changed in another window. Reload before saving.');
        try { config.concierge = parseConciergeProfile(body.profile); } catch(e) { throw new InboxConflict((e as Error).message,400); }
        config.conciergeRevision = (config.conciergeRevision || 0) + 1;
        saveYoubotConfig(config);
        const saved = loadYoubotConfig();
        if (saved.conciergeRevision !== config.conciergeRevision || JSON.stringify(saved.concierge) !== JSON.stringify(config.concierge)) throw new InboxConflict('Your changes could not be saved. Check disk access and try again.',500);
        ctx.agentOrchestrator?.updateConfig({concierge:config.concierge});
      } else if (method !== 'GET') throw new InboxConflict('Method not allowed.',405);
      const saved = loadYoubotConfig(); json(res,{profile:saved.concierge || DEFAULT_CONCIERGE,revision:saved.conciergeRevision || 0}); return true;
    }
    if (u.pathname === '/api/concierge/dashboard' && method === 'GET') {
      const [recent,attention,unread,handled,visitors] = await Promise.all([store.list({limit:6}),store.list({filter:'needs',limit:8}),store.list({filter:'unread',limit:1}),store.list({filter:'handled',limit:1}),db.get<{count:number}>('SELECT COUNT(*) AS count FROM youbot_inbox_threads WHERE last_incoming_at >= ?',[new Date(Date.now()-7*86400000).toISOString()])]);
      json(res,{recent:recent.threads,attention:attention.threads,counts:{visitors:Number(visitors?.count || 0),needs:attention.total,unread:unread.total,handled:handled.total},configured:!!loadYoubotConfig().concierge}); return true;
    }
    if (u.pathname === '/api/concierge/threads' && method === 'GET') {
      json(res,await store.list({search:u.searchParams.get('search')?.slice(0,200),channel:u.searchParams.get('channel') || undefined,filter:u.searchParams.get('filter') || undefined,offset:Math.max(0,Math.min(100000,Number(u.searchParams.get('offset')) || 0))})); return true;
    }
    const match = u.pathname.match(/^\/api\/concierge\/threads\/([^/]+)(?:\/(read|control|reply|resolve))?$/);
    if (!match) throw new InboxConflict('Not found.',404);
    const id = decodeURIComponent(match[1]), action = match[2], thread = await store.get(id);
    if (!thread) throw new InboxConflict('Conversation not found.',404);
    if (!action && method === 'GET') {
      const [messages,approvals,followups] = await Promise.all([store.messages(id,u.searchParams.get('before') || undefined),db.query("SELECT id,question,context FROM youbot_pending_approvals WHERE session_id=? AND status='pending'",[id]),db.query("SELECT id,reason,follow_up_at FROM youbot_follow_ups WHERE (session_id=? OR contact_id=?) AND status='pending' ORDER BY follow_up_at",[id,id])]);
      const cfg=loadYoubotConfig();
      const autoReplyEnabled=cfg.channels?.[thread.channel]?.auto_reply ?? thread.channel === 'webchat';
      json(res,{thread,...messages,approvals,followups,autoReplyEnabled,replyUnavailable:replyAvailability(ctx,thread)}); return true;
    }
    if (method !== 'POST') throw new InboxConflict('Method not allowed.',405);
    if (action === 'read') {
      if (!Number.isInteger(body.version) || Number(body.version)<0) throw new InboxConflict('Invalid message version.',400);
      await store.read(id,Number(body.version));
    } else if (action === 'control') {
      if (!['takeover','handback','handled','reopen'].includes(String(body.action))) throw new InboxConflict('Choose a conversation action.',400);
      await store.control(id,body.action as 'takeover',Number(body.version));
    } else if (action === 'reply') {
      if (typeof body.content !== 'string' || !body.content.trim() || body.content.length>10000 || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(body.requestId) || !Number.isInteger(body.version)) throw new InboxConflict('Enter a reply of up to 10,000 characters.',400);
      const message = await store.ownerReply(id,body.content.trim(),body.requestId,String(body.channel),t=>sendVisitorReply(ctx,t,String(body.content).trim(),String(body.requestId)),Number(body.version),t=>{ const reason=replyAvailability(ctx,t); if(reason) throw new InboxConflict(reason); });
      json(res,{message}); return true;
    } else if (action === 'resolve') {
      await store.locked(id,async()=>{
        if (body.kind === 'error') {
          if(body.error !== (await store.get(id))?.lastError) throw new InboxConflict('The delivery status changed. Review it again.');
          await db.execute('UPDATE youbot_inbox_threads SET last_error=NULL WHERE id=?',[id]);
        } else if(body.kind === 'approval') {
          if(typeof body.note !== 'string' || !body.note.trim() || body.note.length>3000) throw new InboxConflict('Add a note about your decision.',400);
          await db.execute("UPDATE youbot_pending_approvals SET status='resolved',owner_response=?,resolved_at=? WHERE id=? AND session_id=? AND status='pending'",[body.note.trim(),new Date().toISOString(),String(body.id),id]);
        } else if(body.kind === 'followup') {
          await db.execute("UPDATE youbot_follow_ups SET status='completed',completed_at=?,result='Marked done by owner in inbox' WHERE id=? AND (session_id=? OR contact_id=?) AND status='pending'",[new Date().toISOString(),String(body.id),id,id]);
        } else throw new InboxConflict('Choose an item to resolve.',400);
      });
    } else throw new InboxConflict('Not found.',404);
    json(res,{thread:await store.get(id)});
  } catch(e) { json(res,{error:e instanceof InboxConflict ? e.message : 'Something went wrong. Reload and try again.'},e instanceof InboxConflict ? e.status : 500); }
  return true;
};
