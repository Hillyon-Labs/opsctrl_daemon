#!/usr/bin/env node


import * as dotenv from 'dotenv';
import * as path from 'path';

import { KubernetesPodWatchdog } from './core/watchdog';
import { WatchdogConfig } from './config/watchdog-config';
import { gracefulShutdown, printErrorAndExit, runHttpBasedHealthCheck, waitUntil } from './utils/utils';
import { ClusterRegistrationService } from './core/cluster-registration';



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
    
    // Handle cluster registration if configured
    const clusterConfig = config.getClusterRegistrationConfig();
    let registrationService: ClusterRegistrationService | null = null;
    
    if (clusterConfig.skipRegistration) {
      console.log('ℹ️  Cluster registration disabled (SKIP_CLUSTER_REGISTRATION=true)');
    } else {
      // Registration is required
      if (!clusterConfig.clusterName || !clusterConfig.userEmail) {
        printErrorAndExit('❌ Cluster registration is required but CLUSTER_NAME and/or USER_EMAIL environment variables are not set. Set SKIP_CLUSTER_REGISTRATION=true to disable registration requirement.', 1);
      }
      
      console.log('🔗 Cluster registration is required before starting monitoring...');
      
      registrationService = new ClusterRegistrationService({
        clusterName: clusterConfig.clusterName,
        userEmail: clusterConfig.userEmail,
        version: process.env.npm_package_version || '1.0.0',
        backendUrl: clusterConfig.backendUrl
      });

      // Wait until cluster is successfully registered
      console.log('⏳ Waiting for cluster registration to complete...');
      const clusterInfo = await waitUntil(
        async () => {
          try {
            const info = await registrationService!.ensureClusterRegistration();
            return info;
          } catch (error) {
            console.log(`🔄 Registration attempt failed: ${error}. Retrying...`);
            return undefined;
          }
        },
        300000, // 5 minutes timeout
        10000   // 10 second intervals
      );

      if (!clusterInfo) {
        printErrorAndExit('❌ Failed to register cluster within timeout period. Cannot proceed with monitoring.', 1);
      }

      console.log(`🎯 Cluster registered successfully: ${clusterInfo.cluster_id}`);
      
      // Set cluster ID as environment variable for use by watchdog
      process.env.CLUSTER_ID = clusterInfo.cluster_id;
    }
    
    console.log('🚀 Initializing monitoring system...');
    
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
      runHttpBasedHealthCheck(healthConfig, watchdog);
    }

    // Graceful shutdown handling
    process.on('SIGTERM', async () => await gracefulShutdown('SIGTERM', watchdog));
    process.on('SIGINT', async () => await gracefulShutdown('SIGINT', watchdog));

    // Keep the process running
    console.log('🔄 opsctrl-daemon is running. Press Ctrl+C to stop.');

  } catch (error) {
    printErrorAndExit(`💥 Failed to start opsctrl-daemon: ${error}`, 1);
  }
}

// Start the application
main().catch((error) => {
  printErrorAndExit(`💥 Unhandled error: ${error}`, 1);
});