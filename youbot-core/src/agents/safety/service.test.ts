import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SafetyService, createSafetyService, resetSafetyService } from './service.js';
import type { SafetyRuleCreate } from './types.js';

describe('SafetyService', () => {
  let service: SafetyService;

  beforeEach(() => {
    resetSafetyService();
    service = createSafetyService({ enabled: true });
  });

  afterEach(() => {
    resetSafetyService();
  });

  describe('addRule', () => {
    it('should add a new safety rule', () => {
      const ruleData: SafetyRuleCreate = {
        name: 'Test Rule',
        description: 'A test rule',
        category: 'spam',
        level: 'medium',
        action: 'warn'
      };

      const rule = service.addRule(ruleData);

      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('Test Rule');
      expect(rule.category).toBe('spam');
      expect(rule.enabled).toBe(true);
    });

    it('should throw error for invalid rule name', () => {
      const ruleData: SafetyRuleCreate = {
        name: '',
        description: 'Invalid rule',
        category: 'spam',
        level: 'medium',
        action: 'warn'
      };

      expect(() => service.addRule(ruleData)).toThrow('Rule name is required');
    });

    it('should throw error for invalid pattern', () => {
      const ruleData: SafetyRuleCreate = {
        name: 'Bad Pattern',
        description: 'Invalid pattern',
        category: 'spam',
        level: 'medium',
        action: 'warn',
        pattern: '[invalid('
      };

      expect(() => service.addRule(ruleData)).toThrow('Invalid regex pattern');
    });
  });

  describe('updateRule', () => {
    it('should update an existing rule', () => {
      const rule = service.addRule({
        name: 'Original Name',
        description: 'Original description',
        category: 'spam',
        level: 'low',
        action: 'warn'
      });

      const updated = service.updateRule(rule.id, {
        name: 'Updated Name',
        level: 'high'
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.level).toBe('high');
      expect(updated?.description).toBe('Original description');
    });

    it('should return null for non-existent rule', () => {
      const result = service.updateRule('non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('removeRule', () => {
    it('should remove an existing rule', () => {
      const rule = service.addRule({
        name: 'To Remove',
        description: 'Will be removed',
        category: 'spam',
        level: 'low',
        action: 'warn'
      });

      const result = service.removeRule(rule.id);
      expect(result).toBe(true);
      expect(service.getRule(rule.id)).toBeNull();
    });

    it('should return false for non-existent rule', () => {
      const result = service.removeRule('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('listRules', () => {
    it('should list all rules with pagination', () => {
      service.addRule({
        name: 'Rule 1',
        description: 'First rule',
        category: 'spam',
        level: 'low',
        action: 'warn'
      });
      service.addRule({
        name: 'Rule 2',
        description: 'Second rule',
        category: 'harmful_content',
        level: 'high',
        action: 'block'
      });

      const result = service.listRules();

      expect(result.rules.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });

    it('should filter rules by category', () => {
      service.addRule({
        name: 'Spam Rule',
        description: 'Spam detection',
        category: 'spam',
        level: 'low',
        action: 'warn'
      });

      const result = service.listRules({ categories: ['spam'] });

      expect(result.rules.every(r => r.category === 'spam')).toBe(true);
    });
  });

  describe('checkContent', () => {
    it('should return safe for clean content', () => {
      const result = service.checkContent('This is a normal message.');
      
      expect(result.safe).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect pattern violations', () => {
      service.addRule({
        name: 'Test Pattern',
        description: 'Detect test pattern',
        category: 'spam',
        level: 'medium',
        action: 'warn',
        pattern: '\\bTEST123\\b'
      });

      const result = service.checkContent('This contains TEST123 pattern.');

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].matchedContent).toBe('TEST123');
    });

    it('should detect keyword violations', () => {
      service.addRule({
        name: 'Bad Words',
        description: 'Detect bad words',
        category: 'inappropriate_language',
        level: 'high',
        action: 'block',
        keywords: ['badword1', 'badword2']
      });

      const result = service.checkContent('This has badword1 in it.');

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.safe).toBe(false);
    });

    it('should sanitize content when requested', () => {
      service.addRule({
        name: 'Email Sanitizer',
        description: 'Sanitize emails',
        category: 'personal_information',
        level: 'medium',
        action: 'sanitize',
        pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b'
      });

      const result = service.checkContent('Contact me at test@example.com', { sanitize: true });

      expect(result.sanitizedContent).toBeDefined();
      expect(result.sanitizedContent).toContain('[REDACTED]');
    });

    it('should respect disabled rules', () => {
      service.addRule({
        name: 'Disabled Rule',
        description: 'This rule is disabled',
        category: 'spam',
        level: 'high',
        action: 'block',
        pattern: 'DISABLED_PATTERN',
        enabled: false
      });

      const result = service.checkContent('This has DISABLED_PATTERN');

      expect(result.violations.filter(v => v.ruleName === 'Disabled Rule')).toHaveLength(0);
    });

    it('should calculate correct safety score', () => {
      service.addRule({
        name: 'High Risk',
        description: 'High risk rule',
        category: 'harmful_content',
        level: 'critical',
        action: 'block',
        pattern: 'DANGEROUS'
      });

      const result = service.checkContent('This is DANGEROUS content');

      expect(result.score).toBeLessThan(1.0);
      expect(result.safe).toBe(false);
    });
  });

  describe('isSafe', () => {
    it('should return true for safe content', () => {
      expect(service.isSafe('Hello world')).toBe(true);
    });

    it('should return false for unsafe content', () => {
      service.addRule({
        name: 'Block Rule',
        description: 'Block specific content',
        category: 'spam',
        level: 'critical',
        action: 'block',
        pattern: 'BLOCKED'
      });

      expect(service.isSafe('This is BLOCKED')).toBe(false);
    });
  });

  describe('getScore', () => {
    it('should return 1.0 for clean content', () => {
      expect(service.getScore('Clean content')).toBe(1.0);
    });

    it('should return lower score for content with violations', () => {
      service.addRule({
        name: 'Score Test',
        description: 'Test scoring',
        category: 'spam',
        level: 'high',
        action: 'warn',
        pattern: 'VIOLATION'
      });

      const score = service.getScore('This has a VIOLATION');
      expect(score).toBeLessThan(1.0);
    });
  });

  describe('sanitize', () => {
    it('should return original content if no sanitization needed', () => {
      const content = 'Clean content';
      expect(service.sanitize(content)).toBe(content);
    });

    it('should sanitize matched content', () => {
      service.addRule({
        name: 'Sanitize Test',
        description: 'Test sanitization',
        category: 'personal_information',
        level: 'medium',
        action: 'sanitize',
        pattern: 'SECRET'
      });

      const result = service.sanitize('This is SECRET information');
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      service.addRule({
        name: 'Stats Test',
        description: 'Test stats',
        category: 'spam',
        level: 'medium',
        action: 'warn',
        pattern: 'TESTSTATS'
      });

      service.checkContent('This is TESTSTATS content');
      service.checkContent('Clean content');

      const stats = service.getStats();

      expect(stats.totalChecks).toBe(2);
      expect(stats.warnedCount).toBe(1);
    });
  });

  describe('enable/disable', () => {
    it('should disable safety checks', () => {
      service.addRule({
        name: 'Block All',
        description: 'Block everything',
        category: 'spam',
        level: 'critical',
        action: 'block',
        pattern: '.*'
      });

      service.disable();
      
      const result = service.checkContent('Any content');
      expect(result.safe).toBe(true);
      expect(service.isEnabled()).toBe(false);
    });

    it('should re-enable safety checks', () => {
      service.disable();
      service.enable();

      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('import/export', () => {
    it('should export and import rules', () => {
      service.addRule({
        name: 'Export Test',
        description: 'Test export',
        category: 'spam',
        level: 'low',
        action: 'warn'
      });

      const exported = service.exportRules();
      
      const newService = createSafetyService();
      newService.importRules(exported);

      const imported = newService.getRule(exported[exported.length - 1].id);
      expect(imported?.name).toBe('Export Test');
    });
  });

  describe('event listeners', () => {
    it('should emit events on violations', () => {
      const events: Array<{ type: string; data: unknown }> = [];
      
      service.addEventListener((event) => {
        events.push(event);
      });

      service.addRule({
        name: 'Event Test',
        description: 'Test events',
        category: 'spam',
        level: 'high',
        action: 'block',
        pattern: 'TRIGGER'
      });

      service.checkContent('This TRIGGER an event');

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('violation');
    });
  });
});