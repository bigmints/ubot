import { describe, expect, it, vi } from 'vitest';
import { requestStructuredCompletion } from './structured-generation.js';

const spec = {
  name: 'submit_collection_proposal',
  description: 'Submit one collection proposal.',
  parameters: {
    type: 'object',
    properties: {
      operations: { type: 'array' },
      unresolvedIssues: { type: 'array', items: { type: 'string' } },
    },
    required: ['operations', 'unresolvedIssues'],
    additionalProperties: false,
  },
};

describe('structured generation transport', () => {
  it('forces one non-executing function and returns its structured arguments', async () => {
    const create = vi.fn(async () => ({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: {
              name: spec.name,
              arguments: '{"operations":[],"unresolvedIssues":[]}',
            },
          }],
        },
      }],
    }));

    const result = await requestStructuredCompletion(
      { chat: { completions: { create } } } as never,
      'test-model',
      'system',
      'user',
      spec,
      { temperature: 0, maxTokens: 100 },
    );

    expect(result).toEqual({
      content: '{"operations":[],"unresolvedIssues":[]}',
      transport: 'tool',
      finishReason: 'tool_calls',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      tools: [expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: spec.name, parameters: spec.parameters }),
      })],
      tool_choice: { type: 'function', function: { name: spec.name } },
    }));
  });

  it('returns plain text for local validation when a compatible provider ignores tool choice', async () => {
    const create = vi.fn(async () => ({
      choices: [{
        finish_reason: 'stop',
        message: { content: 'not valid json', tool_calls: [] },
      }],
    }));

    await expect(requestStructuredCompletion(
      { chat: { completions: { create } } } as never,
      'test-model',
      'system',
      'user',
      spec,
      {},
    )).resolves.toEqual({
      content: 'not valid json',
      transport: 'text',
      finishReason: 'stop',
    });
  });
});
