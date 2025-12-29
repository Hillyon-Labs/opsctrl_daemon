import { exec } from 'child_process';

import { V1ContainerStatus } from '@kubernetes/client-node';

import chalk from 'chalk';
import { ContainerStatusSummary } from '../common/interfaces/containerStatus.interface';
import { SanitizedPodDiagnostics } from '../common/interfaces/sanitizedpod.interface';
import { KubernetesPodWatchdog } from '../core/watchdog';

/**
 * Repeatedly invokes `fn()` until it returns a truthy value or the timeout elapses.
 * @param fn        async function that returns a token or falsy
 * @param timeoutMs total time to keep trying (in ms)
 * @param intervalMs pause between attempts (in ms)
 */
export async function waitUntil<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  return undefined;
}

/**
 * Delays execution for the given number of milliseconds.
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * takes in a kubernetes container status and returns a summary of its state
 * ================================================================
 * @param container
 * @param type
 * @returns
 */
export function parseContainerState(
  container: V1ContainerStatus,
  type: 'init' | 'main',
): ContainerStatusSummary {
  const { name, state } = container;

  if (!state) {
    return { name, type, state: 'Unknown' };
  }

  if (state.waiting) {
    return {
      name,
      type,
      state: `Waiting: ${state.waiting.reason || 'Unknown'}`,
      reason: state.waiting.reason,
      message: state.waiting.message,
    };
  }

  if (state.terminated) {
    return {
      name,
      type,
      state: `Terminated: ${state.terminated.reason || 'Unknown'}`,
      reason: state.terminated.reason,
      message: state.terminated.message,
    };
  }

  if (state.running) {
    return { name, type, state: 'Running' };
  }

  return { name, type, state: 'Unknown' };
}

/**
 *
 * Logs detailed pod diagnostics to the console if needed.
 *
 * @param diagnosis
 */
export function verboseLogDiagnosis(diagnosis: SanitizedPodDiagnostics) {
  console.log(`\n${chalk.red('🚨 Pod Phase:')} ${diagnosis.phase}`);

  console.log(chalk.yellow('📦 Containers:'));
  for (const state of diagnosis.containerState) {
    console.log(`- [${state.type}] ${state.name}: ${state.state}`);
  }

  if (diagnosis.events.length) {
    console.log(chalk.cyan('\n🧾 Events:'));
    diagnosis.events.forEach((e) => console.log(`- ${e}`));
  }

  if (diagnosis.recentLogs.length) {
    console.log(chalk.green('\n📜 Logs (Sanitized):'));
    diagnosis.recentLogs.slice(0, 15).forEach((line) => console.log(line));
  }
}

export function printErrorAndExit(message: string, exitCode = 1): never {
  console.error(`\n ${chalk.red('❌ Error:')} ${message}`);
  process.exit(exitCode);
}

/**
 *
 * Opens the provided URL in the default web browser accroos all platforms.
 * Uses `open` command on macOS, `start` on Windows, and `xdg-open` on Linux.
 * @param url - The URL to open
 */
export function openBrowser(url: string) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}


export function runHttpBasedHealthCheck(healthConfig: any, watchdog: KubernetesPodWatchdog) {
  const http = require('http');
      const server = http.createServer((req: any, res: any) => {
        if (req.url === '/health') {
          const health = watchdog.getHealthStatus();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(health));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
      
      server.listen(healthConfig.port, () => {
        console.log(`🏥 Health check server listening on port ${healthConfig.port}`);
      });
}


export async function gracefulShutdown(signal: string, watchdog: KubernetesPodWatchdog) {
      console.log(`📡 Received ${signal}, initiating graceful shutdown...`);
      try {
        if (watchdog) {
          await watchdog.stopMonitoring();
        }
        process.exit(0);
      } catch (error) {
        printErrorAndExit(`❌ Error during shutdown: ${error}`, 1);
      }
};