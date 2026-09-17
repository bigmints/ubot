/**
 * Loop Detector
 *
 * Detects when the agent gets stuck repeating the same tool calls.
 * Three detection strategies:
 *   1. genericRepeat: same tool + same args called N times in a row
 *   2. pingPong: alternating A→B→A→B pattern with identical results
 *   3. noProgress: identical tool results N times
 *
 * Used by the orchestrator to break infinite loops.
 */

export interface LoopDetection {
  shouldStop: boolean;
  reason: string;
  severity: 'warning' | 'critical';
}

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  resultHash: string | null;
}

export class LoopDetector {
  private history: ToolCallRecord[] = [];
  private readonly historySize: number;
  private readonly warningThreshold: number;
  private readonly criticalThreshold: number;

  constructor(opts?: {
    historySize?: number;
    warningThreshold?: number;
    criticalThreshold?: number;
  }) {
    this.historySize = opts?.historySize ?? 30;
    this.warningThreshold = opts?.warningThreshold ?? 2;
    this.criticalThreshold = opts?.criticalThreshold ?? 3;
  }

  /**
   * Record a tool call and check for loops.
   */
  record(toolName: string, args: Record<string, unknown>, result?: string): LoopDetection {
    const argsHash = this.hash(JSON.stringify(args));
    const resultHash = result ? this.hash(result) : null;

    this.history.push({ toolName, argsHash, resultHash });
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    return this.detect();
  }

  private detect(): LoopDetection {
    const noLoop: LoopDetection = { shouldStop: false, reason: '', severity: 'warning' };

    // 1. genericRepeat: same tool + same args N times in a row
    const repeatCheck = this.checkGenericRepeat();
    if (repeatCheck.shouldStop) return repeatCheck;

    // 2. pingPong: A→B→A→B pattern
    const pingPongCheck = this.checkPingPong();
    if (pingPongCheck.shouldStop) return pingPongCheck;

    // 3. noProgress: identical results N times
    const progressCheck = this.checkNoProgress();
    if (progressCheck.shouldStop) return progressCheck;

    return noLoop;
  }

  private checkGenericRepeat(): LoopDetection {
    if (this.history.length < this.warningThreshold) {
      return { shouldStop: false, reason: '', severity: 'warning' };
    }

    const last = this.history[this.history.length - 1];
    let count = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.toolName === last.toolName && h.argsHash === last.argsHash) {
        count++;
      } else {
        break;
      }
    }

    if (count >= this.criticalThreshold) {
      return {
        shouldStop: true,
        reason: `Tool "${last.toolName}" called ${count} times in a row with identical arguments. This appears to be an infinite loop.`,
        severity: 'critical',
      };
    }

    if (count >= this.warningThreshold) {
      return {
        shouldStop: true,
        reason: `Tool "${last.toolName}" called ${count} times with the same arguments. Stopping to avoid a loop.`,
        severity: 'warning',
      };
    }

    // Special case: browser_snapshot is expensive (DOM dumps).
    // If it's been called 2+ times in a row let the LLM know to stop over-snapshotting.
    if (last.toolName.includes('browser_snapshot') || last.toolName.includes('browser_get_snapshot')) {
      if (count >= 2) {
        return {
          shouldStop: true,
          reason: `Tool "${last.toolName}" called ${count} times consecutively. Snapshots are expensive — only take one after each user action, not repeatedly.`,
          severity: 'warning',
        };
      }
    }

    return { shouldStop: false, reason: '', severity: 'warning' };
  }

  private checkPingPong(): LoopDetection {
    if (this.history.length < 4) {
      return { shouldStop: false, reason: '', severity: 'warning' };
    }

    // Check last 6 entries for A-B-A-B-A-B pattern
    const window = this.history.slice(-6);
    if (window.length < 4) return { shouldStop: false, reason: '', severity: 'warning' };

    const a = window[window.length - 2];
    const b = window[window.length - 1];
    if (a.toolName === b.toolName) return { shouldStop: false, reason: '', severity: 'warning' };

    let alternating = 0;
    for (let i = window.length - 1; i >= 1; i -= 2) {
      const cur = window[i];
      const prev = window[i - 1];
      if (cur.toolName === b.toolName && cur.argsHash === b.argsHash &&
          prev.toolName === a.toolName && prev.argsHash === a.argsHash) {
        alternating++;
      } else {
        break;
      }
    }

    if (alternating >= 2) {
      return {
        shouldStop: true,
        reason: `Ping-pong loop detected: alternating between "${a.toolName}" and "${b.toolName}" with no progress.`,
        severity: 'critical',
      };
    }

    return { shouldStop: false, reason: '', severity: 'warning' };
  }

  private checkNoProgress(): LoopDetection {
    if (this.history.length < this.warningThreshold) {
      return { shouldStop: false, reason: '', severity: 'warning' };
    }

    // Check if last N results are all identical
    const recent = this.history.slice(-this.criticalThreshold);
    if (recent.length < this.criticalThreshold) return { shouldStop: false, reason: '', severity: 'warning' };

    const firstResult = recent[0].resultHash;
    if (!firstResult) return { shouldStop: false, reason: '', severity: 'warning' };

    const allSame = recent.every(r => r.resultHash === firstResult);
    if (allSame) {
      return {
        shouldStop: true,
        reason: `Last ${recent.length} tool calls returned identical results. No progress being made.`,
        severity: 'critical',
      };
    }

    return { shouldStop: false, reason: '', severity: 'warning' };
  }

  /** Simple string hash for comparison */
  private hash(str: string): string {
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 2000); i++) {
      const ch = str.charCodeAt(i);
      h = ((h << 5) - h) + ch;
      h |= 0;
    }
    return h.toString(36);
  }
}
