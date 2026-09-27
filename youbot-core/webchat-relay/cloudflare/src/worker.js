import { DurableObject } from 'cloudflare:workers';

const VERSION = '3.0.0';
const CAPABILITIES = { sessionReplies: true, botPush: true, asyncMessages: true };
const DEFAULT_CONFIG = { title: 'Chat with us', color: '#274e3d', welcomeMessage: 'Hello. How can I help?', avatarUrl: '' };
const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;
const RESERVED = new Set(['api','health','widget','manifest','admin','account','auth','login','signup','support','status','www','mail','static','public','relay','telemetry','docs','assets','install.sh','robots.txt','sitemap.xml','__migration']);
const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Secret', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' };
const PUBLIC_FILES = new Set(['widget.js','session-transport.js','telemetry.js','sw.js','icon-192.svg','icon-512.svg']);
const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function safeError(error) { return json({ error: error.status ? error.message : 'Relay is temporarily unavailable' }, error.status || 503); }
function key(...parts) { return JSON.stringify(parts); }
function string(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function session(value) { if (typeof value !== 'string' || value.length < 1 || value.length > 160) fail('A valid session is required'); return value; }
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value)) fail('A valid request ID is required'); return value; }
function slug(value) { const result = string(value, 200).trim().toLowerCase(); if (!SLUG.test(result) || RESERVED.has(result)) fail('Use an available address of 3–40 lowercase letters, numbers or single hyphens'); return result; }
function epoch(value, fallback = 0) { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? n : fallback; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])); return value; }
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
async function body(request, max = 700 * 1024) {
  if (Number(request.headers.get('content-length')) > max) fail('Request body is too large', 413);
  const reader = request.body?.getReader(); if (!reader) return {};
  let size = 0; const chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); fail('Request body is too large', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const result = JSON.parse(new TextDecoder().decode(bytes) || '{}'); if (!result || typeof result !== 'object' || Array.isArray(result)) fail('Expected JSON object'); return result; } catch { fail('Invalid JSON'); }
}
async function sign(secret, value) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
async function secureEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const [a,b] = await Promise.all([actual,expected].map(x => crypto.subtle.digest('SHA-256', enc.encode(x))));
  return crypto.subtle.timingSafeEqual(a,b);
}
async function tenantFor(secret, installation) { const p = (await sign(secret, `installation:${installation}`)).slice(0,18); return `${p}.${(await sign(secret, `tenant:${p}`)).slice(0,10)}`; }
async function validTenant(secret, tenant) { return /^[A-Za-z0-9_-]{18}\.[A-Za-z0-9_-]{10}$/.test(tenant) && await secureEqual(tenant.slice(19), (await sign(secret, `tenant:${tenant.slice(0,18)}`)).slice(0,10)); }
function signingSecrets(env) {
  const values=[env.RELAY_SIGNING_SECRET,...(env.LEGACY_RELAY_SIGNING_SECRET?[env.LEGACY_RELAY_SIGNING_SECRET]:[])];
  if(values.some(value=>typeof value!=='string' || value.length<32))fail('Relay credentials are not configured',503);
  return [...new Set(values)];
}
async function tenantSecret(env,tenant) {
  if(typeof tenant!=='string')return null;
  for(const secret of signingSecrets(env))if(await validTenant(secret,tenant))return secret;
  return null;
}
function stub(binding, name) { return binding.get(binding.idFromName(name)); }
function internal(request, pathname, headers = {}) { const url = new URL(request.url); url.pathname = pathname; const h = new Headers(request.headers); for (const [k,v] of Object.entries(headers)) h.set(k,v); return new Request(url, { method: request.method, headers:h, body:['GET','HEAD'].includes(request.method)?undefined:request.body, redirect:'manual' }); }
async function asset(env, request, pathname, status) {
  const url = new URL(request.url); url.pathname = pathname; url.search = '';
  const response = await env.ASSETS.fetch(new Request(url, { method:request.method === 'HEAD' ? 'HEAD' : 'GET' }));
  const headers = new Headers(response.headers); for(const [k,v] of Object.entries(HEADERS)) headers.set(k,v);
  if (pathname === '/install.sh') { headers.set('Content-Type','text/x-shellscript; charset=utf-8'); headers.set('Content-Disposition','inline; filename="install.sh"'); }
  return new Response(request.method === 'HEAD' ? null : response.body, {status:status || response.status,headers});
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url); const path = url.pathname.replace(/\/{2,}/g,'/'); const method = request.method;
      if (method === 'OPTIONS') return new Response(null, {status:204,headers:HEADERS});
      if (path === '/telemetry/config') return json({measurementId:/^G-[A-Z0-9]+$/.test(env.GA_MEASUREMENT_ID || '') ? env.GA_MEASUREMENT_ID : ''});
      if (path === '/' || path === '/docs' || path.startsWith('/docs/') || path.startsWith('/assets/') || ['/robots.txt','/sitemap.xml','/install.sh'].includes(path)) {
        if (!['GET','HEAD'].includes(method)) return json({error:'Method not allowed'},405,{Allow:'GET, HEAD'});
        return asset(env,request,path);
      }
      if (PUBLIC_FILES.has(path.slice(1))) { if (!['GET','HEAD'].includes(method)) fail('Method not allowed',405); return asset(env,request,'/_relay/'+path.slice(1)); }
      if (!env.RELAY_SIGNING_SECRET || env.RELAY_SIGNING_SECRET.length < 32) fail('Relay credentials are not configured',503);
      if (path.startsWith('/__migration/')) {
        if (env.MIGRATION_MODE !== 'true' || !env.MIGRATION_SECRET || !await secureEqual(request.headers.get('X-Migration-Secret'),env.MIGRATION_SECRET)) fail('Not found',404);
        if (method !== 'POST' || !['/__migration/import','/__migration/verify'].includes(path)) fail('Not found',404);
        const record = await body(request, 2 * 1024 * 1024);
        if (!record.data || typeof record.data !== 'object' || !await tenantSecret(env,record.tenantId)) fail('Invalid migration record');
        if (!['tenant','slug','session','event','message','receipt'].includes(record.kind)) fail('Invalid record kind');
        const forward = target => target.fetch(new Request('https://internal'+path,{
          method:'POST',headers:{'X-Migration-Secret':env.MIGRATION_SECRET,'X-Relay-Tenant':record.tenantId},body:JSON.stringify(record)
        }));
        if(record.kind==='tenant') {
          const registryResult=await forward(stub(env.REGISTRY,'registry'));
          if(!registryResult.ok) return registryResult;
          const tenantResult=await forward(stub(env.TENANTS,record.tenantId));
          if(!tenantResult.ok) return tenantResult;
          if(path.endsWith('/verify')) {
            const registered=await registryResult.json(), stored=await tenantResult.json();
            return json({matches:registered.matches===true && stored.matches===true});
          }
          return tenantResult;
        }
        return forward(record.kind==='slug' ? stub(env.REGISTRY,'registry') : stub(env.TENANTS,record.tenantId));
      }
      if (path === '/health' && method === 'GET') return json({status:'ok',version:VERSION,storage:'durable-objects-sqlite',migrationMode:env.MIGRATION_MODE === 'true',capabilities:CAPABILITIES});
      if (env.MIGRATION_MODE === 'true') fail('Relay migration is in progress',503);
      const registry = stub(env.REGISTRY,'registry');
      if (path === '/api/slugs/availability' && method === 'GET') {
        try { slug(url.searchParams.get('slug')); } catch(e) { return json({slug:string(url.searchParams.get('slug'),200),available:false,reason:e.message}); }
        return registry.fetch(internal(request,path));
      }
      if (path === '/api/tenants/register' && method === 'POST') {
        const b = await body(request); const installation = string(b.installationId,201).trim();
        if (!/^[A-Za-z0-9._:-]{16,200}$/.test(installation)) fail('A valid installation ID is required');
        const candidates=await Promise.all(signingSecrets(env).map(async secret=>({tenantId:await tenantFor(secret,installation),secret})));
        const lookup=await registry.fetch(new Request('https://internal/lookup',{method:'POST',body:JSON.stringify({tenantIds:candidates.map(candidate=>candidate.tenantId)})}));
        if(!lookup.ok)return lookup;
        const existing=(await lookup.json()).tenantIds;
        if(!Array.isArray(existing))fail('Tenant registry is unavailable',503);
        if(existing.length>1)fail('This installation has multiple existing relay identities; operator reconciliation is required',409);
        const selected=existing.length ? candidates.find(candidate=>candidate.tenantId===existing[0]) : candidates[0];
        if(!selected)fail('Tenant registry is unavailable',503);
        const tenant=selected.tenantId, signingSecret=selected.secret;
        const wanted = b.requestedSlug === undefined ? undefined : slug(b.requestedSlug);
        const registration = await registry.fetch(new Request('https://internal/register',{method:'POST',headers:{'CF-Connecting-IP':request.headers.get('CF-Connecting-IP') || 'unknown'},body:JSON.stringify({tenantId:tenant,slug:wanted})}));
        if (!registration.ok) return registration;
        const result = await registration.json();
        const base = (env.PUBLIC_BASE_URL || url.origin).replace(/\/$/,'');
        return json({status:'ready',tenantId:tenant,slug:result.slug || '',relayUrl:`${base}/${result.slug || tenant}`,tenantRelayUrl:`${base}/${tenant}`,botSecret:await sign(signingSecret,`bot:${tenant}`),ownerKey:(await sign(signingSecret,`owner:${tenant}`)).slice(0,32)},201);
      }
      const parts = path.split('/').filter(Boolean); const publicId = parts.shift() || '';
      let tenant = publicId;
      if (!await tenantSecret(env,tenant)) {
        if (!SLUG.test(publicId) || RESERVED.has(publicId)) fail('Not found',404);
        const result = await registry.fetch(new Request(`https://internal/resolve?slug=${encodeURIComponent(publicId)}`));
        tenant = (await result.json()).tenantId;
        if (!tenant || !await tenantSecret(env,tenant)) fail('Not found',404);
      }
      const route = '/'+parts.join('/');
      if ((route === '/' || /^\/k\/[^/]+$/.test(route)) && ['GET','HEAD'].includes(method)) return asset(env,request,'/_relay/index.html');
      if (route === '/manifest.json' && method === 'GET') {
        const keyValue = url.searchParams.get('key');
        return json({name:'Youbot Chat',short_name:'Youbot',start_url:`/${publicId}${keyValue ? '/k/'+encodeURIComponent(keyValue):''}`,scope:`/${publicId}/`,display:'standalone',background_color:'#f6f4ee',theme_color:'#274e3d',icons:[{src:'/icon-192.svg',sizes:'192x192',type:'image/svg+xml'},{src:'/icon-512.svg',sizes:'512x512',type:'image/svg+xml'}]});
      }
      // Migration is reachable only through the separately authenticated root route.
      if (route.startsWith('/__migration')) fail('Not found',404);
      return stub(env.TENANTS,tenant).fetch(internal(request,route,{'X-Relay-Tenant':tenant}));
    } catch(error) { return safeError(error); }
  }
};

