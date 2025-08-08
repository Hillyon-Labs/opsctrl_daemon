import Joi from 'joi';
import { WatchdogConfiguration } from '../common/interfaces/watchdog.interfaces';
import {
  THIRTY_SECONDS_IN_MILLISECONDS,
  ONE_HOUR_IN_MILLISECONDS,
  DIAGNOSIS_MIN_TIMEOUT_MS,
  DIAGNOSIS_MAX_TIMEOUT_MS,
  DIAGNOSIS_DEFAULT_TIMEOUT_MS,
  DIAGNOSIS_CACHE_MIN_TTL_MS,
  DIAGNOSIS_CACHE_MAX_TTL_MS,
  DIAGNOSIS_CACHE_DEFAULT_TTL_MS,
  MAX_PENDING_DURATION_MIN_MS,
  MAX_PENDING_DURATION_MAX_MS,
  MAX_PENDING_DURATION_DEFAULT_MS,
  ALERT_BACKOFF_MIN_MS,
  ALERT_BACKOFF_MAX_MS,
  ALERT_BACKOFF_DEFAULT_MS,
  ALERT_MAX_BACKOFF_MIN_MS,
  ALERT_MAX_BACKOFF_MAX_MS,
  ALERT_MAX_BACKOFF_DEFAULT_MS,
  RECONNECTION_BACKOFF_MIN_MS,
  RECONNECTION_BACKOFF_MAX_MS,
  RECONNECTION_BACKOFF_DEFAULT_MS,
  RECONNECTION_MAX_BACKOFF_MIN_MS,
  RECONNECTION_MAX_BACKOFF_MAX_MS,
  RECONNECTION_MAX_BACKOFF_DEFAULT_MS,
  ALERT_RATE_LIMIT_MAX_MINUTES,
  ALERT_RATE_LIMIT_DEFAULT_MINUTES
} from '../common/time.constants';

/**
 * Comprehensive environment variable validation schema using Joi
 * This schema defines validation rules, default values, and detailed error messages
 * for all environment variables used by the opsctrl-daemon
 */
