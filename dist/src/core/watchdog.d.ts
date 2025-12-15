import { EventEmitter } from 'events';
import { WatchdogConfiguration, ConnectionState } from '../common/interfaces/watchdog.interfaces';
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
export declare class KubernetesPodWatchdog extends EventEmitter {
    /**
     * Kubernetes configuration and API client instances
     * These are initialized once during construction and reused throughout the lifecycle
     */
    private readonly kubernetesConfig;
    private readonly coreV1Api;
    private readonly watchApi;
    /**
     * Runtime configuration merged from defaults and user overrides
     * Immutable after initialization to ensure consistent behavior
     */
    private readonly configuration;
    /**
     * In-memory cache for diagnosis results with TTL management
     * Key format: `${namespace}/${podName}` for efficient lookups
     * Automatically expires entries based on configured TTL
     */
    private readonly diagnosisCache;
    /**
     * Active watch requests tracking for graceful shutdown
     * Each namespace gets its own AbortController for independent lifecycle management
     */
    private readonly activeWatchRequests;
    /**
     * Token storage for handling authentication
     */
    private readonly tokenStorage;
    /**
     * Interval for proactive token refresh
     */
    private tokenRefreshInterval?;
    /**
     * Connection state tracking for resilience patterns
     * Enables circuit breaker behavior and exponential backoff
     */
    private readonly connectionState;
    /**
     * Cleanup timer for periodic cache maintenance
     * Removes expired entries to prevent memory leaks
     */
    private cacheCleanupTimer;
    /**
     * Metrics tracking for observability and performance monitoring
     * Reset periodically and exposed via health endpoints
     */
    private readonly metrics;
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
    constructor(userConfiguration?: Partial<WatchdogConfiguration>);
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
    initialize(): Promise<void>;
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
    startMonitoring(): Promise<void>;
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
    stopMonitoring(): Promise<void>;
    /**
     * Get current system health and operational metrics
     *
     * @returns Comprehensive health status including metrics and connection state
     */
    getHealthStatus(): {
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
        cacheStats: {
            entries: number;
            hitRate: number;
        };
    };
    /**
     * Merge user configuration with enterprise-grade defaults
     *
     * This method ensures all configuration values have sensible defaults
     * while allowing fine-grained customization for specific environments.
     *
     * @param userConfig - Partial configuration from user
     * @returns Complete configuration with all required fields
     */
    private mergeWithDefaults;
    /**
     * Validate cluster connectivity and basic permissions
     *
     * @private
     * @throws {Error} When cluster is unreachable or permissions are insufficient
     */
    private validateClusterConnectivity;
    /**
     * Discover namespaces available for monitoring based on permissions
     *
     * @private
     * @returns Array of namespace names accessible for monitoring
     */
    private discoverMonitorableNamespaces;
    /**
     * Perform comprehensive system health check
     *
     * @private
     */
    private performSystemHealthCheck;
    /**
     * Validate that internal diagnosis functions are available
     *
     * @private
     */
    private validateDiagnosisCommand;
    /**
     * Test webhook connectivity with a health check request
     *
     * @private
     */
    private validateWebhookConnectivity;
    /**
     * Resolve target namespaces based on configuration
     *
     * @private
     * @returns Array of namespace names to monitor
     */
    private resolveTargetNamespaces;
    /**
     * Establish a resilient watch stream for a specific namespace
     *
     * This method implements the circuit breaker pattern with exponential backoff
     * to handle transient failures and API server pressure gracefully.
     *
     * @private
     * @param namespace - Target namespace for monitoring
     */
    private establishNamespaceWatch;
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
    private processPodEvent;
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
    private analyzeForFailures;
    /**
     * Check if pod has been pending for too long
     *
     * @private
     */
    private checkForLongPendingPod;
    /**
     * Analyze container states for various failure patterns
     *
     * @private
     */
    private analyzeContainerStates;
    /**
     * Check individual container for failure conditions
     *
     * @private
     */
    private checkContainerForFailures;
    /**
     * Check for resource constraint violations
     *
     * @private
     */
    private checkResourceConstraints;
    /**
     * Create a structured failure event object
     *
     * @private
     */
    private createFailureEvent;
    /**
     * Calculate severity based on restart count
     *
     * @private
     */
    private calculateRestartSeverity;
    /**
     * Calculate severity based on waiting reason
     *
     * @private
     */
    private calculateWaitingSeverity;
    /**
     * Determine if diagnosis should be executed for this failure
     *
     * @private
     */
    private shouldExecuteDiagnosis;
    /**
     * Execute diagnosis workflow with caching and error handling
     *
     * @private
     */
    private executeDiagnosisWorkflow;
    /**
     * Get diagnosis result from cache if available and not expired
     *
     * @private
     */
    private getDiagnosisFromCache;
    /**
     * Cache diagnosis result with TTL
     *
     * @private
     */
    private cacheDiagnosisResult;
    /**
     * Execute internal diagnosis using local functions
     *
     * @private
     */
    private executeInternalDiagnosis;
    /**
     * Perform diagnosis using comprehensive stack analysis
     *
     * @private
     */
    private performInternalDiagnosis;
    /**
     * Start proactive token refresh monitoring
     *
     * @private
     */
    private startTokenRefreshMonitoring;
    /**
     * Extract container states from pod object
     *
     * @private
     */
    private extractContainerStates;
    /**
     * Format container state for diagnosis
     *
     * @private
     */
    private formatContainerState;
    /**
     * Determine if alert should be sent based on severity and configuration
     *
     * @private
     */
    private shouldSendAlert;
    /**
     * Determine if failure should be reported to backend based on severity
     *
     * @private
     */
    private shouldReportToBackend;
    /**
     * Report failure to backend with comprehensive stack data aggregated into single pod format
     *
     * @private
     */
    private reportFailureToBackend;
    /**
     * Send structured alert to configured webhook
     *
     * @private
     */
    private sendStructuredAlert;
    /**
     * Send alert with retry logic and exponential backoff
     *
     * @private
     */
    private sendAlertWithRetry;
    /**
     * Handle watch stream errors with reconnection logic
     *
     * @private
     */
    private handleWatchError;
    /**
     * Schedule reconnection with exponential backoff
     *
     * @private
     */
    private scheduleReconnection;
    /**
     * Handle internal errors to prevent crashes
     *
     * @private
     */
    private handleInternalError;
    /**
     * Set up periodic cache cleanup to prevent memory leaks
     *
     * @private
     */
    private setupCacheCleanup;
    /**
     * Update cache hit rate metric for observability
     *
     * @private
     */
    private updateCacheHitRate;
    /**
     * Deep merge utility for configuration objects
     *
     * @private
     */
    private deepMerge;
}
/**
 * Export types for external consumption
 */
export type { PodFailureEvent, WatchdogConfiguration, FailureSeverityLevel, FailurePattern } from '../common/interfaces/watchdog.interfaces';
//# sourceMappingURL=watchdog.d.ts.map