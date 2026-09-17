import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CollectionAuthoringJobStatus =
  | 'accepted'
  | 'ingested'
  | 'organizing'
  | 'needs-review'
  | 'conflict'
  | 'pending'
  | 'failed';

export type CollectionAuthoringDiagnostic = {
  stage: 'provider' | 'source-read' | 'model-output' | 'engine-validation' | 'persistence';
  code:
    | 'PROVIDER_UNAVAILABLE'
    | 'SOURCE_REVIEW_FAILED'
    | 'MODEL_OUTPUT_MISSING_JSON'
    | 'MODEL_OUTPUT_INVALID_JSON'
    | 'MODEL_OUTPUT_CONTRACT_INVALID'
    | 'MODEL_OUTPUT_LIMIT_EXCEEDED'
    | 'ENGINE_INVALID_ARGUMENT'
    | 'ENGINE_PROPOSAL_INVALID'
    | 'ENGINE_LIMIT_EXCEEDED'
    | 'ENGINE_INPUT_INCOMPLETE'
    | 'GENERATED_PAYLOAD_LIMIT_EXCEEDED'
    | 'AUTHORING_STORAGE_FAILED';
  attempts: number;
  outputCharacters: number;
  transport: 'tool' | 'text' | 'unknown';
  finishReason: 'tool_calls' | 'length' | 'stop' | 'unknown';
};

