import { randomUUID } from 'node:crypto';
import {
  COLLECTION_TOOL_DEFINITIONS,
  type JsonSchema,
  type ToolDefinition as EngineToolDefinition,
} from '@youbot/collection-engine';
import type { ToolDefinition } from '../../engine/types.js';
import type { ToolExecutionContext, ToolModule } from '../../tools/types.js';
import {
  channelActor,
  getYoubotCollectionService,
} from '../../concierge/collections/service.js';
import { answerCollectionFromPlan, CollectionAnswerError } from '../../concierge/collections/answer-service.js';

type ParameterSchema = JsonSchema & {
  type?: string;
  description?: string;
  items?: unknown;
  properties?: unknown;
  enum?: unknown[];
};

function parameterType(schema: ParameterSchema): ToolDefinition['parameters'][number]['type'] {
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') return 'array';
  if (schema.type === 'object') return 'object';
  return 'string';
}

export function toYoubotToolDefinition(definition: EngineToolDefinition): ToolDefinition {
  const schema = definition.inputSchema as {
    properties?: Record<string, ParameterSchema>;
    required?: string[];
  };
  const required = new Set(schema.required || []);
  return {
    name: definition.name,
    description: definition.description,
    parameters: Object.entries(schema.properties || {}).map(([name, property]) => ({
      name,
      type: parameterType(property),
      description: property.description
        || (property.enum ? `Allowed values: ${property.enum.join(', ')}.` : `${name} for this collection operation.`),
      required: required.has(name),
      ...(property.items ? { items: property.items } : {}),
      ...(property.properties ? { properties: property.properties } : {}),
    })),
  };
}

const effectTools = new Set([
  'collections_change_apply',
  'collections_publish',
  'collections_unpublish',
  'collections_archive',
  'collections_undo',
]);
const engineDefinitions = COLLECTION_TOOL_DEFINITIONS
  .filter((definition) => !effectTools.has(definition.name));

const collectionAnswerDefinition: ToolDefinition = {
  name: 'collections_answer',
  description: 'Required for visitor-facing answers from a collection. Submit a read-only JSON search plan; the host returns the final grounded text from current published fields. Use this instead of writing collection facts yourself.',
  parameters: [
    { name: 'collectionId', type: 'string', description: 'Published collection ID returned by collections_list.', required: true },
    { name: 'planJson', type: 'string', description: 'JSON object with optional text, filters and sort plus pageSize. Use public field IDs only. Filters use fieldId, operator and value; sort uses fieldId and direction.', required: true },
    { name: 'usedFieldIdsJson', type: 'string', description: 'JSON array of public field IDs needed for the answer. Use [] to let the host include all matching public facts.', required: false },
  ],
};

const collectionsModule: ToolModule = {
  name: 'collections',
  tools: [...engineDefinitions.map(toYoubotToolDefinition), collectionAnswerDefinition],
  register(registry) {
    for (const definition of engineDefinitions) {
      registry.register(definition.name, async (
        args,
        execution?: ToolExecutionContext,
      ) => {
        const service = await getYoubotCollectionService();
        const isOwner = execution?.isOwner === true;
        const runtimeActor = isOwner
          ? channelActor('owner', execution?.sessionId, execution?.source)
          : channelActor('visitor', execution?.sessionId, execution?.source);
        const result = isOwner
          ? await service.executeOwner(runtimeActor, definition.name, args, { requestId: randomUUID() })
          : await service.executeVisitor(runtimeActor, definition.name, args, randomUUID());
        if (!result.ok) {
          return {
            toolName: definition.name,
            success: false,
            error: `${result.error.code}: ${result.error.message}`,
            duration: 0,
          };
        }
        return {
          toolName: definition.name,
          success: true,
          result: JSON.stringify(result),
          duration: 0,
        };
      });
    }
    registry.register('collections_answer', async (args, execution) => {
      try {
        const collectionId = typeof args.collectionId === 'string' ? args.collectionId.trim() : '';
        const question = typeof execution?.userMessage === 'string' ? execution.userMessage.trim() : '';
        const planJson = typeof args.planJson === 'string' ? args.planJson : '';
        const usedFieldIdsJson = typeof args.usedFieldIdsJson === 'string' ? args.usedFieldIdsJson : '[]';
        if (!collectionId || !question || question.length > 1_000 || !planJson || planJson.length > 20_000 || usedFieldIdsJson.length > 10_000) {
          throw new Error('INVALID_ARGUMENT: A collection ID, trusted visitor message and bounded JSON plan are required.');
        }
        const plan = JSON.parse(planJson) as unknown;
        const usedFieldIds = JSON.parse(usedFieldIdsJson) as unknown;
        const service = await getYoubotCollectionService();
        const actor = channelActor('visitor', execution?.sessionId, execution?.source);
        const answer = await answerCollectionFromPlan({ service, actor, collectionId, question, plan, usedFieldIds });
        return {
          toolName: 'collections_answer',
          success: true,
          result: JSON.stringify(answer),
          duration: 0,
        };
      } catch (error) {
        return {
          toolName: 'collections_answer',
          success: false,
          error: error instanceof CollectionAnswerError
            ? `${error.code}: ${error.message}`
            : error instanceof Error ? error.message : 'ANSWER_UNAVAILABLE: The collection answer could not be prepared.',
          duration: 0,
        };
      }
    });
  },
};

export const toolModules: ToolModule[] = [collectionsModule];
export default collectionsModule;
