#!/usr/bin/env node


import * as dotenv from 'dotenv';
import * as path from 'path';

import { KubernetesPodWatchdog } from './core/watchdog';
import { WatchdogConfig } from './config/watchdog-config';



const envFiles = [
  '.env.local',
  `.env.${process.env.NODE_ENV}`,
  '.env'
];

envFiles.forEach(file => {
  const envPath = path.resolve(process.cwd(), file);
  dotenv.config({ path: envPath });
});


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
    // Load and validate configuration from environment variables
    const config = WatchdogConfig.fromEnvironment();
    
    // Initialize the watchdog with configuration
    watchdog = new KubernetesPodWatchdog(config.toWatchdogConfiguration());

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
    const healthConfig = config.getHealthCheckConfig();
    if (healthConfig.enabled) {
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