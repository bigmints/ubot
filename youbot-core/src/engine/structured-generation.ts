import type OpenAI from 'openai';

export type StructuredOutputSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type StructuredGenerationResult = {
  content: string;
  transport: 'tool' | 'text';
  finishReason: 'tool_calls' | 'length' | 'stop' | 'unknown';
};

function finishReason(value: unknown): StructuredGenerationResult['finishReason'] {
  return value === 'tool_calls' || value === 'length' || value === 'stop'
    ? value
    : 'unknown';
}

/**
 * Ask an OpenAI-compatible provider for one schema-only function call.
 * Some compatible providers ignore tool_choice and return JSON text instead;
 * callers deliberately receive that text and apply the same local validator.
 */
export async function requestStructuredCompletion(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  spec: StructuredOutputSpec,
  options: { temperature?: number; maxTokens?: number },
): Promise<StructuredGenerationResult> {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage || ' ' },
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    tools: [{
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
      },
    }],
    tool_choice: { type: 'function', function: { name: spec.name } },
  });
  const choice = completion.choices[0];
  const message = choice?.message;
  const call = message?.tool_calls?.find((candidate) => (
    candidate.type === 'function' && candidate.function.name === spec.name
  ));
  if (call?.type === 'function') {
    return {
      content: call.function.arguments || '',
      transport: 'tool',
      finishReason: finishReason(choice?.finish_reason),
    };
  }
  return {
    content: typeof message?.content === 'string' ? message.content : '',
    transport: 'text',
    finishReason: finishReason(choice?.finish_reason),
  };
}
