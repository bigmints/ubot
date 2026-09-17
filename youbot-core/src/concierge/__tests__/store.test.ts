import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteConnection } from '../../data/database/sqlite.js';
import { ConciergeStore, InboxDispatchHeld } from '../store.js';
import { DEFAULT_CONCIERGE, parseConciergeProfile } from '../profile.js';
let db:SQLiteConnection, store:ConciergeStore, directory:string;
const incoming=(messageId='one',body='Hello')=>store.receive({id:'visitor-a',name:'Alex',channel:'telegram',address:'1234',content:body,messageId});
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'youbot-inbox-'));db=new SQLiteConnection({config:{path:join(directory,'test.sqlite')}});store=new ConciergeStore(db);await store.ready;});
afterEach(async()=>{await db.close();await rm(directory,{recursive:true,force:true});});
describe('durable visitor inbox',()=>{
 it('captures paused messages, deduplicates intake, and keeps concurrent unread messages',async()=>{
  await incoming();await store.control('visitor-a','takeover');await store.read('visitor-a',1);
  await incoming('two','Are you there?');await incoming('two','Are you there?');await store.read('visitor-a',1);
  const t=await store.get('visitor-a');expect(t).toMatchObject({incomingVersion:2,readVersion:1,unread:true,paused:true});expect((await store.messages('visitor-a')).messages).toHaveLength(2);
  await store.read('visitor-a',2);expect((await store.get('visitor-a'))?.unread).toBe(false);
 });
 it('reconciles intake after a projection write failed',async()=>{
  const original=db.execute.bind(db);let fail=true;
  vi.spyOn(db,'execute').mockImplementation(async(sql,params)=>{if(fail&&sql.includes('SET handled=CASE')){fail=false;throw new Error('disk interrupted');}return original(sql,params);});
  await expect(incoming()).rejects.toThrow('disk interrupted');await incoming();expect((await store.get('visitor-a'))?.incomingVersion).toBe(1);
 });
 it('suppresses stale model output even after handback',async()=>{
  const t=(await incoming()).thread;const send=vi.fn();await store.control(t.id,'takeover');await store.control(t.id,'handback');
  expect(await store.automatedReply(t.id,t.revision,'Old response',send)).toBe(false);expect(send).not.toHaveBeenCalled();
 });
 it('waits for an in-flight send before takeover completes',async()=>{
  const t=(await incoming()).thread;let release!:()=>void;let entered!:()=>void;
  const start=new Promise<void>(r=>entered=r), gate=new Promise<void>(r=>release=r);
  const dispatch=store.automatedReply(t.id,t.revision,'Reply',async()=>{entered();await gate;});await start;
  let taken=false;const control=store.control(t.id,'takeover').then(()=>{taken=true;});await Promise.resolve();expect(taken).toBe(false);release();await dispatch;await control;expect((await store.get(t.id))?.paused).toBe(true);
 });
 it('persists collection evidence and removes a held automated outbox record',async()=>{
  const t=(await incoming()).thread;
  await store.rememberCollectionEvidence(t.id,['evidence-1','evidence-2']);
  const restarted=new ConciergeStore(db);await restarted.ready;
  expect(await restarted.collectionEvidence(t.id)).toMatchObject({evidenceReceiptIds:['evidence-1','evidence-2']});
  const send=vi.fn(async()=>{throw new InboxDispatchHeld('Collection facts changed before delivery.');});
  expect(await restarted.automatedReply(t.id,t.revision,'Published information',send)).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await restarted.messages(t.id)).messages).toHaveLength(1);
  expect((await restarted.get(t.id))?.lastError).toContain('changed before delivery');
 });
 it('does not send twice when a reply request is retried',async()=>{
  await incoming();await store.control('visitor-a','takeover');const send=vi.fn();
  const first=await store.ownerReply('visitor-a','Hi','request-123','telegram',send,1);const retry=await store.ownerReply('visitor-a','Hi','request-123','telegram',send,1);
  expect(first.id).toBe(retry.id);expect(send).toHaveBeenCalledTimes(1);
  await expect(store.ownerReply('visitor-b','Hi','request-123','telegram',send)).rejects.toThrow('different message');
 });
 it('records uncertain delivery and never blindly retries it',async()=>{
  await incoming();await store.control('visitor-a','takeover');const send=vi.fn().mockRejectedValue(new Error('connection lost'));
  await expect(store.ownerReply('visitor-a','Hi','request-unknown','telegram',send)).rejects.toThrow('delivery is unknown');
  expect((await store.ownerReply('visitor-a','Hi','request-unknown','telegram',send)).delivery).toBe('unknown');expect(send).toHaveBeenCalledTimes(1);expect((await store.get('visitor-a'))?.lastError).toBeTruthy();
 });
 it('rejects changed channel or unseen incoming messages before dispatch',async()=>{
  await incoming();await store.control('visitor-a','takeover');const send=vi.fn();
  await expect(store.ownerReply('visitor-a','Hi','request-other','whatsapp',send,1)).rejects.toThrow('another channel');await incoming('two');
  await expect(store.ownerReply('visitor-a','Hi','request-next','telegram',send,1)).rejects.toThrow('new message');expect(send).not.toHaveBeenCalled();
 });
 it('rejects disconnected sends before creating an outbox record',async()=>{
  await incoming();await store.control('visitor-a','takeover');const send=vi.fn();
  await expect(store.ownerReply('visitor-a','Hi','request-offline','telegram',send,1,()=>{throw new Error('Disconnected');})).rejects.toThrow('Disconnected');
  expect((await store.messages('visitor-a')).messages).toHaveLength(1);expect(send).not.toHaveBeenCalled();
 });
 it('pages identical timestamps without skipping messages',async()=>{
  await incoming();for(let i=0;i<205;i++)await db.execute("INSERT INTO youbot_inbox_messages(id,thread_id,speaker,body,channel,created_at,delivery) VALUES(?,?,'visitor',?,'telegram',?,'received')",['page-'+String(i).padStart(3,'0'),'visitor-a',String(i),'2025-01-01T00:00:00.000Z']);
  const page=await store.messages('visitor-a');const older=await store.messages('visitor-a',page.messages[0].id);expect(page.hasMore).toBe(true);expect(new Set([...page.messages,...older.messages].map(m=>m.id)).size).toBe(206);
 });
 it('recovers an interrupted send after restart',async()=>{
  await incoming();await db.execute("INSERT INTO youbot_inbox_messages(id,thread_id,speaker,body,channel,created_at,delivery) VALUES('interrupted','visitor-a','owner','Hello','telegram',?,'sending')",[new Date().toISOString()]);
  const reopened=new ConciergeStore(db);await reopened.ready;expect((await reopened.messages('visitor-a')).messages.find(m=>m.id==='interrupted')?.delivery).toBe('unknown');expect((await reopened.get('visitor-a'))?.lastError).toContain('interrupted');
 });
 it('prevents marking a thread handled while decisions remain',async()=>{
  await incoming();await db.execute("INSERT INTO youbot_pending_approvals(id,question,requester_jid,session_id,status,created_at) VALUES('a','Book?','1234','visitor-a','pending',?)",[new Date().toISOString()]);
  await expect(store.control('visitor-a','handled',1)).rejects.toThrow('unresolved');
 });
 it('validates the profile without granting extra permissions',()=>{
  expect(parseConciergeProfile(DEFAULT_CONCIERGE).tone).toBe('warm');expect(()=>parseConciergeProfile({...DEFAULT_CONCIERGE,name:''})).toThrow('required');expect(()=>parseConciergeProfile({...DEFAULT_CONCIERGE,knowledge:[{id:'1',title:'A',content:'B'},{id:'1',title:'C',content:'D'}]})).toThrow('unique');
 });
});

