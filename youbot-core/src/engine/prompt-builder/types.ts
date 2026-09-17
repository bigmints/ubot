/**
 * Prompt Builder Types
 * Types for building and managing LLM prompts with templates and variables
 */

export type VariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface PromptVariable {
  name: string;
  type: VariableType;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    enum?: string[];
  };
}

export interface PromptTemplate {
  id: string;
  name: string;
  slug: string;
  description?: string;
  content: string;
  variables: PromptVariable[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    version: number;
    tags: string[];
    author?: string;
  };
}

export interface PromptTemplateCreate {
  name: string;
  slug: string;
  description?: string;
  content: string;
  variables?: Partial<PromptVariable>[];
  tags?: string[];
  author?: string;
}

export interface PromptTemplateUpdate {
  name?: string;
  description?: string;
  content?: string;
  variables?: PromptVariable[];
  tags?: string[];
}

export interface PromptBuildOptions {
  templateId?: string;
  templateSlug?: string;
  template?: PromptTemplate;
  variables: Record<string, unknown>;
  validate?: boolean;
  strict?: boolean;
}

export interface PromptBuildResult {
  success: boolean;
  prompt: string;
  template?: PromptTemplate;
  errors: PromptBuildError[];
  warnings: string[];
  usedVariables: string[];
  missingVariables: string[];
}

export interface PromptBuildError {
  code: string;
  message: string;
  variable?: string;
  details?: Record<string, unknown>;
}

export interface PromptBuilderConfig {
  strictMode: boolean;
  validateVariables: boolean;
  cacheTemplates: boolean;
  maxTemplateSize: number;
  maxPromptSize: number;
}

export interface PromptTemplateFilter {
  tags?: string[];
  author?: string;
  search?: string;
  hasVariables?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface PromptTemplateListResult {
  templates: PromptTemplate[];
  total: number;
  page: number;
  pageSize: number;
}

export type PromptVariableValue = string | number | boolean | unknown[] | Record<string, unknown>;

export interface CompiledPrompt {
  content: string;
  template: PromptTemplate;
  variables: Record<string, PromptVariableValue>;
  tokens: {
    estimated: number;
    variables: number;
  };
}