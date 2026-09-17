/**
 * Safety Layer Service
 * Main service for content safety checks and moderation
 */

import path from 'path';
import type {
  SafetyRule,
  SafetyRuleCreate,
  SafetyRuleUpdate,
  SafetyViolation,
  SafetyCheckResult,
  SafetyCheckOptions,
  SafetyStats,
  SafetyConfig,
  SafetyFilter,
  SafetyListResult,
  SafetyEvent,
  SafetyEventListener
} from './types.js';
import { DEFAULT_SAFETY_CONFIG } from './types.js';
import {
  generateSafetyId,
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
  extractContext,
  getHighestAction,
  meetsMinLevel,
  DEFAULT_SAFETY_RULES
} from './utils.js';

/**
 * Simple logger interface for the safety service
 */
interface SafetyLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger
 */
const defaultLogger: SafetyLogger = {
  info: (message, data) => console.log(`[INFO] ${message}`, data || ''),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data || ''),
  error: (message, data) => console.error(`[ERROR] ${message}`, data || '')
};

let safetyServiceInstance: SafetyService | null = null;

export class SafetyService {
  private rules: Map<string, SafetyRule> = new Map();
  private config: SafetyConfig;
  private stats: SafetyStats;
  private eventListeners: Set<SafetyEventListener> = new Set();
  private logger: SafetyLogger;

