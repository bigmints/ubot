import { describe, it, expect } from 'vitest';
import skillsModule from '../../agents/skills/tools.js';
import { registerModule, createMockContext } from './test-helpers.js';

describe('Skills Tool Module', () => {
  it('should export correct module metadata', () => {
    expect(skillsModule.name).toBe('skills');
    expect(skillsModule.tools.length).toBe(5);
    expect(skillsModule.tools.map(t => t.name)).toEqual([
      'list_skills', 'create_skill', 'update_skill', 'delete_skill', 'run_skill',
    ]);
  });

  it('should register all 5 executors', () => {
    const registry = registerModule(skillsModule);
    expect(registry.registeredNames()).toHaveLength(5);
  });

  describe('list_skills', () => {
    it('should throw when skill engine is null', async () => {
      const registry = registerModule(skillsModule, createMockContext({ allNull: true }));
      await expect(registry.call('list_skills')).rejects.toThrow('Skill engine not initialized');
    });

    it('should list skills', async () => {
      const registry = registerModule(skillsModule);
      const result = await registry.call('list_skills');
      expect(result.success).toBe(true);
    });
  });

  describe('create_skill', () => {
    it('should throw when skill engine is null', async () => {
      const registry = registerModule(skillsModule, createMockContext({ allNull: true }));
      await expect(
        registry.call('create_skill', { name: 'test', description: 'desc', instructions: 'do stuff' })
      ).rejects.toThrow('Skill engine not initialized');
    });

    it('should create a skill', async () => {
      const registry = registerModule(skillsModule);
      const result = await registry.call('create_skill', {
        name: 'My Skill',
        description: 'A test skill',
        instructions: 'Do the thing',
        events: 'message',
      });
      expect(result.success).toBe(true);
      expect(result.result).toContain('Created skill');
    });
  });

  describe('update_skill', () => {
    it('should throw when skill engine is null', async () => {
      const registry = registerModule(skillsModule, createMockContext({ allNull: true }));
      await expect(
        registry.call('update_skill', { skill_id: 'skill-1', name: 'Updated' })
      ).rejects.toThrow('Skill engine not initialized');
    });

    it('should return error when skill_id is empty', async () => {
      const registry = registerModule(skillsModule);
      const result = await registry.call('update_skill', { skill_id: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('delete_skill', () => {
    it('should throw when skill engine is null', async () => {
      const registry = registerModule(skillsModule, createMockContext({ allNull: true }));
      await expect(
        registry.call('delete_skill', { skill_id: 'skill-1' })
      ).rejects.toThrow('Skill engine not initialized');
    });

    it('should return error without skill_id', async () => {
      const registry = registerModule(skillsModule);
      const result = await registry.call('delete_skill', { skill_id: '' });
      expect(result.success).toBe(false);
    });
  });
});
