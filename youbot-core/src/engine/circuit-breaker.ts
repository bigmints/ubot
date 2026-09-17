/**
 * Circuit Breaker for Tool Groups
 * 
 * Prevents cascading failures by tracking consecutive tool failures
 * and temporarily disabling a tool group after too many failures.
 * 
 * Usage:
 *   const breaker = new CircuitBreaker();
 *   if (breaker.isOpen('mcp_playwright_browser_')) return "Browser tools unavailable";
 *   const result = await executeToolCall(...);
 *   result.success ? breaker.recordSuccess('mcp_playwright_browser_') : breaker.recordFailure('mcp_playwright_browser_');
 */

import { log } from '../logger/ring-buffer.js';

interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null;  // timestamp when circuit opened
  lastFailure: string;       // last error message
}

const FAILURE_THRESHOLD = 3;
const RECOVERY_MS = 2 * 60 * 1000; // 2 minutes before allowing a test call

export class CircuitBreaker {
  private circuits: Map<string, CircuitState> = new Map();

  /**
   * Get the circuit prefix for a tool name
   * e.g. "mcp_playwright_browser_click" → "mcp_playwright_browser_"
   */
  private getPrefix(toolName: string): string | null {
    // Only circuit-break MCP tool groups
    if (toolName.startsWith('mcp_playwright_browser_')) return 'mcp_playwright_browser_';
    // Add more prefixes as needed
    return null;
  }

  private getState(prefix: string): CircuitState {
    if (!this.circuits.has(prefix)) {
      this.circuits.set(prefix, { consecutiveFailures: 0, openedAt: null, lastFailure: '' });
    }
    return this.circuits.get(prefix)!;
  }

  /**
   * Check if the circuit is open (tool calls should be blocked)
   * Returns error message if open, null if closed (allow call)
   */
  isOpen(toolName: string): string | null {
    const prefix = this.getPrefix(toolName);
    if (!prefix) return null;

    const state = this.getState(prefix);
    if (!state.openedAt) return null; // circuit is closed

    // Check if recovery period has elapsed — allow a test call
    const elapsed = Date.now() - state.openedAt;
    if (elapsed >= RECOVERY_MS) {
      log.info('CircuitBreaker', `${prefix} circuit allowing test call after ${Math.round(elapsed / 1000)}s recovery`);
      return null; // allow one test call through
    }

    return `Browser tools temporarily unavailable after ${FAILURE_THRESHOLD} consecutive failures (last error: ${state.lastFailure}). Will retry automatically in ${Math.round((RECOVERY_MS - elapsed) / 1000)}s.`;
  }

  /**
   * Record a successful tool call — closes the circuit
   */
  recordSuccess(toolName: string): void {
    const prefix = this.getPrefix(toolName);
    if (!prefix) return;

    const state = this.getState(prefix);
    if (state.openedAt) {
      log.info('CircuitBreaker', `${prefix} circuit CLOSED (recovered)`);
    }
    state.consecutiveFailures = 0;
    state.openedAt = null;
    state.lastFailure = '';
  }

  /**
   * Record a failed tool call — may open the circuit
   */
  recordFailure(toolName: string, error: string): void {
    const prefix = this.getPrefix(toolName);
    if (!prefix) return;

    const state = this.getState(prefix);
    state.consecutiveFailures++;
    state.lastFailure = error.slice(0, 200);

    if (state.consecutiveFailures >= FAILURE_THRESHOLD && !state.openedAt) {
      state.openedAt = Date.now();
      log.warn('CircuitBreaker', `${prefix} circuit OPENED after ${state.consecutiveFailures} consecutive failures`);
    }
  }
}

// Singleton instance
let instance: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!instance) {
    instance = new CircuitBreaker();
  }
  return instance;
}