  constructor(config?: Partial<SafetyConfig>, logger?: SafetyLogger) {
    this.logger = logger || defaultLogger;
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
    this.stats = createDefaultStats();
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    for (const ruleData of DEFAULT_SAFETY_RULES) {
      const rule: SafetyRule = {
        ...ruleData,
        id: generateSafetyId(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.rules.set(rule.id, rule);
    }
  }

  // Rule Management
  addRule(create: SafetyRuleCreate): SafetyRule {
    const validation = validateRuleName(create.name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    if (create.pattern) {
      const patternValidation = validatePattern(create.pattern);
      if (!patternValidation.valid) {
        throw new Error(patternValidation.error);
      }
    }

    const rule: SafetyRule = {
      id: generateSafetyId(),
      name: create.name,
      description: create.description,
      category: create.category,
      level: create.level,
      action: create.action,
      pattern: create.pattern,
      keywords: create.keywords || [],
      enabled: create.enabled ?? true,
      priority: create.priority ?? 50,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.rules.set(rule.id, rule);
    this.logger.info('Safety rule added', { ruleId: rule.id, name: rule.name });
    
    return rule;
  }

  updateRule(id: string, update: SafetyRuleUpdate): SafetyRule | null {
    const existing = this.rules.get(id);
    if (!existing) {
      return null;
    }

    if (update.name) {
      const validation = validateRuleName(update.name);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    if (update.pattern) {
      const patternValidation = validatePattern(update.pattern);
      if (!patternValidation.valid) {
        throw new Error(patternValidation.error);
      }
    }

    const updated: SafetyRule = {
      ...existing,
      ...update,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    };

    this.rules.set(id, updated);
    this.logger.info('Safety rule updated', { ruleId: id });
    
    return updated;
  }

  removeRule(id: string): boolean {
    const removed = this.rules.delete(id);
    if (removed) {
      this.logger.info('Safety rule removed', { ruleId: id });
    }
    return removed;
  }

  getRule(id: string): SafetyRule | null {
    return this.rules.get(id) || null;
  }

  listRules(filter?: SafetyFilter, page: number = 1, pageSize: number = 20): SafetyListResult {
    let rules = Array.from(this.rules.values());
    
    if (filter) {
      rules = filterRules(rules, filter);
    }
    
    rules = sortRulesByPriority(rules);
    
    return paginateRules(rules, page, pageSize);
  }

  // Content Checking
  checkContent(content: string, options?: SafetyCheckOptions): SafetyCheckResult {
    const startTime = Date.now();
    
    if (!this.config.enabled) {
      return {
        safe: true,
        score: 1.0,
        violations: [],
        actions: ['allow'],
        warnings: [],
        metadata: {
          checkedAt: new Date(),
          checkDuration: 0,
          rulesApplied: 0,
          contentLength: content.length
        }
      };
    }

    const violations: SafetyViolation[] = [];
    let rulesApplied = 0;

    // Get applicable rules
    let applicableRules = Array.from(this.rules.values())
      .filter(rule => rule.enabled);

    // Filter by specific rules if provided
    if (options?.rules) {
      applicableRules = applicableRules.filter(rule => options.rules!.includes(rule.id));
    }

    // Filter by categories if provided
    if (options?.categories) {
      applicableRules = applicableRules.filter(rule => options.categories!.includes(rule.category));
    }

    // Filter by minimum level if provided
    if (options?.minLevel) {
      applicableRules = applicableRules.filter(rule => 
        meetsMinLevel(rule.level, options.minLevel!)
      );
    }

    // Sort by priority
    applicableRules = sortRulesByPriority(applicableRules);

    // Check each rule
    for (const rule of applicableRules) {
      rulesApplied++;
      
      // Check pattern match
      if (rule.pattern) {
        const matches = findMatches(content, rule.pattern);
        for (const match of matches) {
          violations.push({
            id: generateSafetyId(),
            ruleId: rule.id,
            ruleName: rule.name,
            category: rule.category,
            level: rule.level,
            action: rule.action,
            matchedContent: match.match,
            matchedPattern: typeof rule.pattern === 'string' ? rule.pattern : rule.pattern.source,
            context: extractContext(content, match.index, match.index + match.match.length),
            position: {
              start: match.index,
              end: match.index + match.match.length
            },
            confidence: 0.9,
            timestamp: new Date()
          });
        }
      }

      // Check keyword matches
      if (rule.keywords && rule.keywords.length > 0) {
        const keywordMatches = containsKeywords(content, rule.keywords);
        for (const match of keywordMatches) {
          violations.push({
            id: generateSafetyId(),
            ruleId: rule.id,
            ruleName: rule.name,
            category: rule.category,
            level: rule.level,
            action: rule.action,
            matchedContent: match.keyword,
            context: extractContext(content, match.index, match.index + match.keyword.length),
            position: {
              start: match.index,
              end: match.index + match.keyword.length
            },
            confidence: 0.8,
            timestamp: new Date()
          });
        }
      }
    }

    // Calculate score
    const score = calculateSafetyScore(violations);
    
    // Determine actions
    const actions = [...new Set(violations.map(v => v.action))];
    const highestAction = getHighestAction(actions.length > 0 ? actions : ['allow']);

    // Determine if safe
    const safe = score >= this.config.minScoreThreshold && 
                 violations.filter(v => v.action === 'block').length === 0;

    // Generate warnings
    const warnings: string[] = [];
    if (options?.includeWarnings !== false) {
      for (const violation of violations.filter(v => v.action === 'warn')) {
        warnings.push(`Safety warning: ${violation.ruleName} - ${violation.matchedContent}`);
      }
    }

    // Sanitize content if requested
    let sanitizedContent: string | undefined;
    if (options?.sanitize || this.config.enableSanitization) {
      const sanitizeViolations = violations.filter(v => v.action === 'sanitize');
      if (sanitizeViolations.length > 0) {
        const matches = sanitizeViolations
          .filter(v => v.position)
          .map(v => ({ start: v.position!.start, end: v.position!.end }));
        sanitizedContent = sanitizeContent(content, matches);
      }
    }

    // Log violations if configured
    if (this.config.logViolations && violations.length > 0) {
      this.logger.warn('Safety violations detected', {
        violationCount: violations.length,
        score,
        highestAction
      });
    }

    const result: SafetyCheckResult = {
      safe,
      score,
      violations,
      actions: [highestAction],
      sanitizedContent,
      warnings,
      metadata: {
        checkedAt: new Date(),
        checkDuration: Date.now() - startTime,
        rulesApplied,
        contentLength: content.length
      }
    };

    // Update stats
    this.stats = updateStatsWithResult(this.stats, result);

    // Emit event
    this.emitEvent({
      type: safe ? 'check' : 'violation',
      timestamp: new Date(),
      data: result
    });

    // Check for escalation
    if (score < this.config.escalateThreshold) {
      this.emitEvent({
        type: 'escalate',
        timestamp: new Date(),
        data: { score, violations, content: content.substring(0, 100) }
      });
    }

    return result;
  }

  // Quick check methods
  isSafe(content: string): boolean {
    return this.checkContent(content).safe;
  }

  getScore(content: string): number {
    return this.checkContent(content).score;
  }

  sanitize(content: string): string {
    const result = this.checkContent(content, { sanitize: true });
    return result.sanitizedContent || content;
  }

  // Statistics
  getStats(): SafetyStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = createDefaultStats();
    this.logger.info('Safety stats reset');
  }

  // Configuration
  getConfig(): SafetyConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Safety config updated');
  }

  // Event handling
  addEventListener(listener: SafetyEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitEvent(event: SafetyEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Error in safety event listener', { error });
      }
    }
  }

  // Import/Export
  exportRules(): SafetyRule[] {
    return Array.from(this.rules.values());
  }

  importRules(rules: SafetyRule[]): void {
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
    this.logger.info('Safety rules imported', { count: rules.length });
  }

  // Enable/Disable
  enable(): void {
    this.config.enabled = true;
    this.logger.info('Safety layer enabled');
  }

  disable(): void {
    this.config.enabled = false;
    this.logger.info('Safety layer disabled');
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  // Path Security & Sandboxing
  /**
   * Check if a path is safe (within the workspace root)
   */
  isPathSafe(targetPath: string, workspaceRoot: string): boolean {
    if (!workspaceRoot) return false;
    
    try {
      const absoluteWorkspace = path.resolve(workspaceRoot);
      const absoluteTarget = path.isAbsolute(targetPath) 
        ? path.resolve(targetPath)
        : path.resolve(workspaceRoot, targetPath);
        
      return absoluteTarget.startsWith(absoluteWorkspace);
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if a path is within any of the allowed paths (workspace + config allowed_paths)
   */
  isPathInAllowedPaths(targetPath: string, workspaceRoot: string, allowedPaths: string[]): boolean {
    // Expand ~ in target path
    const expandedTarget = targetPath.startsWith('~')
      ? path.join(process.env.HOME || '', targetPath.slice(1))
      : targetPath;

    // Always check workspace root first
    if (this.isPathSafe(expandedTarget, workspaceRoot)) return true;

    // Check additional allowed paths
    try {
      const absoluteTarget = path.isAbsolute(expandedTarget)
        ? path.resolve(expandedTarget)
        : path.resolve(workspaceRoot, expandedTarget);

      for (const allowed of allowedPaths) {
        // Expand ~ to home directory
        const expandedPath = allowed.startsWith('~') 
          ? path.join(process.env.HOME || '', allowed.slice(1))
          : allowed;
        const absoluteAllowed = path.resolve(expandedPath);
        if (absoluteTarget.startsWith(absoluteAllowed)) return true;
      }
    } catch { /* deny on error */ }

    return false;
  }

  /**
   * Validate a path and return the absolute path if safe, otherwise throw
   */
  validatePath(targetPath: string, workspaceRoot: string): string {
    if (!workspaceRoot) {
      throw new Error('Security Error: Workspace root not defined');
    }
    
    if (!this.isPathSafe(targetPath, workspaceRoot)) {
      throw new Error(`Security Error: Access denied. Path is outside the allowed workspace: ${targetPath}`);
    }
    
    return path.isAbsolute(targetPath) 
      ? path.resolve(targetPath)
      : path.resolve(workspaceRoot, targetPath);
  }

  /**
   * Validate a path against workspace + allowed paths. Returns absolute path or throws.
   */
  validatePathWithAllowedPaths(targetPath: string, workspaceRoot: string, allowedPaths: string[]): string {
    if (!workspaceRoot) {
      throw new Error('Security Error: Workspace root not defined');
    }

    // Expand ~ in target path
    const expandedTarget = targetPath.startsWith('~')
      ? path.join(process.env.HOME || '', targetPath.slice(1))
      : targetPath;

    if (!this.isPathInAllowedPaths(expandedTarget, workspaceRoot, allowedPaths)) {
      throw new Error(`Security Error: Access denied. Path "${targetPath}" is outside allowed directories.`);
    }

    return path.isAbsolute(expandedTarget)
      ? path.resolve(expandedTarget)
      : path.resolve(workspaceRoot, expandedTarget);
  }
}

// Factory function
export function createSafetyService(config?: Partial<SafetyConfig>, logger?: SafetyLogger): SafetyService {
  return new SafetyService(config, logger);
}

// Singleton access
export function getSafetyService(): SafetyService {
  if (!safetyServiceInstance) {
    safetyServiceInstance = new SafetyService();
  }
  return safetyServiceInstance;
}

export function resetSafetyService(): void {
  safetyServiceInstance = null;
}