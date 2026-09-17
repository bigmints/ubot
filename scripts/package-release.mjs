/** Stage a prebuilt self-hosted release without source-tree credentials or databases. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/package-release.mjs /absolute/new/output-directory');
const out = path.resolve(destination);
// Refuse to replace existing folders or package into source/runtime trees.
if (out === root || out.startsWith(root + path.sep)) throw new Error('Choose an output folder outside the source checkout.');
const entries = [
  'Start Youbot.command', 'Start Youbot.cmd', 'START HERE.md',
  'scripts/start-desktop.mjs', 'scripts/start-windows.ps1', 'scripts/desktop-setup.html',
  'youbot-core/package.json', 'youbot-core/package-lock.json',
  'youbot-core/scripts/fix-whisper-addon.mjs', 'youbot-core/dist', 'youbot-core/web-ui/out',
];
for (const entry of entries) {
  await fs.mkdir(path.dirname(path.join(out, entry)), { recursive: true });
  await fs.cp(path.join(root, entry), path.join(out, entry), { recursive: true });
}
const files = {};
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(target);
    else files[path.relative(out, target).split(path.sep).join('/')] = createHash('sha256').update(await fs.readFile(target)).digest('hex');
  }
}
await walk(out);
await fs.writeFile(path.join(out, 'release-manifest.json'), JSON.stringify({ format: 1, edition: 'self-hosted', builtAt: new Date().toISOString(), files }, null, 2));
await fs.chmod(path.join(out, 'Start Youbot.command'), 0o755);
console.log(`Staged ${Object.keys(files).length} files in ${out}`);
