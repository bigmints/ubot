import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLiteConnection, resolveSQLitePath } from './sqlite.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('SQLite production defaults', () => {
  it('resolves explicit environment paths before config paths', () => {
    expect(resolveSQLitePath('config.db', { DATABASE_PATH: '/tmp/env.db' }, '/work')).toBe('/tmp/env.db');
    expect(resolveSQLitePath('config.db', { SQLITE_DB_PATH: 'env.db', YOUBOT_HOME: '/srv/youbot' }, '/work'))
      .toBe('/srv/youbot/env.db');
    expect(resolveSQLitePath('config.db', { YOUBOT_HOME: '/srv/youbot' }, '/work'))
      .toBe('/srv/youbot/config.db');
  });

  it('creates a private database with integrity and concurrency pragmas', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youbot-sqlite-'));
    temporaryRoots.push(root);
    const databasePath = path.join(root, 'private', 'youbot.db');
    const database = new SQLiteConnection({ config: { path: databasePath } });

    expect(await database.get<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(await database.get<{ journal_mode: string }>('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(await database.get<{ timeout: number }>('PRAGMA busy_timeout')).toEqual({ timeout: 5000 });
    expect(fs.statSync(databasePath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(databasePath)).mode & 0o777).toBe(0o700);

    await database.close();
  });
});
