import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';

const primary='primary-signing-key-for-fixtures-32characters';
const legacy='legacy-signing-key-for-fixtures-32characters';
const admin='migration-signing-key-for-fixtures-32characters';
const hmac=(secret,value)=>createHmac('sha256',secret).update(value).digest('base64url');
const tenant=(secret,installation)=>{const p=hmac(secret,`installation:${installation}`).slice(0,18);return `${p}.${hmac(secret,`tenant:${p}`).slice(0,10)}`;};
test('mixed signing identities import, authenticate and resume without recreating or merging tenants',async t=>{
  const source=await readFile(new URL('../src/worker.js',import.meta.url),'utf8');
  const dir=await mkdtemp(join(tmpdir(),'relay-legacy-identity-'));
  const runtime=migration=>new Miniflare({modules:true,script:source,compatibilityDate:'2026-07-30',
    bindings:{RELAY_SIGNING_SECRET:primary,LEGACY_RELAY_SIGNING_SECRET:legacy,MIGRATION_SECRET:admin,MIGRATION_MODE:String(migration)},
    durableObjects:{REGISTRY:{className:'RelayRegistry',useSQLite:true},TENANTS:{className:'RelayTenant',useSQLite:true}},durableObjectsPersist:dir});
  let mf=runtime(true);
  t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
  const post=async(path,data,headers={})=>{
    const response=await mf.dispatchFetch(`https://relay.test${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    return {status:response.status,data:await response.json()};
  };
  const primaryInstall='installation-primary-existing',legacyInstall='installation-legacy-existing',conflictInstall='installation-both-identities';
  const primaryId=tenant(primary,primaryInstall),legacyId=tenant(legacy,legacyInstall);
  const records=[
    {kind:'tenant',tenantId:primaryId,id:primaryId,data:{config:{title:'Primary tenant'}}},
    {kind:'tenant',tenantId:legacyId,id:legacyId,data:{config:{title:'Legacy tenant'},slug:'legacy-client'}},
    ...[primary,legacy].map(secret=>{const id=tenant(secret,conflictInstall);return {kind:'tenant',tenantId:id,id,data:{config:{title:'Conflicted tenant'}}};}),
    {kind:'slug',tenantId:legacyId,id:'legacy-client',data:{tenantId:legacyId}},
  ];
  for(const record of records){assert.equal((await post('/__migration/import',record,{'X-Migration-Secret':admin})).data.imported,true);assert.equal((await post('/__migration/verify',record,{'X-Migration-Secret':admin})).data.matches,true);}
  const unknown=tenant('unknown-signing-key-for-fixtures-32characters','installation-unrecognized');
  assert.equal((await post('/__migration/import',{kind:'tenant',tenantId:unknown,id:unknown,data:{}},{'X-Migration-Secret':admin})).status,400);
  await mf.dispose();mf=runtime(false);
  for(const [installationId,expected,secret] of [[primaryInstall,primaryId,primary],[legacyInstall,legacyId,legacy]]) {
    const resumed=await post('/api/tenants/register',{installationId});
    assert.equal(resumed.status,201);assert.equal(resumed.data.tenantId,expected);
    assert.equal(resumed.data.botSecret,hmac(secret,`bot:${expected}`));
    assert.equal(resumed.data.ownerKey,hmac(secret,`owner:${expected}`).slice(0,32));
  }
  const conflict=await post('/api/tenants/register',{installationId:conflictInstall});
  assert.equal(conflict.status,409);assert.match(conflict.data.error,/operator reconciliation/);
  const newInstall='installation-new-after-cutover';
  assert.equal((await post('/api/tenants/register',{installationId:newInstall})).data.tenantId,tenant(primary,newInstall));
  const botHeader={'X-Bot-Secret':hmac(legacy,`bot:${legacyId}`)};
  assert.equal((await post('/legacy-client/api/bot/socket-ticket',{},botHeader)).status,200);
  assert.equal((await post('/legacy-client/api/bot/socket-ticket',{}, {'X-Bot-Secret':hmac(primary,`bot:${legacyId}`)})).status,401);
  const message={session:'fixture-session-for-legacy',requestId:randomUUID(),image:'data:image/png;base64,aGVsbG8='};
  assert.equal((await post('/legacy-client/api/message',{...message,ownerKey:hmac(primary,`owner:${legacyId}`).slice(0,32)})).status,403);
  const accepted=await post('/legacy-client/api/message',{...message,ownerKey:hmac(legacy,`owner:${legacyId}`).slice(0,32)});
  assert.equal(accepted.status,202);
  assert.equal((await post('/legacy-client/api/bot/reply',{messageId:accepted.data.messageId,response:'Legacy identity works'},botHeader)).status,200);
  const history=await mf.dispatchFetch('https://relay.test/legacy-client/api/history?session='+message.session);
  assert.equal((await history.json()).messages.at(-1).content,'Legacy identity works');
});
