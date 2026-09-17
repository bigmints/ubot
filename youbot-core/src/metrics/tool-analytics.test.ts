import { beforeEach, describe, expect, it } from 'vitest';
import { createToolAnalytics, type ToolAnalytics } from './tool-analytics.js';

describe('Tool Analytics', () => {
  let analytics: ToolAnalytics;

  beforeEach(() => {
    analytics = createToolAnalytics();
  });

  it('records successful and failed executions', async () => {
    await analytics.recordToolCall('test_tool', true, 100);
    await analytics.recordToolCall('test_tool', false, 50, 'failure');

    const stats = await analytics.getToolStats('test_tool');
    expect(stats).toMatchObject({
      totalCalls: 2,
      successfulCalls: 1,
      failedCalls: 1,
      averageDuration: 75,
      errorRate: 50,
    });
  });

  it('returns an isolated copy of tool stats', async () => {
    await analytics.recordToolCall('specific_tool', true, 150);
    const stats = await analytics.getToolStats('specific_tool');
    expect(stats).not.toBeNull();
    expect(stats?.totalCalls).toBe(1);
    if (stats) stats.totalCalls = 99;
    expect((await analytics.getToolStats('specific_tool'))?.totalCalls).toBe(1);
  });

  it('returns null for an unknown tool', async () => {
    await expect(analytics.getToolStats('missing')).resolves.toBeNull();
  });

  it('resets one tool without removing others', async () => {
    await analytics.recordToolCall('remove', true, 10);
    await analytics.recordToolCall('keep', true, 20);
    await analytics.resetToolStats('remove');

    await expect(analytics.getToolStats('remove')).resolves.toBeNull();
    expect((await analytics.getToolStats('keep'))?.totalCalls).toBe(1);
  });

  it('ranks tools by usage and failure count', async () => {
    await analytics.recordToolCall('busy', true, 10);
    await analytics.recordToolCall('busy', false, 20);
    await analytics.recordToolCall('quiet', false, 30);

    expect((await analytics.getMostUsedTools(1))[0].toolName).toBe('busy');
    expect((await analytics.getMostFailedTools(2)).map((item) => item.toolName)).toEqual(
      expect.arrayContaining(['busy', 'quiet']),
    );
  });
});