class StoredObject extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.sql = ctx.storage.sql; this.sql.exec('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))'); this.sql.exec('CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL)'); }
  get(kind,id) { const r = this.sql.exec('SELECT data FROM records WHERE kind=? AND id=?',kind,id).toArray()[0]; return r ? JSON.parse(r.data) : null; }
  put(kind,id,data) { this.sql.exec('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',kind,id,JSON.stringify(data)); }
  del(kind,id) { this.sql.exec('DELETE FROM records WHERE kind=? AND id=?',kind,id); }
  all(kind) { return this.sql.exec('SELECT id,data FROM records WHERE kind=?',kind).toArray().map(r=>({id:r.id,...JSON.parse(r.data)})); }
  count(kind) { return this.sql.exec('SELECT count(*) AS n FROM records WHERE kind=?',kind).one().n; }
  rate(k,limit,ms) { const now=Date.now(); this.sql.exec('DELETE FROM rates WHERE reset<=?',now); const r=this.sql.exec('SELECT count,reset FROM rates WHERE id=?',k).toArray()[0]; if(r?.count>=limit) fail('Too many requests',429); if(!r && this.sql.exec('SELECT count(*) AS n FROM rates').one().n>=10000) fail('Relay is busy',503); this.sql.exec('INSERT INTO rates(id,count,reset) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',k,now+ms); }
  migrationRecord(record) { return key(record.kind,record.tenantId,record.sessionId || '',record.id || record.tenantId); }
}

