import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageRoot = join(repositoryRoot, 'packages', 'collection-engine');
const temporary = await mkdtemp(join(tmpdir(), 'collection-engine-consumer-'));
const isolatedEnvironment = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };
let tarball;

try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json'], { cwd: packageRoot, encoding: 'utf8', env: isolatedEnvironment }));
  tarball = join(packageRoot, packed[0].filename);
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.dependencies, {}, 'packed engine must have zero runtime dependencies');
  assert.equal(JSON.stringify(packageJson.scripts).includes('youbot-core'), false, 'package scripts cannot use workspace paths');
  const entries = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(entries.every((entry) => entry.startsWith('package/dist/') || entry.startsWith('package/dist-cjs/') || entry === 'package/package.json' || entry === 'package/README.md'));
  const sourceText = execFileSync('tar', ['-xOf', tarball, ...entries.filter((entry) => entry.endsWith('.js'))], { encoding: 'utf8' });
  assert.equal(/from\s+['\"](?:react|next|openai|pdf-parse|@anthropic-ai|@google\/generative-ai)/.test(sourceText), false);
  assert.equal(/youbot-core|\.\.\/\.\.\//.test(sourceText), false);
  assert.equal(/upload|ocr|parse_pdf|import_(?:start|status|cancel|retry)/i.test(sourceText), false);

  await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: 'independent-collection-consumer', private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temporary, stdio: 'pipe', env: isolatedEnvironment });
  const consumer = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  COLLECTION_TOOL_NAMES, createCollectionEngine, createJsonFileCollectionRepository,
  executeCollectionTool, getCollectionToolDefinitions
} from '@youbot/collection-engine';

const require = createRequire(import.meta.url);
const commonJsEngine = require('@youbot/collection-engine');
assert.equal(typeof commonJsEngine.createCollectionEngine, 'function');
assert.equal(commonJsEngine.COLLECTION_TOOL_NAMES.length, 19);

const store = new URL('./engine.json', import.meta.url).pathname;
let policyEnabled = true;
const policy = { authorize: async () => policyEnabled };
const owner = { actorId:'outside-owner', entityId:'outside-entity', audience:'owner', authorizationHandle:'trusted', correlationId:'consumer' };
const visitor = { actorId:'outside-visitor', entityId:'outside-entity', audience:'visitor', authorizationHandle:'trusted', correlationId:'consumer' };
const other = { ...owner, actorId:'other-owner', entityId:'other-entity' };
let n = 0;
const options = (repository) => ({ repository, policy, ids:{next:(p)=>p+'_'+(++n)}, clock:{now:()=>new Date('2026-09-14T12:00:00Z')} });
let repository = await createJsonFileCollectionRepository({ filePath: store });
let engine = createCollectionEngine(options(repository));
const call = (context,name,args,requestId=name+'-'+(++n),toolVersion='1') => executeCollectionTool(engine,context,{name,arguments:args,requestId,toolVersion});
const fromOpenAI = (fixture) => ({name:fixture.function.name,arguments:JSON.parse(fixture.function.arguments),requestId:fixture.id,toolVersion:'1'});
const fromMcp = (fixture) => ({name:fixture.name,arguments:fixture.arguments,requestId:fixture.requestId,toolVersion:'1'});

