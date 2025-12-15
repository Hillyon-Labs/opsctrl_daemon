"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitUntil = waitUntil;
exports.delay = delay;
exports.parseContainerState = parseContainerState;
exports.verboseLogDiagnosis = verboseLogDiagnosis;
exports.printErrorAndExit = printErrorAndExit;
exports.openBrowser = openBrowser;
exports.runHttpBasedHealthCheck = runHttpBasedHealthCheck;
exports.gracefulShutdown = gracefulShutdown;
const child_process_1 = require("child_process");
const chalk_1 = __importDefault(require("chalk"));
/**
 * Repeatedly invokes `fn()` until it returns a truthy value or the timeout elapses.
 * @param fn        async function that returns a token or falsy
 * @param timeoutMs total time to keep trying (in ms)
 * @param intervalMs pause between attempts (in ms)
 */
async function waitUntil(fn, timeoutMs, intervalMs) {
    const deadline = Date.now() + timeoutMs;
    do {
        const result = await fn();
        if (result)
            return result;
        await new Promise((r) => setTimeout(r, intervalMs));
    } while (Date.now() < deadline);
    return undefined;
}
/**
 * Delays execution for the given number of milliseconds.
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after delay
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * takes in a kubernetes container status and returns a summary of its state
 * ================================================================
 * @param container
 * @param type
 * @returns
 */
function parseContainerState(container, type) {
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
        };
    }
    if (state.terminated) {
        return {
            name,
            type,
            state: `Terminated: ${state.terminated.reason || 'Unknown'}`,
            reason: state.terminated.reason,
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
function verboseLogDiagnosis(diagnosis) {
    console.log(`\n${chalk_1.default.red('🚨 Pod Phase:')} ${diagnosis.phase}`);
    console.log(chalk_1.default.yellow('📦 Containers:'));
    for (const state of diagnosis.containerState) {
        console.log(`- [${state.type}] ${state.name}: ${state.state}`);
    }
    if (diagnosis.events.length) {
        console.log(chalk_1.default.cyan('\n🧾 Events:'));
        diagnosis.events.forEach((e) => console.log(`- ${e}`));
    }
    if (diagnosis.recentLogs.length) {
        console.log(chalk_1.default.green('\n📜 Logs (Sanitized):'));
        diagnosis.recentLogs.slice(0, 15).forEach((line) => console.log(line));
    }
}
function printErrorAndExit(message, exitCode = 1) {
    console.error(`\n ${chalk_1.default.red('❌ Error:')} ${message}`);
    process.exit(exitCode);
}
/**
 *
 * Opens the provided URL in the default web browser accroos all platforms.
 * Uses `open` command on macOS, `start` on Windows, and `xdg-open` on Linux.
 * @param url - The URL to open
 */
function openBrowser(url) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    (0, child_process_1.exec)(`${cmd} "${url}"`);
}
function runHttpBasedHealthCheck(healthConfig, watchdog) {
    const http = require('http');
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            const health = watchdog.getHealthStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
        }
        else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
    server.listen(healthConfig.port, () => {
        console.log(`🏥 Health check server listening on port ${healthConfig.port}`);
    });
}
async function gracefulShutdown(signal, watchdog) {
    console.log(`📡 Received ${signal}, initiating graceful shutdown...`);
    try {
        if (watchdog) {
            await watchdog.stopMonitoring();
        }
        process.exit(0);
    }
    catch (error) {
        printErrorAndExit(`❌ Error during shutdown: ${error}`, 1);
    }
}
;
//# sourceMappingURL=utils.js.map