/** Browser-guided source launcher. No credentials are put in URLs or logs. */
import http from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.join(root, 'youbot-core');
const home = process.env.YOUBOT_DESKTOP_HOME || path.join(os.homedir(), '.youbot-desktop');
const configPath = path.join(home, 'config.json');
const token = randomBytes(24).toString('hex');
const port = Number(process.env.YOUBOT_DESKTOP_PORT || 11490);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
const npmCli = path.resolve(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
const state = { phase: 'welcome', step: '', error: '', url: '', returning: existsSync(configPath) };

let child;
let busy = false;
let secretValues = [];
await fs.mkdir(home, { recursive: true, mode: 0o700 });
const logPath = path.join(home, 'setup.log');
function redact(text) { let output = text; for (const secret of secretValues) if (secret) output = output.split(secret).join('[hidden]'); return output; }
async function log(text) { await fs.appendFile(logPath, redact(text), { mode: 0o600 }); }
async function runNpm(cwd, args) {
  if (!existsSync(npmCli)) throw new Error('The Node.js installation is missing npm. Install Node.js 22 or newer from nodejs.org and reopen Start Youbot.');
  await new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [npmCli, ...args], { cwd, env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    processChild.stdout.on('data', data => { void log(data.toString()); });
    processChild.stderr.on('data', data => { void log(data.toString()); });
    processChild.once('error', reject);
    processChild.once('exit', code => code === 0 ? resolve() : reject(new Error(`A setup step could not finish (code ${code}). Check your internet connection and available disk space, then try again. Details are in ${logPath}.`)));
  });
}
async function writeNewConfig(username, password) {
  if (existsSync(configPath)) return;
  const config = {
    version: '3.0',
    server: { port, host: '127.0.0.1', auth: { mode: 'local', username, password } },
    database: { path: path.join(home, 'data', 'youbot.db') },
    capabilities: { models: { enabled: true, default: '', providers: {} }, search: { enabled: true, default: 'duckduckgo', providers: { duckduckgo: { enabled: true } } } },
    channels: { whatsapp: { enabled: false }, telegram: { enabled: false }, webchat: { enabled: false } },
  };
  await fs.mkdir(path.join(home, 'data'), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
}
async function isYoubotRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/status`, { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    return response.ok && typeof data.authRequired === 'boolean';
  } catch { return false; }
}
async function buildAndStart(username, password) {
  busy = true; state.phase = 'working'; state.error = '';
  secretValues = [password];
  try {
    if (await isYoubotRunning()) throw new Error(`Another Youbot is using port ${port}. Stop it before starting this installation.`);
    state.step = 'Saving your setup';
    await writeNewConfig(username, password);
    state.returning = true;
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    secretValues.push(config.server?.auth?.password, config.server?.access_password);
    const isRelease = existsSync(path.join(root, 'release-manifest.json'));
    if (isRelease) {
      state.step = 'Checking your download';
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.json'), 'utf8'));
      for (const [relative, expected] of Object.entries(manifest.files)) {
        const target = path.resolve(root, relative);
        if (!target.startsWith(root + path.sep)) throw new Error('Invalid release manifest. Download a fresh copy.');
        const hash = createHash('sha256').update(await fs.readFile(target)).digest('hex');
        if (hash !== expected) throw new Error('Your download is incomplete or changed. Download and extract a fresh release. Your saved data will be kept.');
      }
    }
    state.step = 'Getting the assistant ready. The first start can take several minutes.';
    if (isRelease) {
      const lockHash = createHash('sha256').update(await fs.readFile(path.join(core, 'package-lock.json'))).digest('hex');
      const installedPath = path.join(core, 'node_modules', '.youbot-installed');
      const installed = await fs.readFile(installedPath, 'utf8').catch(() => '');
      if (installed !== lockHash) {
        await runNpm(core, ['ci', '--omit=dev']);
        await fs.writeFile(installedPath, lockHash);
      }
    } else {
      if (!existsSync(path.join(core, 'node_modules', '.bin', 'tsc'))) await runNpm(core, ['ci']);
      state.step = 'Getting the interface ready';
      if (!existsSync(path.join(core, 'web-ui', 'node_modules', '.bin', 'next'))) await runNpm(path.join(core, 'web-ui'), ['ci']);
      state.step = 'Building your assistant';
      await runNpm(core, ['run', 'build']);
      state.step = 'Building your interface';
      await runNpm(path.join(core, 'web-ui'), ['run', 'build']);
    }
    state.step = 'Starting Youbot';
    const app = path.join(home, 'app');
    await fs.mkdir(app, { recursive: true });
    for (const [source, target] of [['dist', 'dist'], ['web-ui/out', 'web']]) {
      await fs.rm(path.join(app, target), { recursive: true, force: true });
      await fs.cp(path.join(core, source), path.join(app, target), { recursive: true });
    }
    await fs.copyFile(path.join(core, 'package.json'), path.join(app, 'package.json'));
    const modulesLink = path.join(app, 'node_modules');
    const modulesStat = await fs.lstat(modulesLink).catch(() => null);
    if (modulesStat?.isSymbolicLink()) await fs.unlink(modulesLink);
    else if (modulesStat) throw new Error('The app dependencies folder needs attention. See START HERE.md before changing any files.');
    await fs.symlink(path.join(core, 'node_modules'), modulesLink, process.platform === 'win32' ? 'junction' : 'dir');
    child = spawn(process.execPath, [path.join(app, 'dist', 'index.js')], { cwd: app, env: { ...process.env, YOUBOT_HOME: home, DATABASE_PATH: path.join(home, 'data', 'youbot.db'), PORT: String(port), YOUBOT_HOST: '127.0.0.1', NODE_ENV: 'production', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', data => { void log(data.toString()); });
    child.stderr.on('data', data => { void log(data.toString()); });
    child.on('error', error => { state.phase = 'error'; state.error = error.message; });
    child.on('exit', () => { if (state.phase !== 'stopped') { state.phase = 'error'; state.error = `Youbot stopped. Open ${logPath} for details, then try again.`; } });
    for (let i = 0; i < 90; i++) {
      if (state.phase === 'error') throw new Error(state.error);
      if (await isYoubotRunning()) { state.phase = 'ready'; state.url = `http://127.0.0.1:${port}/setup`; return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    child.kill();
    throw new Error(`Youbot took too long to start. Details are in ${logPath}.`);
  } catch (error) { state.phase = 'error'; state.error = redact(error.message); }
  finally { busy = false; }
}
const html = await fs.readFile(path.join(root, 'scripts', 'desktop-setup.html'), 'utf8');
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, origin);
  if (url.pathname === '/' && req.method === 'GET') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  const authorization = req.headers.authorization || '';
  const expected = `Bearer ${token}`;
  if (Buffer.byteLength(authorization) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/status' && req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)); return; }
  if (req.method !== 'POST' || req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/start') {
    if (busy || state.phase === 'ready') { res.writeHead(409); res.end(); return; }
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Form too large'); }
      const { username = '', password = '' } = JSON.parse(body);
      if (!state.returning && (typeof username !== 'string' || !username.trim() || username.length > 80 || typeof password !== 'string' || password.length < 10 || password.length > 200)) throw new Error('Choose a name and a password with at least 10 characters.');
      void buildAndStart(username.trim(), password);
      res.writeHead(202); res.end('{}');
    } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
    return;
  }
  if (url.pathname === '/stop') { state.phase = 'stopped'; child?.kill(); res.end('{}'); return; }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/#${token}`;
  console.log('Youbot setup is opening in your browser. Keep this window open while using Youbot.');
  if (process.env.YOUBOT_SETUP_NO_BROWSER === '1') { console.log(url); return; }
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  browser.on('error', () => console.log(`Open this address on this computer: ${url}`));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { state.phase = 'stopped'; child?.kill(); server.close(); setTimeout(() => process.exit(0), 1000).unref(); });
