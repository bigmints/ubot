/**
 * Safety Layer Utilities
 * Helper functions for safety checks and content analysis
 */

import type {
  SafetyLevel,
  SafetyCategory,
  SafetyAction,
  SafetyRule,
  SafetyViolation,
  SafetyCheckResult,
  SafetyFilter,
  SafetyListResult,
  SafetyStats
} from './types.js';

// Generate unique ID
export function generateSafetyId(): string {
  return `safety_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// Get level priority for comparison
export function getLevelPriority(level: SafetyLevel): number {
  const priorities: Record<SafetyLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  };
  return priorities[level];
}

// Get action priority for comparison
export function getActionPriority(action: SafetyAction): number {
  const priorities: Record<SafetyAction, number> = {
    allow: 0,
    warn: 1,
    sanitize: 2,
    review: 3,
    block: 4,
    escalate: 5
  };
  return priorities[action];
}

// Compare two safety levels
export function compareLevels(a: SafetyLevel, b: SafetyLevel): number {
  return getLevelPriority(a) - getLevelPriority(b);
}

// Check if level meets minimum threshold
export function meetsMinLevel(level: SafetyLevel, minLevel: SafetyLevel): boolean {
  return getLevelPriority(level) >= getLevelPriority(minLevel);
}

// Get the highest action from a list
export function getHighestAction(actions: SafetyAction[]): SafetyAction {
  if (actions.length === 0) return 'allow';
  
  return actions.reduce((highest, current) => {
    return getActionPriority(current) > getActionPriority(highest) ? current : highest;
  }, 'allow' as SafetyAction);
}

// Escape regex special characters
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Convert string pattern to RegExp
export function patternToRegex(pattern: string, flags: string = 'gi'): RegExp {
  return new RegExp(pattern, flags);
}

// Check if content matches a pattern
export function matchesPattern(content: string, pattern: string | RegExp): boolean {
  try {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
    return regex.test(content);
  } catch {
    return false;
  }
}

// Find all matches in content
export function findMatches(content: string, pattern: string | RegExp): Array<{
  match: string;
  index: number;
  groups?: Record<string, string>;
}> {
  const results: Array<{
    match: string;
    index: number;
    groups?: Record<string, string>;
  }> = [];
  
  try {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      results.push({
        match: match[0],
        index: match.index,
        groups: match.groups
      });
    }
  } catch {
    // Return empty array on regex error
  }
  
  return results;
}

// Check if content contains any keywords
export function containsKeywords(content: string, keywords: string[]): Array<{
  keyword: string;
  index: number;
}> {
  const results: Array<{
    keyword: string;
    index: number;
  }> = [];
  
  const lowerContent = content.toLowerCase();
  
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    let index = lowerContent.indexOf(lowerKeyword);
    
    while (index !== -1) {
      results.push({
        keyword,
        index
      });
      index = lowerContent.indexOf(lowerKeyword, index + 1);
    }
  }
  
  return results;
}

// Sanitize content by replacing matched portions
export function sanitizeContent(
  content: string,
  matches: Array<{ start: number; end: number }>,
  replacement: string = '[REDACTED]'
): string {
  if (matches.length === 0) return content;
  
  // Sort matches by start position in reverse order
  const sortedMatches = [...matches].sort((a, b) => b.start - a.start);
  
  let result = content;
  for (const match of sortedMatches) {
    result = result.slice(0, match.start) + replacement + result.slice(match.end);
  }
  
  return result;
}

// Calculate safety score based on violations
export function calculateSafetyScore(violations: SafetyViolation[]): number {
  if (violations.length === 0) return 1.0;
  
  const weights: Record<SafetyLevel, number> = {
    low: 0.1,
    medium: 0.25,
    high: 0.5,
    critical: 1.0
  };
  
  const totalPenalty = violations.reduce((sum, v) => {
    return sum + weights[v.level] * v.confidence;
  }, 0);
  
  return Math.max(0, 1 - totalPenalty);
}

// Filter rules based on criteria
export function filterRules(rules: SafetyRule[], filter: SafetyFilter): SafetyRule[] {
  return rules.filter(rule => {
    if (filter.categories && !filter.categories.includes(rule.category)) {
      return false;
    }
    if (filter.levels && !filter.levels.includes(rule.level)) {
      return false;
    }
    if (filter.actions && !filter.actions.includes(rule.action)) {
      return false;
    }
    if (filter.enabled !== undefined && rule.enabled !== filter.enabled) {
      return false;
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      return (
        rule.name.toLowerCase().includes(searchLower) ||
        rule.description.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });
}

// Sort rules by priority
export function sortRulesByPriority(rules: SafetyRule[]): SafetyRule[] {
  return [...rules].sort((a, b) => {
    // Higher priority first
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    // Then by level
    return getLevelPriority(b.level) - getLevelPriority(a.level);
  });
}

// Paginate rules
export function paginateRules(
  rules: SafetyRule[],
  page: number = 1,
  pageSize: number = 20
): SafetyListResult {
  const total = rules.length;
  const offset = (page - 1) * pageSize;
  const paginatedRules = rules.slice(offset, offset + pageSize);
  
  return {
    rules: paginatedRules,
    total,
    page,
    pageSize
  };
}

// Create default safety stats
export function createDefaultStats(): SafetyStats {
  return {
    totalChecks: 0,
    blockedCount: 0,
    warnedCount: 0,
    sanitizedCount: 0,
    violationsByCategory: {} as Record<SafetyCategory, number>,
    violationsByLevel: {} as Record<SafetyLevel, number>,
    averageScore: 1.0,
    lastUpdated: new Date()
  };
}

// Update stats with new check result
export function updateStatsWithResult(
  stats: SafetyStats,
  result: SafetyCheckResult
): SafetyStats {
  const newStats = { ...stats };
  
  newStats.totalChecks += 1;
  newStats.lastUpdated = new Date();
  
  if (result.actions.includes('block')) {
    newStats.blockedCount += 1;
  }
  if (result.actions.includes('warn')) {
    newStats.warnedCount += 1;
  }
  if (result.sanitizedContent) {
    newStats.sanitizedCount += 1;
  }
  
  // Update violations by category
  for (const violation of result.violations) {
    newStats.violationsByCategory[violation.category] = 
      (newStats.violationsByCategory[violation.category] || 0) + 1;
    newStats.violationsByLevel[violation.level] = 
      (newStats.violationsByLevel[violation.level] || 0) + 1;
  }
  
  // Update average score
  const totalScore = newStats.averageScore * (newStats.totalChecks - 1) + result.score;
  newStats.averageScore = totalScore / newStats.totalChecks;
  
  return newStats;
}

// Validate rule name
export function validateRuleName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Rule name is required' };
  }
  if (name.length > 100) {
    return { valid: false, error: 'Rule name must be 100 characters or less' };
  }
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(name)) {
    return { valid: false, error: 'Rule name can only contain letters, numbers, spaces, underscores, and hyphens' };
  }
  return { valid: true };
}

// Validate regex pattern
export function validatePattern(pattern: string): { valid: boolean; error?: string } {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid regex pattern: ${(e as Error).message}` };
  }
}

