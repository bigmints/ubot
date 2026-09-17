const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source=fs.readFileSync(require.resolve('../public/sw.js'),'utf8');
function worker(){
 const listeners={},deleted=[],added=[],cached=[];
 const cache={addAll:async paths=>added.push(...paths),put:async request=>cached.push(request.url)};
 const context={URL,Response,self:{location:{origin:'https://youbot.live'},addEventListener:(name,listener)=>listeners[name]=listener,skipWaiting(){},clients:{claim(){}}},caches:{open:async()=>cache,keys:async()=>['youbot-webchat-v1','youbot-webchat-v2','other-app-cache'],delete:async key=>deleted.push(key),match:async()=>undefined},fetch:async()=>new Response('asset')};
 vm.runInNewContext(source,context);return {listeners,deleted,added,cached};
}
test('shared-domain service worker does not intercept website, docs, tenant pages or authenticated APIs',()=>{
 const {listeners}=worker();
 for(const [url,method] of [['/','GET'],['/docs/installation','GET'],['/api/tenants/register','POST'],['/abcdefghijklmnopqr.abcdefghij','GET'],['/abcdefghijklmnopqr.abcdefghij/api/bot/poll','GET'],['/abcdefghijklmnopqr.abcdefghij/api/config','GET'],['/widget.js','POST'],['https://example.com/widget.js','GET']]){
  let intercepted=false;listeners.fetch({request:{url:new URL(url,'https://youbot.live').href,method},respondWith(){intercepted=true;}});assert.equal(intercepted,false,`${method} ${url}`);
 }
});
test('worker precaches only public assets and migrates only its own old cache',async()=>{
 const w=worker();let pending;
 w.listeners.install({waitUntil(p){pending=p;}});await pending;
 assert.deepEqual(w.added,['/widget.js','/icon-192.svg','/icon-512.svg']);
 w.listeners.activate({waitUntil(p){pending=p;}});await pending;
 assert.deepEqual(w.deleted,['youbot-webchat-v1']);
 w.listeners.fetch({request:{url:'https://youbot.live/widget.js',method:'GET'},respondWith(p){pending=p;}});assert.equal((await pending).status,200);assert.deepEqual(w.cached,['https://youbot.live/widget.js']);
});