const environmentSchema = Joi.object({
  // ====================================
  // APPLICATION CONFIGURATION
  // ====================================
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'staging', 'test')
    .default('development')
    .description('Node.js environment mode'),

  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'trace')
    .default('info')
    .description('Logging verbosity level'),

  // ====================================
  // MONITORING CONFIGURATION (REQUIRED)
  // ====================================
  WATCH_NAMESPACES: Joi.string()
    .required()
    .pattern(/^[a-z0-9-,]+$/)
    .messages({
      'string.pattern.base': 'WATCH_NAMESPACES must be comma-separated namespace names (lowercase, numbers, hyphens only)',
      'any.required': 'WATCH_NAMESPACES is required for targeted monitoring'
    })
    .description('Comma-separated list of namespaces to monitor - REQUIRED for targeted monitoring'),

  EXCLUDE_NAMESPACES: Joi.string()
    .default('kube-system,kube-public,kube-node-lease')
    .pattern(/^[a-z0-9-,]+$/)
    .description('Comma-separated list of namespaces to exclude from monitoring'),

  MIN_RESTART_THRESHOLD: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(3)
    .description('Minimum container restart count to trigger failure detection'),

  MAX_PENDING_DURATION_MS: Joi.number()
    .integer()
    .min(MAX_PENDING_DURATION_MIN_MS) // Minimum 30 seconds
    .max(MAX_PENDING_DURATION_MAX_MS) // Maximum 1 hour
    .default(MAX_PENDING_DURATION_DEFAULT_MS)
    .description('Maximum time a pod can remain in Pending state (milliseconds)'),

  ENABLE_CRASH_LOOP_DETECTION: Joi.boolean()
    .default(true)
    .description('Enable detection of crash loop back-off patterns'),

  ENABLE_IMAGE_PULL_FAILURE_DETECTION: Joi.boolean()
    .default(true)
    .description('Enable detection of image pull failures'),

  ENABLE_RESOURCE_LIMIT_DETECTION: Joi.boolean()
    .default(true)
    .description('Enable detection of resource limit violations'),

  // ====================================
  // DIAGNOSIS CONFIGURATION
  // ====================================
  DIAGNOSIS_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable/disable automated diagnosis execution'),

  DIAGNOSIS_TIMEOUT_MS: Joi.number()
    .integer()
    .min(DIAGNOSIS_MIN_TIMEOUT_MS) // Minimum 5 seconds
    .max(DIAGNOSIS_MAX_TIMEOUT_MS) // Maximum 5 minutes
    .default(DIAGNOSIS_DEFAULT_TIMEOUT_MS)
    .description('Timeout for diagnosis command execution (milliseconds)'),

  DIAGNOSIS_CACHE_TTL_MS: Joi.number()
    .integer()
    .min(DIAGNOSIS_CACHE_MIN_TTL_MS) // Minimum 1 minute
    .max(DIAGNOSIS_CACHE_MAX_TTL_MS) // Maximum 24 hours
    .default(DIAGNOSIS_CACHE_DEFAULT_TTL_MS)
    .description('Time-to-live for cached diagnosis results (milliseconds)'),

  DIAGNOSIS_CACHE_MAX_ENTRIES: Joi.number()
    .integer()
    .min(10)
    .max(50000)
    .default(1000)
    .description('Maximum number of entries to keep in diagnosis cache'),


  // ====================================
  // ALERTING CONFIGURATION
  // ====================================
  WEBHOOK_URL: Joi.string()
    .allow('') // Allow empty string
    .uri({ scheme: ['http', 'https'] })
    .optional()
    .description('Webhook URL for sending alerts (optional)'),

  ALERT_MAX_ATTEMPTS: Joi.number()
    .integer()
    .min(1)
    .max(10)
    .default(3)
    .description('Maximum number of retry attempts for failed alert deliveries'),

  ALERT_BACKOFF_MS: Joi.number()
    .integer()
    .min(ALERT_BACKOFF_MIN_MS)
    .max(ALERT_BACKOFF_MAX_MS)
    .default(ALERT_BACKOFF_DEFAULT_MS)
    .description('Initial backoff delay for alert retries (milliseconds)'),

  ALERT_MAX_BACKOFF_MS: Joi.number()
    .integer()
    .min(ALERT_MAX_BACKOFF_MIN_MS)
    .max(ALERT_MAX_BACKOFF_MAX_MS)
    .default(ALERT_MAX_BACKOFF_DEFAULT_MS)
    .description('Maximum backoff delay for alert retries (milliseconds)'),

  ALERT_SEVERITY_FILTERS: Joi.string()
    .pattern(/^(informational|low|medium|high|critical)(,(informational|low|medium|high|critical))*$/)
    .default('medium,high,critical')
    .messages({
      'string.pattern.base': 'ALERT_SEVERITY_FILTERS must contain valid severity levels: informational,low,medium,high,critical'
    })
    .description('Severity levels that should trigger alerts'),

  ALERT_RATE_LIMIT_WINDOW_MINUTES: Joi.number()
    .integer()
    .min(0)
    .max(ALERT_RATE_LIMIT_MAX_MINUTES) // Maximum 24 hours
    .default(ALERT_RATE_LIMIT_DEFAULT_MINUTES)
    .description('Rate limiting window for alerts in minutes (0 to disable)'),

  INCLUDE_FULL_MANIFESTS: Joi.boolean()
    .default(false)
    .description('Include full pod manifests in alert payloads'),

  // ====================================
  // RESILIENCE CONFIGURATION
  // ====================================
  RECONNECTION_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable/disable automatic reconnection on connection failures'),

  RECONNECTION_INITIAL_BACKOFF_MS: Joi.number()
    .integer()
    .min(RECONNECTION_BACKOFF_MIN_MS)
    .max(RECONNECTION_BACKOFF_MAX_MS)
    .default(RECONNECTION_BACKOFF_DEFAULT_MS)
    .description('Initial backoff delay for reconnection attempts (milliseconds)'),

  RECONNECTION_MAX_BACKOFF_MS: Joi.number()
    .integer()
    .min(RECONNECTION_MAX_BACKOFF_MIN_MS)
    .max(RECONNECTION_MAX_BACKOFF_MAX_MS)
    .default(RECONNECTION_MAX_BACKOFF_DEFAULT_MS)
    .description('Maximum backoff delay for reconnection attempts (milliseconds)'),

  RECONNECTION_BACKOFF_MULTIPLIER: Joi.number()
    .min(1.1)
    .max(10)
    .default(2)
    .description('Multiplier for exponential backoff calculation'),

  RECONNECTION_MAX_FAILURES: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(5)
    .description('Maximum consecutive failures before giving up reconnection'),

  // ====================================
  // HEALTH CHECK CONFIGURATION
  // ====================================
  ENABLE_HEALTH_CHECK: Joi.boolean()
    .default(false)
    .description('Enable HTTP health check server'),

  HEALTH_CHECK_PORT: Joi.number()
    .integer()
    .min(1024)
    .max(65535)
    .default(3000)
    .description('Port for health check server'),

  // ====================================
  // DEVELOPMENT CONFIGURATION
  // ====================================
  DEVELOPMENT_MODE: Joi.boolean()
    .default(false)
    .description('Enable development features and detailed logging'),

  KUBERNETES_DEBUG: Joi.boolean()
    .default(false)
    .description('Enable debug output for Kubernetes client'),

  KUBECONFIG_PATH: Joi.string()
    .allow('')
    .default('')
    .description('Custom kubeconfig path (empty for default)'),

}).required();

