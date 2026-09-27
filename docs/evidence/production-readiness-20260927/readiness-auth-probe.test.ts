import { it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
vi.mock('../../engine/handler.js', () => ({ getProcessingSessions: () => [] }));
vi.mock('../../data/config.js', () => ({ loadYoubotConfig: () => ({channels:{webchat:{bot_secret:'fixture-bot-secret',owner_key:'fixture-owner-key'}}}) }));
import { handleChatRoutes } from './chat.js';
it('reproduces non-owner read of owner sessions, history and relay credentials', async () => {
 const ctx:any={auth:{authenticated:true,isOwner:false,clientName:'visitor',scopes:['chat']},agentOrchestrator:{getConfig:()=>({}),getConversationStore:()=>({listSessions:async()=>[{id:'owner-thread'}],getHistory:async()=>[{content:'fixture owner-only text'}]})}};
 const results:any[]=[];
 for(const url of ['/api/chat/sessions','/api/chat/history','/api/chat/config']){
  let status=0;let payload=''; const res:any={writeHead:(n:number)=>{status=n},end:(s:string)=>{payload=s}};
  expect(await handleChatRoutes({} as any,res,url,'GET',ctx)).toBe(true);
  expect(status).toBe(200);
  results.push({url,isOwner:false,status,payload:JSON.parse(payload)});
 }
 expect(results[0].payload.sessions[0].id).toBe('owner-thread');
 expect(results[1].payload.messages[0].content).toBe('fixture owner-only text');
 expect(results[2].payload.webchatBotSecret).toBe('fixture-bot-secret');
 writeFileSync('/Users/pretheesh/Projects/youbot/docs/evidence/production-readiness-20260927/auth-probe-results.json',JSON.stringify(results,null,2));
});
