/**
 * Skill Repository Interface
 *
 * Defines the contract for skill persistence.
 * Active implementation: file-skill-repository.ts (SKILL.md files)
 */

import type { Skill } from './skill-types.js';

export interface SkillRepository {
  create(skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>): Skill;
  getById(id: string): Skill | null;
  getAll(): Skill[];
  getEnabled(): Skill[];
  getByEventType(eventKey: string): Skill[];
  update(id: string, updates: Partial<Skill>): Skill | null;
  delete(id: string): boolean;
  toggleEnabled(id: string, enabled: boolean): Skill | null;
  /** The directory where skills are stored (file-based repos) */
  readonly dir?: string;
  /** Get raw SKILL.md content for a skill (for the UI editor) */
  getRaw?(id: string): string | null;
  /** Save raw SKILL.md content directly (from the UI editor) */
  saveRaw?(id: string, content: string): Skill | null;
}

/** @deprecated Use SkillRepository */
export type UserSkillRepository = SkillRepository;
