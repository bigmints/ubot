/**
 * Feature Store
 *
 * Persistent tracking for feature development lifecycle.
 * Stores feature state, queue files, logs, steps, and error tracking.
 * Lives in workspace/features/ directory.
 *
 * Usage:
 *   const store = new FeatureStore(workspacePath);
 *   await store.create({ id: 'feature-1', title: 'Auth flow', codebase: { path: '/path/to/app' } });
 *   await store.updateStep('feature-1', 'step-1', { status: 'completed', result: 'Done' });
 *   const feature = await store.get('feature-1');
 */

import fs from "fs";
import path from "path";
import { log } from "../logger/ring-buffer.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FeatureStep {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;
  error?: string;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
  duration?: number; // seconds
}

export interface FeatureCodebase {
  path: string;
  techStack: string[];
  entryPoints: string[];
  structure: string; // summary of directory layout
}

export interface Feature {
  id: string;
  title: string;
  status: "planning" | "approved" | "building" | "complete" | "failed" | "paused";
  codebase: FeatureCodebase;
  queueFile?: string;
  logsDir?: string;
  steps: FeatureStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface FeatureList {
  features: Feature[];
  total: number;
  byStatus: Record<string, number>;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const FEATURES_DIR = "features";

// ─── Helper Functions ──────────────────────────────────────────────────────────

function getFeaturePath(workspacePath: string, featureId: string): string {
  return path.join(workspacePath, FEATURES_DIR, `${featureId}.json`);
}

function ensureFeaturesDir(workspacePath: string): void {
  const dir = path.join(workspacePath, FEATURES_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.info("FeatureStore", `Created features directory: ${dir}`);
  }
}

function generateId(): string {
  return `feature-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ─── FeatureStore Class ────────────────────────────────────────────────────────

export class FeatureStore {
  public workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    ensureFeaturesDir(workspacePath);
  }

  /**
   * Create a new feature
   */
  async create(
    options: {
      title?: string;
      codebase?: Partial<FeatureCodebase>;
      queueFile?: string;
      logsDir?: string;
      metadata?: Record<string, any>;
    } = {},
  ): Promise<Feature> {
    const id = generateId();
    const feature: Feature = {
      id,
      title: options.title || "New Feature",
      status: "planning",
      codebase: {
        path: options.codebase?.path || this.workspacePath,
        techStack: options.codebase?.techStack || [],
        entryPoints: options.codebase?.entryPoints || [],
        structure: options.codebase?.structure || "",
      },
      queueFile: options.queueFile,
      logsDir: options.logsDir,
      steps: [],
      createdAt: now(),
      updatedAt: now(),
      metadata: options.metadata,
    };

    await this.save(feature);
    log.info("FeatureStore", `Created feature: ${id} (${feature.title})`);
    return feature;
  }

  /**
   * Get a feature by ID
   */
  async get(featureId: string): Promise<Feature | null> {
    const filePath = getFeaturePath(this.workspacePath, featureId);
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as Feature;
    } catch (err: any) {
      log.error("FeatureStore", `Failed to read feature ${featureId}: ${err.message}`);
      return null;
    }
  }

  /**
   * List all features
   */
  async list(): Promise<FeatureList> {
    const featuresDir = path.join(this.workspacePath, FEATURES_DIR);
    if (!fs.existsSync(featuresDir)) {
      return { features: [], total: 0, byStatus: {} };
    }

    const files = fs.readdirSync(featuresDir).filter((f) => f.endsWith(".json"));
    const features: Feature[] = [];
    const byStatus: Record<string, number> = {};

    for (const file of files) {
      const filePath = path.join(featuresDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const feature = JSON.parse(content) as Feature;
        features.push(feature);
        byStatus[feature.status] = (byStatus[feature.status] || 0) + 1;
      } catch (err: any) {
        log.error("FeatureStore", `Failed to read feature file ${file}: ${err.message}`);
      }
    }

    // Sort by updatedAt (most recent first)
    features.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { features, total: features.length, byStatus };
  }

  /**
   * Update feature status
   */
  async updateStatus(
    featureId: string,
    status: Feature["status"],
  ): Promise<Feature | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    feature.status = status;
    feature.updatedAt = now();

    if (status === "complete" || status === "failed") {
      feature.completedAt = now();
    }

    await this.save(feature);
    log.info("FeatureStore", `Updated feature ${featureId} status: ${status}`);
    return feature;
  }

  /**
   * Add a step to the feature
   */
  async addStep(
    featureId: string,
    step: Omit<FeatureStep, "retryCount">,
  ): Promise<Feature | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    const newStep: FeatureStep = {
      ...step,
      retryCount: 0,
      status: "pending",
    };

    feature.steps.push(newStep);
    feature.updatedAt = now();

    await this.save(feature);
    log.info("FeatureStore", `Added step "${newStep.id}" to feature ${featureId}`);
    return feature;
  }

  /**
   * Update a step's status and result
   */
  async updateStep(
    featureId: string,
    stepId: string,
    updates: Partial<FeatureStep>,
  ): Promise<Feature | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    const stepIndex = feature.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      log.warn("FeatureStore", `Step ${stepId} not found in feature ${featureId}`);
      return null;
    }

    const step = feature.steps[stepIndex];

    // Update fields
    if (updates.status) step.status = updates.status;
    if (updates.result !== undefined) step.result = updates.result;
    if (updates.error !== undefined) step.error = updates.error;
    if (updates.startedAt) step.startedAt = updates.startedAt;
    if (updates.completedAt) step.completedAt = updates.completedAt;
    if (updates.duration !== undefined) step.duration = updates.duration;

    // Auto-manage retry count on failure
    if (updates.status === "failed") {
      step.retryCount += 1;
    }

    feature.updatedAt = now();
    await this.save(feature);
    log.info("FeatureStore", `Updated step ${stepId} in feature ${featureId}`);
    return feature;
  }

  /**
   * Update codebase information
   */
  async updateCodebase(
    featureId: string,
    codebase: Partial<FeatureCodebase>,
  ): Promise<Feature | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    feature.codebase = { ...feature.codebase, ...codebase };
    feature.updatedAt = now();

    await this.save(feature);
    log.info("FeatureStore", `Updated codebase for feature ${featureId}`);
    return feature;
  }

  /**
   * Set queue file path
   */
  async setQueueFile(featureId: string, queueFile: string): Promise<Feature | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    feature.queueFile = queueFile;
    feature.updatedAt = now();

    await this.save(feature);
    log.info("FeatureStore", `Set queue file for feature ${featureId}: ${queueFile}`);
    return feature;
  }

  /**
   * Set logs directory
   */
  async setLogsDir(featureId: string, logsDir: string): Promise<Feature | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    feature.logsDir = logsDir;
    feature.updatedAt = now();

    await this.save(feature);
    log.info("FeatureStore", `Set logs dir for feature ${featureId}: ${logsDir}`);
    return feature;
  }

  /**
   * Delete a feature
   */
  async delete(featureId: string): Promise<boolean> {
    const filePath = getFeaturePath(this.workspacePath, featureId);
    if (!fs.existsSync(filePath)) return false;

    try {
      fs.unlinkSync(filePath);
      log.info("FeatureStore", `Deleted feature: ${featureId}`);
      return true;
    } catch (err: any) {
      log.error("FeatureStore", `Failed to delete feature ${featureId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Save feature to disk
   */
  private async save(feature: Feature): Promise<void> {
    try {
      const filePath = getFeaturePath(this.workspacePath, feature.id);
      const content = JSON.stringify(feature, null, 2);
      fs.writeFileSync(filePath, content, "utf-8");
    } catch (err: any) {
      log.error("FeatureStore", `Failed to save feature ${feature.id}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get feature summary (lightweight, no full feature data)
   */
  async getSummary(featureId: string): Promise<{
    id: string;
    title: string;
    status: string;
    steps: { id: string; name: string; status: string }[];
    updatedAt: string;
  } | null> {
    const feature = await this.get(featureId);
    if (!feature) return null;

    return {
      id: feature.id,
      title: feature.title,
      status: feature.status,
      steps: feature.steps.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
      })),
      updatedAt: feature.updatedAt,
    };
  }

  /**
   * Get feature progress percentage
   */
  async getProgress(featureId: string): Promise<number> {
    const feature = await this.get(featureId);
    if (!feature || feature.steps.length === 0) return 0;

    const completed = feature.steps.filter((s) => s.status === "completed").length;
    return Math.round((completed / feature.steps.length) * 100);
  }
}

// ─── Singleton Instance ────────────────────────────────────────────────────────

let instance: FeatureStore | null = null;

export function getFeatureStore(workspacePath: string): FeatureStore {
  if (!instance || instance.workspacePath !== workspacePath) {
    instance = new FeatureStore(workspacePath);
  }
  return instance;
}
