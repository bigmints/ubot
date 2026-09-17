/**
 * Tool Analytics System
 * Collects and tracks tool usage statistics for monitoring and optimization
 */

export interface ToolUsageStats {
	toolName: string;
	totalCalls: number;
	successfulCalls: number;
	failedCalls: number;
	averageDuration: number;
	lastUsed: Date;
	errorRate: number;
}

export interface ToolAnalytics {
	recordToolCall(
		toolName: string,
		success: boolean,
		duration: number,
		error?: string,
	): Promise<void>;
	getToolStats(toolName: string): Promise<ToolUsageStats | null>;
	getAllToolStats(): Promise<ToolUsageStats[]>;
	resetToolStats(toolName: string): Promise<void>;
	getMostUsedTools(limit?: number): Promise<ToolUsageStats[]>;
	getMostFailedTools(limit?: number): Promise<ToolUsageStats[]>;
}

export function createToolAnalytics(): ToolAnalytics {
	// In-memory storage for tool stats (will be lost on restart)
	const toolStats: Record<string, ToolUsageStats> = {};

	return {
		async recordToolCall(
			toolName: string,
			success: boolean,
			duration: number,
			_error?: string,
		): Promise<void> {
			try {
				if (!toolStats[toolName]) {
					toolStats[toolName] = {
						toolName,
						totalCalls: 0,
						successfulCalls: 0,
						failedCalls: 0,
						averageDuration: 0,
						lastUsed: new Date(),
						errorRate: 0,
					};
				}

				const stats = toolStats[toolName];
				stats.totalCalls++;
				stats.lastUsed = new Date();

				if (success) {
					stats.successfulCalls++;
				} else {
					stats.failedCalls++;
				}

				// Update average duration
				stats.averageDuration =
					(stats.averageDuration * (stats.totalCalls - 1) + duration) /
					stats.totalCalls;

				// Update error rate
				stats.errorRate =
					stats.totalCalls > 0
						? (stats.failedCalls / stats.totalCalls) * 100
						: 0;
			} catch (err: any) {
				console.error(
					`[ToolAnalytics] Failed to record tool call for ${toolName}:`,
					err.message,
				);
			}
		},

		async getToolStats(toolName: string): Promise<ToolUsageStats | null> {
			try {
				const stats = toolStats[toolName];
				return stats ? { ...stats } : null;
			} catch (err: any) {
				console.error(
					`[ToolAnalytics] Failed to get stats for ${toolName}:`,
					err.message,
				);
				return null;
			}
		},

		async getAllToolStats(): Promise<ToolUsageStats[]> {
			try {
				return Object.values(toolStats);
			} catch (err: any) {
				console.error("[ToolAnalytics] Failed to get all stats:", err.message);
				return [];
			}
		},

		async resetToolStats(toolName: string): Promise<void> {
			try {
				delete toolStats[toolName];
			} catch (err: any) {
				console.error(
					`[ToolAnalytics] Failed to reset stats for ${toolName}:`,
					err.message,
				);
			}
		},

		async getMostUsedTools(limit: number = 10): Promise<ToolUsageStats[]> {
			try {
				return Object.values(toolStats)
					.sort((a, b) => b.totalCalls - a.totalCalls)
					.slice(0, limit);
			} catch (err: any) {
				console.error(
					"[ToolAnalytics] Failed to get most used tools:",
					err.message,
				);
				return [];
			}
		},

		async getMostFailedTools(limit: number = 10): Promise<ToolUsageStats[]> {
			try {
				return Object.values(toolStats)
					.sort((a, b) => b.failedCalls - a.failedCalls)
					.slice(0, limit);
			} catch (err: any) {
				console.error(
					"[ToolAnalytics] Failed to get most failed tools:",
					err.message,
				);
				return [];
			}
		},
	};
}
