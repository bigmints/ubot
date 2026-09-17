import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CollectionAuthoringMessage = {
  id: string;
  speaker: 'owner' | 'concierge';
  content: string;
  createdAt: string;
  state: 'saved' | 'needs-review' | 'error';
};

type MessageFile = {
  version: 1;
  collections: Record<string, CollectionAuthoringMessage[]>;
};

const emptyFile = (): MessageFile => ({ version: 1, collections: {} });

export class CollectionMessageStore {
  private queue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(collectionId: string): Promise<CollectionAuthoringMessage[]> {
    const state = await this.read();
    return structuredClone(state.collections[collectionId] || []);
  }

  async append(
    collectionId: string,
    message: Omit<CollectionAuthoringMessage, 'id' | 'createdAt'>,
  ): Promise<CollectionAuthoringMessage> {
    const saved: CollectionAuthoringMessage = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...message,
    };
    const operation = this.queue.then(async () => {
      const state = await this.read();
      const messages = state.collections[collectionId] || [];
      state.collections[collectionId] = [...messages.slice(-199), saved];
      await this.write(state);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return saved;
  }

  private async read(): Promise<MessageFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as MessageFile;
      if (parsed.version !== 1 || !parsed.collections || typeof parsed.collections !== 'object') {
        throw new Error('Unsupported collection message store.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
      throw error;
    }
  }

  private async write(state: MessageFile): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

let stores = new Map<string, CollectionMessageStore>();

export function getCollectionMessageStore(engineDataPath: string): CollectionMessageStore {
  const filePath = path.join(path.dirname(engineDataPath), 'authoring-messages.json');
  let store = stores.get(filePath);
  if (!store) {
    store = new CollectionMessageStore(filePath);
    stores.set(filePath, store);
  }
  return store;
}

export function resetCollectionMessageStoresForTests(): void {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('Collection message stores can only be reset in tests.');
  }
  stores = new Map();
}