export class RelayRegistry extends StoredObject {
  async fetch(request) {
    try {
      const url=new URL(request.url), path=url.pathname;
      if (path.startsWith('/__migration/')) {
        if(this.env.MIGRATION_MODE!=='true' || !this.env.MIGRATION_SECRET || !await secureEqual(request.headers.get('X-Migration-Secret'),this.env.MIGRATION_SECRET)) fail('Not found',404);
        if(request.method!=='POST' || !['/__migration/import','/__migration/verify'].includes(path)) fail('Not found',404);
        const r=await body(request,2*1024*1024);
        if (!['tenant','slug'].includes(r.kind) || !r.data || typeof r.data!=='object' || Array.isArray(r.data)
          || typeof r.id!=='string' || !r.id || r.id.includes('/')
          || request.headers.get('X-Relay-Tenant')!==r.tenantId || !await tenantSecret(this.env,r.tenantId)) fail('Invalid migration record');
        const verify=path==='/__migration/verify';
        const name=r.kind==='slug' ? slug(r.id) : (r.data.slug ? slug(r.data.slug) : '');
        if ((r.kind==='slug' && (name!==r.id || r.data.tenantId!==r.tenantId))
          || (r.kind==='tenant' && (r.id!==r.tenantId || (r.data.slug && name!==r.data.slug)))) fail('Migration identity mismatch');
        const tenantValue={slug:name};
        if (verify) return json({matches:same(this.get('imported',this.migrationRecord(r)),r)
          && same(this.get('tenant',r.tenantId),tenantValue)
          && (!name || same(this.get('slug',name),{tenantId:r.tenantId}))});
        this.ctx.storage.transactionSync(()=>{
          const existing=this.get('tenant',r.tenantId);
          if(existing && existing.slug!==name) fail('Tenant slug conflict',409);
          const prior=name ? this.get('slug',name) : null;
          if(prior && prior.tenantId!==r.tenantId) fail('Slug conflict',409);
          if(name)this.put('slug',name,{tenantId:r.tenantId});
          this.put('tenant',r.tenantId,tenantValue);
          this.put('imported',this.migrationRecord(r),r);
        });
        return json({imported:true});
      }
      if(path==='/lookup' && request.method==='POST') {
        const b=await body(request);
        if(!Array.isArray(b.tenantIds) || b.tenantIds.length<1 || b.tenantIds.length>2)fail('Invalid tenant lookup');
        for(const tenant of b.tenantIds)if(!await tenantSecret(this.env,tenant))fail('Invalid tenant lookup');
        return json({tenantIds:[...new Set(b.tenantIds)].filter(tenant=>this.get('tenant',tenant)!==null)});
      }
      if(path==='/resolve') return json({tenantId:this.get('slug',url.searchParams.get('slug'))?.tenantId || null});
      const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
      if(path==='/api/slugs/availability') { this.rate('availability:'+ip,120,3600000); const name=slug(url.searchParams.get('slug'));return json({slug:name,available:!this.get('slug',name),reason:this.get('slug',name)?'This address is already in use.':''}); }
      if(path==='/register') {
        const b=await body(request); this.rate('register:'+ip,20,3600000);
        return this.ctx.storage.transactionSync(()=>{const prior=this.get('tenant',b.tenantId);if(!prior && this.count('tenant')>=5000) fail('Relay registration capacity reached',503); if(prior?.slug && b.slug && prior.slug!==b.slug) fail('This installation already has an address',409); const name=b.slug || prior?.slug || ''; if(name && this.get('slug',name)?.tenantId && this.get('slug',name).tenantId!==b.tenantId) fail('This address is already in use',409); if(name)this.put('slug',name,{tenantId:b.tenantId});this.put('tenant',b.tenantId,{slug:name});return json({slug:name});});
      }
      fail('Not found',404);
    } catch(error) { return safeError(error); }
  }
}

