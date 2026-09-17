import crypto from 'node:crypto';
import fs from 'node:fs';
import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const FORMAT_VERSION = 1;
const COPY_ROOTS = ['config.json', 'data', 'provider-access', 'creds', 'sessions', 'workspace', 'custom', 'collection-sources'];
const EXCLUDED_DIRECTORY_NAMES = new Set(['backups', 'browser-profile', 'logs', 'models']);

export interface BackupFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  databasePath: string;
  files: BackupFileEntry[];
  excluded: string[];
}

export interface BackupResult {
  backupPath: string;
  manifest: BackupManifest;
}

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function assertInsideHome(home: string, candidate: string, label: string): string {
  const relative = path.relative(home, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside YOUBOT_HOME`);
  }
  return relative.split(path.sep).join('/');
}

function readConfiguredDatabasePath(home: string): string {
  if (process.env.DATABASE_PATH) {
    return path.resolve(process.env.DATABASE_PATH);
  }
  if (process.env.SQLITE_DB_PATH) {
    return path.resolve(process.env.SQLITE_DB_PATH);
  }
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')) as { database?: { path?: string } };
    const configured = config.database?.path || path.join('data', 'youbot.db');
    return path.isAbsolute(configured) ? configured : path.resolve(home, configured);
  } catch {
    return path.join(home, 'data', 'youbot.db');
  }
}

function quoteSqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function snapshotSqlite(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await rm(destination, { force: true });
  const database = await open({ filename: source, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    await database.exec(`VACUUM INTO ${quoteSqliteString(destination)}`);
  } finally {
    await database.close();
  }

  await assertSqliteIntegrity(destination);
  await fs.promises.chmod(destination, 0o600);
}

async function assertSqliteIntegrity(filename: string): Promise<void> {
  const snapshot = await open({ filename, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    const rows = await snapshot.all<{ integrity_check: string }[]>('PRAGMA integrity_check');
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
      throw new Error('SQLite integrity check failed for the backup snapshot');
    }
  } finally {
    await snapshot.close();
  }
}

function assertRuntimeStopped(home: string): void {
  const pidFile = path.join(home, 'youbot.pid');
  if (!fs.existsSync(pidFile)) return;
  const raw = fs.readFileSync(pidFile, 'utf8').trim();
  if (!/^\d+$/.test(raw)) return;
  try {
    process.kill(Number(raw), 0);
  } catch (error: any) {
    if (error?.code === 'ESRCH') return;
    throw new Error('Unable to verify whether Youbot is stopped; refusing to restore');
  }
  throw new Error('Stop Youbot before restoring a backup');
}

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  for await (const chunk of input) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function listFiles(root: string, relative = ''): Promise<BackupFileEntry[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const result: BackupFileEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    const child = path.join(root, childRelative);
    if (entry.isSymbolicLink()) throw new Error(`Backup contains unsupported symbolic link: ${childRelative}`);
    if (entry.isDirectory()) result.push(...await listFiles(root, childRelative));
    else if (entry.isFile()) {
      const details = await stat(child);
      result.push({
        path: childRelative.split(path.sep).join('/'),
        size: details.size,
        sha256: await sha256(child),
      });
    }
  }
  return result;
}

export async function createDataBackup(homeInput: string, destinationInput?: string): Promise<BackupResult> {
  const home = path.resolve(homeInput);
  const databasePath = readConfiguredDatabasePath(home);
  const databaseRelative = assertInsideHome(home, databasePath, 'Configured SQLite database');
  if (!fs.existsSync(databasePath)) throw new Error(`SQLite database not found: ${databasePath}`);

  const backupPath = path.resolve(destinationInput || path.join(home, 'backups', `youbot-${safeTimestamp()}`));
  if (backupPath === home || backupPath.startsWith(`${home}${path.sep}`) && !backupPath.startsWith(`${path.join(home, 'backups')}${path.sep}`)) {
    throw new Error('Backup destination inside YOUBOT_HOME must be under its backups directory');
  }
  if (fs.existsSync(backupPath)) throw new Error(`Backup destination already exists: ${backupPath}`);

  const temporary = `${backupPath}.partial-${process.pid}-${crypto.randomUUID()}`;
  const payload = path.join(temporary, 'payload');
  const excluded: string[] = [];
  await mkdir(payload, { recursive: true, mode: 0o700 });

  try {
    for (const rootName of COPY_ROOTS) {
      const source = path.join(home, rootName);
      if (!fs.existsSync(source)) continue;
      await cp(source, path.join(payload, rootName), {
        recursive: true,
        preserveTimestamps: true,
        filter: async (candidate) => {
          const relative = path.relative(home, candidate);
          const name = path.basename(candidate);
          const details = await lstat(candidate);
          if (details.isSymbolicLink()) {
            excluded.push(`${relative} (symbolic link)`);
            return false;
          }
          if (details.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(name)) {
            excluded.push(`${relative}/`);
            return false;
          }
          const resolved = path.resolve(candidate);
          if (resolved === databasePath || resolved === `${databasePath}-wal` || resolved === `${databasePath}-shm`) {
            return false;
          }
          return true;
        },
      });
    }

    await snapshotSqlite(databasePath, path.join(payload, databaseRelative));
    const files = await listFiles(payload);
    const manifest: BackupManifest = {
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      databasePath: databaseRelative,
      files,
      excluded: [...new Set(excluded)].sort(),
    };
    await writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    await rename(temporary, backupPath);
    return { backupPath, manifest };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyDataBackup(backupInput: string): Promise<BackupManifest> {
  const backupPath = path.resolve(backupInput);
  const manifest = JSON.parse(await readFile(path.join(backupPath, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.formatVersion !== FORMAT_VERSION || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported or malformed backup manifest');
  }
  const payload = path.join(backupPath, 'payload');
  const actual = await listFiles(payload);
  if (actual.length !== manifest.files.length) throw new Error('Backup file set does not match its manifest');
  for (let index = 0; index < actual.length; index += 1) {
    const expected = manifest.files[index];
    const observed = actual[index];
    if (expected.path !== observed.path || expected.size !== observed.size || expected.sha256 !== observed.sha256) {
      throw new Error(`Backup verification failed for ${expected.path}`);
    }
  }
  if (!manifest.files.some((entry) => entry.path === manifest.databasePath)) {
    throw new Error('Backup manifest does not include its SQLite snapshot');
  }
  const databasePath = path.resolve(payload, manifest.databasePath);
  const databaseRelative = path.relative(payload, databasePath);
  if (!databaseRelative || databaseRelative === '..' || databaseRelative.startsWith(`..${path.sep}`) || path.isAbsolute(databaseRelative)) {
    throw new Error('Backup manifest contains an invalid SQLite path');
  }
  await assertSqliteIntegrity(databasePath);
  return manifest;
}

export async function restoreDataBackup(homeInput: string, backupInput: string): Promise<{ previousPath: string; safetyBackupPath: string }> {
  const home = path.resolve(homeInput);
  const backupPath = path.resolve(backupInput);
  const manifest = await verifyDataBackup(backupPath);
  assertInsideHome(home, path.join(home, manifest.databasePath), 'Backup database target');
  assertRuntimeStopped(home);

  const safety = await createDataBackup(home, path.join(home, 'backups', `pre-restore-${safeTimestamp()}`));
  const staging = path.join(home, `.restore-staging-${crypto.randomUUID()}`);
  const previousPath = path.join(home, `.restore-previous-${safeTimestamp()}`);
  await cp(path.join(backupPath, 'payload'), staging, { recursive: true, preserveTimestamps: true });
  await mkdir(previousPath, { recursive: true, mode: 0o700 });

  const topLevel = [...new Set(manifest.files.map((entry) => entry.path.split('/')[0]))].sort();
  const replaced: string[] = [];
  try {
    for (const name of topLevel) {
      const active = path.join(home, name);
      const incoming = path.join(staging, name);
      const previous = path.join(previousPath, name);
      if (fs.existsSync(active)) {
        await mkdir(path.dirname(previous), { recursive: true, mode: 0o700 });
        await rename(active, previous);
      }
      replaced.push(name);
      await rename(incoming, active);
    }
    await rm(staging, { recursive: true, force: true });
    const restoredDatabase = path.join(home, manifest.databasePath);
    if (fs.existsSync(restoredDatabase)) await fs.promises.chmod(restoredDatabase, 0o600);
    if (fs.existsSync(path.join(home, 'config.json'))) await fs.promises.chmod(path.join(home, 'config.json'), 0o600);
    return { previousPath, safetyBackupPath: safety.backupPath };
  } catch (error) {
    for (const name of replaced.reverse()) {
      const active = path.join(home, name);
      const previous = path.join(previousPath, name);
      await rm(active, { recursive: true, force: true });
      if (fs.existsSync(previous)) await rename(previous, active);
    }
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const home = option('--home') || process.env.YOUBOT_HOME;
  if (!home) throw new Error('--home or YOUBOT_HOME is required');

  if (command === 'backup') {
    const result = await createDataBackup(home, option('--to'));
    console.log(`Backup created: ${result.backupPath}`);
    console.log(`Verified files: ${result.manifest.files.length}`);
    return;
  }
  if (command === 'verify') {
    const source = option('--from');
    if (!source) throw new Error('--from is required');
    const manifest = await verifyDataBackup(source);
    console.log(`Backup verified: ${path.resolve(source)}`);
    console.log(`Files: ${manifest.files.length}`);
    return;
  }
  if (command === 'restore') {
    const source = option('--from');
    if (!source) throw new Error('--from is required');
    const result = await restoreDataBackup(home, source);
    console.log(`Restore complete. Previous state: ${result.previousPath}`);
    console.log(`Safety backup: ${result.safetyBackupPath}`);
    return;
  }
  throw new Error('Usage: data-backup.js backup [--to PATH] | verify --from PATH | restore --from PATH --home PATH');
}

if (!process.env.VITEST && process.argv[1]?.endsWith(path.join('ops', 'data-backup.js'))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
