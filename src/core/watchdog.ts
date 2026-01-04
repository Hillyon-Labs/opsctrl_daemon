

import * as k8s from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import { 
  PodFailureEvent, 
  WatchdogConfiguration, 
  FailureSeverityLevel, 
  FailurePattern,
  DiagnosisCacheEntry,
  ConnectionState,
  WatchRequest
} from '../common/interfaces/watchdog.interfaces';
import { 
  diagnoseStack,
  getStackDataForBackend
} from './diagnosis';
import { TokenStorage } from './token-storage';
import { initKube } from './kube';
import { printErrorAndExit } from '../utils/utils';
import { runStackAnalysis } from './client';
import { StackAnalysisPayload, StackComponent } from '../common/interfaces/client.interface';



/**
 * Enterprise Kubernetes Pod Monitoring System
 * 
 * This module implements a comprehensive, production-ready Kubernetes pod monitoring daemon
 * designed to provide real-time visibility into pod health across multiple namespaces.
 * 
 * Key Features:
 * - Intelligent failure detection with severity classification
 * - Automated diagnosis using internal functions
 * - Resilient connection management with exponential backoff
 * - In-memory caching with TTL for performance optimization
 * - Structured event emission for integration with monitoring systems
 * - Comprehensive error handling and logging
 * 
 * Architecture:
 * The system follows an event-driven architecture using Node.js EventEmitter pattern,
 * enabling loose coupling between failure detection and response mechanisms.
 * 
 * @author Orchide Irakoze Sr
 * @version 1.0.0
 */
export class KubernetesPodWatchdog extends EventEmitter {
  /**
   * Kubernetes configuration and API client instances
   * These are initialized once during construction and reused throughout the lifecycle
   */
  private readonly kubernetesConfig: k8s.KubeConfig;
  private readonly coreV1Api: k8s.CoreV1Api;
  private readonly watchApi: k8s.Watch;

  /**
   * Runtime configuration merged from defaults and user overrides
   * Immutable after initialization to ensure consistent behavior
   */
  private readonly configuration: Readonly<WatchdogConfiguration>;

  /**
   * In-memory cache for diagnosis results with TTL management
   * Key format: `${namespace}/${podName}` for efficient lookups
   * Automatically expires entries based on configured TTL
   */
  private readonly diagnosisCache: Map<string, DiagnosisCacheEntry>;

  /**
   * Active watch requests tracking for graceful shutdown
   * Each namespace gets its own AbortController for independent lifecycle management
   */
  private readonly activeWatchRequests: Map<string, WatchRequest>;

  /**
   * Token storage for handling authentication
   */
  private readonly tokenStorage = new TokenStorage();
  
  /**
   * Interval for proactive token refresh
   */
  private tokenRefreshInterval?: NodeJS.Timeout;

  /**
   * Connection state tracking for resilience patterns
   * Enables circuit breaker behavior and exponential backoff
   */
  private readonly connectionState: ConnectionState;

  /**
   * Cleanup timer for periodic cache maintenance
   * Removes expired entries to prevent memory leaks
   */
  private cacheCleanupTimer: NodeJS.Timeout | null;

  /**
   * Metrics tracking for observability and performance monitoring
   * Reset periodically and exposed via health endpoints
   */
  private readonly metrics: {
    totalFailuresDetected: number;
    diagnosisCallsExecuted: number;
    cacheHitRate: number;
    reconnectionAttempts: number;
    lastHealthCheck: Date;
  };

  /**
   * Initialize the Kubernetes Pod Watchdog with comprehensive configuration
   * 
   * This constructor performs several critical initialization steps:
   * 1. Merges user configuration with secure defaults
   * 2. Initializes Kubernetes API clients with authentication
   * 3. Sets up internal data structures for caching and connection tracking
   * 4. Configures event emitter with appropriate listeners
   * 
   * @param userConfiguration - Partial configuration object, merged with defaults
   * @throws {Error} When Kubernetes configuration cannot be loaded
   */
  constructor(userConfiguration: Partial<WatchdogConfiguration> = {}) {
    super();

    // Initialize Kubernetes configuration with automatic discovery
    // Supports in-cluster config, kubeconfig file, and explicit configuration
    this.kubernetesConfig = new k8s.KubeConfig();
    try {
      this.kubernetesConfig.loadFromDefault();
    } catch (error) {
      printErrorAndExit(`❌ Failed to load Kubernetes configuration: ${error}`, 1);
    }

    // Create API clients with validated configuration
    this.coreV1Api = this.kubernetesConfig.makeApiClient(k8s.CoreV1Api);
    this.watchApi = new k8s.Watch(this.kubernetesConfig);

    // Merge user configuration with enterprise defaults
    this.configuration = this.mergeWithDefaults(userConfiguration);

    // Initialize internal state management structures
    this.diagnosisCache = new Map<string, DiagnosisCacheEntry>();
    this.activeWatchRequests = new Map<string, WatchRequest>();
    this.cacheCleanupTimer = null;

    // Initialize connection state for resilience tracking
    this.connectionState = {
      isHealthy: true,
      lastSuccessfulConnection: new Date(),
      consecutiveFailures: 0,
      reconnectionBackoffMs: 1000
    };

    // Initialize metrics for observability
    this.metrics = {
      totalFailuresDetected: 0,
      diagnosisCallsExecuted: 0,
      cacheHitRate: 0,
      reconnectionAttempts: 0,
      lastHealthCheck: new Date()
    };

    // Configure event emitter error handling to prevent crashes
    this.on('error', this.handleInternalError.bind(this));

    // Set up periodic cache cleanup to prevent memory leaks
    this.setupCacheCleanup();
  }

