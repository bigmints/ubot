/**
 * Prompt Builder
 * Core logic for building prompts from templates with variable interpolation
 */

import type { LoggerInstance } from '../../logger/types.js';
import { createLogger } from '../../logger/index.js';
import type {
  PromptTemplate,
  PromptTemplateCreate,
  PromptTemplateUpdate,
  PromptBuildOptions,
  PromptBuildResult,
  PromptBuildError,
  PromptBuilderConfig,
  PromptTemplateFilter,
  PromptTemplateListResult,
  PromptVariable,
  PromptVariableValue,
  CompiledPrompt,
} from './types.js';

const DEFAULT_CONFIG: PromptBuilderConfig = {
  strictMode: false,
  validateVariables: true,
  cacheTemplates: true,
  maxTemplateSize: 100000,
  maxPromptSize: 500000,
};

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const NESTED_VARIABLE_PATTERN = /\{\{(\w+(?:\.\w+)*)\}\}/g;

function generateId(): string {
  return `pt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export class PromptBuilder {
  private templates: Map<string, PromptTemplate> = new Map();
  private slugIndex: Map<string, string> = new Map();
  private config: PromptBuilderConfig;
  private logger: LoggerInstance;

  constructor(config?: Partial<PromptBuilderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger({ level: 'info' });
  }

  /**
   * Create a new prompt template
   */
  createTemplate(input: PromptTemplateCreate): PromptTemplate {
    const now = new Date();
    const template: PromptTemplate = {
      id: generateId(),
      name: input.name,
      slug: input.slug,
      description: input.description,
      content: input.content,
      variables: this.normalizeVariables(input.variables || []),
      metadata: {
        createdAt: now,
        updatedAt: now,
        version: 1,
        tags: input.tags || [],
        author: input.author,
      },
    };

    this.validateTemplate(template);
    this.templates.set(template.id, template);
    this.slugIndex.set(template.slug, template.id);

    this.logger.info('Created prompt template', {
      templateId: template.id,
      slug: template.slug,
      variableCount: template.variables.length,
    });

    return template;
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get a template by slug
   */
  getTemplateBySlug(slug: string): PromptTemplate | undefined {
    const id = this.slugIndex.get(slug);
    return id ? this.templates.get(id) : undefined;
  }

  /**
   * Update an existing template
   */
  updateTemplate(id: string, updates: PromptTemplateUpdate): PromptTemplate | undefined {
    const existing = this.templates.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: PromptTemplate = {
      ...existing,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      content: updates.content ?? existing.content,
      variables: updates.variables ?? existing.variables,
      metadata: {
        ...existing.metadata,
        updatedAt: new Date(),
        version: existing.metadata.version + 1,
        tags: updates.tags ?? existing.metadata.tags,
      },
    };

    this.validateTemplate(updated);
    this.templates.set(id, updated);

    this.logger.info('Updated prompt template', {
      templateId: id,
      version: updated.metadata.version,
    });

    return updated;
  }

  /**
   * Delete a template
   */
  deleteTemplate(id: string): boolean {
    const template = this.templates.get(id);
    if (!template) {
      return false;
    }

    this.templates.delete(id);
    this.slugIndex.delete(template.slug);

    this.logger.info('Deleted prompt template', { templateId: id });
    return true;
  }

  /**
   * List templates with filtering and pagination
   */
  listTemplates(
    filter?: PromptTemplateFilter,
    page: number = 1,
    pageSize: number = 20
  ): PromptTemplateListResult {
    let filtered = Array.from(this.templates.values());

    if (filter) {
      if (filter.tags && filter.tags.length > 0) {
        filtered = filtered.filter((t) =>
          filter.tags!.some((tag) => t.metadata.tags.includes(tag))
        );
      }

      if (filter.author) {
        filtered = filtered.filter((t) => t.metadata.author === filter.author);
      }

      if (filter.search) {
        const search = filter.search.toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.name.toLowerCase().includes(search) ||
            t.slug.toLowerCase().includes(search) ||
            t.description?.toLowerCase().includes(search) ||
            t.content.toLowerCase().includes(search)
        );
      }

      if (filter.hasVariables !== undefined) {
        filtered = filtered.filter(
          (t) => (t.variables.length > 0) === filter.hasVariables
        );
      }

      if (filter.createdAfter) {
        filtered = filtered.filter((t) => t.metadata.createdAt >= filter.createdAfter!);
      }

      if (filter.createdBefore) {
        filtered = filtered.filter((t) => t.metadata.createdAt <= filter.createdBefore!);
      }
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const templates = filtered.slice(start, start + pageSize);

    return {
      templates,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Build a prompt from a template
   */
  build(options: PromptBuildOptions): PromptBuildResult {
    const errors: PromptBuildError[] = [];
    const warnings: string[] = [];
    const usedVariables: string[] = [];
    const missingVariables: string[] = [];

    let template: PromptTemplate | undefined;

    if (options.template) {
      template = options.template;
    } else if (options.templateId) {
      template = this.getTemplate(options.templateId);
      if (!template) {
        errors.push({
          code: 'TEMPLATE_NOT_FOUND',
          message: `Template with ID '${options.templateId}' not found`,
        });
      }
    } else if (options.templateSlug) {
      template = this.getTemplateBySlug(options.templateSlug);
      if (!template) {
        errors.push({
          code: 'TEMPLATE_NOT_FOUND',
          message: `Template with slug '${options.templateSlug}' not found`,
        });
      }
    } else {
      errors.push({
        code: 'NO_TEMPLATE',
        message: 'No template specified for building prompt',
      });
    }

    if (errors.length > 0) {
      return {
        success: false,
        prompt: '',
        template,
        errors,
        warnings,
        usedVariables,
        missingVariables,
      };
    }

    const shouldValidate = options.validate ?? this.config.validateVariables;
    const isStrict = options.strict ?? this.config.strictMode;

    // Validate variables if required
    if (shouldValidate && template) {
      const validation = this.validateVariables(template, options.variables);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      missingVariables.push(...validation.missing);
    }

    // Check for missing required variables in strict mode
    if (isStrict && missingVariables.length > 0) {
      errors.push({
        code: 'MISSING_REQUIRED_VARIABLES',
        message: `Missing required variables: ${missingVariables.join(', ')}`,
        details: { missingVariables },
      });
    }

    if (errors.length > 0) {
      return {
        success: false,
        prompt: '',
        template,
        errors,
        warnings,
        usedVariables,
        missingVariables,
      };
    }

    // Build the prompt
    let prompt = template!.content;
    const variableMap = options.variables;

    // Extract variables from template content
    const contentVariables = this.extractVariables(template!.content);

    for (const varName of contentVariables) {
      const value = this.getVariableValue(varName, variableMap, template!.variables);
      if (value !== undefined) {
        prompt = this.replaceVariable(prompt, varName, value);
        usedVariables.push(varName);
      } else if (!missingVariables.includes(varName)) {
        missingVariables.push(varName);
        if (isStrict) {
          errors.push({
            code: 'UNDEFINED_VARIABLE',
            message: `Variable '${varName}' is not defined`,
            variable: varName,
          });
        }
      }
    }

    // Check prompt size
    if (prompt.length > this.config.maxPromptSize) {
      warnings.push(
        `Prompt size (${prompt.length}) exceeds recommended maximum (${this.config.maxPromptSize})`
      );
    }

    return {
      success: errors.length === 0,
      prompt,
      template,
      errors,
      warnings,
      usedVariables,
      missingVariables,
    };
  }

  /**
   * Compile a prompt with metadata
   */
  compile(
    templateId: string,
    variables: Record<string, PromptVariableValue>
  ): CompiledPrompt | undefined {
    const template = this.getTemplate(templateId);
    if (!template) {
      return undefined;
    }

    const result = this.build({ template, variables, validate: true });
    if (!result.success) {
      return undefined;
    }

    return {
      content: result.prompt,
      template,
      variables,
      tokens: {
        estimated: this.estimateTokens(result.prompt),
        variables: this.estimateTokens(JSON.stringify(variables)),
      },
    };
  }

  /**
   * Extract variable names from template content
   */
  extractVariables(content: string): string[] {
    const variables = new Set<string>();
    let match: RegExpExecArray | null;

    VARIABLE_PATTERN.lastIndex = 0;
    while ((match = VARIABLE_PATTERN.exec(content)) !== null) {
      variables.add(match[1]);
    }

    NESTED_VARIABLE_PATTERN.lastIndex = 0;
    while ((match = NESTED_VARIABLE_PATTERN.exec(content)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * Estimate token count for a string
   */
  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Clear all templates
   */
  clearTemplates(): void {
    this.templates.clear();
    this.slugIndex.clear();
    this.logger.info('Cleared all prompt templates');
  }

  /**
   * Get builder statistics
   */
  getStats(): {
    templateCount: number;
    totalVariables: number;
    averageTemplateSize: number;
  } {
    const templates = Array.from(this.templates.values());
    const totalVariables = templates.reduce((sum, t) => sum + t.variables.length, 0);
    const totalSize = templates.reduce((sum, t) => sum + t.content.length, 0);

    return {
      templateCount: templates.length,
      totalVariables,
      averageTemplateSize: templates.length > 0 ? Math.round(totalSize / templates.length) : 0,
    };
  }

  private normalizeVariables(
    variables: Partial<PromptVariable>[]
  ): PromptVariable[] {
    return variables.map((v) => ({
      name: v.name || '',
      type: v.type || 'string',
      required: v.required ?? true,
      defaultValue: v.defaultValue,
      description: v.description,
      validation: v.validation,
    }));
  }

  private validateTemplate(template: PromptTemplate): void {
    if (!template.name || template.name.trim() === '') {
      throw new Error('Template name is required');
    }

    if (!template.slug || template.slug.trim() === '') {
      throw new Error('Template slug is required');
    }

    if (!template.content) {
      throw new Error('Template content is required');
    }

    if (template.content.length > this.config.maxTemplateSize) {
      throw new Error(
        `Template content exceeds maximum size of ${this.config.maxTemplateSize} characters`
      );
    }

    // Validate slug format
    const slugPattern = /^[a-z0-9-]+$/;
    if (!slugPattern.test(template.slug)) {
      throw new Error(
        'Template slug must contain only lowercase letters, numbers, and hyphens'
      );
    }

    // Check for duplicate slug
    const existingId = this.slugIndex.get(template.slug);
    if (existingId && existingId !== template.id) {
      throw new Error(`Template with slug '${template.slug}' already exists`);
    }
  }

  private validateVariables(
    template: PromptTemplate,
    values: Record<string, unknown>
  ): {
    errors: PromptBuildError[];
    warnings: string[];
    missing: string[];
  } {
    const errors: PromptBuildError[] = [];
    const warnings: string[] = [];
    const missing: string[] = [];

    for (const variable of template.variables) {
      const value = values[variable.name];

      if (value === undefined || value === null) {
        if (variable.required && variable.defaultValue === undefined) {
          missing.push(variable.name);
        }
        continue;
      }

      // Type validation
      const typeError = this.validateVariableType(variable, value);
      if (typeError) {
        errors.push({
          code: 'INVALID_VARIABLE_TYPE',
          message: typeError,
          variable: variable.name,
        });
      }

      // Custom validation
      if (variable.validation) {
        const customError = this.validateVariableCustom(variable, value);
        if (customError) {
          errors.push({
            code: 'VALIDATION_FAILED',
            message: customError,
            variable: variable.name,
          });
        }
      }
    }

    // Check for unused variables
    const templateVars = new Set(template.variables.map((v) => v.name));
    for (const key of Object.keys(values)) {
      if (!templateVars.has(key)) {
        warnings.push(`Variable '${key}' is defined but not used in template`);
      }
    }

    return { errors, warnings, missing };
  }

  private validateVariableType(
    variable: PromptVariable,
    value: unknown
  ): string | null {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (actualType !== variable.type) {
      // Allow number coercion for string type
      if (variable.type === 'string' && (actualType === 'number' || actualType === 'boolean')) {
        return null;
      }
      return `Variable '${variable.name}' expected type '${variable.type}' but got '${actualType}'`;
    }

    return null;
  }

  private validateVariableCustom(
    variable: PromptVariable,
    value: unknown
  ): string | null {
    const { validation } = variable;
    if (!validation) return null;

    if (typeof value === 'string') {
      if (validation.pattern) {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(value)) {
          return `Variable '${variable.name}' does not match pattern '${validation.pattern}'`;
        }
      }

      if (validation.min !== undefined && value.length < validation.min) {
        return `Variable '${variable.name}' must be at least ${validation.min} characters`;
      }

      if (validation.max !== undefined && value.length > validation.max) {
        return `Variable '${variable.name}' must be at most ${validation.max} characters`;
      }
    }

    if (typeof value === 'number') {
      if (validation.min !== undefined && value < validation.min) {
        return `Variable '${variable.name}' must be at least ${validation.min}`;
      }

      if (validation.max !== undefined && value > validation.max) {
        return `Variable '${variable.name}' must be at most ${validation.max}`;
      }
    }

    if (validation.enum && !validation.enum.includes(String(value))) {
      return `Variable '${variable.name}' must be one of: ${validation.enum.join(', ')}`;
    }

    return null;
  }

  private getVariableValue(
    name: string,
    values: Record<string, unknown>,
    definitions: PromptVariable[]
  ): unknown {
    if (values[name] !== undefined) {
      return values[name];
    }

    const definition = definitions.find((v) => v.name === name);
    if (definition?.defaultValue !== undefined) {
      return definition.defaultValue;
    }

    return undefined;
  }

  private replaceVariable(
    content: string,
    name: string,
    value: unknown
  ): string {
    const stringValue = this.stringifyValue(value);
    const pattern = new RegExp(`\\{\\{${name}\\}\\}`, 'g');
    return content.replace(pattern, stringValue);
  }

  private stringifyValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.stringifyValue(v)).join('\n');
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }
}

// Singleton instance
let defaultBuilder: PromptBuilder | undefined;

export function getPromptBuilder(config?: Partial<PromptBuilderConfig>): PromptBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new PromptBuilder(config);
  }
  return defaultBuilder;
}

export function createPromptBuilder(config?: Partial<PromptBuilderConfig>): PromptBuilder {
  return new PromptBuilder(config);
}