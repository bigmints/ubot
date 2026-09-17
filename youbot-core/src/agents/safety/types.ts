/**
 * Safety Layer Types
 * Types for content safety, filtering, and moderation
 */

export type SafetyLevel = 'low' | 'medium' | 'high' | 'critical';

export type SafetyCategory = 
  | 'harmful_content'
  | 'personal_information'
  | 'spam'
  | 'inappropriate_language'
  | 'malicious_links'
  | 'phishing'
  | 'scam'
  | 'harassment'
  | 'hate_speech'
  | 'violence'
  | 'sexual_content'
  | 'self_harm'
  | 'misinformation'
  | 'custom';

export type SafetyAction = 
  | 'allow'
  | 'warn'
  | 'block'
  | 'sanitize'
  | 'escalate'
  | 'review';

export interface SafetyRule {
  id: string;
  name: string;
  description: string;
  category: SafetyCategory;
  level: SafetyLevel;
  action: SafetyAction;
  pattern?: string | RegExp;
  keywords?: string[];
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafetyRuleCreate {
  name: string;
  description: string;
  category: SafetyCategory;
  level: SafetyLevel;
  action: SafetyAction;
  pattern?: string;
  keywords?: string[];
  enabled?: boolean;
  priority?: number;
}

export interface SafetyRuleUpdate {
  name?: string;
  description?: string;
  category?: SafetyCategory;
  level?: SafetyLevel;
  action?: SafetyAction;
  pattern?: string;
  keywords?: string[];
  enabled?: boolean;
  priority?: number;
}

export interface SafetyViolation {
  id: string;
  ruleId: string;
  ruleName: string;
  category: SafetyCategory;
  level: SafetyLevel;
  action: SafetyAction;
  matchedContent: string;
  matchedPattern?: string;
  context?: string;
  position?: {
    start: number;
    end: number;
  };
  confidence: number;
  timestamp: Date;
}

export interface SafetyCheckResult {
  safe: boolean;
  score: number;
  violations: SafetyViolation[];
  actions: SafetyAction[];
  sanitizedContent?: string;
  warnings: string[];
  metadata: {
    checkedAt: Date;
    checkDuration: number;
    rulesApplied: number;
    contentLength: number;
  };
}

export interface SafetyCheckOptions {
  rules?: string[];
  categories?: SafetyCategory[];
  minLevel?: SafetyLevel;
  sanitize?: boolean;
  includeWarnings?: boolean;
  context?: string;
  userId?: string;
  sessionId?: string;
}

export interface ContentAnalysis {
  sentiment: {
    score: number;
    label: 'positive' | 'negative' | 'neutral';
  };
  language: string;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  topics: string[];
  readability: {
    score: number;
    level: string;
  };
}

export interface SafetyStats {
  totalChecks: number;
  blockedCount: number;
  warnedCount: number;
  sanitizedCount: number;
  violationsByCategory: Record<SafetyCategory, number>;
  violationsByLevel: Record<SafetyLevel, number>;
  averageScore: number;
  lastUpdated: Date;
}

export interface SafetyConfig {
  enabled: boolean;
  defaultAction: SafetyAction;
  minScoreThreshold: number;
  maxViolations: number;
  enableSanitization: boolean;
  enableContentAnalysis: boolean;
  logViolations: boolean;
  escalateThreshold: number;
  customPatterns: Array<{
    name: string;
    pattern: string;
    category: SafetyCategory;
  }>;
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  enabled: true,
  defaultAction: 'warn',
  minScoreThreshold: 0.7,
  maxViolations: 5,
  enableSanitization: true,
  enableContentAnalysis: false,
  logViolations: true,
  escalateThreshold: 0.3,
  customPatterns: []
};

export const SAFETY_LEVEL_PRIORITY: Record<SafetyLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export const SAFETY_ACTION_PRIORITY: Record<SafetyAction, number> = {
  allow: 0,
  warn: 1,
  sanitize: 2,
  review: 3,
  block: 4,
  escalate: 5
};

export interface SafetyFilter {
  categories?: SafetyCategory[];
  levels?: SafetyLevel[];
  actions?: SafetyAction[];
  enabled?: boolean;
  search?: string;
}

export interface SafetyListResult {
  rules: SafetyRule[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SafetyEvent {
  type: 'check' | 'violation' | 'block' | 'escalate';
  timestamp: Date;
  data: unknown;
}

export type SafetyEventListener = (event: SafetyEvent) => void;

export const SAFETY_SKILL = {
  id: 'safety-layer',
  name: 'Safety Layer',
  description: 'Content safety, filtering, and moderation capabilities',
  category: 'security' as const,
  level: 'intermediate' as const,
  tags: ['safety', 'moderation', 'filtering', 'security', 'content']
};