export type CollectionAuthoringJob = {
  id: string;
  entityId: string;
  requestId: string;
  collectionId: string;
  kind: 'text' | 'pdf' | 'url' | 'image';
  status: CollectionAuthoringJobStatus;
  attempt: number;
  baseRevision: number;
  fingerprint: string;
  sourceRevisionId?: string;
  ingestId?: string;
  proposalId?: string;
  acceptedCount?: number;
  source?: {
    kind: 'url' | 'image';
    reference: string;
    label: string;
    sha256: string;
    mediaType: string;
    byteCount: number;
    characterCount: number;
    coverage: {
      status: 'complete' | 'partial';
      reasons: string[];
    };
  };
  generated?: {
    operations: unknown[];
    unresolvedIssues: string[];
    sourceRevisionIds: string[];
  };
  conflict?: {
    expectedRevision: number;
    currentRevision: number;
  };
  warning?: string;
  diagnostic?: CollectionAuthoringDiagnostic;
  recoverable: boolean;
  retryRequestIds?: string[];
  lease?: {
    token: string;
    runtimeId: string;
    processId: number;
    acquiredAt: string;
    expiresAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

type AuthoringJobState = {
  version: 1;
  jobs: Record<string, CollectionAuthoringJob>;
};

const stores = new Map<string, CollectionAuthoringJobStore>();
const MAX_SERIALIZED_GENERATED_BYTES = 1_048_576;
const MAX_GENERATED_OPERATIONS = 200;
const MAX_GENERATED_UNRESOLVED_ISSUES = 100;
const MAX_GENERATED_SOURCE_REVISIONS = 100;
const MAX_UNRESOLVED_ISSUE_CHARACTERS = 1_000;
const AUTHORING_LEASE_MS = 15 * 60 * 1_000;
let runtimeInstanceId = randomUUID();

function blankState(): AuthoringJobState {
  return { version: 1, jobs: {} };
}

function jobId(entityId: string, requestId: string): string {
  const digest = createHash('sha256').update(entityId).update('\0').update(requestId).digest('hex');
  return `authoring_${digest.slice(0, 24)}`;
}

function boundedGenerated(
  value: CollectionAuthoringJob['generated'],
): CollectionAuthoringJob['generated'] {
  if (!value) return undefined;
  if (
    value.operations.length > MAX_GENERATED_OPERATIONS
    || value.unresolvedIssues.length > MAX_GENERATED_UNRESOLVED_ISSUES
    || value.sourceRevisionIds.length > MAX_GENERATED_SOURCE_REVISIONS
  ) {
    throw new Error('AUTHORING_GENERATED_LIMIT_EXCEEDED');
  }
  if (
    value.unresolvedIssues.some((item) => (
      typeof item !== 'string' || item.length > MAX_UNRESOLVED_ISSUE_CHARACTERS
    ))
    || value.sourceRevisionIds.some((item) => typeof item !== 'string')
  ) {
    throw new Error('AUTHORING_GENERATED_PAYLOAD_INVALID');
  }
  const generated = {
    operations: value.operations,
    unresolvedIssues: value.unresolvedIssues,
    sourceRevisionIds: value.sourceRevisionIds,
  };
  const serialized = JSON.stringify(generated);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_GENERATED_BYTES) {
    throw new Error('AUTHORING_GENERATED_PAYLOAD_TOO_LARGE');
  }
  return JSON.parse(serialized) as NonNullable<CollectionAuthoringJob['generated']>;
}

function durable(job: CollectionAuthoringJob): CollectionAuthoringJob {
  return {
    ...job,
    generated: boundedGenerated(job.generated),
    diagnostic: job.diagnostic ? {
      stage: job.diagnostic.stage,
      code: job.diagnostic.code,
      attempts: Math.max(0, Math.min(10, Math.trunc(job.diagnostic.attempts))),
      outputCharacters: Math.max(0, Math.min(
        MAX_SERIALIZED_GENERATED_BYTES,
        Math.trunc(job.diagnostic.outputCharacters),
      )),
      transport: job.diagnostic.transport,
      finishReason: job.diagnostic.finishReason,
    } : undefined,
    retryRequestIds: job.retryRequestIds?.slice(-50),
  };
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function leaseIsActive(lease: NonNullable<CollectionAuthoringJob['lease']>): boolean {
  if (lease.processId === process.pid) return lease.runtimeId === runtimeInstanceId;
  if (Number.isInteger(lease.processId) && lease.processId > 0) return processIsAlive(lease.processId);
  return Date.parse(lease.expiresAt) > Date.now();
}

function recoverAbandonedLeases(state: AuthoringJobState): boolean {
  let changed = false;
  for (const [id, job] of Object.entries(state.jobs)) {
    if (job.status !== 'organizing') continue;
    if (job.lease && leaseIsActive(job.lease)) continue;
    state.jobs[id] = durable({
      ...job,
      status: 'pending',
      lease: undefined,
      warning: 'The previous organization attempt ended before completion. Retry the saved operation.',
      recoverable: true,
      updatedAt: new Date().toISOString(),
    });
    changed = true;
  }
  return changed;
}

type ClaimedJobUpdate = Partial<Omit<
  CollectionAuthoringJob,
  'id' | 'entityId' | 'requestId' | 'collectionId' | 'kind' | 'fingerprint' | 'createdAt' | 'lease'
>>;

export class CollectionAuthoringJobStore {
  readonly directory: string;
  readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(engineDataPath: string) {
    this.directory = path.dirname(engineDataPath);
    this.filePath = path.join(this.directory, 'authoring-jobs.json');
  }

  private async read(): Promise<AuthoringJobState> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AuthoringJobState>;
      return { version: 1, jobs: parsed.jobs || {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return blankState();
      throw error;
    }
  }

  private async write(state: AuthoringJobState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700).catch(() => undefined);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  private locked<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  create(input: {
    entityId: string;
    requestId: string;
    collectionId: string;
    kind: 'text' | 'pdf' | 'url' | 'image';
    baseRevision: number;
    fingerprint: string;
  }): Promise<{ job: CollectionAuthoringJob; duplicate: boolean }> {
    return this.locked(async () => {
      const state = await this.read();
      const recovered = recoverAbandonedLeases(state);
      const id = jobId(input.entityId, input.requestId);
      const prior = state.jobs[id];
      if (prior) {
        if (
          prior.entityId !== input.entityId
          || prior.collectionId !== input.collectionId
          || prior.kind !== input.kind
          || prior.fingerprint !== input.fingerprint
        ) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        if (recovered) await this.write(state);
        return { job: state.jobs[id], duplicate: true };
      }
      const now = new Date().toISOString();
      const job: CollectionAuthoringJob = {
        id,
        entityId: input.entityId,
        requestId: input.requestId,
        collectionId: input.collectionId,
        kind: input.kind,
        status: 'accepted',
        attempt: 0,
        baseRevision: input.baseRevision,
        fingerprint: input.fingerprint,
        recoverable: true,
        createdAt: now,
        updatedAt: now,
      };
      state.jobs[id] = job;
      await this.write(state);
      return { job, duplicate: false };
    });
  }

  get(entityId: string, id: string): Promise<CollectionAuthoringJob | undefined> {
    return this.locked(async () => {
      const state = await this.read();
      if (recoverAbandonedLeases(state)) await this.write(state);
      const job = state.jobs[id];
      return job?.entityId === entityId ? job : undefined;
    });
  }

  save(job: CollectionAuthoringJob): Promise<CollectionAuthoringJob> {
    return this.locked(async () => {
      const state = await this.read();
      const recovered = recoverAbandonedLeases(state);
      const prior = state.jobs[job.id];
      if (prior && (prior.entityId !== job.entityId || prior.requestId !== job.requestId)) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      if (prior?.lease && leaseIsActive(prior.lease) && prior.lease.token !== job.lease?.token) {
        if (recovered) await this.write(state);
        return prior;
      }
      if (prior?.proposalId && prior.proposalId !== job.proposalId) {
        if (recovered) await this.write(state);
        return prior;
      }
      const saved = durable({ ...job, updatedAt: new Date().toISOString() });
      state.jobs[job.id] = saved;
      await this.write(state);
      return saved;
    });
  }

  list(entityId: string, collectionId: string | undefined, limit: number): Promise<CollectionAuthoringJob[]> {
    return this.locked(async () => {
      const state = await this.read();
      if (recoverAbandonedLeases(state)) await this.write(state);
      return Object.values(state.jobs)
        .filter((job) => job.entityId === entityId && (!collectionId || job.collectionId === collectionId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.min(limit, 100)));
    });
  }

  claim(
    entityId: string,
    id: string,
    expectedRevision: number,
    retryRequestId?: string,
  ): Promise<{ job: CollectionAuthoringJob; acquired: boolean; token?: string }> {
    return this.locked(async () => {
      const state = await this.read();
      recoverAbandonedLeases(state);
      const prior = state.jobs[id];
      if (!prior || prior.entityId !== entityId) throw new Error('NOT_FOUND_OR_FORBIDDEN');
      if (prior.proposalId || (prior.lease && leaseIsActive(prior.lease))) {
        await this.write(state);
        return { job: prior, acquired: false };
      }
      const now = new Date();
      const token = randomUUID();
      const job = durable({
        ...prior,
        status: 'organizing',
        attempt: prior.attempt + 1,
        baseRevision: expectedRevision,
        conflict: undefined,
        warning: undefined,
        diagnostic: undefined,
        recoverable: true,
        retryRequestIds: retryRequestId
          ? [...(prior.retryRequestIds || []), retryRequestId]
          : prior.retryRequestIds,
        lease: {
          token,
          runtimeId: runtimeInstanceId,
          processId: process.pid,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + AUTHORING_LEASE_MS).toISOString(),
        },
        updatedAt: now.toISOString(),
      });
      state.jobs[id] = job;
      await this.write(state);
      return { job, acquired: true, token };
    });
  }

  updateClaim(
    entityId: string,
    id: string,
    token: string,
    update: ClaimedJobUpdate,
    release = false,
  ): Promise<{ job: CollectionAuthoringJob; applied: boolean }> {
    return this.locked(async () => {
      const state = await this.read();
      const prior = state.jobs[id];
      if (!prior || prior.entityId !== entityId) throw new Error('NOT_FOUND_OR_FORBIDDEN');
      if (prior.lease?.token !== token) return { job: prior, applied: false };
      const saved = durable({
        ...prior,
        ...update,
        lease: release ? undefined : prior.lease,
        updatedAt: new Date().toISOString(),
      });
      state.jobs[id] = saved;
      await this.write(state);
      return { job: saved, applied: true };
    });
  }
}

export function getCollectionAuthoringJobStore(engineDataPath: string): CollectionAuthoringJobStore {
  const key = path.resolve(engineDataPath);
  let store = stores.get(key);
  if (!store) {
    store = new CollectionAuthoringJobStore(key);
    stores.set(key, store);
  }
  return store;
}

export function resetCollectionAuthoringJobStoresForTests(): void {
  stores.clear();
  runtimeInstanceId = randomUUID();
}
