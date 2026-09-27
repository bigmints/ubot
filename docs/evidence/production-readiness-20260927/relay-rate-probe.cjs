process.env.RELAY_SIGNING_SECRET='isolated-readiness-probe-signing-secret';
const {createServer}=require('./youbot-core/webchat-relay/server.js');
(async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {const base=`http://127.0.0.1:${server.address().port}`;const send=ip=>fetch(base+'/api/tenants/register',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({installationId:'invalid'})});
let first,last;for(let i=0;i<21;i++){const r=await send('198.51.100.1');if(i===0)first=r.status;last=r.status;await r.text();}
const changed=await send('198.51.100.2');console.log(JSON.stringify({firstStatus:first,afterLimitStatus:last,changedForwardedForStatus:changed.status}));await changed.text();
}finally{await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.message);process.exitCode=1});
