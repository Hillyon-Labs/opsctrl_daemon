import { KubernetesPodWatchdog } from './watchdog';

/**
 * Main entry point for the opsctrl-daemon.
 * 
 * This file demonstrates how to use the KubernetesPodWatchdog in a production environment.
 * It includes proper configuration, error handling, and graceful shutdown procedures.
 */
async function main(): Promise<void> {
  console.log('🚀 Starting opsctrl-daemon...');
  
  // Create watchdog with production-ready configuration
  const watchdog = new KubernetesPodWatchdog({
    // Target specific namespaces (comment out to monitor all)
    // targetNamespaces: ['production', 'staging', 'development'],
    
    // Exclude system namespaces by default
    excludedNamespaces: [
      'kube-system', 
      'kube-public', 
      'kube-node-lease',
      'istio-system',
      'monitoring'
    ],
    
    // Configure failure detection thresholds
    failureThresholds: {
      restartCount: 3,                    // Alert after 3 restarts
      pendingTimeoutMinutes: 10,          // Alert if pending > 10 minutes
      consecutiveFailures: 2,             // Escalate after 2 consecutive failures
      restartRateWindowMinutes: 15        // Measure restart rate over 15 minutes
    },
    
    // Configure automated diagnosis
    diagnostics: {
      enabled: true,                      // Enable automated diagnosis
      cacheExpirationMinutes: 5,          // Cache diagnosis results for 5 minutes
      timeoutSeconds: 30,                 // Timeout diagnosis after 30 seconds
      allowParallelExecution: false,      // Run diagnoses sequentially
      maxConcurrentDiagnoses: 3           // Max 3 concurrent diagnosis processes
    },
    
    // Configure alerting
    alerting: {
      webhookUrl: process.env.WEBHOOK_URL,  // Set via environment variable
      severityFilter: ['medium', 'high', 'critical'],  // Only alert on these severities
      rateLimitWindowMinutes: 5,          // Rate limit duplicate alerts
      includeFullManifests: false,        // Don't include full pod manifests (for brevity)
      customTemplate: undefined           // Use default alert template
    },
    
    // Configure watch behavior
    watchBehavior: {
      reconnectionDelaySeconds: 5,        // Wait 5s before reconnecting
      maxReconnectionAttempts: 10,        // Try reconnecting up to 10 times
      resyncIntervalMinutes: 30,          // Resync every 30 minutes
      enableEventBuffering: true,         // Buffer events during reconnection
      maxBufferedEvents: 1000             // Buffer up to 1000 events
    }
  });
  
  // Set up event listeners for comprehensive monitoring
  
  // Listen for pod failures - this is the main event you'll want to handle
  watchdog.on('podFailure', (failure) => {
    console.log(`🚨 CRITICAL: Pod failure detected!`);
    console.log(`   Namespace: ${failure.namespace}`);
    console.log(`   Pod: ${failure.pod.metadata?.name}`);
    console.log(`   Reason: ${failure.reason}`);
    console.log(`   Severity: ${failure.severity}`);
    console.log(`   Pattern: ${failure.failurePattern}`);
    console.log(`   Failure ID: ${failure.failureId}`);
    
    if ((failure as any).previousDiagnosis) {
      console.log(`   Diagnosis: ${(failure as any).previousDiagnosis}`);
    }
    
    // Here you could integrate with your incident management system
    // await createIncident(failure);
    // await notifyOnCallEngineer(failure);
    // await triggerAutomaticRemediation(failure);
  });
  
  // Listen for watchdog errors to monitor the health of the monitoring system itself
  watchdog.on('watchdogError', (error) => {
    console.error(`⚠️  Watchdog error in phase ${error.phase}:`, error);
    
    // You might want to alert on watchdog failures too
    // await alertOnWatchdogFailure(error);
  });
  
  // Listen for successful startup
  watchdog.on('watchdogStarted', (info) => {
    console.log(`✅ Watchdog started successfully!`);
    console.log(`   Target namespaces: ${info.targetNamespaces}`);
    console.log(`   Successful connections: ${info.successfulConnections}`);
    console.log(`   Startup duration: ${info.startupDuration}ms`);
  });
  
  // Listen for shutdown
  watchdog.on('watchdogStopped', (info) => {
    console.log(`🛑 Watchdog stopped after ${Math.round(info.operationDuration / 1000)}s of operation`);
  });
  
  // Listen for maintenance activities (optional, for debugging)
  watchdog.on('maintenanceComplete', (stats) => {
    if (stats.activeConnections > 0) {
      console.log(`🧹 Maintenance: ${stats.activeConnections} active connections, ${stats.cachedDiagnoses} cached diagnoses`);
    }
  });
  
  // Listen for diagnosis completion (optional, for monitoring diagnosis performance)
  watchdog.on('diagnosticsComplete', (result) => {
    console.log(`🔍 Diagnosis completed for ${result.podName} in ${result.namespace}`);
  });
  
  // Set up graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n📡 Received ${signal}, initiating graceful shutdown...`);
    
    try {
      await watchdog.stopMonitoring();
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  // Handle various shutdown signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Ctrl+C
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Docker/K8s termination
  process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT')); // Quit signal
  
  // Handle uncaught errors gracefully
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
  });
  
  try {
    // Start the watchdog
    await watchdog.startMonitoring();

    console.log('🎯 opsctrl-daemon is now monitoring your Kubernetes cluster');
    console.log('   Press Ctrl+C to stop gracefully');
    
    // Keep the process alive
    const keepAlive = () => {
      setTimeout(keepAlive, 1000);
    };
    keepAlive();
    
  } catch (error) {
    console.error('❌ Failed to start opsctrl-daemon:', error);
    process.exit(1);
  }
}

// Start the daemon
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