assert.equal(COLLECTION_TOOL_NAMES.length,19);
assert.equal(COLLECTION_TOOL_NAMES.some((name)=>/upload|parse|ocr|job|import/.test(name)),false);
const ownerDefinitions=await getCollectionToolDefinitions(engine,owner);
assert.equal(ownerDefinitions.length,19);
assert.equal(ownerDefinitions.every((definition)=>definition.metadata&&['read','write'].includes(definition.metadata.access)&&Array.isArray(definition.outputSchema.oneOf)),true);
assert.equal(ownerDefinitions.find((definition)=>definition.name==='collections_change_propose').inputSchema.properties.operations.items.oneOf.length,4);
const createCall=fromOpenAI({id:'openai-create',function:{name:'collections_create',arguments:JSON.stringify({name:'Independent classes',schema:[{id:'title',label:'Title',type:'string',required:true,public:true},{id:'price',label:'Price',type:'number',public:true}]})}});
const created=await executeCollectionTool(engine,owner,createCall); assert.equal(created.ok,true);
const collectionId=created.data.collectionId;
const ingestArgs={kind:'records',source:{reference:'external-library-result',reportedCoverage:'partial'},records:[{inputId:'r1',title:'Pottery',price:180}],manifest:{declaredCount:1}};
const ingested=await call(owner,'collections_ingest',ingestArgs,'ingest-once'); assert.equal(ingested.ok,true);
const retried=await call(owner,'collections_ingest',ingestArgs,'ingest-once'); assert.deepEqual(retried.data,ingested.data);
const duplicateConflict=await call(owner,'collections_ingest',{...ingestArgs,records:[{inputId:'r2'}]},'ingest-once'); assert.equal(duplicateConflict.error.code,'IDEMPOTENCY_CONFLICT');
const proposal=await call(owner,'collections_change_propose',{collectionId,expectedRevision:1,sourceRevisionIds:[ingested.data.sourceRevisionId],operations:[{kind:'create_item',itemId:'class-1',values:{title:'Pottery',price:180},status:'available',evidence:[{sourceRevisionId:ingested.data.sourceRevisionId}]}]}); assert.equal(proposal.ok,true);
const applied=await call(owner,'collections_change_apply',{proposalId:proposal.data.id,expectedRevision:1}); assert.equal(applied.ok,true);
const review=await call(owner,'collections_get',{collectionId,selectedItemIds:['class-1']}); assert.equal(review.ok,true);
const publishOwner={...owner,intentReceipt:'exact-publish-intent'};
const published=await call(publishOwner,'collections_publish',{collectionId,selectedItemIds:['class-1'],expectedPublicationRevision:0,reviewedPayloadHash:review.data.publicationReview.reviewedPayloadHash}); assert.equal(published.ok,true);
const mcpSearch=fromMcp({requestId:'mcp-search',name:'collections_search',arguments:{collectionIds:[collectionId],filters:[{fieldId:'price',operator:'lte',value:180}]}});
const searched=await executeCollectionTool(engine,visitor,mcpSearch); assert.equal(searched.ok,true); assert.equal(searched.data.totalCount,1);
const crossEntity=await call(other,'collections_get',{collectionId}); assert.equal(crossEntity.error.code,'NOT_FOUND_OR_FORBIDDEN');
const visitorDefinitions=await getCollectionToolDefinitions(engine,visitor); assert.equal(visitorDefinitions.length,6);
const visitorMutation=await call(visitor,'collections_create',{name:'forged'}); assert.equal(visitorMutation.error.code,'UNAUTHORIZED');
const malformed=await call(owner,'collections_list',{entityId:'forged'}); assert.equal(malformed.error.code,'INVALID_ARGUMENT');
const unsupported=await call(owner,'collections_list',{},'unsupported','2'); assert.equal(unsupported.error.code,'UNSUPPORTED_VERSION');

repository=await createJsonFileCollectionRepository({filePath:store}); engine=createCollectionEngine(options(repository));
const afterRestart=await call(visitor,'collections_search',{collectionIds:[collectionId]}); assert.equal(afterRestart.ok,true); assert.equal(afterRestart.data.totalCount,1);
const otherAfterRestart=await call(other,'collections_list',{}); assert.equal(otherAfterRestart.ok,true); assert.equal(otherAfterRestart.data.totalCount,0);
const multiContextA={...owner,actorId:'multi-a',entityId:'multi-entity'};
const multiContextB={...owner,actorId:'multi-b',entityId:'multi-entity'};
const [multiRepositoryA,multiRepositoryB]=await Promise.all([createJsonFileCollectionRepository({filePath:store}),createJsonFileCollectionRepository({filePath:store})]);
const multiEngineA=createCollectionEngine(options(multiRepositoryA));
const multiEngineB=createCollectionEngine(options(multiRepositoryB));
const [multiA,multiB]=await Promise.all([
  executeCollectionTool(multiEngineA,multiContextA,{name:'collections_create',arguments:{name:'Concurrent A'},requestId:'multi-a',toolVersion:'1'}),
  executeCollectionTool(multiEngineB,multiContextB,{name:'collections_create',arguments:{name:'Concurrent B'},requestId:'multi-b',toolVersion:'1'})
]);
assert.equal(multiA.ok,true); assert.equal(multiB.ok,true);
repository=await createJsonFileCollectionRepository({filePath:store}); engine=createCollectionEngine(options(repository));
const multiRead=await call(multiContextA,'collections_list',{}); assert.equal(multiRead.ok,true); assert.equal(multiRead.data.totalCount,2);
policyEnabled=false;
const revoked=await call(visitor,'collections_evidence_validate',{evidenceReceiptId:searched.evidence.id}); assert.equal(revoked.error.code,'UNAUTHORIZED');
console.log(JSON.stringify({ok:true,toolCount:COLLECTION_TOOL_NAMES.length,published:afterRestart.data.totalCount,restart:true,multiInstanceWrites:true,esmImport:true,commonJsRequire:true,toolMetadata:true,nestedSchemas:true,outputValidation:true,protocolFixtures:['openai','mcp'],visitorDenied:true,policyRevocation:true}));
`;
  await writeFile(join(temporary, 'consumer.mjs'), consumer);
  const result = JSON.parse(execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, encoding: 'utf8' }).trim());
  assert.equal(result.ok, true);
  console.log(JSON.stringify({ ...result, tarball: basename(tarball), independentDirectory: true, runtimeDependencies: 0 }));
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (tarball) await rm(tarball, { force: true });
}
