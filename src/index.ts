#!/usr/bin/env node

/**
 * Main entry point for the opsctrl-daemon
 * Kubernetes Pod Monitoring and Failure Detection Daemon
 */

// Load environment variables from .env files
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables in order of preference
// 1. .env.local (local overrides, not committed)
// 2. .env.{NODE_ENV} (environment-specific)
// 3. .env (default configuration)
const envFiles = [
  '.env.local',
  `.env.${process.env.NODE_ENV}`,
  '.env'
];

envFiles.forEach(file => {
  const envPath = path.resolve(process.cwd(), file);
  dotenv.config({ path: envPath });
});

import { KubernetesPodWatchdog } from './core/watchdog';
import { WatchdogConfiguration } from './common/interfaces/watchdog.interfaces';

// Configuration from environment variables
const config: Partial<WatchdogConfiguration> = {
  monitoring: {
    namespaces: process.env.WATCH_NAMESPACES?.split(','),
    excludeNamespaces: process.env.EXCLUDE_NAMESPACES?.split(',') || ['kube-system', 'kube-public', 'kube-node-lease'],
    failureDetection: {
      minRestartThreshold: parseInt(process.env.MIN_RESTART_THRESHOLD || '3'),
      maxPendingDurationMs: parseInt(process.env.MAX_PENDING_DURATION_MS || '600000'),
      enableCrashLoopDetection: process.env.ENABLE_CRASH_LOOP_DETECTION !== 'false',
      enableImagePullFailureDetection: process.env.ENABLE_IMAGE_PULL_FAILURE_DETECTION !== 'false',
      enableResourceLimitDetection: process.env.ENABLE_RESOURCE_LIMIT_DETECTION !== 'false'
    }
  },
  diagnosis: {
    enabled: process.env.DIAGNOSIS_ENABLED !== 'false',
    timeoutMs: parseInt(process.env.DIAGNOSIS_TIMEOUT_MS || '30000'),
    cacheConfig: {
      ttlMs: parseInt(process.env.DIAGNOSIS_CACHE_TTL_MS || '300000'),
      maxEntries: parseInt(process.env.DIAGNOSIS_CACHE_MAX_ENTRIES || '1000')
    },
    opsctrlIntegration: {
      command: process.env.OPSCTRL_COMMAND || 'npm',
      args: process.env.OPSCTRL_ARGS?.split(' ') || ['run', 'dev', '--', 'diagnose'],
      workingDirectory: process.env.OPSCTRL_WORKING_DIR || process.cwd()
    }
  },
  alerting: {
    webhookUrl: process.env.WEBHOOK_URL,
    retryPolicy: {
      maxAttempts: parseInt(process.env.ALERT_MAX_ATTEMPTS || '3'),
      backoffMs: parseInt(process.env.ALERT_BACKOFF_MS || '1000'),
      maxBackoffMs: parseInt(process.env.ALERT_MAX_BACKOFF_MS || '30000')
    },
    severityFilters: (process.env.ALERT_SEVERITY_FILTERS?.split(',') as any) || ['medium', 'high', 'critical'],
    rateLimitWindowMinutes: parseInt(process.env.ALERT_RATE_LIMIT_WINDOW_MINUTES || '0'),
    includeFullManifests: process.env.INCLUDE_FULL_MANIFESTS === 'true'
  },
  resilience: {
    reconnectionPolicy: {
      enabled: process.env.RECONNECTION_ENABLED !== 'false',
      initialBackoffMs: parseInt(process.env.RECONNECTION_INITIAL_BACKOFF_MS || '1000'),
      maxBackoffMs: parseInt(process.env.RECONNECTION_MAX_BACKOFF_MS || '30000'),
      backoffMultiplier: parseFloat(process.env.RECONNECTION_BACKOFF_MULTIPLIER || '2'),
      maxConsecutiveFailures: parseInt(process.env.RECONNECTION_MAX_FAILURES || '5')
    }
  }
};

async function main() {
  console.log('🚀 Starting opsctrl-daemon...');
  console.log(`📦 Version: ${process.env.npm_package_version || 'unknown'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Log DaemonSet information if running in Kubernetes
  if (process.env.NODE_NAME) {
    console.log(`🏷️  Node: ${process.env.NODE_NAME}`);
    console.log(`📦 Pod: ${process.env.POD_NAME || 'unknown'}`);
    console.log(`📂 Namespace: ${process.env.POD_NAMESPACE || 'default'}`);
    console.log(`🔄 DaemonSet Mode: ${process.env.DAEMONSET_MODE === 'true' ? 'enabled' : 'disabled'}`);
  }

  let watchdog: KubernetesPodWatchdog;

  try {
    // Initialize the watchdog with configuration
    watchdog = new KubernetesPodWatchdog(config);

    // Set up event listeners
    watchdog.on('podFailure', (failureEvent) => {
      const nodeInfo = process.env.NODE_NAME ? ` [Node: ${process.env.NODE_NAME}]` : '';
      console.log(`🚨 Pod failure detected: ${failureEvent.metadata.podName} in ${failureEvent.metadata.namespace}${nodeInfo}`);
      console.log(`   Severity: ${failureEvent.failure.severity}`);
      console.log(`   Pattern: ${failureEvent.failure.pattern}`);
      console.log(`   Reason: ${failureEvent.failure.reason}`);
    });

    watchdog.on('monitoringStarted', (event) => {
      console.log(`✅ Monitoring started for ${event.namespacesMonitored} namespaces`);
    });

    watchdog.on('monitoringStopped', (event) => {
      console.log(`🛑 Monitoring stopped. Total failures detected: ${event.metrics.totalFailuresDetected}`);
    });

    watchdog.on('error', (error) => {
      console.error('❌ Watchdog error:', error);
    });

    // Initialize and start monitoring
    await watchdog.initialize();
    await watchdog.startMonitoring();

    // Health check endpoint (simple HTTP server)
    if (process.env.ENABLE_HEALTH_CHECK === 'true') {
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
      
      const port = process.env.HEALTH_CHECK_PORT || 3000;
      server.listen(port, () => {
        console.log(`🏥 Health check server listening on port ${port}`);
      });
    }

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`📡 Received ${signal}, initiating graceful shutdown...`);
      try {
        if (watchdog) {
          await watchdog.stopMonitoring();
        }
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Keep the process running
    console.log('🔄 opsctrl-daemon is running. Press Ctrl+C to stop.');

  } catch (error) {
    console.error('💥 Failed to start opsctrl-daemon:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});