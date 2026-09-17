/**
 * Prompt Builder Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder, createPromptBuilder, getPromptBuilder } from './builder.js';
import type { PromptTemplateCreate } from './types.js';

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = createPromptBuilder();
  });

  describe('createTemplate', () => {
    it('should create a template with required fields', () => {
      const input: PromptTemplateCreate = {
        name: 'Test Template',
        slug: 'test-template',
        content: 'Hello {{name}}!',
      };

      const template = builder.createTemplate(input);

      expect(template.id).toBeDefined();
      expect(template.name).toBe('Test Template');
      expect(template.slug).toBe('test-template');
      expect(template.content).toBe('Hello {{name}}!');
      expect(template.variables).toEqual([]);
      expect(template.metadata.version).toBe(1);
      expect(template.metadata.tags).toEqual([]);
    });

    it('should create a template with variables', () => {
      const input: PromptTemplateCreate = {
        name: 'Greeting',
        slug: 'greeting',
        content: 'Hello {{name}}, you are {{age}} years old.',
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false, defaultValue: 25 },
        ],
      };

      const template = builder.createTemplate(input);

      expect(template.variables).toHaveLength(2);
      expect(template.variables[0].name).toBe('name');
      expect(template.variables[0].required).toBe(true);
      expect(template.variables[1].defaultValue).toBe(25);
    });

    it('should throw on invalid slug format', () => {
      const input: PromptTemplateCreate = {
        name: 'Test',
        slug: 'Invalid Slug!',
        content: 'Test',
      };

      expect(() => builder.createTemplate(input)).toThrow('slug must contain only lowercase');
    });

    it('should throw on duplicate slug', () => {
      builder.createTemplate({
        name: 'First',
        slug: 'duplicate-slug',
        content: 'First',
      });

      expect(() =>
        builder.createTemplate({
          name: 'Second',
          slug: 'duplicate-slug',
          content: 'Second',
        })
      ).toThrow('already exists');
    });

    it('should throw on empty name', () => {
      const input: PromptTemplateCreate = {
        name: '',
        slug: 'test',
        content: 'Test',
      };

      expect(() => builder.createTemplate(input)).toThrow('name is required');
    });
  });

  describe('getTemplate', () => {
    it('should return template by id', () => {
      const created = builder.createTemplate({
        name: 'Test',
        slug: 'test',
        content: 'Content',
      });

      const found = builder.getTemplate(created.id);
      expect(found).toEqual(created);
    });

    it('should return undefined for non-existent id', () => {
      expect(builder.getTemplate('non-existent')).toBeUndefined();
    });
  });

  describe('getTemplateBySlug', () => {
    it('should return template by slug', () => {
      const created = builder.createTemplate({
        name: 'Test',
        slug: 'my-template',
        content: 'Content',
      });

      const found = builder.getTemplateBySlug('my-template');
      expect(found).toEqual(created);
    });

    it('should return undefined for non-existent slug', () => {
      expect(builder.getTemplateBySlug('non-existent')).toBeUndefined();
    });
  });

  describe('updateTemplate', () => {
    it('should update template fields', () => {
      const created = builder.createTemplate({
        name: 'Original',
        slug: 'update-test',
        content: 'Original content',
      });

      const updated = builder.updateTemplate(created.id, {
        name: 'Updated',
        content: 'Updated content',
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated');
      expect(updated!.content).toBe('Updated content');
      expect(updated!.metadata.version).toBe(2);
    });

    it('should return undefined for non-existent template', () => {
      expect(builder.updateTemplate('non-existent', { name: 'Test' })).toBeUndefined();
    });
  });

  describe('deleteTemplate', () => {
    it('should delete existing template', () => {
      const created = builder.createTemplate({
        name: 'To Delete',
        slug: 'delete-me',
        content: 'Content',
      });

      expect(builder.deleteTemplate(created.id)).toBe(true);
      expect(builder.getTemplate(created.id)).toBeUndefined();
      expect(builder.getTemplateBySlug('delete-me')).toBeUndefined();
    });

    it('should return false for non-existent template', () => {
      expect(builder.deleteTemplate('non-existent')).toBe(false);
    });
  });

  describe('listTemplates', () => {
    beforeEach(() => {
      builder.createTemplate({
        name: 'Template A',
        slug: 'template-a',
        content: 'A',
        tags: ['tag1', 'tag2'],
      });
      builder.createTemplate({
        name: 'Template B',
        slug: 'template-b',
        content: 'B',
        tags: ['tag2'],
      });
      builder.createTemplate({
        name: 'Template C',
        slug: 'template-c',
        content: 'C',
        tags: ['tag3'],
      });
    });

    it('should list all templates', () => {
      const result = builder.listTemplates();
      expect(result.templates).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should filter by tags', () => {
      const result = builder.listTemplates({ tags: ['tag2'] });
      expect(result.templates).toHaveLength(2);
    });

    it('should filter by search term', () => {
      const result = builder.listTemplates({ search: 'Template A' });
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].slug).toBe('template-a');
    });

    it('should paginate results', () => {
      const page1 = builder.listTemplates(undefined, 1, 2);
      const page2 = builder.listTemplates(undefined, 2, 2);

      expect(page1.templates).toHaveLength(2);
      expect(page1.page).toBe(1);
      expect(page2.templates).toHaveLength(1);
      expect(page2.page).toBe(2);
    });
  });

  describe('build', () => {
    it('should build prompt with variables', () => {
      const template = builder.createTemplate({
        name: 'Greeting',
        slug: 'greeting',
        content: 'Hello {{name}}, welcome to {{place}}!',
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'place', type: 'string', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: { name: 'Alice', place: 'Wonderland' },
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Hello Alice, welcome to Wonderland!');
      expect(result.usedVariables).toContain('name');
      expect(result.usedVariables).toContain('place');
    });

    it('should use default values for missing variables', () => {
      const template = builder.createTemplate({
        name: 'Default Test',
        slug: 'default-test',
        content: 'Hello {{name}}!',
        variables: [
          { name: 'name', type: 'string', required: false, defaultValue: 'Guest' },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Hello Guest!');
    });

    it('should report missing required variables', () => {
      const template = builder.createTemplate({
        name: 'Required Test',
        slug: 'required-test',
        content: 'Hello {{name}}!',
        variables: [
          { name: 'name', type: 'string', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: {},
        validate: true,
      });

      expect(result.missingVariables).toContain('name');
    });

    it('should fail in strict mode with missing variables', () => {
      const template = builder.createTemplate({
        name: 'Strict Test',
        slug: 'strict-test',
        content: 'Hello {{name}}!',
        variables: [
          { name: 'name', type: 'string', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: {},
        strict: true,
        validate: true,
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate variable types', () => {
      const template = builder.createTemplate({
        name: 'Type Test',
        slug: 'type-test',
        content: 'Age: {{age}}',
        variables: [
          { name: 'age', type: 'number', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: { age: 'not a number' },
        validate: true,
      });

      expect(result.success).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_VARIABLE_TYPE');
    });

    it('should validate with custom pattern', () => {
      const template = builder.createTemplate({
        name: 'Pattern Test',
        slug: 'pattern-test',
        content: 'Email: {{email}}',
        variables: [
          {
            name: 'email',
            type: 'string',
            required: true,
            validation: { pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$' },
          },
        ],
      });

      const validResult = builder.build({
        templateId: template.id,
        variables: { email: 'test@example.com' },
        validate: true,
      });

      expect(validResult.success).toBe(true);

      const invalidResult = builder.build({
        templateId: template.id,
        variables: { email: 'invalid-email' },
        validate: true,
      });

      expect(invalidResult.success).toBe(false);
      expect(invalidResult.errors[0].code).toBe('VALIDATION_FAILED');
    });

    it('should validate with enum values', () => {
      const template = builder.createTemplate({
        name: 'Enum Test',
        slug: 'enum-test',
        content: 'Format: {{format}}',
        variables: [
          {
            name: 'format',
            type: 'string',
            required: true,
            validation: { enum: ['json', 'xml', 'yaml'] },
          },
        ],
      });

      const validResult = builder.build({
        templateId: template.id,
        variables: { format: 'json' },
        validate: true,
      });

      expect(validResult.success).toBe(true);

      const invalidResult = builder.build({
        templateId: template.id,
        variables: { format: 'csv' },
        validate: true,
      });

      expect(invalidResult.success).toBe(false);
    });

    it('should warn about unused variables', () => {
      const template = builder.createTemplate({
        name: 'Unused Test',
        slug: 'unused-test',
        content: 'Hello {{name}}!',
        variables: [
          { name: 'name', type: 'string', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: { name: 'Alice', unused: 'value' },
        validate: true,
      });

      expect(result.warnings).toContain(
        "Variable 'unused' is defined but not used in template"
      );
    });

    it('should build from template slug', () => {
      builder.createTemplate({
        name: 'Slug Build Test',
        slug: 'slug-build-test',
        content: 'Test {{value}}',
      });

      const result = builder.build({
        templateSlug: 'slug-build-test',
        variables: { value: 'success' },
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Test success');
    });

    it('should build from template object directly', () => {
      const template = builder.createTemplate({
        name: 'Direct Build Test',
        slug: 'direct-build-test',
        content: 'Direct {{value}}',
      });

      const result = builder.build({
        template,
        variables: { value: 'access' },
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Direct access');
    });

    it('should handle array variables', () => {
      const template = builder.createTemplate({
        name: 'Array Test',
        slug: 'array-test',
        content: 'Items:\n{{items}}',
        variables: [
          { name: 'items', type: 'array', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: { items: ['one', 'two', 'three'] },
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Items:\none\ntwo\nthree');
    });

    it('should handle object variables', () => {
      const template = builder.createTemplate({
        name: 'Object Test',
        slug: 'object-test',
        content: 'Data: {{data}}',
        variables: [
          { name: 'data', type: 'object', required: true },
        ],
      });

      const result = builder.build({
        templateId: template.id,
        variables: { data: { key: 'value', nested: { prop: 123 } } },
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('"key": "value"');
    });
  });

  describe('compile', () => {
    it('should compile prompt with metadata', () => {
      const template = builder.createTemplate({
        name: 'Compile Test',
        slug: 'compile-test',
        content: 'Hello {{name}}!',
      });

      const compiled = builder.compile(template.id, { name: 'World' });

      expect(compiled).toBeDefined();
      expect(compiled!.content).toBe('Hello World!');
      expect(compiled!.template).toEqual(template);
      expect(compiled!.tokens.estimated).toBeGreaterThan(0);
    });

    it('should return undefined for non-existent template', () => {
      expect(builder.compile('non-existent', {})).toBeUndefined();
    });
  });

  describe('extractVariables', () => {
    it('should extract all variable names', () => {
      const content = 'Hello {{name}}, you are {{age}} years old from {{city}}';
      const variables = builder.extractVariables(content);

      expect(variables).toEqual(expect.arrayContaining(['name', 'age', 'city']));
    });

    it('should return unique variables', () => {
      const content = '{{name}} and {{name}} and {{name}}';
      const variables = builder.extractVariables(content);

      expect(variables).toEqual(['name']);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens based on character count', () => {
      const text = 'This is a test string with multiple words';
      const tokens = builder.estimateTokens(text);

      expect(tokens).toBe(Math.ceil(text.length / 4));
    });
  });

  describe('getStats', () => {
    it('should return builder statistics', () => {
      builder.createTemplate({
        name: 'Stat Test 1',
        slug: 'stat-test-1',
        content: 'Short',
        variables: [{ name: 'v1', type: 'string', required: true }],
      });
      builder.createTemplate({
        name: 'Stat Test 2',
        slug: 'stat-test-2',
        content: 'A bit longer content',
        variables: [
          { name: 'v1', type: 'string', required: true },
          { name: 'v2', type: 'number', required: false },
        ],
      });

      const stats = builder.getStats();

      expect(stats.templateCount).toBe(2);
      expect(stats.totalVariables).toBe(3);
      expect(stats.averageTemplateSize).toBeGreaterThan(0);
    });
  });

  describe('clearTemplates', () => {
    it('should remove all templates', () => {
      builder.createTemplate({
        name: 'To Clear',
        slug: 'to-clear',
        content: 'Content',
      });

      builder.clearTemplates();

      expect(builder.getAllTemplates()).toHaveLength(0);
    });
  });
});

describe('getPromptBuilder', () => {
  it('should return a singleton instance', () => {
    const instance1 = getPromptBuilder();
    const instance2 = getPromptBuilder();

    expect(instance1).toBe(instance2);
  });
});