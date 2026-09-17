import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiContext } from '../../../api/context.js';
import { handleCollectionRoutes } from '../routes.js';
import {
  getCollectionAuthoringJobStore,
  resetCollectionAuthoringJobStoresForTests,
} from '../authoring-jobs.js';
import { resetCollectionMessageStoresForTests } from '../messages.js';
import { getYoubotCollectionService, resetYoubotCollectionServiceForTests } from '../service.js';
import { setCollectionSourceDependenciesForTests } from '../source-intake.js';
import { textPdf } from './pdf-fixture.js';

type ResponseCapture = { status: number; body: any };

function request(body?: unknown) {
  return Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
}

function response(): { res: any; capture: ResponseCapture } {
  const capture: ResponseCapture = { status: 0, body: undefined };
  return {
    capture,
    res: {
      writeHead(status: number) { capture.status = status; },
      end(value: string) { capture.body = value ? JSON.parse(value) : undefined; },
    },
  };
}

async function call(ctx: ApiContext, method: string, target: string, body?: unknown) {
  const { res, capture } = response();
  const handled = await handleCollectionRoutes(
    request(body),
    res,
    new URL(target, 'http://localhost'),
    method,
    ctx,
  );
  expect(handled).toBe(true);
  return capture;
}

function unwrap(capture: ResponseCapture): any {
  expect(capture.status).toBeGreaterThanOrEqual(200);
  expect(capture.status).toBeLessThan(300);
  const result = capture.body.result;
  expect(result.ok).toBe(true);
  return result.data;
}

function sourceResponse(
  status: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/plain' },
) {
  const values = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get: (name: string) => values[name.toLowerCase()] || null },
    body: Readable.from([Buffer.from(body)]),
    cancel: vi.fn(),
  };
}

