import { describe, it, expect } from 'vitest';
import {
  generateSafetyId,
  getLevelPriority,
  getActionPriority,
  compareLevels,
  meetsMinLevel,
  getHighestAction,
  escapeRegex,
  patternToRegex,
  matchesPattern,
  findMatches,
  containsKeywords,
  sanitizeContent,
  calculateSafetyScore,
  filterRules,
  sortRulesByPriority,
  paginateRules,
  createDefaultStats,
  updateStatsWithResult,
  validateRuleName,
  validatePattern,
  extractContext
} from './utils.js';
import type { SafetyRule, SafetyViolation, SafetyCheckResult } from './types.js';

describe('Safety Utils', () => {
  describe('generateSafetyId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateSafetyId();
      const id2 = generateSafetyId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^safety_\d+_[a-z0-9]+$/);
    });
  });

  describe('getLevelPriority', () => {
    it('should return correct priorities for each level', () => {
      expect(getLevelPriority('low')).toBe(1);
      expect(getLevelPriority('medium')).toBe(2);
      expect(getLevelPriority('high')).toBe(3);
      expect(getLevelPriority('critical')).toBe(4);
    });
  });

  describe('getActionPriority', () => {
    it('should return correct priorities for each action', () => {
      expect(getActionPriority('allow')).toBe(0);
      expect(getActionPriority('warn')).toBe(1);
      expect(getActionPriority('sanitize')).toBe(2);
      expect(getActionPriority('review')).toBe(3);
      expect(getActionPriority('block')).toBe(4);
      expect(getActionPriority('escalate')).toBe(5);
    });
  });

  describe('compareLevels', () => {
    it('should compare levels correctly', () => {
      expect(compareLevels('low', 'high')).toBeLessThan(0);
      expect(compareLevels('critical', 'medium')).toBeGreaterThan(0);
      expect(compareLevels('medium', 'medium')).toBe(0);
    });
  });

  describe('meetsMinLevel', () => {
    it('should check if level meets minimum', () => {
      expect(meetsMinLevel('high', 'medium')).toBe(true);
      expect(meetsMinLevel('low', 'high')).toBe(false);
      expect(meetsMinLevel('critical', 'critical')).toBe(true);
    });
  });

  describe('getHighestAction', () => {
    it('should return highest priority action', () => {
      expect(getHighestAction(['allow', 'warn', 'block'])).toBe('block');
      expect(getHighestAction(['warn', 'sanitize'])).toBe('sanitize');
      expect(getHighestAction(['allow'])).toBe('allow');
    });

    it('should return allow for empty array', () => {
      expect(getHighestAction([])).toBe('allow');
    });
  });

  describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
      expect(escapeRegex('test.*+?^${}()|[]\\')).toBe('test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });
  });

  describe('patternToRegex', () => {
    it('should convert string to regex', () => {
      const regex = patternToRegex('test');
      expect(regex.test('this is a test')).toBe(true);
    });

    it('should use provided flags', () => {
      const regex = patternToRegex('test', 'i');
      expect(regex.test('TEST')).toBe(true);
    });
  });

  describe('matchesPattern', () => {
    it('should match string pattern', () => {
      expect(matchesPattern('hello world', 'world')).toBe(true);
      expect(matchesPattern('hello world', 'foo')).toBe(false);
    });

    it('should match regex pattern', () => {
      expect(matchesPattern('hello world', /world/)).toBe(true);
      expect(matchesPattern('hello world', /^hello/)).toBe(true);
    });

    it('should return false for invalid pattern', () => {
      expect(matchesPattern('test', '[invalid')).toBe(false);
    });
  });

  describe('findMatches', () => {
    it('should find all matches', () => {
      const matches = findMatches('test1 test2 test3', /test\d/g);
      
      expect(matches).toHaveLength(3);
      expect(matches[0].match).toBe('test1');
      expect(matches[1].match).toBe('test2');
      expect(matches[2].match).toBe('test3');
    });

    it('should return empty array for no matches', () => {
      const matches = findMatches('hello world', /\d+/);
      expect(matches).toHaveLength(0);
    });
  });

  describe('containsKeywords', () => {
    it('should find keywords in content', () => {
      const matches = containsKeywords('hello world test', ['world', 'foo']);
      
      expect(matches).toHaveLength(1);
      expect(matches[0].keyword).toBe('world');
    });

    it('should be case insensitive', () => {
      const matches = containsKeywords('HELLO WORLD', ['world']);
      
      expect(matches).toHaveLength(1);
    });

    it('should find multiple occurrences', () => {
      const matches = containsKeywords('test test test', ['test']);
      
      expect(matches).toHaveLength(3);
    });
  });

  describe('sanitizeContent', () => {
    it('should replace matched content', () => {
      const content = 'hello SECRET world';
      const result = sanitizeContent(content, [{ start: 6, end: 12 }]);
      
      expect(result).toBe('hello [REDACTED] world');
    });

    it('should handle multiple matches', () => {
      const content = 'secret1 and secret2';
      const result = sanitizeContent(content, [
        { start: 0, end: 7 },
        { start: 12, end: 19 }
      ]);
      
      expect(result).toBe('[REDACTED] and [REDACTED]');
    });

    it('should return original content if no matches', () => {
      const content = 'hello world';
      const result = sanitizeContent(content, []);
      
      expect(result).toBe(content);
    });
  });

  describe('calculateSafetyScore', () => {
    it('should return 1.0 for no violations', () => {
      expect(calculateSafetyScore([])).toBe(1.0);
    });

    it('should reduce score for violations', () => {
      const violations: SafetyViolation[] = [
        {
          id: '1',
          ruleId: 'r1',
          ruleName: 'Test',
          category: 'spam',
          level: 'medium',
          action: 'warn',
          matchedContent: 'test',
          confidence: 0.9,
          timestamp: new Date()
        }
      ];
      
      const score = calculateSafetyScore(violations);
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThan(0);
    });

    it('should penalize critical violations more', () => {
      const lowViolation: SafetyViolation[] = [{
        id: '1',
        ruleId: 'r1',
        ruleName: 'Test',
        category: 'spam',
        level: 'low',
        action: 'warn',
        matchedContent: 'test',
        confidence: 1.0,
        timestamp: new Date()
      }];
      
      const criticalViolation: SafetyViolation[] = [{
        id: '1',
        ruleId: 'r1',
        ruleName: 'Test',
        category: 'spam',
        level: 'critical',
        action: 'block',
        matchedContent: 'test',
        confidence: 1.0,
        timestamp: new Date()
      }];
      
      expect(calculateSafetyScore(criticalViolation)).toBeLessThan(calculateSafetyScore(lowViolation));
    });
  });

  describe('filterRules', () => {
    const rules: SafetyRule[] = [
      {
        id: '1',
        name: 'Rule 1',
        description: 'Test',
        category: 'spam',
        level: 'low',
        action: 'warn',
        enabled: true,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '2',
        name: 'Rule 2',
        description: 'Test',
        category: 'harmful_content',
        level: 'critical',
        action: 'block',
        enabled: false,
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    it('should filter by category', () => {
      const filtered = filterRules(rules, { categories: ['spam'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('should filter by enabled status', () => {
      const filtered = filterRules(rules, { enabled: true });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('should filter by search term', () => {
      const filtered = filterRules(rules, { search: 'Rule 2' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('2');
    });
  });

  describe('sortRulesByPriority', () => {
    it('should sort by priority descending', () => {
      const rules: SafetyRule[] = [
        { id: '1', name: 'Low', description: '', category: 'spam', level: 'low', action: 'warn', enabled: true, priority: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', name: 'High', description: '', category: 'spam', level: 'low', action: 'warn', enabled: true, priority: 10, createdAt: new Date(), updatedAt: new Date() }
      ];
      
      const sorted = sortRulesByPriority(rules);
      expect(sorted[0].priority).toBe(10);
      expect(sorted[1].priority).toBe(1);
    });
  });

  describe('paginateRules', () => {
    const rules: SafetyRule[] = Array.from({ length: 25 }, (_, i) => ({
      id: `${i + 1}`,
      name: `Rule ${i + 1}`,
      description: '',
      category: 'spam' as const,
      level: 'low' as const,
      action: 'warn' as const,
      enabled: true,
      priority: i,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    it('should return first page', () => {
      const result = paginateRules(rules, 1, 10);
      expect(result.rules).toHaveLength(10);
      expect(result.page).toBe(1);
      expect(result.total).toBe(25);
    });

    it('should return last page with remaining items', () => {
      const result = paginateRules(rules, 3, 10);
      expect(result.rules).toHaveLength(5);
    });
  });

  describe('createDefaultStats', () => {
    it('should create default stats object', () => {
      const stats = createDefaultStats();
      
      expect(stats.totalChecks).toBe(0);
      expect(stats.blockedCount).toBe(0);
      expect(stats.averageScore).toBe(1.0);
    });
  });

  describe('updateStatsWithResult', () => {
    it('should update stats with check result', () => {
      const stats = createDefaultStats();
      const result: SafetyCheckResult = {
        safe: false,
        score: 0.5,
        violations: [{
          id: '1',
          ruleId: 'r1',
          ruleName: 'Test',
          category: 'spam',
          level: 'medium',
          action: 'warn',
          matchedContent: 'test',
          confidence: 0.9,
          timestamp: new Date()
        }],
        actions: ['warn'],
        warnings: [],
        metadata: {
          checkedAt: new Date(),
          checkDuration: 10,
          rulesApplied: 1,
          contentLength: 100
        }
      };
      
      const updated = updateStatsWithResult(stats, result);
      
      expect(updated.totalChecks).toBe(1);
      expect(updated.warnedCount).toBe(1);
      expect(updated.averageScore).toBe(0.5);
    });
  });

  describe('validateRuleName', () => {
    it('should validate correct names', () => {
      expect(validateRuleName('Valid Name').valid).toBe(true);
      expect(validateRuleName('valid_name-123').valid).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateRuleName('').valid).toBe(false);
      expect(validateRuleName('   ').valid).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(validateRuleName('Invalid@Name').valid).toBe(false);
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(101);
      expect(validateRuleName(longName).valid).toBe(false);
    });
  });

  describe('validatePattern', () => {
    it('should validate correct patterns', () => {
      expect(validatePattern('\\d+').valid).toBe(true);
      expect(validatePattern('[a-z]+').valid).toBe(true);
    });

    it('should reject invalid patterns', () => {
      expect(validatePattern('[invalid').valid).toBe(false);
      expect(validatePattern('*invalid').valid).toBe(false);
    });
  });

  describe('extractContext', () => {
    it('should extract context around match', () => {
      const content = 'This is a long string with a MATCH in the middle of it';
      const context = extractContext(content, 27, 32);
      
      expect(context).toContain('MATCH');
      expect(context.length).toBeLessThanOrEqual(content.length);
    });

    it('should add ellipsis for truncated content', () => {
      const content = 'This is a long string with a MATCH in the middle of it';
      const context = extractContext(content, 27, 32, 5);
      
      expect(context).toContain('...');
    });

    it('should handle match at start', () => {
      const content = 'MATCH at the start';
      const context = extractContext(content, 0, 5, 5);
      
      expect(context).toContain('MATCH');
    });
  });
});