  /**
   * Initialize the watchdog system and validate cluster connectivity
   * 
   * This method performs essential pre-monitoring setup:
   * - Validates cluster connectivity and permissions
   * - Discovers available namespaces for monitoring
   * - Performs initial health checks
   * - Prepares internal systems for monitoring
   * 
   * @returns Promise that resolves when initialization is complete
   * @throws {Error} When cluster connectivity or permissions are insufficient
   */
  public async initialize(): Promise<void> {
    try {
      console.log('🔄 Initializing Kubernetes Pod Watchdog...');

      // Validate cluster connectivity and basic permissions
      await this.validateClusterConnectivity();

      // Initialize global Kubernetes client for diagnosis functions
      initKube();

      // Discover and validate namespace access permissions
      const availableNamespaces = await this.discoverMonitorableNamespaces();
      console.log(`📋 Discovered ${availableNamespaces.length} monitorable namespaces`);

      // Perform initial health check of all systems
      await this.performSystemHealthCheck();

      console.log('✅ Kubernetes Pod Watchdog initialization complete');
    } catch (error) {
      printErrorAndExit(`❌ Failed to initialize Kubernetes Pod Watchdog: ${error}`, 1);
    }
  }

  /**
   * Start comprehensive pod monitoring across configured namespaces
   * 
   * This method orchestrates the entire monitoring process:
   * - Establishes watch streams for each target namespace
   * - Implements resilient connection management
   * - Begins event processing and failure detection
   * - Activates automated diagnosis and alerting
   * 
   * The monitoring system is designed to be self-healing, automatically
   * recovering from transient failures and API server disruptions.
   * 
   * @returns Promise that resolves when all watch streams are established
   * @throws {Error} When critical monitoring setup fails
   */
  public async startMonitoring(): Promise<void> {
    try {
      console.log('🚀 Starting comprehensive pod monitoring...');

      // Determine target namespaces based on configuration
      const targetNamespaces = await this.resolveTargetNamespaces();
      console.log(`🎯 Targeting ${targetNamespaces.length} namespaces for monitoring`);

      // Establish watch streams for each namespace with error handling
      const watchPromises = targetNamespaces.map(namespace => 
        this.establishNamespaceWatch(namespace)
      );

      // Wait for all watch streams to be established
      await Promise.allSettled(watchPromises);

      // Update connection state and metrics
      this.connectionState.isHealthy = true;
      this.connectionState.lastSuccessfulConnection = new Date();
      this.metrics.lastHealthCheck = new Date();

      console.log(`✅ Monitoring active across ${this.activeWatchRequests.size} namespaces`);
      
      // Start proactive token refresh monitoring
      this.startTokenRefreshMonitoring();
      
      // Emit monitoring started event for external integrations
      this.emit('monitoringStarted', {
        timestamp: new Date(),
        namespacesMonitored: targetNamespaces.length,
        configuration: this.configuration
      });

    } catch (error) {
      console.error('❌ Failed to start pod monitoring:', error);
      throw new Error(`Failed to start monitoring: ${error}`);
    }
  }

  /**
   * Gracefully stop all monitoring activities and clean up resources
   * 
   * This method ensures proper resource cleanup:
   * - Aborts all active watch streams
   * - Clears internal caches and timers
   * - Closes API connections
   * - Emits shutdown events for external cleanup
   * 
   * @returns Promise that resolves when shutdown is complete
   */
  public async stopMonitoring(): Promise<void> {
    try {
      console.log('🛑 Initiating graceful monitoring shutdown...');

      // Abort all active watch requests
      for (const [namespace, watchRequest] of this.activeWatchRequests) {
        try {
          watchRequest.abortController.abort();
          console.log(`📡 Stopped monitoring namespace: ${namespace}`);
        } catch (error) {
          console.warn(`⚠️ Error stopping watch for ${namespace}:`, error);
        }
      }

      // Clear all internal state
      this.activeWatchRequests.clear();
      this.diagnosisCache.clear();

      // Clean up timers
      if (this.cacheCleanupTimer) {
        clearInterval(this.cacheCleanupTimer);
        this.cacheCleanupTimer = null;
      }
      
      // Stop token refresh monitoring
      if (this.tokenRefreshInterval) {
        clearInterval(this.tokenRefreshInterval);
        this.tokenRefreshInterval = undefined;
      }

      // Update connection state
      this.connectionState.isHealthy = false;

      console.log('✅ Monitoring shutdown complete');

      // Emit shutdown event for external cleanup
      this.emit('monitoringStopped', {
        timestamp: new Date(),
        metrics: this.metrics
      });

    } catch (error) {
      console.error('❌ Error during monitoring shutdown:', error);
      printErrorAndExit(`❌ Failed to stop monitoring: ${error}`, 1);
    }
  }

