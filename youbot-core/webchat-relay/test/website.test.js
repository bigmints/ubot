const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.RELAY_SIGNING_SECRET = 'website-test-signing-secret-long-enough';
const { createServer, tenantIdFor } = require('../server.js');
let server,base;
before(async()=>{server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
test('homepage, docs and all local navigation targets are served',async()=>{
 const routes=['/','/docs','/docs/installation','/docs/first-concierge','/docs/ai-providers','/docs/connections','/docs/relay','/docs/privacy','/docs/troubleshooting'];
 const bodies=new Map();
 for(const route of routes){const response=await fetch(base+route);assert.equal(response.status,200,route);assert.match(response.headers.get('content-type'),/text\/html/);const body=await response.text();assert.match(body,/<main id="main"/);bodies.set(route,body);}
 for(const [route,body] of bodies){
  for(const [,href] of body.matchAll(/(?:href|src)="([^"\s]+)"/g)){
   if(!href.startsWith('/')&&!href.startsWith('#'))continue;
   const link=new URL(href,base+route);
   const response=await fetch(link);assert.equal(response.status,200,`${route} -> ${href}`);
   if(link.hash){const target=bodies.get(link.pathname)||await response.text();assert.ok(target.includes(`id="${link.hash.slice(1)}"`),`${route} missing anchor ${href}`);}
  }
 }
 assert.match(bodies.get('/docs/installation'),/https:\/\/youbot\.live\/install\.sh/);
 assert.match(bodies.get('/docs/installation'),/without (?:administrator|root) access/);
 assert.match(bodies.get('/docs/installation'),/Coming soon/);
 assert.match(bodies.get('/docs/privacy'),/Aggregate analytics/);
 assert.match(bodies.get('/docs/privacy'),/does not create Google Analytics or advertising cookies/);
});
test('site returns correct HEAD, method errors, security headers and 404s',async()=>{
 const head=await fetch(base+'/docs/installation/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.ok(Number(head.headers.get('content-length'))>0);
 assert.match(head.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.match(head.headers.get('content-security-policy'),/www\.googletagmanager\.com/);
 assert.match(head.headers.get('content-security-policy'),/www\.google-analytics\.com/);
 const post=await fetch(base+'/',{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
 const installer=await fetch(base+'/install.sh');
 assert.equal(installer.status,200);
 assert.match(installer.headers.get('content-type'),/text\/x-shellscript/);
 assert.equal(installer.headers.get('cache-control'),'no-cache');
 assert.match(installer.headers.get('content-disposition'),/filename="install\.sh"/);
 const installerBody=await installer.text();
 assert.match(installerBody,/^#!\/usr\/bin\/env bash/);
 assert.match(installerBody,/set -Eeuo pipefail/);
 assert.match(installerBody,/Bigmints-com\/ubot/);
 const installerHead=await fetch(base+'/install.sh',{method:'HEAD'});
 assert.equal(installerHead.status,200);
 assert.equal(await installerHead.text(),'');
 assert.ok(Number(installerHead.headers.get('content-length'))>0);
 const installerPost=await fetch(base+'/install.sh',{method:'POST'});
 assert.equal(installerPost.status,405);
 assert.equal(installerPost.headers.get('allow'),'GET, HEAD');
 for(const route of ['/docs/missing','/assets/missing','/assets/../build.mjs','/website/build.mjs','/website/serve.cjs','/assets/%2e%2e%2fserve.cjs']){assert.equal((await fetch(base+route)).status,404,route);}
});
test('homepage coexists with signed entity chat, relay health and bot authentication',async()=>{
 const tenant=tenantIdFor('website-route-integration-0001');
 const chat=await fetch(`${base}/${tenant}`);assert.equal(chat.status,200);const body=await chat.text();assert.doesNotMatch(body,/YOUR PERSONAL AI CONCIERGE/);
 assert.equal((await fetch(`${base}/${tenant}/api/bot/poll`)).status,401);
 assert.equal((await fetch(`${base}/${tenant}/health`)).status,200);
 assert.equal((await fetch(`${base}/health`)).status,200);
 const telemetryConfig=await (await fetch(`${base}/telemetry/config`)).json();assert.deepEqual(telemetryConfig,{measurementId:''});
 assert.equal((await fetch(`${base}/telemetry.js`)).status,200);
 assert.equal((await fetch(`${base}/not-a-tenant/api/config`)).status,404);
});