// Extract context around a match
export function extractContext(
  content: string,
  start: number,
  end: number,
  contextLength: number = 50
): string {
  const contextStart = Math.max(0, start - contextLength);
  const contextEnd = Math.min(content.length, end + contextLength);
  
  let context = content.slice(contextStart, contextEnd);
  
  if (contextStart > 0) {
    context = '...' + context;
  }
  if (contextEnd < content.length) {
    context = context + '...';
  }
  
  return context;
}

// Default safety rules
export const DEFAULT_SAFETY_RULES: Array<Omit<SafetyRule, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'PII Detection',
    description: 'Detects potential personally identifiable information',
    category: 'personal_information',
    level: 'high',
    action: 'sanitize',
    pattern: '\\b\\d{3}[-.]?\\d{2}[-.]?\\d{4}\\b|\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b',
    enabled: true,
    priority: 100
  },
  {
    name: 'Email Detection',
    description: 'Detects email addresses',
    category: 'personal_information',
    level: 'medium',
    action: 'sanitize',
    pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    enabled: true,
    priority: 90
  },
  {
    name: 'Credit Card Detection',
    description: 'Detects potential credit card numbers',
    category: 'personal_information',
    level: 'critical',
    action: 'block',
    pattern: '\\b(?:\\d{4}[-\\s]?){3}\\d{4}\\b',
    enabled: true,
    priority: 150
  },
  {
    name: 'URL Detection',
    description: 'Detects URLs in content',
    category: 'malicious_links',
    level: 'low',
    action: 'warn',
    pattern: 'https?://[^\\s]+',
    enabled: true,
    priority: 50
  },
  {
    name: 'Profanity Filter',
    description: 'Basic profanity detection',
    category: 'inappropriate_language',
    level: 'medium',
    action: 'sanitize',
    keywords: ['badword1', 'badword2', 'badword3'],
    enabled: true,
    priority: 70
  }
];