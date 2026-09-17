'use strict';
const fs = require('node:fs');
const path = require('node:path');
const installerFile = fs.existsSync(path.join(__dirname,'../install.sh'))
 ? '../install.sh'
 : '../../../install.sh';
// Explicit public allowlist: never serve the generator, server or runtime files.
const pages = new Map([
 ['/', 'index.html'], ['/docs', 'docs/index.html'],
 ...['installation','first-concierge','ai-providers','connections','relay','privacy','troubleshooting'].map(slug => [`/docs/${slug}`, `docs/${slug}/index.html`]),
]);
const assets = new Map([
 ['/assets/site.css', ['assets/site.css','text/css; charset=utf-8']],
 ['/assets/site.js', ['assets/site.js','application/javascript; charset=utf-8']],
 ['/assets/telemetry.js', ['../public/telemetry.js','application/javascript; charset=utf-8']],
 ['/assets/icon.svg', ['assets/icon.svg','image/svg+xml']],
 ['/assets/Inter.ttf', ['assets/Inter.ttf','font/ttf']],
 ['/assets/Inter-OFL.txt', ['assets/Inter-OFL.txt','text/plain; charset=utf-8']],
 ['/robots.txt', ['robots.txt','text/plain; charset=utf-8']],
 ['/sitemap.xml', ['sitemap.xml','application/xml; charset=utf-8']],
 ['/install.sh', [installerFile,'text/x-shellscript; charset=utf-8']],
]);
const RESERVED_PATH_SEGMENTS = new Set(
 [...pages.keys(), ...assets.keys()]
  .map(route => route.split('/').filter(Boolean)[0])
  .filter(Boolean),
);
const headers = {
 'X-Content-Type-Options': 'nosniff',
 'Referrer-Policy': 'strict-origin-when-cross-origin',
 'X-Frame-Options': 'DENY',
 'Content-Security-Policy': "default-src 'none'; script-src 'self' https://www.googletagmanager.com; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' https://www.google-analytics.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
function serveWebsite(req,res,pathname) {
 const normalized=pathname.length>1 ? pathname.replace(/\/$/,'') : pathname;
 const page=pages.get(normalized), asset=assets.get(normalized);
 const isMissingPage = normalized === '/404' || normalized.startsWith('/docs/') || normalized.startsWith('/assets/');
 if(!page && !asset && !isMissingPage) return false;
 if(req.method!=='GET' && req.method!=='HEAD') {
  res.writeHead(405,{...headers,'Allow':'GET, HEAD','Content-Type':'text/plain; charset=utf-8'});res.end('Method not allowed');return true;
 }
 const file=page || asset?.[0] || '404.html';
 const content=fs.readFileSync(path.join(__dirname,file));
 res.writeHead(page||asset?200:404,{
  ...headers,
  'Content-Type': asset?.[1] || 'text/html; charset=utf-8',
  'Content-Length':content.length,
  'Cache-Control':normalized==='/install.sh'?'no-cache':asset?'public, max-age=3600':'no-cache',
  ...(normalized==='/install.sh'?{'Content-Disposition':'inline; filename="install.sh"'}:{}),
 });
 res.end(req.method==='HEAD'?undefined:content);return true;
}
module.exports={serveWebsite,RESERVED_PATH_SEGMENTS};