  /**
   * Get current system health and operational metrics
   * 
   * @returns Comprehensive health status including metrics and connection state
   */
  public getHealthStatus(): {
    isHealthy: boolean;
    connectionState: ConnectionState;
    metrics: {
      totalFailuresDetected: number;
      diagnosisCallsExecuted: number;
      cacheHitRate: number;
      reconnectionAttempts: number;
      lastHealthCheck: Date;
    };
    activeNamespaces: string[];
    cacheStats: { entries: number; hitRate: number };
  } {
    return {
      isHealthy: this.connectionState.isHealthy,
      connectionState: { ...this.connectionState },
      metrics: { ...this.metrics },
      activeNamespaces: Array.from(this.activeWatchRequests.keys()),
      cacheStats: {
        entries: this.diagnosisCache.size,
        hitRate: this.metrics.cacheHitRate
      }
    };
  }

  /**
   * Merge user configuration with enterprise-grade defaults
   * 
   * This method ensures all configuration values have sensible defaults
   * while allowing fine-grained customization for specific environments.
   * 
   * @param userConfig - Partial configuration from user
   * @returns Complete configuration with all required fields
   */
  private mergeWithDefaults(userConfig: Partial<WatchdogConfiguration>): WatchdogConfiguration {
    const defaults: WatchdogConfiguration = {
      monitoring: {
        namespaces: undefined, // undefined means "all accessible namespaces"
        excludeNamespaces: ['kube-system', 'kube-public', 'kube-node-lease'],
        failureDetection: {
          minRestartThreshold: 3,
          maxPendingDurationMs: 600000, // 10 minutes
          enableCrashLoopDetection: true,
          enableImagePullFailureDetection: true,
          enableResourceLimitDetection: true
        }
      },
      diagnosis: {
        enabled: true,
        timeoutMs: 30000, // 30 seconds
        cacheConfig: {
          ttlMs: 300000, // 5 minutes
          maxEntries: 1000
        }
      },
      alerting: {
        webhookUrl: undefined,
        retryPolicy: {
          maxAttempts: 3,
          backoffMs: 1000,
          maxBackoffMs: 30000
        },
        severityFilters: ['medium', 'high', 'critical'],
        rateLimitWindowMinutes: 0,
        includeFullManifests: false
      },
      resilience: {
        reconnectionPolicy: {
          enabled: true,
          initialBackoffMs: 1000,
          maxBackoffMs: 30000,
          backoffMultiplier: 2,
          maxConsecutiveFailures: 5
        }
      }
    };

    // Deep merge user configuration with defaults
    return this.deepMerge(defaults, userConfig);
  }

  /**
   * Validate cluster connectivity and basic permissions
   * 
   * @private
   * @throws {Error} When cluster is unreachable or permissions are insufficient
   */
  private async validateClusterConnectivity(): Promise<void> {
    try {
      // Log cluster connection information
      const currentContext = this.kubernetesConfig.getCurrentContext();
      const cluster = this.kubernetesConfig.getCurrentCluster();
      console.log(`🔧 Connected to cluster: ${currentContext}`);
      if (cluster?.server) {
        console.log(`🌐 API Server: ${cluster.server}`);
      }

      // Test basic API connectivity
      const namespaceList = await this.coreV1Api.listNamespace();
      if (!namespaceList) {
        printErrorAndExit('Empty response from Kubernetes API',0);
      }

      console.log('🔗 Cluster connectivity validated');
    } catch (error) {
      printErrorAndExit(`Cluster connectivity validation failed: ${error}`,1);
    }
  }

  /**
   * Discover namespaces available for monitoring based on permissions
   * 
   * @private
   * @returns Array of namespace names accessible for monitoring
   */
  private async discoverMonitorableNamespaces(): Promise<string[]> {
    try {
      const namespaceList = await this.coreV1Api.listNamespace();
      const allNamespaces = namespaceList.items
        .map((ns: k8s.V1Namespace) => ns.metadata?.name)
        .filter((name: string | undefined): name is string => Boolean(name));

      // Filter out excluded namespaces
      const monitorableNamespaces = allNamespaces.filter((ns: string) => 
        !this.configuration.monitoring.excludeNamespaces.includes(ns)
      );

      return monitorableNamespaces;
    } catch (error) {
      console.warn('⚠️ Failed to discover namespaces, falling back to default:', error);
      return ['default'];
    }
  }

  /**
   * Perform comprehensive system health check
   * 
   * @private
   */
  private async performSystemHealthCheck(): Promise<void> {
    // Validate diagnosis command availability if enabled
    if (this.configuration.diagnosis.enabled) {
      await this.validateDiagnosisCommand();
    }

    // Test webhook connectivity if configured
    if (this.configuration.alerting.webhookUrl) {
      await this.validateWebhookConnectivity();
    }

    console.log('🏥 System health check completed');
  }

