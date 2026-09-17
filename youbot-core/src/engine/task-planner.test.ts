import { describe, it, expect, vi } from 'vitest';
import { createTaskPlan, getExecutionOrder, isSimpleRequest } from './task-planner';

describe('Task Planner', () => {
  describe('isSimpleRequest', () => {
    it('should identify simple requests', () => {
      expect(isSimpleRequest('What time is it?')).toBe(true);
      expect(isSimpleRequest('Search for pizza near me')).toBe(true);
      expect(isSimpleRequest('Send a message to John')).toBe(true);
    });

    it('should identify complex requests', () => {
      expect(isSimpleRequest('Search for pizza and then send the address to John')).toBe(false);
      expect(isSimpleRequest('First find a recipe, then write it to a file, and finally email it to me')).toBe(false);
      expect(isSimpleRequest('word '.repeat(21))).toBe(false); // Word count > 20
    });
  });

  describe('createTaskPlan', () => {
    it('should return a single step for simple requests', async () => {
      const generate = vi.fn();
      const plan = await createTaskPlan('test-session', 'Simple task', ['general'], generate);
      
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].agentType).toBe('nexus');
      expect(generate).not.toHaveBeenCalled();
    });

    it('should decompose complex requests using LLM', async () => {
      const mockResponse = JSON.stringify({
        steps: [
          { id: 'step-1', description: 'Search for pizza', agentType: 'browser-operator', dependsOn: [], prompt: 'Search for pizza' },
          { id: 'step-2', description: 'Send address to John', agentType: 'general', dependsOn: ['step-1'], prompt: 'Send {step-1.result} to John' }
        ]
      });
      const generate = vi.fn().mockResolvedValue(mockResponse);
      
      const plan = await createTaskPlan('test-session', 'Search for pizza and then send the address to John', ['browser-operator', 'general'], generate);
      
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].id).toBe('step-1');
      expect(plan.steps[1].dependsOn).toContain('step-1');
      expect(generate).toHaveBeenCalled();
    });

    it('should fallback to single step on LLM failure', async () => {
      const generate = vi.fn().mockRejectedValue(new Error('LLM Error'));
      const plan = await createTaskPlan('test-session', 'Complex task that fails planning', ['general'], generate);
      
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].description).toBe('Complex task that fails planning');
    });
  });

  describe('getExecutionOrder', () => {
    it('should return steps in correct topological order', () => {
      const steps: any[] = [
        { id: 's1', dependsOn: [] },
        { id: 's2', dependsOn: ['s1'] },
        { id: 's3', dependsOn: [] },
        { id: 's4', dependsOn: ['s2', 's3'] }
      ];
      
      const order = getExecutionOrder(steps);
      
      expect(order).toHaveLength(3);
      expect(order[0].map(s => s.id)).toContain('s1');
      expect(order[0].map(s => s.id)).toContain('s3');
      expect(order[1].map(s => s.id)).toContain('s2');
      expect(order[2].map(s => s.id)).toContain('s4');
    });
  });
});
