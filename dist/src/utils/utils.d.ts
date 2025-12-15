import { V1ContainerStatus } from '@kubernetes/client-node';
import { ContainerStatusSummary } from '../common/interfaces/containerStatus.interface';
import { SanitizedPodDiagnostics } from '../common/interfaces/sanitizedpod.interface';
import { KubernetesPodWatchdog } from '../core/watchdog';
/**
 * Repeatedly invokes `fn()` until it returns a truthy value or the timeout elapses.
 * @param fn        async function that returns a token or falsy
 * @param timeoutMs total time to keep trying (in ms)
 * @param intervalMs pause between attempts (in ms)
 */
export declare function waitUntil<T>(fn: () => Promise<T | undefined>, timeoutMs: number, intervalMs: number): Promise<T | undefined>;
/**
 * Delays execution for the given number of milliseconds.
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after delay
 */
export declare function delay(ms: number): Promise<void>;
/**
 * takes in a kubernetes container status and returns a summary of its state
 * ================================================================
 * @param container
 * @param type
 * @returns
 */
export declare function parseContainerState(container: V1ContainerStatus, type: 'init' | 'main'): ContainerStatusSummary;
/**
 *
 * Logs detailed pod diagnostics to the console if needed.
 *
 * @param diagnosis
 */
export declare function verboseLogDiagnosis(diagnosis: SanitizedPodDiagnostics): void;
export declare function printErrorAndExit(message: string, exitCode?: number): never;
/**
 *
 * Opens the provided URL in the default web browser accroos all platforms.
 * Uses `open` command on macOS, `start` on Windows, and `xdg-open` on Linux.
 * @param url - The URL to open
 */
export declare function openBrowser(url: string): void;
export declare function runHttpBasedHealthCheck(healthConfig: any, watchdog: KubernetesPodWatchdog): void;
export declare function gracefulShutdown(signal: string, watchdog: KubernetesPodWatchdog): Promise<void>;
//# sourceMappingURL=utils.d.ts.map