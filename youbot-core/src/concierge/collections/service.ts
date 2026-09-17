import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  createCollectionEngine,
  createJsonFileCollectionRepository,
  createMemoryCollectionRepository,
  executeCollectionTool,
  getCollectionToolDefinitions,
  type CollectionEngine,
  type ExecutionContext,
  type PolicyPort,
  type RepositoryPort,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from '@youbot/collection-engine';

const VISITOR_READ_TOOLS = new Set([
  'collections_tools_list',
  'collections_list',
  'collections_get',
  'collections_item_get',
  'collections_search',
  'collections_view_get',
  'collections_evidence_validate',
]);

const EXACT_INTENT_TOOLS = new Set([
  'collections_publish',
  'collections_unpublish',
  'collections_archive',
]);

export type CollectionActor = {
  id: string;
  label?: string;
};

export type ExecuteOptions = {
  requestId?: string;
  exactIntent?: boolean;
};

export type CollectionServiceOptions = {
  dataPath?: string;
  entityId?: string;
  repository?: RepositoryPort;
};

function opaqueId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

export function resolveCollectionDataPath(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): string {
  const root = environment.YOUBOT_HOME
    ? path.resolve(environment.YOUBOT_HOME)
    : path.resolve(workingDirectory);
  return path.join(root, 'data', 'collections', 'engine.json');
}

export function resolveCollectionEntityId(
  dataPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.YOUBOT_ENTITY_ID?.trim();
  return configured || opaqueId('entity', path.dirname(path.resolve(dataPath)));
}

export function ownerActor(clientName?: string): CollectionActor {
  const stableName = clientName?.trim() || 'local-dashboard';
  return { id: opaqueId('owner', stableName), label: stableName };
}

export function channelActor(
  audience: ExecutionContext['audience'],
  sessionId?: string,
  source?: string,
): CollectionActor {
  const stableSession = sessionId?.trim() || 'unknown-session';
  const stableSource = source?.trim() || 'unknown-source';
  const label = `${stableSource}:${stableSession}`;
  return { id: opaqueId(audience, label), label };
}

export class YoubotCollectionService {
  readonly entityId: string;
  readonly dataPath?: string;
  private readonly engine: CollectionEngine;
  private readonly authorizationHandle = randomUUID();

  private constructor(
    repository: RepositoryPort,
    entityId: string,
    dataPath?: string,
  ) {
    this.entityId = entityId;
    this.dataPath = dataPath;

    const policy: PolicyPort = {
      authorize: async ({ context, action }) => {
        if (
          context.authorizationHandle !== this.authorizationHandle
          || context.entityId !== this.entityId
        ) {
          return { allowed: false, reason: 'The collection is not available.' };
        }

        if (context.audience === 'visitor') {
          return {
            allowed: VISITOR_READ_TOOLS.has(action),
            reason: VISITOR_READ_TOOLS.has(action)
              ? undefined
              : 'Visitors cannot change collections.',
          };
        }

        if (EXACT_INTENT_TOOLS.has(action)) {
          const expected = `intent:${context.correlationId}`;
          return {
            allowed: context.intentReceipt === expected,
            reason: context.intentReceipt === expected
              ? undefined
              : 'Use an explicit owner action to publish or withdraw content.',
          };
        }

        return { allowed: true, policyRevision: 'youbot-local-owner-v1' };
      },
    };

    this.engine = createCollectionEngine({ repository, policy });
  }

  static async create(options: CollectionServiceOptions = {}): Promise<YoubotCollectionService> {
    const dataPath = options.dataPath || resolveCollectionDataPath();
    const repository = options.repository
      || await createJsonFileCollectionRepository({ filePath: dataPath });
    const entityId = options.entityId || resolveCollectionEntityId(dataPath);
    return new YoubotCollectionService(repository, entityId, options.repository ? undefined : dataPath);
  }

  static memory(entityId = 'entity_test'): YoubotCollectionService {
    return new YoubotCollectionService(createMemoryCollectionRepository(), entityId);
  }

  private context(
    audience: ExecutionContext['audience'],
    actor: CollectionActor,
    correlationId: string,
    exactIntent = false,
  ): ExecutionContext {
    return Object.freeze({
      actorId: actor.id,
      entityId: this.entityId,
      audience,
      authorizationHandle: this.authorizationHandle,
      correlationId,
      ...(exactIntent ? { intentReceipt: `intent:${correlationId}` } : {}),
    });
  }

  async ownerTools(actor: CollectionActor): Promise<readonly ToolDefinition[]> {
    return getCollectionToolDefinitions(
      this.engine,
      this.context('owner', actor, randomUUID()),
    );
  }

  async visitorTools(): Promise<readonly ToolDefinition[]> {
    return getCollectionToolDefinitions(
      this.engine,
      this.context('visitor', { id: 'visitor' }, randomUUID()),
    );
  }

  async executeOwner(
    actor: CollectionActor,
    name: string,
    args: unknown,
    options: ExecuteOptions = {},
  ): Promise<ToolResult> {
    const requestId = options.requestId || randomUUID();
    const call: ToolCall = { name, arguments: args, toolVersion: '1', requestId };
    return executeCollectionTool(
      this.engine,
      this.context('owner', actor, requestId, options.exactIntent === true),
      call,
    );
  }

  async executeVisitor(
    actor: CollectionActor,
    name: string,
    args: unknown,
    requestId = randomUUID(),
  ): Promise<ToolResult> {
    const call: ToolCall = { name, arguments: args, toolVersion: '1', requestId };
    return executeCollectionTool(
      this.engine,
      this.context('visitor', actor, requestId),
      call,
    );
  }

  async readSnapshot(): Promise<YoubotCollectionService> {
    const state = await this.engine.repository.read((current) => structuredClone(current));
    return YoubotCollectionService.create({
      entityId: this.entityId,
      repository: createMemoryCollectionRepository(state),
    });
  }
}

let sharedService: Promise<YoubotCollectionService> | undefined;

export function getYoubotCollectionService(): Promise<YoubotCollectionService> {
  if (!sharedService) sharedService = YoubotCollectionService.create();
  return sharedService;
}

export function resetYoubotCollectionServiceForTests(): void {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('Collection service reset is only available in tests.');
  }
  sharedService = undefined;
}