export class RelayTenant extends StoredObject {
  constructor(ctx,env) { super(ctx,env); ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong')); }
  broadcast(data,role,sessionId) { for(const ws of this.ctx.getWebSockets(role)) {const meta=ws.deserializeAttachment();if(sessionId && meta?.session!==sessionId)continue;try{ws.send(JSON.stringify(data));}catch{try{ws.close(1011,'Reconnect');}catch{}}} }
  notifySession(s,event={type:'history_changed'}) { this.broadcast(event,'visitor',s); }
  addEvent(s,event) { this.put('session',s,{...(this.get('session',s)||{}),sessionId:s,lastMessageAt:event.timestamp}); this.put('event',key(s,event.id),{...event,sessionId:s}); const older=this.sql.exec("SELECT id FROM records WHERE kind='event' AND json_extract(data,'$.sessionId')=? ORDER BY json_extract(data,'$.timestamp') DESC,id DESC LIMIT -1 OFFSET 100",s).toArray();for(const row of older)this.del('event',row.id); }
  pending() { return this.sql.exec("SELECT data FROM records WHERE kind='message' AND json_extract(data,'$.status')='pending'").toArray().map(r=>JSON.parse(r.data)); }
  async schedule() {
    const now=Date.now();
    const times=this.pending().flatMap(m=>[m.expiresAt,...(m.claimedUntil>now?[m.claimedUntil]:[])]).filter(Number.isFinite);
    if(times.length) await this.ctx.storage.setAlarm(Math.max(now+100,Math.min(...times)));
    else await this.ctx.storage.deleteAlarm();
  }
  expire() {
    const now=Date.now();
    for(const m of this.pending()) {
      if(m.expiresAt>now) continue;
      this.ctx.storage.transactionSync(()=>{
        m.status='timed_out';
        m.response='This message could not be answered in time. Please try again.';
        this.put('message',m.id,m);
        this.addEvent(m.session,{id:'reply-'+m.id,role:'assistant',content:m.response,delivery:'session',timestamp:new Date(now).toISOString(),messageId:m.id,requestId:m.requestId});
      });
      this.notifySession(m.session);
      this.notifySession(m.session,{type:'message_completed',messageId:m.id});
    }
  }
  cleanup() { this.sql.exec("DELETE FROM records WHERE kind='ticket' AND json_extract(data,'$.expiresAt')<?",Date.now()); this.sql.exec("DELETE FROM records WHERE kind='message' AND json_extract(data,'$.status')!='pending' AND json_extract(data,'$.retainUntil')<?",Date.now()); }
  async alarm() { this.expire();this.cleanup(); if(this.pending().some(m=>m.claimedUntil<=Date.now()))this.broadcast({type:'messages_available'},'bot'); await this.schedule(); }
  upgrade(role,s) {
    // Public visitors cannot consume the slots needed by the authenticated bot.
    const sockets=this.ctx.getWebSockets(role);
    if(role==='bot' && sockets.length>=4) fail('Too many bot connections',429);
    if(role==='visitor') {
      if(sockets.length>=124) fail('Too many visitor connections',429);
      if(sockets.filter(ws=>ws.deserializeAttachment()?.session===s).length>=4) fail('Too many connections for this session',429);
    }
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server,[role]);
    server.serializeAttachment({role,session:s || ''});
    server.send(JSON.stringify({type:'ready'}));
    return new Response(null,{status:101,webSocket:client,headers:HEADERS});
  }
  webSocketMessage(ws) { ws.close(1008,'Use HTTP for relay operations'); }
  webSocketClose(ws,code) { try {ws.close(code===1005?1000:code);}catch{} }
  webSocketError(ws) { try {ws.close(1011,'Reconnect');}catch{} }
  async migration(request) {
    const r=await body(request,2*1024*1024);
    const object=value=>value && typeof value==='object' && !Array.isArray(value);
    const identifier=value=>typeof value==='string' && value.length>0 && value.length<=1500 && !value.includes('/');
    const historicalSession=value=>{if(typeof value!=='string' || !value.length || value.length>160)fail('Invalid migrated session');return value;};
    const time=value=>{const n=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;if(!Number.isFinite(n))fail('Invalid migrated timestamp');return n;};
    if(!['tenant','session','event','message','receipt'].includes(r.kind) || !object(r.data) || !identifier(r.id)
      || request.headers.get('X-Relay-Tenant')!==r.tenantId || !await tenantSecret(this.env,r.tenantId)) fail('Invalid migration record');
    const identity=this.get('metadata','identity');
    if(identity && identity.tenantId!==r.tenantId)fail('Migration tenant mismatch',409);
    const rid=this.migrationRecord(r), d=r.data, projections=[];
    if(r.kind==='tenant') {
      if(r.id!==r.tenantId || (d.config!==undefined && !object(d.config)) || (d.slug!==undefined && slug(d.slug)!==d.slug))fail('Invalid migrated tenant');
      projections.push(['config','config',{...DEFAULT_CONFIG,...d.config}],['metadata','tenant',d]);
    }
    if(r.kind==='session') {
      historicalSession(r.sessionId);
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(r.sessionId)));
      const expected=btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      if(d.sessionId!==r.sessionId || r.id!==expected)fail('Migration session identity mismatch');
      if(d.lastMessageAt!==undefined)time(d.lastMessageAt);
      projections.push(['session',r.sessionId,d]);
    }
    if(r.kind==='event') {
      historicalSession(r.sessionId);
      if(!['user','assistant'].includes(d.role) || typeof d.content!=='string' || (d.id!==undefined && !identifier(d.id)))fail('Invalid migrated history event');
      const timestamp=d.createdAt || d.timestamp;time(timestamp);
      projections.push(['event',key(r.sessionId,r.id),{...d,id:d.id || r.id,sessionId:r.sessionId,timestamp}]);
    }
    if(r.kind==='message') {
      historicalSession(d.session);
      if(!['pending','resolved','timed_out'].includes(d.status) || (d.id!==undefined && d.id!==r.id)
        || (d.message!==undefined && typeof d.message!=='string') || (d.response!==undefined && typeof d.response!=='string'))fail('Invalid migrated message');
      const claimedUntil=time(d.claimedUntil), expiresAt=time(d.expireAt), createdAt=time(d.createdAt);
      projections.push(['message',r.id,{...d,id:r.id,claimedUntil,expiresAt,retainUntil:expiresAt,createdAt}]);
    }
    if(r.kind==='receipt') {
      historicalSession(d.sessionId);if(typeof d.content!=='string')fail('Invalid migrated reply receipt');
      if(d.createdAt!==undefined)time(d.createdAt);
      projections.push(['receipt',r.id,d]);
    }
    if(new URL(request.url).pathname==='/__migration/verify') return json({matches:same(this.get('imported',rid),r)
      && identity?.tenantId===r.tenantId && projections.every(([kind,id,value])=>same(this.get(kind,id),value))});
    this.ctx.storage.transactionSync(()=>{
      if(r.kind!=='tenant' && !this.get('metadata','tenant'))fail('Import tenant before its records',409);
      if(r.kind==='event' && !this.get('session',r.sessionId))fail('Import session before history',409);
      if(r.kind==='receipt' && !this.get('session',d.sessionId))fail('Import session before reply receipts',409);
      for(const [kind,id,value] of projections)this.put(kind,id,value);
      this.put('metadata','identity',{tenantId:r.tenantId});this.put('imported',rid,r);
    });
    return json({imported:true});
  }
  async fetch(request) {
    try {
      const url=new URL(request.url), path=url.pathname, method=request.method;
      if(path.startsWith('/__migration/')) {
        if(this.env.MIGRATION_MODE!=='true' || !this.env.MIGRATION_SECRET || !await secureEqual(request.headers.get('X-Migration-Secret'),this.env.MIGRATION_SECRET)) fail('Not found',404);
        if(method!=='POST' || !['/__migration/import','/__migration/verify'].includes(path)) fail('Not found',404);
        return await this.migration(request);
      }
      const tenant=request.headers.get('X-Relay-Tenant'); if(!tenant)fail('Not found',404);
      const signingSecret=await tenantSecret(this.env,tenant);if(!signingSecret)fail('Not found',404);
      this.expire(); this.cleanup();
      if(path==='/health' && method==='GET')return json({status:'ok',version:VERSION,tenant,connected:this.ctx.getWebSockets('bot').length>0,capabilities:CAPABILITIES});
      if(path==='/api/config' && method==='GET')return json(this.get('config','config') || DEFAULT_CONFIG);
      const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
      if(path==='/api/bot/events' && method==='GET') {
        if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')fail('WebSocket upgrade required',426);
        const t=url.searchParams.get('ticket');const value=this.get('ticket',t || '');if(!value || value.expiresAt<Date.now())fail('Invalid or expired connection ticket',401);this.del('ticket',t);return this.upgrade('bot');
      }
      if(path.startsWith('/api/bot/')) {
        const provided=request.headers.get('X-Bot-Secret') || url.searchParams.get('secret');
        if(!await secureEqual(provided,await sign(signingSecret,`bot:${tenant}`)))fail('Invalid bot credential',401);
        if(path==='/api/bot/socket-ticket' && method==='POST'){this.rate('ticket',60,60000);const t=crypto.randomUUID();this.put('ticket',t,{expiresAt:Date.now()+30000});return json({ticket:t,expiresIn:30});}
        if(path==='/api/bot/poll' && method==='GET') {
          this.rate('poll',600,60000); const m=this.pending().sort((a,b)=>a.createdAt-b.createdAt).find(m=>m.claimedUntil<=Date.now());
          if(m){m.claimedUntil=Date.now()+60000;this.put('message',m.id,m);await this.schedule();}
          return json({messages:m?[{id:m.id,session:m.session,name:m.name,message:m.message,ownerKey:m.ownerKey || '',audio:m.audio || '',image:m.image || ''}]:[],capabilities:CAPABILITIES});
        }
        if(method!=='POST')fail('Not found',404);
        const b=await body(request);
        if(path==='/api/bot/typing') {
          const m=this.get('message',string(b.messageId,100));
          if(m?.status==='pending') {
            const now=Date.now();
            // Active work can outlive the initial visitor wait, up to 30 minutes
            // from acceptance. A stalled client cannot retain work indefinitely.
            m.expiresAt=Math.min(m.createdAt+30*60000,now+180000);
            m.claimedUntil=Math.min(m.expiresAt,now+60000);
            this.put('message',m.id,m);
            await this.schedule();
          }
          return json({ok:true,status:m?.status==='pending'?'pending':'already_resolved'});
        }
        if(path==='/api/bot/reply') {
          const m=this.get('message',string(b.messageId,100));if(!m)fail('Message not found',404);const response=string(b.response,50000);
          if(m.status==='resolved'){if(m.response!==response)fail('Message was answered differently',409);return json({ok:true,status:'duplicate'});}
          if(m.status!=='pending')fail('Message expired',409);
          this.ctx.storage.transactionSync(()=>{m.status='resolved';m.response=response;this.put('message',m.id,m);if(response)this.addEvent(m.session,{id:'reply-'+m.id,role:'assistant',content:response,delivery:'session',timestamp:new Date().toISOString(),messageId:m.id,requestId:m.requestId});});
          this.notifySession(m.session);this.notifySession(m.session,{type:'message_completed',messageId:m.id});await this.schedule();return json({ok:true});
        }
        if(path==='/api/bot/send') {
          const s=session(b.session), rid=id(b.requestId), content=string(b.response,50001);if(!content.trim() || content.length>50000)fail('A valid response is required');if(!this.get('session',s))fail('Visitor session was not found',404);
          const prior=this.get('receipt',rid);if(prior){if(prior.sessionId!==s || prior.content!==content)fail('Request ID already used for a different reply',409);return json({ok:true,requestId:rid,status:'duplicate'});}
          if(this.count('receipt')>=10000)fail('Reply receipt capacity reached',503);
          this.ctx.storage.transactionSync(()=>{this.put('receipt',rid,{sessionId:s,content});this.addEvent(s,{id:rid,role:'assistant',content,delivery:'session',timestamp:new Date().toISOString()});});this.notifySession(s);return json({ok:true,requestId:rid,status:'sent'});
        }
        if(path==='/api/bot/config') {
          const c={...(this.get('config','config') || DEFAULT_CONFIG)};if(typeof b.title==='string' && b.title.trim())c.title=b.title.trim().slice(0,100);if(/^#[0-9a-fA-F]{6}$/.test(b.color))c.color=b.color;if(typeof b.welcomeMessage==='string')c.welcomeMessage=b.welcomeMessage.slice(0,1000);if(typeof b.avatarUrl==='string')c.avatarUrl=b.avatarUrl.slice(0,2000);this.put('config','config',c);return json({ok:true,config:c});
        }
        fail('Not found',404);
      }
      if(path==='/api/events' && method==='GET'){this.rate('socket:'+ip,60,60000);if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')fail('WebSocket upgrade required',426);return this.upgrade('visitor',session(url.searchParams.get('session')));}
      if(path==='/api/history' && method==='GET') {
        this.rate('history:'+ip,240,60000);const s=session(url.searchParams.get('session'));const messages=this.sql.exec("SELECT data FROM records WHERE kind='event' AND json_extract(data,'$.sessionId')=? ORDER BY json_extract(data,'$.timestamp') DESC,id DESC LIMIT 100",s).toArray().reverse().map(r=>{const {sessionId,createdAt,...event}=JSON.parse(r.data);return event;});
        return json({messages,sessionId:s,pending:this.pending().filter(m=>m.session===s).map(m=>({messageId:m.id,requestId:m.requestId}))});
      }
      if(path==='/api/message' && method==='POST') {
        const b=await body(request),s=session(b.session),rid=b.requestId===undefined?crypto.randomUUID():id(b.requestId);
        const data={session:s,name:string(b.name,160).trim() || 'Website Visitor',message:string(b.message,20000).trim(),audio:string(b.audio,700*1024),image:string(b.image,700*1024),ownerKey:string(b.ownerKey,256)};
        if(!data.message && !data.audio && !data.image)fail('A message, voice note, or image is required');
        if(data.ownerKey && !await secureEqual(data.ownerKey,(await sign(signingSecret,`owner:${tenant}`)).slice(0,32)))fail('Invalid owner credential',403);
        if(data.image && !data.ownerKey)fail('Owner credential required for image attachments',403);
        const messageId=await sign(signingSecret,key('message',tenant,s,rid)); const existing=this.get('message',messageId);
        if(existing){if(!same(existing.input,data))fail('Request ID already used for a different message',409);return json({accepted:true,messageId,sessionId:s},202);}
        this.rate('message:'+ip,30,60000);this.rate('messages',120,60000);
        if(this.pending().length>=50)fail('This concierge is busy. Please try again shortly.',503);
        if(!this.get('session',s) && this.count('session')>=1000)fail('Visitor session capacity reached',503);
        const now=Date.now();this.ctx.storage.transactionSync(()=>{this.put('message',messageId,{...data,id:messageId,requestId:rid,input:data,status:'pending',claimedUntil:0,createdAt:now,expiresAt:now+180000,retainUntil:now+86400000});this.addEvent(s,{id:'user-'+messageId,role:'user',content:data.message || (data.audio?'[Voice message]':'[Image]'),timestamp:new Date(now).toISOString(),requestId:rid,messageId});});
        await this.schedule();this.broadcast({type:'messages_available'},'bot');this.notifySession(s);return json({accepted:true,messageId,sessionId:s},202);
      }
      fail('Not found',404);
    }catch(error){return safeError(error);}
  }
}
