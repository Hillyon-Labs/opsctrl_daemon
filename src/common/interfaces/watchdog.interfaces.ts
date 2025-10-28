/**
 * Type definitions for the Enterprise Kubernetes Pod Monitoring System
 * 
 * This module defines comprehensive interfaces and types used throughout the
 * pod monitoring system. These types provide strong type safety and clear
 * contracts between system components.
 * 
 * @version 2.0.0
 * @since 2025-07-31
 */

import * as k8s from '@kubernetes/client-node';

/**
 * Enumeration of failure severity levels for classification and prioritization
 * 
 * These severity levels follow industry standards for incident classification:
 * - informational: System notices, no action required
 * - low: Minor issues that don't impact functionality
 * - medium: Issues that may impact functionality but have workarounds
 * - high: Significant issues that impact functionality
 * - critical: System-breaking issues requiring immediate attention
 */
export type FailureSeverityLevel = 'informational' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Common failure patterns for categorization and automated response
 * 
 * These patterns enable the system to apply different handling strategies
 * based on the type of failure detected.
 */
export type FailurePattern = 
  | 'pod-phase-failed'
  | 'long-pending'
  | 'high-restart-count'
  | 'container-waiting-error'
  | 'container-terminated-error'
  | 'resource-constraint'
  | 'image-pull-failure'
  | 'configuration-error'
  | 'network-isolation'
  | 'storage-failure';

/**
 * Comprehensive pod failure event structure
 * 
 * This interface represents a complete failure event with all context
 * needed for diagnosis, alerting, and remediation workflows.
 */
export interface PodFailureEvent {
  /**
   * Event metadata for tracking and correlation
   */
  metadata: {
    /** Name of the failed pod */
    podName: string;
    /** Kubernetes namespace containing the pod */
    namespace: string;
    /** Timestamp when the failure was detected */
    timestamp: Date;
    /** Version of the watchdog that detected the failure */
    watchdogVersion: string;
  };

  /**
   * Detailed failure information
   */
  failure: {
    /** Categorized failure pattern for automated handling */
    pattern: FailurePattern;
    /** Severity level for prioritization and routing */
    severity: FailureSeverityLevel;
    /** Human-readable failure reason */
    reason: string;
    /** Detailed failure message with context */
    message: string;
    /** Timestamp when the failure was first detected */
    detectionTime: Date;
  };

  /**
   * Snapshot of pod state at failure time
   */
  podSnapshot: {
    /** Current pod phase (Running, Pending, Failed, etc.) */
    phase: string;
    /** Pod creation timestamp */
    creationTime: Date;
    /** Pod labels for context and correlation */
    labels: Record<string, string>;
    /** Owner references for tracking controllers */
    ownerReferences: k8s.V1OwnerReference[];
    /** Container states for diagnosis */
    containerStates?: any[];
  };

  /**
   * Diagnosis execution results
   */
  diagnosis: {
    /** Whether diagnosis was executed for this failure */
    executed: boolean;
    /** Diagnosis result text, null if not executed or failed */
    result: string | null;
    /** Whether the result came from cache */
    cached: boolean;
    /** Time taken to execute diagnosis in milliseconds */
    executionTimeMs: number | null;
  };
}

/**
 * Configuration for failure detection algorithms
 */
export interface FailureDetectionConfig {
  /** Minimum container restart count to trigger failure detection */
  minRestartThreshold: number;
  /** Maximum time a pod can remain in Pending state (milliseconds) */
  maxPendingDurationMs: number;
  /** Enable detection of crash loop back-off patterns */
  enableCrashLoopDetection: boolean;
  /** Enable detection of image pull failures */
  enableImagePullFailureDetection: boolean;
  /** Enable detection of resource limit violations */
  enableResourceLimitDetection: boolean;
}

/**
 * Configuration for namespace monitoring scope
 */
export interface MonitoringConfig {
  /** Specific namespaces to monitor (undefined = all accessible) */
  namespaces?: string[];
  /** Namespaces to exclude from monitoring */
  excludeNamespaces: string[];
  /** Failure detection configuration */
  failureDetection: FailureDetectionConfig;
}

/**
 * Configuration for diagnosis cache management
 */
export interface DiagnosisCacheConfig {
  /** Time-to-live for cached diagnosis results (milliseconds) */
  ttlMs: number;
  /** Maximum number of entries to keep in cache */
  maxEntries: number;
}

/**
 * Configuration for automated diagnosis execution
 */
export interface DiagnosisConfig {
  /** Whether to enable automated diagnosis */
  enabled: boolean;
  /** Timeout for diagnosis execution (milliseconds) */
  timeoutMs: number;
  /** Cache configuration for diagnosis results */
  cacheConfig: DiagnosisCacheConfig;
}

/**
 * Configuration for alert retry policy
 */
export interface AlertRetryPolicy {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial backoff delay (milliseconds) */
  backoffMs: number;
  /** Maximum backoff delay (milliseconds) */
  maxBackoffMs: number;
}

/**
 * Configuration for alert delivery
 */
export interface AlertingConfig {
  /** Webhook URL for alert delivery (optional) */
  webhookUrl?: string;
  /** Retry policy for failed alert deliveries */
  retryPolicy: AlertRetryPolicy;
  /** Severity levels that should trigger alerts */
  severityFilters: FailureSeverityLevel[];

  rateLimitWindowMinutes: number,

  includeFullManifests: boolean;

  /** Custom template for alert messages (optional) */
  customTemplate?: string;
}

/**
 * Configuration for connection resilience
 */
export interface ReconnectionPolicy {
  /** Whether automatic reconnection is enabled */
  enabled: boolean;
  /** Initial backoff delay for reconnection (milliseconds) */
  initialBackoffMs: number;
  /** Maximum backoff delay for reconnection (milliseconds) */
  maxBackoffMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum consecutive failures before giving up */
  maxConsecutiveFailures: number;
}

/**
 * Configuration for system resilience features
 */
export interface ResilienceConfig {
  /** Reconnection policy for failed watch streams */
  reconnectionPolicy: ReconnectionPolicy;
}

/**
 * Complete watchdog configuration interface
 * 
 * This interface defines all configurable aspects of the pod monitoring system,
 * providing fine-grained control over behavior while maintaining sensible defaults.
 */
export interface WatchdogConfiguration {
  /** Monitoring scope and failure detection settings */
  monitoring: MonitoringConfig;
  /** Diagnosis execution and caching settings */
  diagnosis: DiagnosisConfig;
  /** Alert delivery and retry settings */
  alerting: AlertingConfig;
  /** Connection resilience and recovery settings */
  resilience: ResilienceConfig;
}

/**
 * Cache entry for diagnosis results with timestamp tracking
 */
export interface DiagnosisCacheEntry {
  /** Cached diagnosis result text */
  diagnosis: string;
  /** Timestamp when the entry was cached */
  timestamp: Date;
}

/**
 * Connection state tracking for resilience management
 */
export interface ConnectionState {
  /** Whether the connection is currently healthy */
  isHealthy: boolean;
  /** Timestamp of last successful connection */
  lastSuccessfulConnection: Date;
  /** Count of consecutive connection failures */
  consecutiveFailures: number;
  /** Current reconnection backoff delay (milliseconds) */
  reconnectionBackoffMs: number;
}

/**
 * Active watch request tracking for lifecycle management
 */
export interface WatchRequest {
  /** Namespace being watched */
  namespace: string;
  /** Abort controller for graceful shutdown */
  abortController: AbortController;
  /** Timestamp when the watch was started */
  startTime: Date;
  /** Whether the watch is currently healthy */
  isHealthy: boolean;
}