describe('collection owner routes', () => {
  let priorHome: string | undefined;
  let context: ApiContext;

  beforeEach(async () => {
    priorHome = process.env.YOUBOT_HOME;
    process.env.YOUBOT_HOME = await mkdtemp(path.join(tmpdir(), 'youbot-collection-routes-'));
    resetYoubotCollectionServiceForTests();
    resetCollectionMessageStoresForTests();
    resetCollectionAuthoringJobStoresForTests();
    context = {
      auth: { authenticated: true, isOwner: true, clientName: 'test-owner' },
      agentOrchestrator: {
        generate: vi.fn(async (systemPrompt: string) => {
          const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
          return JSON.stringify({
            operations: [{
              kind: 'create_item',
              values: { name: 'Sunrise Villa', location: 'Dubai' },
              evidence: [{ sourceRevisionId, fieldId: 'name' }],
            }],
            unresolvedIssues: [],
          });
        }),
      } as any,
    } as ApiContext;
  });

  afterEach(() => {
    setCollectionSourceDependenciesForTests(undefined);
    if (priorHome === undefined) delete process.env.YOUBOT_HOME;
    else process.env.YOUBOT_HOME = priorHome;
  });

  it('creates, organizes, applies, publishes and previews through host-normalized endpoints', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Available homes',
      preset: 'properties',
      requestId: 'request-create-0001',
    }));
    const collectionId = created.id;
    expect(collectionId).toMatch(/^collection_/);

    const authored = unwrap(await call(context, 'POST', `/api/concierge/collections/${collectionId}/messages`, {
      content: 'Sunrise Villa is in Dubai.',
      sourceLabel: 'Owner note',
      expectedRevision: 1,
      requestId: 'request-message-0001',
    }));
    expect(authored.message).toMatchObject({ speaker: 'owner', state: 'saved' });
    expect(authored.proposal).toMatchObject({ collectionId, baseRevision: 1 });

    unwrap(await call(context, 'POST', `/api/concierge/collections/proposals/${authored.proposal.id}/apply`, {
      expectedRevision: 1,
      requestId: 'request-apply-0001',
    }));

    const ownerView = unwrap(await call(context, 'GET', `/api/concierge/collections/${collectionId}/view`));
    expect(ownerView.items).toHaveLength(1);
    expect(ownerView.messages).toHaveLength(2);
    expect(ownerView.reviewedPayloadHash).toBeTruthy();
    const itemId = ownerView.items[0].id;

    unwrap(await call(context, 'POST', `/api/concierge/collections/${collectionId}/publish`, {
      selectedItemIds: [itemId],
      expectedPublicationRevision: 0,
      reviewedPayloadHash: ownerView.reviewedPayloadHash,
      requestId: 'request-publish-0001',
    }));

    const preview = unwrap(await call(context, 'GET', `/api/concierge/collections/${collectionId}/view?audience=visitor&preview=1`));
    expect(preview.items).toEqual(preview.publishedItems);
    expect(preview.publishedItems[0]).toMatchObject({ id: itemId, values: { name: 'Sunrise Villa' } });
    expect(preview.proposals).toEqual([]);
    expect(preview.messages).toEqual([]);

    const searched = unwrap(await call(context, 'GET', `/api/concierge/collections/search?collectionIds=${collectionId}&text=Sunrise&pageSize=100`));
    expect(searched.items[0]).toMatchObject({ id: itemId, values: { name: 'Sunrise Villa' } });
  });

  it('does not accept entity or actor authority from request JSON', async () => {
    const capture = await call(context, 'POST', '/api/concierge/collections/ingest', {
      kind: 'text',
      source: { reportedCoverage: 'unknown' },
      text: 'Private source',
      entityId: 'another-entity',
      actorId: 'another-owner',
      requestId: 'request-spoof-0001',
    });
    expect(capture.status).toBe(400);
    expect(capture.body.code).toBe('INVALID_ARGUMENT');
  });

  it('stores and ingests a PDF once across retry and restart, with owner-only page provenance', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'PDF catalogue', preset: 'properties', requestId: 'request-create-pdf-0001',
    }));
    const pdf = textPdf(['Villa Alpha in Dubai', null, 'Villa Beta in Sharjah']);
    const uploadBody = {
      filename: 'homes.pdf',
      mimeType: 'application/pdf',
      base64: pdf.toString('base64'),
      requestId: 'request-upload-pdf-0001',
    };
    const uploaded = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/upload`, uploadBody));
    expect(uploaded).toMatchObject({
      outcome: 'partial',
      recoverable: false,
      collectionId: created.id,
      acceptedCount: 2,
      duplicate: false,
      coverage: { totalPages: 3, extractedCount: 2, unresolvedCount: 1, unresolvedPages: [2] },
      file: { name: 'homes.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length },
      organization: { status: 'ready', updatedCount: 1, unresolvedCount: 0 },
    });
    expect(uploaded.proposal).toMatchObject({ collectionId: created.id });
    expect(uploaded.view.proposals).toHaveLength(1);

    const inspected = unwrap(await call(context, 'GET', `/api/concierge/collections/sources/${uploaded.sourceRevisionId}`));
    expect(inspected.collectionId).toBe(created.id);
    expect(inspected.segments).toEqual([
      expect.objectContaining({ inputId: 'page-0001', page: 1, text: expect.stringContaining('Villa Alpha') }),
      expect.objectContaining({ inputId: 'page-0003', page: 3, text: expect.stringContaining('Villa Beta') }),
    ]);
    expect(JSON.stringify(inspected)).not.toContain(process.env.YOUBOT_HOME);
    const filtered = unwrap(await call(context, 'GET', `/api/concierge/collections/sources/${uploaded.sourceRevisionId}?inputId=page-0003`));
    expect(filtered.segments).toEqual([
      expect.objectContaining({ inputId: 'page-0003', page: 3, text: expect.stringContaining('Villa Beta') }),
    ]);

    resetYoubotCollectionServiceForTests();
    const retried = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/upload`, uploadBody));
    expect(retried).toMatchObject({
      duplicate: true,
      sourceRevisionId: uploaded.sourceRevisionId,
      ingestId: uploaded.ingestId,
      organization: { status: 'ready', proposalId: uploaded.organization.proposalId },
    });
    const originals = await readdir(path.join(process.env.YOUBOT_HOME!, 'data', 'collections', 'originals'));
    expect(originals).toEqual([`${uploaded.file.sha256}.pdf`]);
    expect((await stat(path.join(process.env.YOUBOT_HOME!, 'data', 'collections', 'originals', originals[0]))).mode & 0o777).toBe(0o600);

    const conflict = await call(context, 'POST', `/api/concierge/collections/${created.id}/upload`, {
      ...uploadBody,
      base64: textPdf(['Different catalogue']).toString('base64'),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('preserves a source when organization is unavailable and resumes with the same request', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Retry catalogue', preset: 'properties', requestId: 'request-create-retry-0001',
    }));
    const body = {
      filename: 'retry.pdf',
      mimeType: 'application/pdf',
      base64: textPdf(['Sunrise Villa in Dubai']).toString('base64'),
      requestId: 'request-upload-retry-0001',
    };
    context.agentOrchestrator = null;
    const pending = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/upload`, body));
    expect(pending).toMatchObject({
      outcome: 'partial', recoverable: true, duplicate: false,
      organization: { status: 'pending', updatedCount: 0, unresolvedCount: 0 },
    });
    expect(pending.sourceRevisionId).toBeTruthy();
    expect(pending.job).toMatchObject({ kind: 'pdf', status: 'pending' });

    const generate = vi.fn(async (systemPrompt: string) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { name: 'Sunrise Villa', location: 'Dubai' },
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate } as any;
    resetYoubotCollectionServiceForTests();
    resetCollectionAuthoringJobStoresForTests();
    const organized = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${pending.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-retry-pdf-job-0001' },
    ));
    expect(organized.job).toMatchObject({
      status: 'needs-review',
      sourceRevisionId: pending.sourceRevisionId,
      ingestId: pending.ingestId,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    const resumed = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/upload`, body));
    expect(resumed).toMatchObject({
      outcome: 'success', recoverable: false, duplicate: true,
      sourceRevisionId: pending.sourceRevisionId,
      ingestId: pending.ingestId,
      organization: { status: 'ready', updatedCount: 1 },
    });
    expect(resumed.proposal).toMatchObject({ id: resumed.organization.proposalId, collectionId: created.id });
    expect(resumed.organization.proposalId).toBe(organized.job.proposalId);
    expect(generate).toHaveBeenCalledTimes(1);

    resetYoubotCollectionServiceForTests();
    const stable = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/upload`, body));
    expect(stable.organization.proposalId).toBe(resumed.organization.proposalId);
    expect(stable.sourceRevisionId).toBe(pending.sourceRevisionId);
  });

  it('persists pending text authoring across restart and retries without duplicate ingestion or proposal', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Restart-safe notes', preset: 'properties', requestId: 'request-create-job-0001',
    }));
    context.agentOrchestrator = null;
    const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'Palm House is in Dubai.',
      expectedRevision: 1,
      requestId: 'request-message-job-0001',
    }));
    expect(accepted.job).toMatchObject({
      collectionId: created.id,
      kind: 'text',
      status: 'pending',
      recoverable: true,
    });
    expect(accepted.job.sourceRevisionId).toBeTruthy();
    expect(accepted.job.ingestId).toBeTruthy();
    expect((await stat(path.join(
      process.env.YOUBOT_HOME!,
      'data',
      'collections',
      'authoring-jobs.json',
    ))).mode & 0o777).toBe(0o600);

    resetYoubotCollectionServiceForTests();
    resetCollectionAuthoringJobStoresForTests();
    const restarted = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}`,
    ));
    expect(restarted.job).toMatchObject({
      id: accepted.job.id,
      sourceRevisionId: accepted.job.sourceRevisionId,
      ingestId: accepted.job.ingestId,
      status: 'pending',
    });

    const generate = vi.fn(async (systemPrompt: string) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { name: 'Palm House', location: 'Dubai' },
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate } as any;
    const retried = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-retry-job-0001' },
    ));
    expect(retried.job).toMatchObject({
      status: 'needs-review',
      sourceRevisionId: accepted.job.sourceRevisionId,
      ingestId: accepted.job.ingestId,
    });
    expect(retried.proposal.id).toBe(retried.job.proposalId);
    expect(generate).toHaveBeenCalledTimes(1);

    const repeated = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-retry-job-0001' },
    ));
    expect(repeated.job.proposalId).toBe(retried.job.proposalId);
    expect(generate).toHaveBeenCalledTimes(1);
    const persistedService = await getYoubotCollectionService();
    const engineState = await persistedService.engine.repository.read((state) => state) as any;
    const entityState = engineState.entities[persistedService.entityId];
    expect(Object.keys(entityState.ingests)).toHaveLength(1);
    expect(Object.keys(entityState.sources)).toHaveLength(1);
    expect(Object.keys(entityState.collections[created.id].proposals)).toHaveLength(1);
    const listed = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/authoring-jobs?collectionId=${created.id}&limit=20`,
    ));
    expect(listed.jobs).toHaveLength(1);
  });

  it('claims an organizing job once across overlapping reload-style retries', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Retry race', preset: 'properties', requestId: 'request-create-race-job-0001',
    }));
    context.agentOrchestrator = null;
    const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'Race House is in Dubai.',
      expectedRevision: 1,
      requestId: 'request-message-race-job-0001',
    }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const generate = vi.fn(async (systemPrompt: string) => {
      await gate;
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { name: 'Race House', location: 'Dubai' },
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate } as any;
    const first = call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-race-retry-first-0001' },
    );
    for (let index = 0; index < 100 && generate.mock.calls.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(generate).toHaveBeenCalledTimes(1);
    const second = await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-race-retry-reload-0002' },
    );
    expect(second).toMatchObject({
      status: 202,
      body: {
        result: {
          ok: true,
          data: { inProgress: true, job: { status: 'organizing' } },
        },
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);

    release();
    const completed = unwrap(await first);
    expect(completed.job.status).toBe('needs-review');
    const service = await getYoubotCollectionService();
    const state = await service.engine.repository.read((value) => value) as any;
    const entity = state.entities[service.entityId];
    expect(Object.keys(entity.sources)).toHaveLength(1);
    expect(Object.keys(entity.ingests)).toHaveLength(1);
    expect(Object.keys(entity.collections[created.id].proposals)).toHaveLength(1);
  });

  it('recovers an abandoned organizing lease after a host restart', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Restarted attempt', preset: 'properties', requestId: 'request-create-lease-job-0001',
    }));
    context.agentOrchestrator = null;
    const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'Restart House is in Dubai.',
      expectedRevision: 1,
      requestId: 'request-message-lease-job-0001',
    }));
    const service = await getYoubotCollectionService();
    const store = getCollectionAuthoringJobStore(service.dataPath!);
    const claimed = await store.claim(
      service.entityId,
      accepted.job.id,
      1,
      'request-abandoned-attempt-0001',
    );
    expect(claimed).toMatchObject({ acquired: true, job: { status: 'organizing' } });

    resetCollectionAuthoringJobStoresForTests();
    const recovered = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}`,
    ));
    expect(recovered.job).toMatchObject({
      status: 'pending',
      recoverable: true,
      warning: expect.stringContaining('previous organization attempt ended'),
    });
    expect(recovered.job.lease).toBeUndefined();
  });

  it('fences a stale completion after an abandoned lease is taken over', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Fenced attempt', preset: 'properties', requestId: 'request-create-fence-job-0001',
    }));
    context.agentOrchestrator = null;
    const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'Fenced House is in Dubai.',
      expectedRevision: 1,
      requestId: 'request-message-fence-job-0001',
    }));
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstGenerate = vi.fn(async (systemPrompt: string) => {
      await firstGate;
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { name: 'Stale House', location: 'Old result' },
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate: firstGenerate } as any;
    const first = call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-fence-first-0001' },
    );
    for (let index = 0; index < 100 && firstGenerate.mock.calls.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(firstGenerate).toHaveBeenCalledTimes(1);

    resetCollectionAuthoringJobStoresForTests();
    const recovered = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}`,
    ));
    expect(recovered.job.status).toBe('pending');
    const secondGenerate = vi.fn(async (systemPrompt: string) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { name: 'Current House', location: 'Dubai' },
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate: secondGenerate } as any;
    const takeover = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-fence-takeover-0002' },
    ));
    expect(takeover.job.status).toBe('needs-review');
    expect(secondGenerate).toHaveBeenCalledTimes(1);

    releaseFirst();
    const stale = unwrap(await first);
    expect(stale.job.proposalId).toBe(takeover.job.proposalId);
    const service = await getYoubotCollectionService();
    const state = await service.engine.repository.read((value) => value) as any;
    const entity = state.entities[service.entityId];
    expect(Object.keys(entity.sources)).toHaveLength(1);
    expect(Object.keys(entity.ingests)).toHaveLength(1);
    expect(Object.keys(entity.collections[created.id].proposals)).toHaveLength(1);
    const proposal = entity.collections[created.id].proposals[takeover.job.proposalId];
    expect(proposal.operations[0].values).toMatchObject({ name: 'Current House', location: 'Dubai' });
  });

  it('preserves generated operations on a concurrent revision conflict and reuses them on retry', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Conflict-safe notes', preset: 'properties', requestId: 'request-create-conflict-job-0001',
    }));
    const generate = vi.fn(async (systemPrompt: string) => {
      const competing = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/proposals`, {
        expectedRevision: 1,
        operations: [{ kind: 'create_item', values: { name: 'Existing House', location: 'Abu Dhabi' } }],
        requestId: 'request-competing-proposal-0001',
      }));
      unwrap(await call(context, 'POST', `/api/concierge/collections/proposals/${competing.id}/apply`, {
        expectedRevision: 1,
        requestId: 'request-competing-apply-0001',
      }));
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { name: 'New House', location: 'Dubai' },
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: ['Confirm the price.'],
      });
    });
    context.agentOrchestrator = { generate } as any;
    const conflicted = await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'New House is in Dubai; confirm its price later.',
      expectedRevision: 1,
      requestId: 'request-message-conflict-job-0001',
    });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body).toMatchObject({
      code: 'REVISION_CONFLICT',
      job: {
        status: 'conflict',
        conflict: { expectedRevision: 1, currentRevision: 2 },
      },
    });
    expect(conflicted.body.job.generated).toMatchObject({
      operations: [expect.objectContaining({ kind: 'create_item' })],
      unresolvedIssues: ['Confirm the price.'],
      sourceRevisionIds: [conflicted.body.job.sourceRevisionId],
    });

    resetYoubotCollectionServiceForTests();
    resetCollectionAuthoringJobStoresForTests();
    const persisted = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/authoring-jobs/${conflicted.body.job.id}`,
    ));
    expect(persisted.job.generated).toEqual(conflicted.body.job.generated);

    const retried = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${conflicted.body.job.id}/retry`,
      { expectedRevision: 2, requestId: 'request-retry-conflict-job-0001' },
    ));
    expect(retried.job.status).toBe('needs-review');
    expect(retried.job.conflict).toBeUndefined();
    expect(retried.job.proposalId).toBeTruthy();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported, malformed, encrypted and scanned-only PDF uploads', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Rejected files', preset: 'generic', requestId: 'request-create-reject-0001',
    }));
    const upload = (requestId: string, base64: string, mimeType = 'application/pdf') => call(
      context, 'POST', `/api/concierge/collections/${created.id}/upload`,
      { filename: 'catalogue.pdf', mimeType, base64, requestId },
    );
    const unsupported = await upload('request-reject-mime-0001', textPdf(['text']).toString('base64'), 'text/plain');
    expect(unsupported).toMatchObject({ status: 400, body: { code: 'PDF_UNSUPPORTED' } });
    const malformed = await upload('request-reject-bad-0001', Buffer.from('not a pdf').toString('base64'));
    expect(malformed).toMatchObject({ status: 400, body: { code: 'PDF_MALFORMED' } });
    const encrypted = await upload('request-reject-encrypted-0001', Buffer.from('%PDF-1.4\n/Encrypt').toString('base64'));
    expect(encrypted).toMatchObject({ status: 400, body: { code: 'PDF_ENCRYPTED' } });
    const scanned = await upload('request-reject-scanned-0001', textPdf([null]).toString('base64'));
    expect(scanned).toMatchObject({ status: 422, body: { code: 'PDF_SCANNED_ONLY' } });
  });

  it('previews answers through visitor retrieval without exposing drafts or private fields', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Visitor facts', preset: 'generic', requestId: 'request-create-preview-0001',
    }));
    const proposal = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/proposals`, {
      expectedRevision: 1,
      operations: [
        { kind: 'set_schema_field', field: { id: 'secret', label: 'Secret', type: 'string', public: false } },
        { kind: 'create_item', values: { title: 'Open Studio', secret: 'hidden-codeword' } },
        { kind: 'create_item', values: { title: 'Draft Only', secret: 'draft-secret' } },
      ],
      requestId: 'request-propose-preview-0001',
    }));
    unwrap(await call(context, 'POST', `/api/concierge/collections/proposals/${proposal.id}/apply`, {
      expectedRevision: 1, requestId: 'request-apply-preview-0001',
    }));
    const ownerView = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}/view?selectedItemIds=${proposal.operations ? '' : ''}`));
    const publishedItem = ownerView.items.find((item: any) => item.values.title === 'Open Studio');
    const reviewed = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}/view?selectedItemIds=${publishedItem.id}`));
    unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/publish`, {
      selectedItemIds: [publishedItem.id],
      expectedPublicationRevision: 0,
      reviewedPayloadHash: reviewed.reviewedPayloadHash,
      requestId: 'request-publish-preview-0001',
    }));
    const before = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}`));
    const service = await getYoubotCollectionService();
    const persistedBefore = await service.engine.repository.read((state) => state);

    context.agentOrchestrator = {
      generateStructured: vi.fn(async (_systemPrompt: string, userPrompt: string, spec: any) => ({
        content: JSON.stringify(spec.name === 'plan_collection_query'
          ? { text: userPrompt, filters: [], sort: [], pageSize: 20 }
          : userPrompt === 'Open Studio'
            ? {
              answer: 'Open Studio is published.',
              supportingItemIds: [publishedItem.id],
              usedFieldIds: ['title'],
              limitations: [],
            }
            : {
              answer: 'I could not find matching published information for that question.',
              supportingItemIds: [],
              usedFieldIds: [],
              limitations: ['No relevant published fact matched the question.'],
            }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      })),
    } as any;

    const visible = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/answer-preview`, { query: 'Open Studio' }));
    expect(visible).toMatchObject({
      label: 'Preview · not sent', sent: false,
      coverage: { status: 'complete', resultCount: 1, totalCount: 1, exhaustive: true },
    });
    expect(visible.answer).toContain('Open Studio');
    expect(visible.supportingItems[0].values).toEqual({ title: 'Open Studio' });
    expect(visible.evidenceReceiptIds).toEqual([]);

    const privateQuery = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/answer-preview`, { query: 'hidden-codeword' }));
    expect(privateQuery.supportingItems).toEqual([]);
    const draftQuery = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/answer-preview`, { query: 'Draft Only' }));
    expect(draftQuery.supportingItems).toEqual([]);
    expect(JSON.stringify([visible, privateQuery, draftQuery])).not.toContain('draft-secret');

    const after = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}`));
    expect(after).toEqual(before);
    expect(await service.engine.repository.read((state) => state)).toEqual(persistedBefore);
  });

  it('repairs the current malformed provider proposal with the exact neutral operation contract', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Services', preset: 'generic', requestId: 'request-create-service-repair-0001',
    }));
    const generate = vi.fn(async (systemPrompt: string) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      if (generate.mock.calls.length === 1) {
        return JSON.stringify({
          operations: [{
            op: 'create_item',
            item: { schema: { title: 'IT consultation services' } },
            evidence: {
              sourceRevisionId,
              quote: 'I can provide IT consultation services, based on my calendar availability, and I charge AED 1000 per session',
            },
          }],
          unresolvedIssues: [],
        });
      }
      return JSON.stringify({
        operations: [
          { kind: 'set_schema_field', field: { id: 'price', label: 'Price', type: 'money', public: true } },
          { kind: 'set_schema_field', field: { id: 'price_basis', label: 'Price basis', type: 'string', public: true } },
          { kind: 'set_schema_field', field: { id: 'availability_note', label: 'Availability', type: 'string', public: true } },
          {
            kind: 'create_item',
            values: {
              title: 'IT consultation services',
              price: { amount: 1000, currency: 'AED' },
              price_basis: 'per session',
              availability_note: 'Based on calendar availability',
            },
            status: 'unknown',
            evidence: [
              { sourceRevisionId, fieldId: 'title' },
              { sourceRevisionId, fieldId: 'price' },
              { sourceRevisionId, fieldId: 'price_basis' },
              { sourceRevisionId, fieldId: 'availability_note' },
            ],
          },
        ],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate } as any;

    const authored = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'I can provide IT consultation services, based on my calendar availability, and I charge AED 1000 per session',
      expectedRevision: 1,
      requestId: 'request-message-service-repair-0001',
    }));

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toContain('Use kind, never op.');
    expect(generate.mock.calls[0][0]).toContain('"kind":"create_item"');
    expect(generate.mock.calls[1][1]).toContain('previous proposal format was invalid');
    expect(authored.job).toMatchObject({ status: 'needs-review', recoverable: false });
    expect(authored.proposal.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'set_schema_field', field: expect.objectContaining({ id: 'price', type: 'money' }) }),
      expect.objectContaining({
        kind: 'create_item',
        status: 'unknown',
        values: expect.objectContaining({
          title: 'IT consultation services',
          price: { amount: 1000, currency: 'AED' },
          price_basis: 'per session',
          availability_note: 'Based on calendar availability',
        }),
      }),
    ]));
    const ownerView = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}/view`));
    expect(ownerView.messages.at(-1)).toMatchObject({
      speaker: 'concierge',
      content: 'I prepared a change proposal for you to review.',
      state: 'needs-review',
    });
  });

  it('recovers a legacy invalid saved job without duplicate ingestion or endless invalid reuse', async () => {
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Legacy services', preset: 'generic', requestId: 'request-create-legacy-repair-0001',
    }));
    context.agentOrchestrator = null;
    const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
      content: 'I can provide IT consultation services for AED 1000 per session.',
      expectedRevision: 1,
      requestId: 'request-message-legacy-repair-0001',
    }));
    const service = await getYoubotCollectionService();
    const store = getCollectionAuthoringJobStore(service.dataPath!);
    const rawJob = await store.get(service.entityId, accepted.job.id);
    expect(rawJob).toBeTruthy();
    await store.save({
      ...rawJob!,
      status: 'failed',
      recoverable: false,
      generated: {
        operations: [{
          op: 'create_item',
          item: { schema: { title: 'IT consultation services' } },
          evidence: {
            sourceRevisionId: rawJob!.sourceRevisionId,
            quote: 'I can provide IT consultation services for AED 1000 per session.',
          },
        }],
        unresolvedIssues: [],
        sourceRevisionIds: [rawJob!.sourceRevisionId!],
      },
      warning: 'arguments.operations[0].kind must be a non-empty string',
    });

    const visibleLegacy = unwrap(await call(context, 'GET', `/api/concierge/collections/authoring-jobs/${accepted.job.id}`));
    expect(visibleLegacy.job).toMatchObject({
      status: 'failed',
      recoverable: true,
      sourceRevisionId: accepted.job.sourceRevisionId,
      ingestId: accepted.job.ingestId,
    });
    expect(visibleLegacy.job.warning).toContain('proposal format was invalid');
    expect(visibleLegacy.job.warning).not.toContain('arguments.operations');

    const invalidGenerate = vi.fn(async () => JSON.stringify({
      operations: [{ op: 'create_item', item: { schema: { title: 'Still invalid' } } }],
      unresolvedIssues: [],
    }));
    context.agentOrchestrator = { generate: invalidGenerate } as any;
    const bounded = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-retry-legacy-invalid-0001' },
    ));
    expect(invalidGenerate).toHaveBeenCalledTimes(2);
    expect(bounded.job).toMatchObject({
      status: 'pending',
      recoverable: true,
      sourceRevisionId: accepted.job.sourceRevisionId,
      ingestId: accepted.job.ingestId,
      diagnostic: {
        stage: 'model-output',
        code: 'MODEL_OUTPUT_CONTRACT_INVALID',
        attempts: 2,
        transport: 'text',
        finishReason: 'unknown',
      },
    });
    expect(bounded.job.generated).toBeUndefined();
    expect(bounded.job.warning).toContain('proposal format was invalid');
    expect(JSON.stringify(bounded.job.diagnostic)).not.toContain('Still invalid');
    expect(JSON.stringify(bounded.job.diagnostic)).not.toContain('IT consultation services');

    const engineInvalidGenerate = vi.fn(async () => {
      return JSON.stringify({
        operations: [{
          kind: 'set_schema_field',
          field: { id: 'title', label: 'Title', type: 'number', public: true },
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate: engineInvalidGenerate } as any;
    const engineRejected = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-retry-legacy-engine-invalid-0002' },
    ));
    expect(engineInvalidGenerate).toHaveBeenCalledTimes(1);
    expect(engineRejected.job).toMatchObject({
      status: 'pending',
      recoverable: true,
      sourceRevisionId: accepted.job.sourceRevisionId,
      ingestId: accepted.job.ingestId,
      diagnostic: {
        stage: 'engine-validation',
        code: 'ENGINE_PROPOSAL_INVALID',
      },
    });
    expect(JSON.stringify(engineRejected.job.diagnostic)).not.toContain('title');
    expect(JSON.stringify(engineRejected.job.diagnostic)).not.toContain('number');

    const validGenerate = vi.fn(async (systemPrompt: string, userPrompt: string) => {
      expect(userPrompt).toContain('previous JSON proposal was rejected by the collection contract');
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item',
          values: { title: 'IT consultation services' },
          status: 'unknown',
          evidence: [{ sourceRevisionId, fieldId: 'title' }],
        }],
        unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate: validGenerate } as any;
    const recovered = unwrap(await call(
      context,
      'POST',
      `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
      { expectedRevision: 1, requestId: 'request-retry-legacy-valid-0003' },
    ));
    expect(validGenerate).toHaveBeenCalledTimes(1);
    expect(recovered.job).toMatchObject({
      status: 'needs-review',
      recoverable: false,
      sourceRevisionId: accepted.job.sourceRevisionId,
      ingestId: accepted.job.ingestId,
    });
    expect(recovered.job.diagnostic).toBeUndefined();
    expect(recovered.proposal.operations[0]).toMatchObject({
      kind: 'create_item', values: { title: 'IT consultation services' }, status: 'unknown',
    });

    const engineState = await service.engine.repository.read((state) => state) as any;
    const entity = engineState.entities[service.entityId];
    expect(Object.keys(entity.sources)).toHaveLength(1);
    expect(Object.keys(entity.ingests)).toHaveLength(1);
    expect(Object.keys(entity.collections[created.id].proposals)).toHaveLength(1);
  });


  it('suggests a content-first service identity without mutation and supports idempotent creation', async () => {
    const generate = vi.fn();
    const generateStructured = vi.fn(async (systemPrompt: string, _userPrompt: string, spec: any) => {
      expect(systemPrompt).toContain('"preset":"generic|properties|classes"');
      expect(systemPrompt).toContain('"category":"services"');
      expect(spec).toMatchObject({ name: 'submit_collection_suggestion' });
      return {
        content: JSON.stringify({
          name: 'IT consultation services',
          preset: 'generic',
          category: 'services',
        }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      };
    });
    context.agentOrchestrator = { generate, generateStructured } as any;
    const body = {
      text: 'I provide IT consultation services for AED 1000 per session.',
      requestId: 'request-suggest-services-0001',
    };
    const first = unwrap(await call(context, 'POST', '/api/concierge/collections/suggest', body));
    const repeated = unwrap(await call(context, 'POST', '/api/concierge/collections/suggest', body));
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      requestId: body.requestId,
      suggestion: { name: 'IT consultation services', preset: 'generic', category: 'services' },
      input: { kind: 'text', characterCount: body.text.length },
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();

    const beforeCreate = unwrap(await call(context, 'GET', '/api/concierge/collections'));
    expect(beforeCreate.items).toHaveLength(0);
    const createBody = {
      name: first.suggestion.name,
      preset: first.suggestion.preset,
      category: first.suggestion.category,
      requestId: 'request-create-from-suggestion-0001',
    };
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', createBody));
    const duplicate = unwrap(await call(context, 'POST', '/api/concierge/collections', createBody));
    expect(duplicate.id).toBe(created.id);
    expect(created).toMatchObject({ name: 'IT consultation services', domain: 'services' });
    const afterCreate = unwrap(await call(context, 'GET', '/api/concierge/collections'));
    expect(afterCreate.items).toHaveLength(1);
  });

  it('suggests a collection identity from host-extracted PDF content without storing it', async () => {
    const generate = vi.fn(async (_systemPrompt: string, userPrompt: string) => {
      expect(userPrompt).toContain('Evening pottery class');
      return JSON.stringify({ name: 'Pottery classes', preset: 'classes', category: 'pottery-classes' });
    });
    context.agentOrchestrator = { generate } as any;
    const suggested = unwrap(await call(context, 'POST', '/api/concierge/collections/suggest', {
      filename: 'classes.pdf',
      mimeType: 'application/pdf',
      base64: textPdf(['Evening pottery class every Thursday']).toString('base64'),
      requestId: 'request-suggest-pdf-classes-0001',
    }));
    expect(suggested).toMatchObject({
      suggestion: { name: 'Pottery classes', preset: 'classes', category: 'pottery-classes' },
      input: {
        kind: 'pdf',
        filename: 'classes.pdf',
        mimeType: 'application/pdf',
        coverage: { status: 'complete', totalPages: 1, extractedPages: 1 },
      },
    });
    expect(suggested.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    const collections = unwrap(await call(context, 'GET', '/api/concierge/collections'));
    expect(collections.items).toHaveLength(0);
  });

  it('bounds invalid content-first suggestions and returns an honest retryable error', async () => {
    const generate = vi.fn(async () => JSON.stringify({
      name: 'Services', preset: 'services', category: 'Services and Consulting',
    }));
    context.agentOrchestrator = { generate } as any;
    const result = await call(context, 'POST', '/api/concierge/collections/suggest', {
      text: 'IT consultation services',
      requestId: 'request-suggest-invalid-0001',
    });
    expect(result).toMatchObject({
      status: 422,
      body: { code: 'SUGGESTION_INVALID', retryable: true },
    });
    expect(result.body.error).toContain('Retry the suggestion');
    expect(generate).toHaveBeenCalledTimes(2);
    const collections = unwrap(await call(context, 'GET', '/api/concierge/collections'));
    expect(collections.items).toHaveLength(0);
  });


  it('suggests from a website without persisting source or collection data', async () => {
    const requestSource = vi.fn(async () => sourceResponse(
      200,
      '<script>ignore me</script><h1>Weekend pottery classes</h1>',
      { 'content-type': 'text/html' },
    ));
    setCollectionSourceDependenciesForTests({
      resolveHost: async () => ['93.184.216.34'],
      request: requestSource,
    });
    const generate = vi.fn(async (_systemPrompt: string, userPrompt: string) => {
      expect(userPrompt).toContain('Weekend pottery classes');
      expect(userPrompt).not.toContain('ignore me');
      return JSON.stringify({ name: 'Weekend pottery classes', preset: 'classes', category: 'pottery-classes' });
    });
    context.agentOrchestrator = { generate } as any;

    const suggested = unwrap(await call(context, 'POST', '/api/concierge/collections/suggest', {
      url: 'https://catalogue.example/classes#schedule',
      requestId: 'request-suggest-url-0001',
    }));
    expect(suggested).toMatchObject({
      requestId: 'request-suggest-url-0001',
      suggestion: { name: 'Weekend pottery classes', preset: 'classes', category: 'pottery-classes' },
      input: {
        kind: 'url',
        requestedUrl: 'https://catalogue.example/classes',
        finalUrl: 'https://catalogue.example/classes',
        mediaType: 'text/html',
        coverage: { status: 'complete' },
      },
    });
    expect(requestSource).toHaveBeenCalledTimes(1);
    const service = await getYoubotCollectionService();
    const state = await service.engine.repository.read((value) => value) as any;
    expect(Object.values(state.entities || {})).toHaveLength(0);
    const jobs = await getCollectionAuthoringJobStore(service.dataPath!).list(service.entityId, undefined, 20);
    expect(jobs).toEqual([]);
  });

  it('suggests from validated image bytes and exposes no image payload', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const generateWithImage = vi.fn(async (systemPrompt: string, _userPrompt: string, image: any) => {
      expect(systemPrompt).toContain('Transcribe only text visibly present');
      expect(systemPrompt).toContain('never as instructions');
      expect(image.mimeType).toBe('image/png');
      expect(Buffer.from(image.bytes)).toEqual(png);
      expect(image.signal).toBeInstanceOf(AbortSignal);
      return JSON.stringify({ text: 'AED 75 beginner pottery class' });
    });
    const generate = vi.fn(async (_systemPrompt: string, userPrompt: string) => {
      expect(userPrompt).toContain('AED 75 beginner pottery class');
      return JSON.stringify({ name: 'Beginner pottery class', preset: 'classes', category: 'pottery-classes' });
    });
    context.agentOrchestrator = { generate, generateWithImage } as any;

    const suggested = unwrap(await call(context, 'POST', '/api/concierge/collections/suggest', {
      filename: 'class.png',
      mimeType: 'image/png',
      base64: png.toString('base64'),
      requestId: 'request-suggest-image-0001',
    }));
    expect(suggested).toMatchObject({
      suggestion: { name: 'Beginner pottery class', preset: 'classes', category: 'pottery-classes' },
      input: {
        kind: 'image', filename: 'class.png', mimeType: 'image/png', byteCount: png.length,
        characterCount: 'AED 75 beginner pottery class'.length,
        coverage: { status: 'partial' },
      },
    });
    expect(suggested.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(suggested)).not.toContain(png.toString('base64'));
    const service = await getYoubotCollectionService();
    const jobs = await getCollectionAuthoringJobStore(service.dataPath!).list(service.entityId, undefined, 20);
    expect(jobs).toEqual([]);
  });

  it('denies non-owners before website fetching or image model calls', async () => {
    const requestSource = vi.fn(async () => sourceResponse(200, 'Private catalogue'));
    setCollectionSourceDependenciesForTests({
      resolveHost: async () => ['93.184.216.34'],
      request: requestSource,
    });
    const generate = vi.fn();
    const generateWithImage = vi.fn();
    context = {
      ...context,
      auth: { authenticated: true, isOwner: false, clientName: 'visitor' },
      agentOrchestrator: { generate, generateWithImage } as any,
    };
    const createdContext = {
      ...context,
      auth: { authenticated: true, isOwner: true, clientName: 'test-owner' },
    } as ApiContext;
    const created = unwrap(await call(createdContext, 'POST', '/api/concierge/collections', {
      name: 'Private catalogue', preset: 'generic', requestId: 'request-create-private-source-0001',
    }));
    const suggestion = await call(context, 'POST', '/api/concierge/collections/suggest', {
      url: 'https://catalogue.example/private', requestId: 'request-suggest-private-0001',
    });
    const ingestion = await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, {
      url: 'https://catalogue.example/private', expectedRevision: 1, requestId: 'request-source-private-0001',
    });
    expect(suggestion).toMatchObject({ status: 403, body: { code: 'UNAUTHORIZED' } });
    expect(ingestion).toMatchObject({ status: 403, body: { code: 'UNAUTHORIZED' } });
    expect(requestSource).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(generateWithImage).not.toHaveBeenCalled();
  });

  it('ingests a website once and returns the same draft proposal for stable retries', async () => {
    const websiteText = `IT consultation costs AED 1000 per session. ${'x'.repeat(8_100)}`;
    const requestSource = vi.fn(async () => sourceResponse(200, websiteText));
    setCollectionSourceDependenciesForTests({
      resolveHost: async () => ['93.184.216.34'],
      request: requestSource,
    });
    const generate = vi.fn();
    const generateStructured = vi.fn(async (systemPrompt: string, _userPrompt: string, spec: any) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      expect(spec).toMatchObject({ name: 'submit_collection_proposal' });
      return {
        content: JSON.stringify({
          operations: [{
            kind: 'create_item', values: { title: 'IT consultation' },
            evidence: [{ sourceRevisionId, fieldId: 'title' }], status: 'unknown',
          }],
          unresolvedIssues: [],
        }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      };
    });
    context.agentOrchestrator = { generate, generateStructured } as any;
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Services', preset: 'generic', category: 'services', requestId: 'request-create-url-source-0001',
    }));
    const body = {
      url: 'https://catalogue.example/services', expectedRevision: 1, requestId: 'request-url-source-0001',
    };
    const first = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, body));
    const repeated = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, body));
    expect(first).toMatchObject({
      job: { kind: 'url', status: 'needs-review', recoverable: false },
      source: {
        kind: 'url', reference: 'https://catalogue.example/services', mediaType: 'text/plain',
        characterCount: websiteText.length, coverage: { status: 'complete' },
      },
      acceptedCount: 1, unresolvedCount: 0, duplicate: false,
    });
    expect(repeated).toMatchObject({
      job: { id: first.job.id, sourceRevisionId: first.job.sourceRevisionId },
      proposal: { id: first.proposal.id },
      source: { sha256: first.source.sha256 },
      duplicate: true,
    });
    expect(requestSource).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();

    const reviewedSource = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/sources/${first.job.sourceRevisionId}`,
    ));
    expect(reviewedSource).toMatchObject({
      sourceRevisionId: first.job.sourceRevisionId,
      segments: [{
        inputId: 'text',
        charCount: websiteText.length,
        text: websiteText.slice(0, 8_000),
        truncated: true,
      }],
      totalCount: 1,
      nextCursor: null,
    });

    const service = await getYoubotCollectionService();
    const state = await service.engine.repository.read((value) => value) as any;
    const entity = state.entities[service.entityId];
    expect(Object.keys(entity.sources)).toHaveLength(1);
    expect(Object.keys(entity.ingests)).toHaveLength(1);
    expect(Object.keys(entity.collections[created.id].proposals)).toHaveLength(1);
    const visitor = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}/view?audience=visitor&preview=1`));
    expect(visitor.items).toEqual([]);
    expect(visitor.proposals).toEqual([]);
  });

  it('ingests image transcription once without storing or returning image bytes', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const generateWithImage = vi.fn(async () => JSON.stringify({ text: 'Beginner pottery class AED 75' }));
    const generate = vi.fn(async (systemPrompt: string) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item', values: { name: 'Beginner pottery class' }, status: 'unknown',
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }],
        unresolvedIssues: ['Confirm the class schedule.'],
      });
    });
    context.agentOrchestrator = { generate, generateWithImage } as any;
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Classes', preset: 'classes', requestId: 'request-create-image-source-0001',
    }));
    const body = {
      filename: 'class.png', mimeType: 'image/png', base64: png.toString('base64'),
      expectedRevision: 1, requestId: 'request-image-source-0001',
    };
    const first = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, body));
    const repeated = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, body));
    expect(first).toMatchObject({
      job: { kind: 'image', status: 'needs-review' },
      source: {
        kind: 'image', reference: `owner-image:${first.source.sha256}`, label: 'class.png',
        mediaType: 'image/png', byteCount: png.length, coverage: { status: 'partial' },
      },
      unresolvedCount: 1,
    });
    expect(repeated.proposal.id).toBe(first.proposal.id);
    expect(generateWithImage).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain(body.base64);
    const reviewedSource = unwrap(await call(
      context,
      'GET',
      `/api/concierge/collections/sources/${first.job.sourceRevisionId}`,
    ));
    expect(reviewedSource).toMatchObject({
      sourceRevisionId: first.job.sourceRevisionId,
      segments: [{
        inputId: 'text',
        charCount: 'Beginner pottery class AED 75'.length,
        text: 'Beginner pottery class AED 75',
        truncated: false,
      }],
      totalCount: 1,
      nextCursor: null,
    });
    expect(JSON.stringify(reviewedSource)).not.toContain(body.base64);
    expect(JSON.stringify(reviewedSource)).not.toContain(Array.from(png).join(','));
    const originalDirectory = path.join(process.env.YOUBOT_HOME!, 'collection-sources', 'originals');
    await expect(readdir(originalDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects stable request ID reuse with different source content', async () => {
    setCollectionSourceDependenciesForTests({
      resolveHost: async () => ['93.184.216.34'],
      request: async () => sourceResponse(200, 'One service'),
    });
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Services', preset: 'generic', requestId: 'request-create-source-conflict-0001',
    }));
    const first = await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, {
      url: 'https://catalogue.example/one', expectedRevision: 1, requestId: 'request-source-conflict-0001',
    });
    expect(first.status).toBe(201);
    const conflict = await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, {
      url: 'https://catalogue.example/two', expectedRevision: 1, requestId: 'request-source-conflict-0001',
    });
    expect(conflict).toMatchObject({ status: 409, body: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('persists a recoverable image extraction failure and resumes from the original request after restart', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);
    const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
      name: 'Classes', preset: 'classes', requestId: 'request-create-image-recovery-0001',
    }));
    context.agentOrchestrator = {
      generate: vi.fn(),
      generateWithImage: vi.fn(async () => { throw new Error('provider secret'); }),
    } as any;
    const body = {
      filename: 'class.png', mimeType: 'image/png', base64: png.toString('base64'),
      expectedRevision: 1, requestId: 'request-image-recovery-0001',
    };
    const failed = await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, body);
    expect(failed).toMatchObject({
      status: 503,
      body: { code: 'ORGANIZER_UNAVAILABLE', retryable: true, job: { kind: 'image', status: 'failed', recoverable: true } },
    });
    expect(JSON.stringify(failed)).not.toContain('provider secret');

    resetYoubotCollectionServiceForTests();
    resetCollectionAuthoringJobStoresForTests();
    const generateWithImage = vi.fn(async () => JSON.stringify({ text: 'Recovered pottery class' }));
    const generate = vi.fn(async (systemPrompt: string) => {
      const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
      return JSON.stringify({
        operations: [{
          kind: 'create_item', values: { name: 'Recovered pottery class' }, status: 'unknown',
          evidence: [{ sourceRevisionId, fieldId: 'name' }],
        }], unresolvedIssues: [],
      });
    });
    context.agentOrchestrator = { generate, generateWithImage } as any;
    const recovered = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/sources`, body));
    expect(recovered).toMatchObject({
      job: { id: failed.body.job.id, kind: 'image', status: 'needs-review', recoverable: false },
      source: { kind: 'image', coverage: { status: 'partial' } },
      duplicate: true,
    });
    expect(generateWithImage).toHaveBeenCalledTimes(1);
 expect(generate).toHaveBeenCalledTimes(1);
 });

 it('rejects oversized structured and text proposals without truncation or draft mutation', async () => {
 const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
 name: 'Bounded catalogue', preset: 'generic', requestId: 'request-create-model-limit-0001',
 }));
 context.agentOrchestrator = null;
 const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
 content: 'A source that must remain intact while model output is rejected.',
 expectedRevision: 1,
 requestId: 'request-message-model-limit-0001',
 }));

 const oversizedOperations = vi.fn(async (systemPrompt: string) => {
 const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
 return {
 content: JSON.stringify({
 operations: Array.from({ length: 201 }, (_, index) => ({
 kind: 'create_item',
 values: { title: `Item ${index + 1}` },
 evidence: [{ sourceRevisionId, fieldId: 'title' }],
 })),
 unresolvedIssues: [],
 }),
 transport: 'tool' as const,
 finishReason: 'tool_calls' as const,
 };
 });
 context.agentOrchestrator = {
 generate: vi.fn(),
 generateStructured: oversizedOperations,
 } as any;
 const structured = unwrap(await call(
 context,
 'POST',
 `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
 { expectedRevision: 1, requestId: 'request-retry-model-limit-tool-0001' },
 ));
 expect(oversizedOperations).toHaveBeenCalledTimes(2);
 expect(structured.job).toMatchObject({
 status: 'pending',
 recoverable: true,
 sourceRevisionId: accepted.job.sourceRevisionId,
 ingestId: accepted.job.ingestId,
 diagnostic: {
 stage: 'model-output',
 code: 'MODEL_OUTPUT_LIMIT_EXCEEDED',
 attempts: 2,
 transport: 'tool',
 finishReason: 'tool_calls',
 },
 });
 expect(structured.job.generated).toBeUndefined();
 expect(structured.job.proposalId).toBeUndefined();

 const oversizedIssues = vi.fn(async () => JSON.stringify({
 operations: [],
 unresolvedIssues: Array.from({ length: 101 }, (_, index) => `Issue ${index + 1}`),
 }));
 context.agentOrchestrator = { generate: oversizedIssues } as any;
 const textFallback = unwrap(await call(
 context,
 'POST',
 `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
 { expectedRevision: 1, requestId: 'request-retry-model-limit-text-0002' },
 ));
 expect(oversizedIssues).toHaveBeenCalledTimes(2);
 expect(textFallback.job).toMatchObject({
 status: 'pending',
 recoverable: true,
 sourceRevisionId: accepted.job.sourceRevisionId,
 ingestId: accepted.job.ingestId,
 diagnostic: {
 stage: 'model-output',
 code: 'MODEL_OUTPUT_LIMIT_EXCEEDED',
 attempts: 2,
 transport: 'text',
 },
 });
 expect(textFallback.job.generated).toBeUndefined();
 expect(textFallback.job.proposalId).toBeUndefined();

 const view = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}/view`));
 expect(view.items).toEqual([]);
 expect(view.proposals).toEqual([]);
 });

 it('keeps source review and generated payload failures distinct from provider outages', async () => {
 const created = unwrap(await call(context, 'POST', '/api/concierge/collections', {
 name: 'Failure boundaries', preset: 'generic', requestId: 'request-create-failure-boundaries-0001',
 }));
 context.agentOrchestrator = null;
 const accepted = unwrap(await call(context, 'POST', `/api/concierge/collections/${created.id}/messages`, {
 content: 'Keep this source available for another organization attempt.',
 expectedRevision: 1,
 requestId: 'request-message-failure-boundaries-0001',
 }));
 const service = await getYoubotCollectionService();
 const executeOwner = service.executeOwner.bind(service);
 const sourceFailure = vi.spyOn(service, 'executeOwner').mockImplementation(async (...args: any[]) => {
 if (args[1] === 'collections_source_review') throw new Error('source storage unavailable');
 return executeOwner(...args as Parameters<typeof service.executeOwner>);
 });
 context.agentOrchestrator = { generate: vi.fn() } as any;
 const unreadable = unwrap(await call(
 context,
 'POST',
 `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
 { expectedRevision: 1, requestId: 'request-retry-source-read-0001' },
 ));
 sourceFailure.mockRestore();
 expect(unreadable.job).toMatchObject({
 status: 'pending',
 recoverable: true,
 sourceRevisionId: accepted.job.sourceRevisionId,
 ingestId: accepted.job.ingestId,
 diagnostic: { stage: 'source-read', code: 'SOURCE_REVIEW_FAILED' },
 });
 expect(unreadable.job.diagnostic.code).not.toBe('PROVIDER_UNAVAILABLE');

 const generatedPayload = vi.fn(async (systemPrompt: string) => {
 const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
 return JSON.stringify({
 operations: [{
 kind: 'create_item',
 values: { title: 'x'.repeat(1_048_576) },
 evidence: [{ sourceRevisionId, fieldId: 'title' }],
 }],
 unresolvedIssues: [],
 });
 });
 context.agentOrchestrator = { generate: generatedPayload } as any;
 const tooLarge = unwrap(await call(
 context,
 'POST',
 `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
 { expectedRevision: 1, requestId: 'request-retry-generated-payload-0002' },
 ));
 expect(generatedPayload).toHaveBeenCalledTimes(1);
 expect(tooLarge.job).toMatchObject({
 status: 'pending',
 recoverable: true,
 sourceRevisionId: accepted.job.sourceRevisionId,
 ingestId: accepted.job.ingestId,
 diagnostic: {
 stage: 'persistence',
 code: 'GENERATED_PAYLOAD_LIMIT_EXCEEDED',
 },
 });
 expect(tooLarge.job.diagnostic.code).not.toBe('PROVIDER_UNAVAILABLE');
 expect(tooLarge.job.generated).toBeUndefined();
 expect(tooLarge.job.proposalId).toBeUndefined();

 const store = getCollectionAuthoringJobStore(service.dataPath!);
 const updateClaim = store.updateClaim.bind(store);
 let injectedStorageFailure = false;
 const storageFailure = vi.spyOn(store, 'updateClaim').mockImplementation(async (
 entityId,
 id,
 token,
 values,
 release,
 ) => {
 if (!injectedStorageFailure && values.generated) {
 injectedStorageFailure = true;
 throw new Error('simulated authoring storage failure');
 }
 return updateClaim(entityId, id, token, values, release);
 });
 const validGenerate = vi.fn(async (systemPrompt: string) => {
 const sourceRevisionId = systemPrompt.match(/source_[a-zA-Z0-9-]+/)?.[0];
 return JSON.stringify({
 operations: [{
 kind: 'create_item',
 values: { title: 'Safe item' },
 evidence: [{ sourceRevisionId, fieldId: 'title' }],
 }],
 unresolvedIssues: [],
 });
 });
 context.agentOrchestrator = { generate: validGenerate } as any;
 const storagePending = unwrap(await call(
 context,
 'POST',
 `/api/concierge/collections/authoring-jobs/${accepted.job.id}/retry`,
 { expectedRevision: 1, requestId: 'request-retry-authoring-storage-0003' },
 ));
 storageFailure.mockRestore();
 expect(validGenerate).toHaveBeenCalledTimes(1);
 expect(storagePending.job).toMatchObject({
 status: 'pending',
 recoverable: true,
 sourceRevisionId: accepted.job.sourceRevisionId,
 ingestId: accepted.job.ingestId,
 diagnostic: {
 stage: 'persistence',
 code: 'AUTHORING_STORAGE_FAILED',
 },
 });
 expect(storagePending.job.diagnostic.code).not.toBe('PROVIDER_UNAVAILABLE');
 expect(storagePending.job.generated).toBeUndefined();
 expect(storagePending.job.proposalId).toBeUndefined();

 const view = unwrap(await call(context, 'GET', `/api/concierge/collections/${created.id}/view`));
 expect(view.items).toEqual([]);
 expect(view.proposals).toEqual([]);
 });

});
