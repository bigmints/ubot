import { describe, it, expect } from 'vitest';
import { toolResult, safeExecutor } from '../types.js';
import { getAllToolDefinitions, getModuleNames } from '../registry.js';

describe('Tool Types', () => {
  describe('toolResult', () => {
    it('should create a success result', () => {
      const result = toolResult('test_tool', true, 'it worked');
      expect(result.toolName).toBe('test_tool');
      expect(result.success).toBe(true);
      expect(result.result).toBe('it worked');
      expect(result.error).toBeUndefined();
      expect(result.duration).toBe(0);
    });

    it('should create a failure result', () => {
      const result = toolResult('test_tool', false, 'it broke');
      expect(result.toolName).toBe('test_tool');
      expect(result.success).toBe(false);
      expect(result.error).toBe('it broke');
      expect(result.result).toBeUndefined();
    });
  });

  describe('safeExecutor', () => {
    it('should wrap successful execution', async () => {
      const executor = safeExecutor('my_tool', async () => 'hello');
      const result = await executor({});
      expect(result.success).toBe(true);
      expect(result.result).toBe('hello');
      expect(result.toolName).toBe('my_tool');
    });

    it('should catch errors and return failure', async () => {
      const executor = safeExecutor('my_tool', async () => {
        throw new Error('something broke');
      });
      const result = await executor({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('something broke');
    });
  });
});

describe('Tool Registry', () => {
  it('should discover modules from capability directories', async () => {
    const names = await getModuleNames();
    expect(names.length).toBeGreaterThan(5);
    // Infrastructure modules always present
    expect(names).toContain('messaging');
  });

  it('should collect all tool definitions', async () => {
    const tools = await getAllToolDefinitions();
    expect(tools.length).toBeGreaterThan(15);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(Array.isArray(tool.parameters)).toBe(true);
    }
  });

  it('should have unique tool names', async () => {
    const tools = await getAllToolDefinitions();
    const names = tools.map((t: any) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
