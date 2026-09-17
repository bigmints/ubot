import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PdfCoverage } from './pdf-intake.js';

export type PdfUploadReceipt = {
  requestId: string;
  collectionId: string;
  sourceRevisionId: string;
  ingestId: string;
  acceptedCount: number;
  createdAt: string;
  file: {
    name: string;
    mimeType: 'application/pdf';
    sizeBytes: number;
    sha256: string;
  };
  coverage: PdfCoverage;
  organization?: {
    status: 'ready' | 'pending';
    proposalId?: string;
    updatedCount: number;
    unresolvedCount: number;
    warning?: string;
  };
};

type ReceiptState = {
  version: 1;
  byRequestId: Record<string, PdfUploadReceipt>;
  bySourceRevisionId: Record<string, PdfUploadReceipt>;
};

const stores = new Map<string, PdfSourceStore>();

function blankState(): ReceiptState {
  return { version: 1, byRequestId: {}, bySourceRevisionId: {} };
}

export class PdfSourceStore {
  readonly directory: string;
  readonly originalsDirectory: string;
  readonly receiptsPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(engineDataPath: string) {
    this.directory = path.dirname(engineDataPath);
    this.originalsDirectory = path.join(this.directory, 'originals');
    this.receiptsPath = path.join(this.directory, 'pdf-sources.json');
  }

  private async read(): Promise<ReceiptState> {
    try {
      const parsed = JSON.parse(await readFile(this.receiptsPath, 'utf8')) as Partial<ReceiptState>;
      return {
        version: 1,
        byRequestId: parsed.byRequestId || {},
        bySourceRevisionId: parsed.bySourceRevisionId || {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return blankState();
      throw error;
    }
  }

  private async write(state: ReceiptState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700).catch(() => undefined);
    const temporary = `${this.receiptsPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, this.receiptsPath);
    await chmod(this.receiptsPath, 0o600).catch(() => undefined);
  }

  private locked<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  findByRequest(requestId: string): Promise<PdfUploadReceipt | undefined> {
    return this.locked(async () => (await this.read()).byRequestId[requestId]);
  }

  findBySource(sourceRevisionId: string): Promise<PdfUploadReceipt | undefined> {
    return this.locked(async () => (await this.read()).bySourceRevisionId[sourceRevisionId]);
  }

  save(receipt: PdfUploadReceipt): Promise<void> {
    return this.locked(async () => {
      const state = await this.read();
      const prior = state.byRequestId[receipt.requestId];
      if (prior && prior.file.sha256 !== receipt.file.sha256) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      const durable = prior?.organization?.status === 'ready' && receipt.organization?.status !== 'ready'
        ? prior
        : receipt;
      state.byRequestId[receipt.requestId] = durable;
      state.bySourceRevisionId[receipt.sourceRevisionId] = durable;
      await this.write(state);
    });
  }

  async storeOriginal(sha256: string, buffer: Buffer): Promise<void> {
    await mkdir(this.originalsDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.originalsDirectory, 0o700).catch(() => undefined);
    const destination = path.join(this.originalsDirectory, `${sha256}.pdf`);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
      await chmod(temporary, 0o600).catch(() => undefined);
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    await chmod(destination, 0o600).catch(() => undefined);
  }
}

export function getPdfSourceStore(engineDataPath: string): PdfSourceStore {
  const key = path.resolve(engineDataPath);
  let store = stores.get(key);
  if (!store) {
    store = new PdfSourceStore(key);
    stores.set(key, store);
  }
  return store;
}