/**
 * Environment variable validation result
 */
interface ValidationResult {
  isValid: boolean;
  config?: ValidatedConfig;
  errors?: string[];
  warnings?: string[];
}

/**
 * Validated and typed configuration object
 */
interface ValidatedConfig {
  nodeEnv: string;
  logLevel: string;
  monitoring: {
    namespaces: string[];
    excludeNamespaces: string[];
    failureDetection: {
      minRestartThreshold: number;
      maxPendingDurationMs: number;
      enableCrashLoopDetection: boolean;
      enableImagePullFailureDetection: boolean;
      enableResourceLimitDetection: boolean;
    };
  };
  diagnosis: {
    enabled: boolean;
    timeoutMs: number;
    cacheConfig: {
      ttlMs: number;
      maxEntries: number;
    };
  };
  alerting: {
    webhookUrl?: string;
    retryPolicy: {
      maxAttempts: number;
      backoffMs: number;
      maxBackoffMs: number;
    };
    severityFilters: string[];
    rateLimitWindowMinutes: number;
    includeFullManifests: boolean;
  };
  resilience: {
    reconnectionPolicy: {
      enabled: boolean;
      initialBackoffMs: number;
      maxBackoffMs: number;
      backoffMultiplier: number;
      maxConsecutiveFailures: number;
    };
  };
  healthCheck: {
    enabled: boolean;
    port: number;
  };
  development: {
    mode: boolean;
    kubernetesDebug: boolean;
    kubeconfigPath?: string;
  };
}

/**
 * WatchdogConfig class with comprehensive Joi validation
 */
export class WatchdogConfig {
  private constructor(private readonly validatedConfig: ValidatedConfig) {}

  /**
   * Validates environment variables and creates a WatchdogConfig instance
   * 
   * @throws {Error} When validation fails with detailed error messages
   * @returns {WatchdogConfig} Validated configuration instance
   */
  static fromEnvironment(): WatchdogConfig {
    const result = this.validateEnvironment();
    
    if (!result.isValid || !result.config) {
      const errorMessage = [
        '❌ Environment variable validation failed:',
        '',
        ...(result.errors || []).map(error => `  • ${error}`),
        '',
        '💡 Check your .env file and ensure all required variables are properly set.',
        '📖 See .env.example for valid configuration examples.'
      ].join('\n');
      
      throw new Error(errorMessage);
    }

    // Log warnings if any
    if (result.warnings && result.warnings.length > 0) {
      console.log('⚠️  Configuration warnings:');
      result.warnings.forEach(warning => console.log(`  • ${warning}`));
      console.log('');
    }

    console.log('✅ Environment configuration validated successfully');
    console.log(`📋 Monitoring namespaces: ${result.config.monitoring.namespaces.join(', ')}`);
    console.log(`🔧 Alerting: ${result.config.alerting.webhookUrl ? 'enabled' : 'disabled'}`);
    console.log('');

    return new WatchdogConfig(result.config);
  }