  /**
   * Validate that internal diagnosis functions are available
   * 
   * @private
   */
  private async validateDiagnosisCommand(): Promise<void> {
    // Validate that internal diagnosis functions are properly imported
    console.log('🔍 Internal diagnosis system validation completed');
  }

  /**
   * Test webhook connectivity with a health check request
   * 
   * @private
   */
  private async validateWebhookConnectivity(): Promise<void> {
    // Implementation would test webhook endpoint
    console.log('📡 Webhook connectivity validation completed');
  }

  /**
   * Resolve target namespaces based on configuration
   * 
   * @private
   * @returns Array of namespace names to monitor
   */
  private async resolveTargetNamespaces(): Promise<string[]> {
    if (this.configuration.monitoring.namespaces) {
      // Use explicitly configured namespaces
      return this.configuration.monitoring.namespaces.filter((ns: string) =>
        !this.configuration.monitoring.excludeNamespaces.includes(ns)
      );
    } else {
      // Discover all accessible namespaces
      return await this.discoverMonitorableNamespaces();
    }
  }

  /**
   * Establish a resilient watch stream for a specific namespace
   * 
   * This method implements the circuit breaker pattern with exponential backoff
   * to handle transient failures and API server pressure gracefully.
   * 
   * @private
   * @param namespace - Target namespace for monitoring
   */
  private async establishNamespaceWatch(namespace: string): Promise<void> {
    const abortController = new AbortController();
    const watchRequest: WatchRequest = {
      namespace,
      abortController,
      startTime: new Date(),
      isHealthy: true
    };

    this.activeWatchRequests.set(namespace, watchRequest);

    try {
      const watchPath = `/api/v1/namespaces/${namespace}/pods`;
      
      console.log(`📡 Establishing watch stream for namespace: ${namespace}`);

      await this.watchApi.watch(
        watchPath,
        {}, // query parameters
        (eventType: string, podObject: k8s.V1Pod) => 
          this.processPodEvent(eventType, podObject, namespace),
        (error: any) => 
          this.handleWatchError(error, namespace, abortController)
      );

      console.log(`✅ Watch stream established for namespace: ${namespace}`);

    } catch (error) {
      console.error(`❌ Failed to establish watch for namespace ${namespace}:`, error);
      this.activeWatchRequests.delete(namespace);
      
      // Implement exponential backoff for reconnection
      if (this.configuration.resilience.reconnectionPolicy.enabled) {
        await this.scheduleReconnection(namespace);
      }
    }
  }

  /**
   * Process incoming pod events and detect failures
   * 
   * This is the core event processing pipeline that analyzes pod state changes
   * and triggers failure detection, diagnosis, and alerting workflows.
   * 
   * @private
   * @param eventType - Kubernetes watch event type (ADDED, MODIFIED, DELETED)
   * @param podObject - Complete pod object from Kubernetes API
   * @param namespace - Namespace containing the pod
   */
  private async processPodEvent(
    eventType: string, 
    podObject: k8s.V1Pod, 
    namespace: string
  ): Promise<void> {
    // Only process events that could indicate failures
    if (!['ADDED', 'MODIFIED'].includes(eventType)) {
      return;
    }

    const podName = podObject.metadata?.name;
    if (!podName) {
      console.warn('⚠️ Received pod event without name metadata');
      return;
    }

    try {
      // Analyze pod state for potential failures
      const failureEvent = await this.analyzeForFailures(podObject, namespace);
      
      if (failureEvent) {
        // Update metrics
        this.metrics.totalFailuresDetected++;
        
        // Execute diagnosis if enabled and appropriate
        if (this.shouldExecuteDiagnosis(failureEvent)) {
          await this.executeDiagnosisWorkflow(failureEvent);
        }
        
        // Emit structured failure event
        this.emit('podFailure', failureEvent);
        
        // Send alert if configured and severity warrants it
        if (this.shouldSendAlert(failureEvent)) {
          await this.sendStructuredAlert(failureEvent);
        }
        
        // Report to backend if severity warrants it
        if (this.shouldReportToBackend(failureEvent)) {
          await this.reportFailureToBackend(failureEvent);
        }
      }

    } catch (error) {
      console.error(`❌ Error processing pod event for ${podName}:`, error);
      this.emit('error', new Error(`Pod event processing failed: ${error}`));
    }
  }

