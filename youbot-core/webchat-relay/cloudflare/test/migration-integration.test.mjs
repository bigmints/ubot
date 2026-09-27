import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const secret='migration-test-signing-secret-32-characters';
const migrationSecret='migration-test-admin-secret-32-characters';
const sign=value=>createHmac('sha256',secret).update(value).digest('base64url');
const payload=sign('installation:migration-test-installation').slice(0,18);
const tenantId=`${payload}.${sign(`tenant:${payload}`).slice(0,10)}`;
const sessionId='legacy-session-migration';
const timestamp='2026-09-27T00:00:00.000Z';
const future='2099-09-27T00:00:00.000Z';
const sessionHash=createHash('sha256').update(sessionId).digest('base64url');
const records=[
  {kind:'tenant',tenantId,id:tenantId,data:{config:{title:'Migrated concierge'},slug:'migration-test',createdAt:timestamp}},
  {kind:'slug',tenantId,id:'migration-test',data:{tenantId,createdAt:timestamp}},
  {kind:'session',tenantId,id:sessionHash,sessionId,data:{sessionId,lastMessageAt:timestamp}},
  {kind:'event',tenantId,id:'firestore-document-id',sessionId,data:{id:'public-event-id',role:'user',content:'Fixture message',createdAt:timestamp,timestamp:'2026-09-26T00:00:00.000Z'}},
  {kind:'message',tenantId,id:'message-id',data:{id:'message-id',session:sessionId,message:'Fixture pending',status:'pending',claimedUntil:timestamp,createdAt:timestamp,expireAt:future}},
  {kind:'receipt',tenantId,id:'reply-request-id',data:{sessionId,content:'Fixture receipt',createdAt:timestamp}},
];

test('migration preserves all six active representations and detects corruption independently of the archived record', async t=>{
  const source=await readFile(new URL('../src/worker.js',import.meta.url),'utf8');
  // Test-only subclasses let us change active data while leaving the import archive intact.
  const harness=source+`
export class MigrationTestTenant extends RelayTenant {
  async fetch(request) {
    if(new URL(request.url).pathname==='/__test/corrupt') {
      const {kind,id}=await request.json();this.put(kind,id,{corrupt:true});return new Response('ok');
    }
    return super.fetch(request);
  }
}
export class MigrationTestRegistry extends RelayRegistry {
  async fetch(request) {
    if(new URL(request.url).pathname==='/__test/corrupt') {
      const {kind,id}=await request.json();this.put(kind,id,{corrupt:true});return new Response('ok');
    }
    return super.fetch(request);
  }
}`;
  const mf=new Miniflare({modules:true,script:harness,compatibilityDate:'2026-07-30',
    bindings:{RELAY_SIGNING_SECRET:secret,MIGRATION_SECRET:migrationSecret,MIGRATION_MODE:'true'},
    durableObjects:{REGISTRY:{className:'MigrationTestRegistry',useSQLite:true},TENANTS:{className:'MigrationTestTenant',useSQLite:true}},
  });
  t.after(()=>mf.dispose());
  const call=(action,record,headers={})=>mf.dispatchFetch(`https://relay.test/__migration/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Migration-Secret':migrationSecret,...headers},body:JSON.stringify(record)});
  for(const record of records){const response=await call('import',record);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).imported,true);}
  for(const record of records){const response=await call('verify',record);assert.equal(response.status,200);assert.equal((await response.json()).matches,true,record.kind);}
  const tenantNamespace=await mf.getDurableObjectNamespace('TENANTS');
  const tenant=tenantNamespace.get(tenantNamespace.idFromName(tenantId));
  const projections=[['config','config'],['session',sessionId],['event',JSON.stringify([sessionId,'firestore-document-id'])],['message','message-id'],['receipt','reply-request-id']];
  for(const [index,projection] of projections.entries()) {
    const record=records[index===0?0:index+1];
    await tenant.fetch('https://internal/__test/corrupt',{method:'POST',body:JSON.stringify({kind:projection[0],id:projection[1]})});
    assert.equal((await (await call('verify',record)).json()).matches,false,record.kind);
    assert.equal((await (await call('import',record)).json()).imported,true);
    assert.equal((await (await call('verify',record)).json()).matches,true);
  }
  const registryNamespace=await mf.getDurableObjectNamespace('REGISTRY');
  const registry=registryNamespace.get(registryNamespace.idFromName('registry'));
  await registry.fetch('https://internal/__test/corrupt',{method:'POST',body:JSON.stringify({kind:'slug',id:'migration-test'})});
  assert.equal((await (await call('verify',records[1])).json()).matches,false);
  assert.equal((await (await call('verify',records[0])).json()).matches,false,'tenant verification includes registry mapping');

  const forged={...records[5],tenantId:'unsigned-invalid-tenant'};
  assert.equal((await call('import',forged)).status,400);
  const invalidSession={...records[2],id:'wrong-session-hash'};
  assert.equal((await call('import',invalidSession)).status,400);
  const invalidTimestamp={...records[4],data:{...records[4].data,expireAt:'invalid'}};
  assert.equal((await call('import',invalidTimestamp)).status,400);
  assert.equal((await call('import',records[0],{'X-Migration-Secret':'wrong'})).status,404);
  const bypass=await mf.dispatchFetch(`https://relay.test/${tenantId}/__migration/import`,{method:'POST',body:JSON.stringify(records[0])});
  assert.ok([404,503].includes(bypass.status));
  const direct=await tenant.fetch('https://internal/__migration/import',{method:'POST',headers:{'X-Relay-Tenant':tenantId},body:JSON.stringify(records[0])});
  assert.equal(direct.status,404,'DO enforces migration secret independently');
});
