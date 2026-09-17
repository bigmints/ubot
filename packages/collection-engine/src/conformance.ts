import type { ExecutionContext, RepositoryPort } from './types.js';
import { createCollectionEngine, executeCollectionTool } from './engine.js';

export async function runRepositoryConformance(repository: RepositoryPort): Promise<{ passed: true }> {
  let sequence = 0;
  const context: ExecutionContext = { actorId: 'conformance-owner', entityId: 'conformance-entity', audience: 'owner', authorizationHandle: 'test', correlationId: 'conformance' };
  const engine = createCollectionEngine({ repository, policy: { authorize: async () => true }, ids: { next: (prefix) => `${prefix}_${++sequence}` }, clock: { now: () => new Date('2026-01-01T00:00:00.000Z') } });
  const call = await executeCollectionTool(engine, context, { name: 'collections_create', arguments: { name: 'Conformance' }, toolVersion: '1', requestId: 'create-1' });
  if (!call.ok) throw new Error('Repository conformance create failed');
  const retried = await executeCollectionTool(engine, context, { name: 'collections_create', arguments: { name: 'Conformance' }, toolVersion: '1', requestId: 'create-1' });
  if (!retried.ok || JSON.stringify(retried.data) !== JSON.stringify(call.data)) throw new Error('Repository conformance idempotency failed');
  const read = await repository.read((state) => Object.keys(state.entities[context.entityId]?.collections ?? {}).length);
  if (read !== 1) throw new Error('Repository conformance atomic read failed');
  return { passed: true };
}