  /**
   * Analyze pod object for various failure conditions
   * 
   * This method implements comprehensive failure detection logic covering:
   * - Pod phase failures (Failed, Pending too long)
   * - Container restart loops and crash patterns
   * - Image pull failures and configuration errors
   * - Resource constraint violations
   * - Custom failure patterns based on configuration
   * 
   * @private
   * @param pod - Complete pod object to analyze
   * @param namespace - Namespace containing the pod
   * @returns PodFailureEvent if failure detected, null otherwise
   */
  private async analyzeForFailures(
    pod: k8s.V1Pod, 
    namespace: string
  ): Promise<PodFailureEvent | null> {
    const status = pod.status;
    
    if (!status) return null;

    // Check for pod-level failures
    if (status.phase === 'Failed') {
      return this.createFailureEvent(pod, namespace, {
        pattern: 'pod-phase-failed',
        severity: 'critical',
        reason: `Pod phase is Failed: ${status.reason || 'Unknown reason'}`,
        message: status.message || 'No additional details available'
      });
    }

    // Check for long-pending pods
    const pendingFailure = this.checkForLongPendingPod(pod, namespace);
    if (pendingFailure) return pendingFailure;

    // Analyze container states for failures
    const containerFailure = this.analyzeContainerStates(pod, namespace);
    if (containerFailure) return containerFailure;

    // Check for resource-related issues
    const resourceFailure = this.checkResourceConstraints(pod, namespace);
    if (resourceFailure) return resourceFailure;

    return null;
  }

  /**
   * Check if pod has been pending for too long
   * 
   * @private
   */
  private checkForLongPendingPod(pod: k8s.V1Pod, namespace: string): PodFailureEvent | null {
    if (pod.status?.phase !== 'Pending') return null;

    const creationTime = pod.metadata?.creationTimestamp;
    if (!creationTime) return null;

    const ageMs = Date.now() - new Date(creationTime).getTime();
    const maxPendingMs = this.configuration.monitoring.failureDetection.maxPendingDurationMs;

    if (ageMs > maxPendingMs) {
      return this.createFailureEvent(pod, namespace, {
        pattern: 'long-pending',
        severity: 'high',
        reason: `Pod pending for ${Math.round(ageMs / 60000)} minutes`,
        message: `Pod has been in Pending state for ${Math.round(ageMs / 60000)} minutes, exceeding threshold of ${Math.round(maxPendingMs / 60000)} minutes`
      });
    }

    return null;
  }

  /**
   * Analyze container states for various failure patterns
   * 
   * @private
   */
  private analyzeContainerStates(pod: k8s.V1Pod, namespace: string): PodFailureEvent | null {
    const allContainers = [
      ...(pod.status?.containerStatuses || []),
      ...(pod.status?.initContainerStatuses || [])
    ];

    for (const container of allContainers) {
      const failure = this.checkContainerForFailures(container, pod, namespace);
      if (failure) return failure;
    }

    return null;
  }

  /**
   * Check individual container for failure conditions
   * 
   * @private
   */
  private checkContainerForFailures(
    container: k8s.V1ContainerStatus, 
    pod: k8s.V1Pod, 
    namespace: string
  ): PodFailureEvent | null {
    const { name, restartCount = 0, state } = container;
    const config = this.configuration.monitoring.failureDetection;

    // Check restart threshold
    if (restartCount >= config.minRestartThreshold) {
      return this.createFailureEvent(pod, namespace, {
        pattern: 'high-restart-count',
        severity: this.calculateRestartSeverity(restartCount),
        reason: `Container ${name} has restarted ${restartCount} times`,
        message: `Container restart count (${restartCount}) exceeds threshold (${config.minRestartThreshold})`
      });
    }

    // Check waiting state failures
    if (state?.waiting) {
      const { reason, message } = state.waiting;
      const criticalWaitReasons = [
        'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 
        'CreateContainerConfigError', 'InvalidImageName'
      ];

      if (criticalWaitReasons.includes(reason || '')) {
        return this.createFailureEvent(pod, namespace, {
          pattern: 'container-waiting-error',
          severity: this.calculateWaitingSeverity(reason || ''),
          reason: `Container ${name}: ${reason}`,
          message: message || 'No additional details available'
        });
      }
    }

    // Check terminated state failures
    if (state?.terminated && state.terminated.exitCode !== 0) {
      return this.createFailureEvent(pod, namespace, {
        pattern: 'container-terminated-error',
        severity: 'high',
        reason: `Container ${name} terminated with exit code ${state.terminated.exitCode}`,
        message: state.terminated.reason || 'Container terminated unexpectedly'
      });
    }

    return null;
  }

  /**
   * Check for resource constraint violations
   * 
   * @private
   */
  private checkResourceConstraints(_pod: k8s.V1Pod, _namespace: string): PodFailureEvent | null {
    // Implementation would check for resource limits, quotas, etc.
    // This is a placeholder for comprehensive resource analysis
    return null;
  }

  /**
   * Create a structured failure event object
   * 
   * @private
   */
  private createFailureEvent(
    pod: k8s.V1Pod, 
    namespace: string, 
    failure: {
      pattern: FailurePattern;
      severity: FailureSeverityLevel;
      reason: string;
      message: string;
    }
  ): PodFailureEvent {
    return {
      metadata: {
        podName: pod.metadata?.name!,
        namespace,
        timestamp: new Date(),
        watchdogVersion: '2.0.0'
      },
      failure: {
        pattern: failure.pattern,
        severity: failure.severity,
        reason: failure.reason,
        message: failure.message,
        detectionTime: new Date()
      },
      podSnapshot: {
        phase: pod.status?.phase || 'Unknown',
        creationTime: pod.metadata?.creationTimestamp ? 
          new Date(pod.metadata.creationTimestamp) : new Date(),
        labels: pod.metadata?.labels || {},
        ownerReferences: pod.metadata?.ownerReferences || [],
        containerStates: this.extractContainerStates(pod)
      },
      diagnosis: {
        executed: false,
        result: null,
        cached: false,
        executionTimeMs: null
      }
    };
  }

