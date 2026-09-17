import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EntityState, RepositoryPort, RepositoryState } from './types.js';
import { PERSISTENCE_SCHEMA_VERSION } from './types.js';

type RepositoryStateV0 = {
  schemaVersion: 0;
  entities: Record<string, Omit<EntityState, 'catalogRevision'>>;
};

const emptyState = (): RepositoryState => ({ schemaVersion: PERSISTENCE_SCHEMA_VERSION, entities: {} });
const clone = <T>(value: T): T => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function currentState(value: unknown): RepositoryState {
  if (!isRecord(value) || value.schemaVersion !== PERSISTENCE_SCHEMA_VERSION || !isRecord(value.entities)) {
    const version = isRecord(value) ? String(value.schemaVersion) : 'invalid';
    throw new Error(`Unsupported persistence schema version ${version}; current=1, migratable=0`);
  }
  return value as RepositoryState;
}

function migrateV0(value: unknown): RepositoryState {
  if (!isRecord(value) || value.schemaVersion !== 0 || !isRecord(value.entities)) {
    throw new Error('Invalid persistence schema version 0 state');
  }
  const entities: Record<string, EntityState> = {};
  for (const [entityId, candidate] of Object.entries(value.entities)) {
    if (!isRecord(candidate)) throw new Error(`Invalid persistence schema version 0 entity ${entityId}`);
    for (const field of ['collections', 'sources', 'ingests', 'evidence', 'idempotency']) {
      if (!isRecord(candidate[field])) {
        throw new Error(`Invalid persistence schema version 0 entity ${entityId}: ${field} must be an object`);
      }
    }
    if ('catalogRevision' in candidate) {
      throw new Error(`Invalid persistence schema version 0 entity ${entityId}: catalogRevision is not part of version 0`);
    }
    entities[entityId] = {
      ...(candidate as Omit<EntityState, 'catalogRevision'>),
      catalogRevision: Object.keys(candidate.collections as Record<string, unknown>).length,
    };
  }
  return { schemaVersion: PERSISTENCE_SCHEMA_VERSION, entities };
}

export function createMemoryCollectionRepository(initial?: RepositoryState): RepositoryPort {
  let state = clone(initial ?? emptyState());
  let queue = Promise.resolve();
  return {
    capabilities: ['atomic-state', 'idempotency'],
    async read(reader) { await queue; return reader(clone(state)); },
    async transact(writer) {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const result = new Promise((res, rej) => { resolve = res; reject = rej; });
      queue = queue.then(async () => {
        const draft = clone(state);
        try { const value = await writer(draft); state = draft; resolve(value); }
        catch (error) { reject(error); }
      });
      return result as Promise<Awaited<ReturnType<typeof writer>>>;
    },
  };
}

export async function createJsonFileCollectionRepository(options: { filePath: string }): Promise<RepositoryPort> {
  if (!options.filePath || typeof options.filePath !== 'string') throw new TypeError('filePath is required');
  const directory = dirname(options.filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await chmod(directory, 0o700); } catch { /* best effort on filesystems without POSIX modes */ }
  const lockPath = `${options.filePath}.lock`;
  const migrationBackupPath = `${options.filePath}.schema-0.backup`;
  const temporaryPath = () => `${options.filePath}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;

  const readLatest = async (): Promise<RepositoryState> =>
    currentState(JSON.parse(await readFile(options.filePath, 'utf8')));

  const acquireLock = async (): Promise<() => Promise<void>> => {
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        return async () => { await rm(lockPath, { recursive: true, force: true }); };
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error('Timed out waiting for collection repository lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  };

  const atomicReplace = async (state: RepositoryState): Promise<void> => {
    const temporary = temporaryPath();
    try {
      await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      try { await chmod(temporary, 0o600); } catch { /* best effort on filesystems without POSIX modes */ }
      await rename(temporary, options.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
  };

  const preserveMigrationBackup = async (raw: string): Promise<void> => {
    try {
      await writeFile(migrationBackupPath, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      const existing = await readFile(migrationBackupPath, 'utf8');
      if (existing !== raw) {
        throw new Error(`Migration backup ${migrationBackupPath} already exists with different contents`);
      }
    }
    try { await chmod(migrationBackupPath, 0o600); } catch { /* best effort on filesystems without POSIX modes */ }
  };

  const initializeRelease = await acquireLock();
  try {
    let raw: string | undefined;
    try {
      raw = await readFile(options.filePath, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      await atomicReplace(emptyState());
    }
    if (raw !== undefined) {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed) && parsed.schemaVersion === 0) {
        const migrated = migrateV0(parsed as RepositoryStateV0);
        await preserveMigrationBackup(raw);
        await atomicReplace(migrated);
      } else {
        currentState(parsed);
      }
    }
  } finally {
    await initializeRelease();
  }

  let queue = Promise.resolve();
  return {
    capabilities: ['atomic-state', 'durable-restart', 'idempotency', 'migration-v0-to-v1'],
    async read(reader) { await queue; return reader(clone(await readLatest())); },
    async transact(writer) {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const result = new Promise((res, rej) => { resolve = res; reject = rej; });
      queue = queue.then(async () => {
        let release: (() => Promise<void>) | undefined;
        try {
          release = await acquireLock();
          const draft = clone(await readLatest());
          const value = await writer(draft);
          await atomicReplace(draft);
          resolve(value);
        } catch (error) { reject(error); }
        finally { if (release) await release(); }
      });
      return result as Promise<Awaited<ReturnType<typeof writer>>>;
    },
  };
}