describe('inbox integration',()=>{
 it('imports legacy visitor history once without claiming delivery',async()=>{
  await db.execute("INSERT INTO youbot_chat_sessions(id,name,type) VALUES('telegram:42','Earlier visitor','telegram')");
  await db.execute("INSERT INTO youbot_chat_messages(id,session_id,role,content) VALUES('legacy-in','telegram:42','user','Hello')");
  await db.execute("INSERT INTO youbot_chat_messages(id,session_id,role,content) VALUES('legacy-out','telegram:42','assistant','Welcome')");
  await db.execute("DELETE FROM youbot_inbox_meta WHERE id='legacy-import'");
  const imported=new ConciergeStore(db);await imported.ready;const restarted=new ConciergeStore(db);await restarted.ready;
  const history=await restarted.messages('telegram:42');expect(history.messages).toHaveLength(2);expect(history.messages.find(m=>m.speaker==='concierge')?.delivery).toBe('historical');expect((await restarted.get('telegram:42'))?.address).toBe('42');
 });
 it('invalidates generated replies when a merged contact changes channel',async()=>{
  const t=(await incoming()).thread;await store.receive({id:t.id,name:'Alex',channel:'whatsapp',address:'123@s.whatsapp.net',content:'Hello from my phone'});
  const send=vi.fn();expect(await store.automatedReply(t.id,t.revision,'Stale reply',send)).toBe(false);expect(send).not.toHaveBeenCalled();
 });
 it('captures incoming messages when auto replies are off without calling AI',async()=>{
  const {handleIncomingMessage}=await import('../../engine/handler.js');
  const history={getOrCreateSession:vi.fn(),addMessage:vi.fn()},chat=vi.fn();
  const deps={concierge:store,orchestrator:{getConfig:()=>({autoReplyWebchat:false}),getConversationStore:()=>history,chat},approvalStore:null,followUpStore:null,eventBus:null,skillEngine:null,contactStore:null,saveConfigValue:vi.fn()} as any;
  const replyFn=vi.fn();await handleIncomingMessage({channel:'webchat',senderId:'visitor-web',senderName:'Web visitor',body:'Is anyone there?',messageId:'web-one',timestamp:new Date(),replyFn},deps);
  expect(chat).not.toHaveBeenCalled();expect(replyFn).not.toHaveBeenCalled();expect((await store.get('webchat:visitor-web'))?.unread).toBe(true);expect(history.addMessage).toHaveBeenCalled();
 });
 it('filters by the original request query and denies non-owner access',async()=>{
  const {handleConciergeRoutes}=await import('../../api/routes/concierge.js');
  await incoming();await store.receive({id:'other',name:'Jules',channel:'whatsapp',address:'44@s.whatsapp.net',content:'Print pickup'});
  const ctx={coreDb:db,auth:{isOwner:true}} as any;
  let status=0,payload:any;const res={writeHead:(code:number)=>{status=code;},end:(value:string)=>{payload=JSON.parse(value);}} as any;
  await handleConciergeRoutes({url:'/api/concierge/threads?search=Jules&channel=whatsapp'} as any,res,'/api/concierge/threads','GET',ctx);
  expect(status).toBe(200);expect(payload.total).toBe(1);expect(payload.threads[0].id).toBe('other');
  ctx.auth.isOwner=false;await handleConciergeRoutes({url:'/api/concierge/threads'} as any,res,'/api/concierge/threads','GET',ctx);expect(status).toBe(403);
 });
});