  /**
   * Validates environment variables using Joi schema
   * 
   * @private
   * @returns {ValidationResult} Validation result with typed config or errors
   */
  private static validateEnvironment(): ValidationResult {
    const { error, value } = environmentSchema.validate(process.env, {
      allowUnknown: true,
      stripUnknown: false,
      abortEarly: false,
      convert: true
    });

    if (error) {
      return {
        isValid: false,
        errors: error.details.map(detail => {
          const field = detail.path.join('.');
          const message = detail.message;
          return `${field}: ${message}`;
        })
      };
    }

    // Convert validated environment to typed configuration
    const config: ValidatedConfig = {
      nodeEnv: value.NODE_ENV,
      logLevel: value.LOG_LEVEL,
      monitoring: {
        namespaces: value.WATCH_NAMESPACES.split(',').map((ns: string) => ns.trim()),
        excludeNamespaces: value.EXCLUDE_NAMESPACES.split(',').map((ns: string) => ns.trim()),
        failureDetection: {
          minRestartThreshold: value.MIN_RESTART_THRESHOLD,
          maxPendingDurationMs: value.MAX_PENDING_DURATION_MS,
          enableCrashLoopDetection: value.ENABLE_CRASH_LOOP_DETECTION,
          enableImagePullFailureDetection: value.ENABLE_IMAGE_PULL_FAILURE_DETECTION,
          enableResourceLimitDetection: value.ENABLE_RESOURCE_LIMIT_DETECTION,
        },
      },
      diagnosis: {
        enabled: value.DIAGNOSIS_ENABLED,
        timeoutMs: value.DIAGNOSIS_TIMEOUT_MS,
        cacheConfig: {
          ttlMs: value.DIAGNOSIS_CACHE_TTL_MS,
          maxEntries: value.DIAGNOSIS_CACHE_MAX_ENTRIES,
        },
      },
      alerting: {
        webhookUrl: value.WEBHOOK_URL || undefined,
        retryPolicy: {
          maxAttempts: value.ALERT_MAX_ATTEMPTS,
          backoffMs: value.ALERT_BACKOFF_MS,
          maxBackoffMs: value.ALERT_MAX_BACKOFF_MS,
        },
        severityFilters: value.ALERT_SEVERITY_FILTERS.split(',').map((filter: string) => filter.trim()),
        rateLimitWindowMinutes: value.ALERT_RATE_LIMIT_WINDOW_MINUTES,
        includeFullManifests: value.INCLUDE_FULL_MANIFESTS,
      },
      resilience: {
        reconnectionPolicy: {
          enabled: value.RECONNECTION_ENABLED,
          initialBackoffMs: value.RECONNECTION_INITIAL_BACKOFF_MS,
          maxBackoffMs: value.RECONNECTION_MAX_BACKOFF_MS,
          backoffMultiplier: value.RECONNECTION_BACKOFF_MULTIPLIER,
          maxConsecutiveFailures: value.RECONNECTION_MAX_FAILURES,
        },
      },
      healthCheck: {
        enabled: value.ENABLE_HEALTH_CHECK,
        port: value.HEALTH_CHECK_PORT,
      },
      development: {
        mode: value.DEVELOPMENT_MODE,
        kubernetesDebug: value.KUBERNETES_DEBUG,
        kubeconfigPath: value.KUBECONFIG_PATH || undefined,
      },
    };

    const warnings: string[] = [];
    
    // Add configuration warnings
    if (!config.alerting.webhookUrl && config.alerting.severityFilters.length > 0) {
      warnings.push('Alerting is configured but no WEBHOOK_URL provided - alerts will not be delivered');
    }

    if (config.monitoring.namespaces.length === 0) {
      warnings.push('No namespaces specified in WATCH_NAMESPACES - daemon will have nothing to monitor');
    }

    if (config.development.mode && config.nodeEnv === 'production') {
      warnings.push('DEVELOPMENT_MODE is enabled in production environment');
    }

    return {
      isValid: true,
      config,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Converts validated config to the interface expected by the watchdog
   * 
   * @returns {WatchdogConfiguration} Configuration for the watchdog system
   */
  toWatchdogConfiguration(): WatchdogConfiguration {
    return {
      monitoring: this.validatedConfig.monitoring,
      diagnosis: this.validatedConfig.diagnosis,
      alerting: this.validatedConfig.alerting as any, // Type assertion for severity filter compatibility
      resilience: this.validatedConfig.resilience,
    };
  }

  /**
   * Get health check configuration
   */
  getHealthCheckConfig() {
    return this.validatedConfig.healthCheck;
  }

  /**
   * Get development configuration
   */
  getDevelopmentConfig() {
    return this.validatedConfig.development;
  }

  /**
   * Get application configuration
   */
  getAppConfig() {
    return {
      nodeEnv: this.validatedConfig.nodeEnv,
      logLevel: this.validatedConfig.logLevel,
    };
  }
}