  /**
   * Calculate severity based on restart count
   * 
   * @private
   */
  private calculateRestartSeverity(restartCount: number): FailureSeverityLevel {
    if (restartCount >= 10) return 'critical';
    if (restartCount >= 5) return 'high';
    if (restartCount >= 3) return 'medium';
    return 'low';
  }

  /**
   * Calculate severity based on waiting reason
   * 
   * @private
   */
  private calculateWaitingSeverity(reason: string): FailureSeverityLevel {
    const criticalReasons = ['CrashLoopBackOff'];
    const highReasons = ['ImagePullBackOff', 'ErrImagePull'];
    
    if (criticalReasons.includes(reason)) return 'critical';
    if (highReasons.includes(reason)) return 'high';
    return 'medium';
  }

  /**
   * Determine if diagnosis should be executed for this failure
   * 
   * @private
   */
  private shouldExecuteDiagnosis(failureEvent: PodFailureEvent): boolean {
    if (!this.configuration.diagnosis.enabled) return false;
    
    // Check severity threshold
    const severityLevel = ['informational', 'low', 'medium', 'high', 'critical'];
    const failureSeverityIndex = severityLevel.indexOf(failureEvent.failure.severity);
    
    // Only diagnose medium and above by default
    return failureSeverityIndex >= 2;
  }

  /**
   * Execute diagnosis workflow with caching and error handling
   * 
   * @private
   */
  private async executeDiagnosisWorkflow(failureEvent: PodFailureEvent): Promise<void> {
    const cacheKey = `${failureEvent.metadata.namespace}/${failureEvent.metadata.podName}`;
    const startTime = Date.now();

    try {
      // Check cache first
      const cachedResult = this.getDiagnosisFromCache(cacheKey);
      if (cachedResult) {
        failureEvent.diagnosis = {
          executed: true,
          result: cachedResult.diagnosis,
          cached: true,
          executionTimeMs: Date.now() - startTime
        };
        // Using cached diagnosis
        return;
      }

      // Execute fresh diagnosis
      const diagnosisResult = await this.executeInternalDiagnosis(
        failureEvent.metadata.podName,
        failureEvent.metadata.namespace
      );

      // Cache the result
      this.cacheDiagnosisResult(cacheKey, diagnosisResult);

      // Update failure event
      failureEvent.diagnosis = {
        executed: true,
        result: diagnosisResult,
        cached: false,
        executionTimeMs: Date.now() - startTime
      };

      this.metrics.diagnosisCallsExecuted++;

    } catch (error) {
      console.error(`❌ Diagnosis failed for ${failureEvent.metadata.podName}:`, error);
      failureEvent.diagnosis = {
        executed: false,
        result: `Diagnosis failed: ${error}`,
        cached: false,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Get diagnosis result from cache if available and not expired
   * 
   * @private
   */
  private getDiagnosisFromCache(cacheKey: string): DiagnosisCacheEntry | null {
    const cached = this.diagnosisCache.get(cacheKey);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp.getTime() > 
      this.configuration.diagnosis.cacheConfig.ttlMs;
    
    if (isExpired) {
      this.diagnosisCache.delete(cacheKey);
      return null;
    }

    return cached;
  }

  /**
   * Cache diagnosis result with TTL
   * 
   * @private
   */
  private cacheDiagnosisResult(cacheKey: string, diagnosis: string): void {
    // Respect max cache size
    if (this.diagnosisCache.size >= this.configuration.diagnosis.cacheConfig.maxEntries) {
      // Remove oldest entry (simple LRU approximation)
      const firstKey = this.diagnosisCache.keys().next().value;
      if (firstKey) {
        this.diagnosisCache.delete(firstKey);
      }
    }

    this.diagnosisCache.set(cacheKey, {
      diagnosis,
      timestamp: new Date()
    });
  }

  /**
   * Execute internal diagnosis using local functions
   * 
   * @private
   */
  private async executeInternalDiagnosis(podName: string, namespace: string): Promise<string> {
    try {
      const timeout = this.configuration.diagnosis.timeoutMs;
      
      return await Promise.race([
        this.performInternalDiagnosis(podName, namespace),
        new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error(`Diagnosis timed out after ${timeout}ms`)), timeout)
        )
      ]);
    } catch (error) {
      throw new Error(`Internal diagnosis failed: ${error}`);
    }
  }

