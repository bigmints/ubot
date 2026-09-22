import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npm(args, cwd) {
  const result = spawnSync("npm", args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const collectionEngine = path.join(root, "packages", "collection-engine");
const core = path.join(root, "youbot-core");
const webUi = path.join(core, "web-ui");
const builtWeb = path.join(webUi, "out");
const servedWeb = path.join(core, "web");

npm(["ci"], collectionEngine);
npm(["run", "build"], collectionEngine);
npm(["ci"], core);
npm(["ci"], webUi);
npm(["run", "build"], core);
npm(["run", "build"], webUi);

await rm(servedWeb, { recursive: true, force: true });
await mkdir(servedWeb, { recursive: true });
await cp(builtWeb, servedWeb, { recursive: true });
