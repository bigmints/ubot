import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SQLiteConnection } from '../data/database/sqlite.js';
import { createDataBackup, restoreDataBackup, verifyDataBackup } from './data-backup.js';

describe('operator data backup and restore', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'youbot-backup-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('creates a consistent manifest, detects tampering, and restores recoverably', async () => {
    const databasePath = path.join(home, 'data', 'youbot.db');
    const database = new SQLiteConnection({ config: { path: databasePath } });
    await database.execute('INSERT INTO youbot_contacts (id, display_name, type, tags, metadata) VALUES (?, ?, ?, ?, ?)', [
      'contact-1', 'Original', 'person', '[]', '{}',
    ]);
    await writeFile(path.join(home, 'config.json'), `${JSON.stringify({ database: { path: 'data/youbot.db' }, marker: 'original' })}\n`, { mode: 0o600 });

    const backup = await createDataBackup(home);
    await expect(verifyDataBackup(backup.backupPath)).resolves.toMatchObject({ formatVersion: 1, databasePath: 'data/youbot.db' });

    await database.execute('UPDATE youbot_contacts SET display_name = ? WHERE id = ?', ['Changed', 'contact-1']);
    await database.close();
    await writeFile(path.join(home, 'config.json'), `${JSON.stringify({ database: { path: 'data/youbot.db' }, marker: 'changed' })}\n`, { mode: 0o600 });

    const restored = await restoreDataBackup(home, backup.backupPath);
    expect(restored.previousPath).toContain('.restore-previous-');
    expect(restored.safetyBackupPath).toContain('pre-restore-');

    const reopened = new SQLiteConnection({ config: { path: databasePath } });
    expect(await reopened.get<{ display_name: string }>('SELECT display_name FROM youbot_contacts WHERE id = ?', ['contact-1']))
      .toEqual({ display_name: 'Original' });
    await reopened.close();
    expect(JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8')).marker).toBe('original');

    await writeFile(path.join(backup.backupPath, 'payload', 'config.json'), '{"tampered":true}\n');
    await expect(verifyDataBackup(backup.backupPath)).rejects.toThrow('verification failed');
  });

  it('refuses to restore while the configured runtime is active', async () => {
    const databasePath = path.join(home, 'data', 'youbot.db');
    const database = new SQLiteConnection({ config: { path: databasePath } });
    await database.close();
    await writeFile(path.join(home, 'config.json'), `${JSON.stringify({ database: { path: 'data/youbot.db' } })}\n`, { mode: 0o600 });
    const backup = await createDataBackup(home);
    await writeFile(path.join(home, 'youbot.pid'), `${process.pid}\n`, { mode: 0o600 });

    await expect(restoreDataBackup(home, backup.backupPath)).rejects.toThrow('Stop Youbot');
  });
});