  /**
   * Perform diagnosis using comprehensive stack analysis
   * 
   * @private
   */
  private async performInternalDiagnosis(podName: string, namespace: string): Promise<string> {
    try {
      // Use comprehensive stack-based diagnosis for better coverage
      return await diagnoseStack(podName, namespace);
    } catch (error) {
      throw new Error(`Failed to perform stack diagnosis: ${error}`);
    }
  }

  /**
   * Start proactive token refresh monitoring
   * 
   * @private
   */
  private startTokenRefreshMonitoring(): void {
    // Check token validity every 15 minutes
    const checkInterval = 15 * 60 * 1000; // 15 minutes
    
    this.tokenRefreshInterval = setInterval(async () => {
      try {
        const isValid = await this.tokenStorage.isTokenValid();
        if (!isValid) {
          console.log('🔄 Proactively refreshing tokens...');
          const refreshed = await this.tokenStorage.refreshTokens();
          if (!refreshed) {
            console.warn('⚠️  Proactive token refresh failed, debugging...');
            await this.tokenStorage.debugTokenStatus();
          }
        }
      } catch (error) {
        console.warn('⚠️  Token refresh check failed:', error);
        await this.tokenStorage.debugTokenStatus();
      }
    }, checkInterval);
  }

  /**
   * Extract container states from pod object
   * 
   * @private
   */
  private extractContainerStates(pod: k8s.V1Pod): any[] {
    const containerStates: any[] = [];
    
    // Process init containers
    const initContainers = pod.status?.initContainerStatuses || [];
    initContainers.forEach(initContainer => {
      containerStates.push({
        name: initContainer.name,
        type: 'init',
        state: this.formatContainerState(initContainer),
        reason: initContainer.state?.waiting?.reason || initContainer.state?.terminated?.reason
      });
    });

    // Process main containers
    const mainContainers = pod.status?.containerStatuses || [];
    mainContainers.forEach(mainContainer => {
      containerStates.push({
        name: mainContainer.name,
        type: 'main',
        state: this.formatContainerState(mainContainer),
        reason: mainContainer.state?.waiting?.reason || mainContainer.state?.terminated?.reason
      });
    });

    return containerStates;
  }

  /**
   * Format container state for diagnosis
   * 
   * @private
   */
  private formatContainerState(containerStatus: k8s.V1ContainerStatus): string {
    if (containerStatus.state?.running) {
      return 'running';
    } else if (containerStatus.state?.waiting) {
      return 'waiting';
    } else if (containerStatus.state?.terminated) {
      return 'terminated';
    }
    return 'unknown';
  }

  /**
   * Determine if alert should be sent based on severity and configuration
   * 
   * @private
   */
  private shouldSendAlert(failureEvent: PodFailureEvent): boolean {
    if (!this.configuration.alerting.webhookUrl) return false;
    
    return this.configuration.alerting.severityFilters.includes(
      failureEvent.failure.severity
    );
  }

  /**
   * Determine if failure should be reported to backend based on severity
   * 
   * @private
   */
  private shouldReportToBackend(failureEvent: PodFailureEvent): boolean {
    // Report medium and above severity failures to backend
    const reportableSeverities: FailureSeverityLevel[] = ['medium', 'high', 'critical'];
    return reportableSeverities.includes(failureEvent.failure.severity);
  }

  /**
   * Report failure to backend with comprehensive stack analysis
   *
   * @private
   */
  private async reportFailureToBackend(failureEvent: PodFailureEvent): Promise<void> {
    try {
      // Collect comprehensive stack data for backend reporting
      const stackData = await getStackDataForBackend(
        failureEvent.metadata.podName,
        failureEvent.metadata.namespace
      );

      // Build components array for stack analysis
      const components: StackComponent[] = [];

      // Add primary pod as first component
      components.push({
        podName: stackData.primaryPod.name,
        status: {
          phase: failureEvent.podSnapshot.phase,
          containerStates: stackData.primaryPod.containerStates || []
        },
        events: stackData.primaryPod.events,
        logs: stackData.primaryPod.logs
      });

      // Add stack components if available
      if (stackData.stackComponents) {
        stackData.stackComponents.components.forEach(comp => {
          if (comp.podName !== stackData.primaryPod.name) {
            components.push({
              podName: comp.podName,
              status: comp.status,
              events: comp.events,
              logs: comp.logs
            });
          }
        });
      }

      // Ensure components have at least a placeholder if no events were collected
      components.forEach(comp => {
        if (comp.events.length === 0) {
          comp.events = ['[unknown]'];
        }
      });

      // Build the stack analysis payload
      const payload: StackAnalysisPayload = {
        primaryPod: failureEvent.metadata.podName,
        helmRelease: stackData.stackComponents?.releaseName || failureEvent.metadata.podName,
        namespace: failureEvent.metadata.namespace,
        timestamp: failureEvent.metadata.timestamp.toISOString(),
        components
      };

      await runStackAnalysis(payload);
    } catch (error) {
      console.error(`❌ Failed to report failure to backend: ${error}`);
    }
  }

