/**
 * Prompt Templates
 * Pre-built templates for common use cases
 */

import type { PromptTemplateCreate, PromptVariable } from './types.js';
import { getPromptBuilder } from './builder.js';

/**
 * System prompt templates
 */
export const SYSTEM_TEMPLATES: PromptTemplateCreate[] = [
  {
    name: 'Basic Chat',
    slug: 'basic-chat',
    description: 'A simple chat prompt with system and user messages',
    content: `You are a helpful AI assistant.

User: {{user_message}}

Please provide a helpful and accurate response.`,
    variables: [
      {
        name: 'user_message',
        type: 'string',
        required: true,
        description: 'The user message to respond to',
      },
    ],
    tags: ['chat', 'basic'],
  },
  {
    name: 'Code Review',
    slug: 'code-review',
    description: 'Review code for quality, bugs, and improvements',
    content: `You are an expert code reviewer. Analyze the following code and provide feedback on:

1. Code quality and readability
2. Potential bugs or issues
3. Performance considerations
4. Security concerns
5. Suggested improvements

Language: {{language}}
Code:
\`\`\`{{language}}
{{code}}
\`\`\`

Please provide a comprehensive review.`,
    variables: [
      {
        name: 'language',
        type: 'string',
        required: true,
        description: 'The programming language',
        defaultValue: 'javascript',
      },
      {
        name: 'code',
        type: 'string',
        required: true,
        description: 'The code to review',
      },
    ],
    tags: ['code', 'review', 'development'],
  },
  {
    name: 'Summarize Text',
    slug: 'summarize-text',
    description: 'Summarize text into key points',
    content: `Summarize the following text into {{format}}.

Text:
{{text}}

Provide a clear and concise summary.`,
    variables: [
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'The text to summarize',
      },
      {
        name: 'format',
        type: 'string',
        required: false,
        description: 'The output format',
        defaultValue: 'bullet points',
        validation: {
          enum: ['bullet points', 'paragraph', 'key takeaways'],
        },
      },
    ],
    tags: ['summarization', 'text'],
  },
  {
    name: 'Agent Task',
    slug: 'agent-task',
    description: 'Template for agent task execution',
    content: `You are {{agent_name}}, an AI agent with the following capabilities:
{{capabilities}}

Your current task is:
{{task}}

Context:
{{context}}

Available tools:
{{tools}}

Execute the task efficiently and report your progress.`,
    variables: [
      {
        name: 'agent_name',
        type: 'string',
        required: true,
        description: 'The name of the agent',
      },
      {
        name: 'capabilities',
        type: 'string',
        required: true,
        description: 'List of agent capabilities',
      },
      {
        name: 'task',
        type: 'string',
        required: true,
        description: 'The task to execute',
      },
      {
        name: 'context',
        type: 'string',
        required: false,
        description: 'Additional context for the task',
        defaultValue: 'No additional context provided.',
      },
      {
        name: 'tools',
        type: 'string',
        required: false,
        description: 'Available tools for the agent',
        defaultValue: 'No tools available.',
      },
    ],
    tags: ['agent', 'task', 'automation'],
  },
  {
    name: 'Data Extraction',
    slug: 'data-extraction',
    description: 'Extract structured data from unstructured text',
    content: `Extract the following information from the text below:

Fields to extract:
{{fields}}

Output format: {{output_format}}

Text:
{{text}}

Provide the extracted data in the specified format.`,
    variables: [
      {
        name: 'fields',
        type: 'string',
        required: true,
        description: 'List of fields to extract',
      },
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'The source text',
      },
      {
        name: 'output_format',
        type: 'string',
        required: false,
        description: 'The output format',
        defaultValue: 'JSON',
        validation: {
          enum: ['JSON', 'CSV', 'YAML'],
        },
      },
    ],
    tags: ['extraction', 'data', 'nlp'],
  },
  {
    name: 'Translation',
    slug: 'translation',
    description: 'Translate text between languages',
    content: `Translate the following text from {{source_language}} to {{target_language}}.

Text:
{{text}}

Provide an accurate and natural translation.`,
    variables: [
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'The text to translate',
      },
      {
        name: 'source_language',
        type: 'string',
        required: true,
        description: 'The source language',
        defaultValue: 'English',
      },
      {
        name: 'target_language',
        type: 'string',
        required: true,
        description: 'The target language',
      },
    ],
    tags: ['translation', 'language'],
  },
];

/**
 * Initialize system templates
 */
export function initializeSystemTemplates(): void {
  const builder = getPromptBuilder();

  for (const template of SYSTEM_TEMPLATES) {
    try {
      const existing = builder.getTemplateBySlug(template.slug);
      if (!existing) {
        builder.createTemplate(template);
      }
    } catch (error) {
      // Log but don't fail if template already exists
      console.warn(`Failed to create template '${template.slug}':`, error);
    }
  }
}

/**
 * Create a custom template
 */
export function createCustomTemplate(
  name: string,
  slug: string,
  content: string,
  variables?: Partial<PromptVariable>[],
  options?: {
    description?: string;
    tags?: string[];
    author?: string;
  }
): import('./types.js').PromptTemplate {
  const builder = getPromptBuilder();

  return builder.createTemplate({
    name,
    slug,
    content,
    variables,
    description: options?.description,
    tags: options?.tags,
    author: options?.author,
  });
}

/**
 * Quick build a prompt from a template slug
 */
export function quickBuild(
  slug: string,
  variables: Record<string, unknown>
): string {
  const builder = getPromptBuilder();
  const result = builder.build({ templateSlug: slug, variables });

  if (!result.success) {
    const errors = result.errors.map((e) => e.message).join('; ');
    throw new Error(`Failed to build prompt: ${errors}`);
  }

  return result.prompt;
}