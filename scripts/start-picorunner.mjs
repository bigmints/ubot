import { mkdir, copyFile, access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = path.join(root, "youbot-core");
const home = path.join(root, ".picorunner-data");
const config = path.join(home, "config.json");
const portFlag = process.argv.indexOf("--port");
const defaultPort = portFlag >= 0 ? process.argv[portFlag + 1] : "5080";
const port = process.env.PORT || defaultPort;

if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error(`Invalid port: ${port}`);
}

for (const directory of [
  home,
  path.join(home, "data"),
  path.join(home, "workspace"),
  path.join(home, "sessions"),
  path.join(home, "creds"),
  path.join(home, "browser-profile"),
  path.join(home, "backups"),
]) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

try {
  await access(config, constants.F_OK);
} catch {
  await copyFile(path.join(root, "cli", "default-config.json"), config);
  await chmod(config, 0o600);
}

const child = spawn(process.execPath, [path.join(core, "dist", "index.js")], {
  cwd: core,
  env: {
    ...process.env,
    PORT: port,
    NODE_ENV: "production",
    YOUBOT_HOST: "127.0.0.1",
    YOUBOT_HOME: home,
    YOUBOT_APP_HOME: core,
    DATABASE_PATH: path.join(home, "data", "youbot.db"),
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Could not start Youbot: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