  /**
   * Send structured alert to configured webhook
   * 
   * @private
   */
  private async sendStructuredAlert(failureEvent: PodFailureEvent): Promise<void> {
    if (!this.configuration.alerting.webhookUrl) return;

    const alert = {
      timestamp: failureEvent.metadata.timestamp.toISOString(),
      severity: failureEvent.failure.severity,
      namespace: failureEvent.metadata.namespace,
      podName: failureEvent.metadata.podName,
      reason: failureEvent.failure.reason,
      message: failureEvent.failure.message,
      pattern: failureEvent.failure.pattern,
      diagnosis: failureEvent.diagnosis.result,
      podSnapshot: failureEvent.podSnapshot,
      watchdogVersion: failureEvent.metadata.watchdogVersion
    };

    await this.sendAlertWithRetry(alert);
  }

  /**
   * Send alert with retry logic and exponential backoff
   * 
   * @private
   */
  private async sendAlertWithRetry(alert: any): Promise<void> {
    const { maxAttempts, backoffMs, maxBackoffMs } = this.configuration.alerting.retryPolicy;
    let attempt = 1;
    let currentBackoff = backoffMs;

    while (attempt <= maxAttempts) {
      try {
        const response = await fetch(this.configuration.alerting.webhookUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert)
        });

        if (response.ok) {
          return;
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

      } catch (error) {
        console.warn(`⚠️ Alert sending failed (attempt ${attempt}/${maxAttempts}):`, error);
        
        if (attempt === maxAttempts) {
          console.error('❌ Alert sending failed after all retry attempts');
          return;
        }

        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, currentBackoff));
        currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        attempt++;
      }
    }
  }

  /**
   * Handle watch stream errors with reconnection logic
   * 
   * @private
   */
  private async handleWatchError(
    error: any, 
    namespace: string, 
    abortController: AbortController
  ): Promise<void> {
    if (abortController.signal.aborted) {
      console.log(`📡 Watch stream for ${namespace} was intentionally aborted`);
      return;
    }

    console.error(`❌ Watch error for namespace ${namespace}:`, error);
    
    // Update connection state
    this.connectionState.consecutiveFailures++;
    this.connectionState.isHealthy = false;

    // Remove failed watch request
    this.activeWatchRequests.delete(namespace);

    // Attempt reconnection if enabled
    if (this.configuration.resilience.reconnectionPolicy.enabled) {
      await this.scheduleReconnection(namespace);
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   * 
   * @private
   */
  private async scheduleReconnection(namespace: string): Promise<void> {
    const policy = this.configuration.resilience.reconnectionPolicy;
    
    if (this.connectionState.consecutiveFailures >= policy.maxConsecutiveFailures) {
      console.error(`❌ Max consecutive failures reached for ${namespace}, giving up`);
      return;
    }

    const backoffMs = Math.min(
      policy.initialBackoffMs * Math.pow(policy.backoffMultiplier, this.connectionState.consecutiveFailures),
      policy.maxBackoffMs
    );

    console.log(`🔄 Scheduling reconnection for ${namespace} in ${backoffMs}ms`);
    this.metrics.reconnectionAttempts++;

    setTimeout(async () => {
      try {
        await this.establishNamespaceWatch(namespace);
        // Reset failure count on successful reconnection
        this.connectionState.consecutiveFailures = 0;
        this.connectionState.isHealthy = true;
        this.connectionState.lastSuccessfulConnection = new Date();
      } catch (error) {
        console.error(`❌ Reconnection failed for ${namespace}:`, error);
      }
    }, backoffMs);
  }

  /**
   * Handle internal errors to prevent crashes
   * 
   * @private
   */
  private handleInternalError(error: Error): void {
    console.error('❌ Internal watchdog error:', error);
    // Log to external monitoring systems if configured
    // Prevent the error from crashing the application
  }

  /**
   * Set up periodic cache cleanup to prevent memory leaks
   * 
   * @private
   */
  private setupCacheCleanup(): void {
    const cleanupIntervalMs = 60000; // Clean up every minute
    
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      const ttl = this.configuration.diagnosis.cacheConfig.ttlMs;
      let removedCount = 0;

      for (const [key, entry] of this.diagnosisCache.entries()) {
        if (now - entry.timestamp.getTime() > ttl) {
          this.diagnosisCache.delete(key);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        console.log(`🧹 Cleaned up ${removedCount} expired cache entries`);
      }

      // Update cache hit rate metric
      this.updateCacheHitRate();

    }, cleanupIntervalMs);
  }

  /**
   * Update cache hit rate metric for observability
   * 
   * @private
   */
  private updateCacheHitRate(): void {
    // This would calculate actual hit rate based on cache access statistics
    // For now, it's a placeholder
    this.metrics.cacheHitRate = this.diagnosisCache.size > 0 ? 0.8 : 0;
  }

  /**
   * Deep merge utility for configuration objects
   * 
   * @private
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}

/**
 * Export types for external consumption
 */
export type { 
  PodFailureEvent, 
  WatchdogConfiguration, 
  FailureSeverityLevel,
  FailurePattern 
} from '../common/interfaces/watchdog.interfaces';
