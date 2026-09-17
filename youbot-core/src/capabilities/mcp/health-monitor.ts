/**
 * Health Monitor for Chrome CDP and MCP infrastructure
 * 
 * Periodically checks that Chrome DevTools Protocol is responding,
 * which is required for Playwright browser automation.
 */

import http from 'http';
import { log } from '../../logger/ring-buffer.js';

interface HealthStatus {
  cdp: boolean;
  lastCheck: Date;
  consecutiveFailures: number;
}

const status: HealthStatus = {
  cdp: false,
  lastCheck: new Date(),
  consecutiveFailures: 0,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Check if Chrome CDP is responding on the given port
 */
function checkCDP(port: number = 9222): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          JSON.parse(data);
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Run a single health check cycle
 */
async function runHealthCheck(): Promise<void> {
  const cdpAlive = await checkCDP();
  status.lastCheck = new Date();

  if (cdpAlive) {
    if (!status.cdp) {
      // Recovered from failure
      log.info('Health', `✅ Chrome CDP recovered after ${status.consecutiveFailures} failures`);
    }
    status.cdp = true;
    status.consecutiveFailures = 0;
  } else {
    status.consecutiveFailures++;
    status.cdp = false;
    // Only log periodically to avoid spam (every 5th failure)
    if (status.consecutiveFailures === 1 || status.consecutiveFailures % 5 === 0) {
      log.warn('Health', `⚠️ Chrome CDP not responding on port 9222 (${status.consecutiveFailures} consecutive failures)`);
    }
  }
}

/**
 * Start the health monitor on a fixed interval
 * @param intervalMs Check interval in milliseconds (default: 60000 = 1 minute)
 */
export function startHealthMonitor(intervalMs: number = 60_000): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  // Run initial check immediately
  runHealthCheck().then(() => {
    if (status.cdp) {
      log.info('Health', `Chrome CDP health monitor started (checking every ${intervalMs / 1000}s) — CDP is UP`);
    } else {
      log.warn('Health', `Chrome CDP health monitor started (checking every ${intervalMs / 1000}s) — CDP is DOWN`);
    }
  });

  intervalHandle = setInterval(runHealthCheck, intervalMs);
}

/**
 * Stop the health monitor
 */
export function stopHealthMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Get the current health status
 */
export function getHealthStatus(): HealthStatus {
  return { ...status };
}
