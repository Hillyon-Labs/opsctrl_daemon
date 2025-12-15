"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatchdogConfig = void 0;
const joi_1 = __importDefault(require("joi"));
const time_constants_1 = require("../common/time.constants");
const kube_1 = require("../core/kube");
/**
 * Comprehensive environment variable validation schema using Joi
 * This schema defines validation rules, default values, and detailed error messages
 * for all environment variables used by the opsctrl-daemon
 */
const environmentSchema = joi_1.default.object({
    // ====================================
    // APPLICATION CONFIGURATION
    // ====================================
    NODE_ENV: joi_1.default.string()
        .valid('development', 'production', 'staging', 'test')
        .default('development')
        .description('Node.js environment mode'),
    LOG_LEVEL: joi_1.default.string()
        .valid('error', 'warn', 'info', 'debug', 'trace')
        .default('info')
        .description('Logging verbosity level'),
    // ====================================
    // MONITORING CONFIGURATION (REQUIRED)
    // ====================================
    WATCH_NAMESPACES: joi_1.default.string()
        .required()
        .pattern(/^[a-z0-9-,]+$/)
        .messages({
        'string.pattern.base': 'WATCH_NAMESPACES must be comma-separated namespace names (lowercase, numbers, hyphens only)',
        'any.required': 'WATCH_NAMESPACES is required for targeted monitoring'
    })
        .description('Comma-separated list of namespaces to monitor - REQUIRED for targeted monitoring'),
    EXCLUDE_NAMESPACES: joi_1.default.string()
        .default('kube-system,kube-public,kube-node-lease')
        .pattern(/^[a-z0-9-,]+$/)
        .description('Comma-separated list of namespaces to exclude from monitoring'),
    MIN_RESTART_THRESHOLD: joi_1.default.number()
        .integer()
        .min(1)
        .max(100)
        .default(3)
        .description('Minimum container restart count to trigger failure detection'),
    MAX_PENDING_DURATION_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.MAX_PENDING_DURATION_MIN_MS) // Minimum 30 seconds
        .max(time_constants_1.MAX_PENDING_DURATION_MAX_MS) // Maximum 1 hour
        .default(time_constants_1.MAX_PENDING_DURATION_DEFAULT_MS)
        .description('Maximum time a pod can remain in Pending state (milliseconds)'),
    ENABLE_CRASH_LOOP_DETECTION: joi_1.default.boolean()
        .default(true)
        .description('Enable detection of crash loop back-off patterns'),
    ENABLE_IMAGE_PULL_FAILURE_DETECTION: joi_1.default.boolean()
        .default(true)
        .description('Enable detection of image pull failures'),
    ENABLE_RESOURCE_LIMIT_DETECTION: joi_1.default.boolean()
        .default(true)
        .description('Enable detection of resource limit violations'),
    // ====================================
    // DIAGNOSIS CONFIGURATION
    // ====================================
    DIAGNOSIS_ENABLED: joi_1.default.boolean()
        .default(true)
        .description('Enable/disable automated diagnosis execution'),
    DIAGNOSIS_TIMEOUT_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.DIAGNOSIS_MIN_TIMEOUT_MS) // Minimum 5 seconds
        .max(time_constants_1.DIAGNOSIS_MAX_TIMEOUT_MS) // Maximum 5 minutes
        .default(time_constants_1.DIAGNOSIS_DEFAULT_TIMEOUT_MS)
        .description('Timeout for diagnosis command execution (milliseconds)'),
    DIAGNOSIS_CACHE_TTL_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.DIAGNOSIS_CACHE_MIN_TTL_MS) // Minimum 1 minute
        .max(time_constants_1.DIAGNOSIS_CACHE_MAX_TTL_MS) // Maximum 24 hours
        .default(time_constants_1.DIAGNOSIS_CACHE_DEFAULT_TTL_MS)
        .description('Time-to-live for cached diagnosis results (milliseconds)'),
    DIAGNOSIS_CACHE_MAX_ENTRIES: joi_1.default.number()
        .integer()
        .min(10)
        .max(50000)
        .default(1000)
        .description('Maximum number of entries to keep in diagnosis cache'),
    // ====================================
    // ALERTING CONFIGURATION
    // ====================================
    WEBHOOK_URL: joi_1.default.string()
        .allow('') // Allow empty string
        .uri({ scheme: ['http', 'https'] })
        .optional()
        .description('Webhook URL for sending alerts (optional)'),
    ALERT_MAX_ATTEMPTS: joi_1.default.number()
        .integer()
        .min(1)
        .max(10)
        .default(3)
        .description('Maximum number of retry attempts for failed alert deliveries'),
    ALERT_BACKOFF_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.ALERT_BACKOFF_MIN_MS)
        .max(time_constants_1.ALERT_BACKOFF_MAX_MS)
        .default(time_constants_1.ALERT_BACKOFF_DEFAULT_MS)
        .description('Initial backoff delay for alert retries (milliseconds)'),
    ALERT_MAX_BACKOFF_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.ALERT_MAX_BACKOFF_MIN_MS)
        .max(time_constants_1.ALERT_MAX_BACKOFF_MAX_MS)
        .default(time_constants_1.ALERT_MAX_BACKOFF_DEFAULT_MS)
        .description('Maximum backoff delay for alert retries (milliseconds)'),
    ALERT_SEVERITY_FILTERS: joi_1.default.string()
        .pattern(/^(informational|low|medium|high|critical)(,(informational|low|medium|high|critical))*$/)
        .default('medium,high,critical')
        .messages({
        'string.pattern.base': 'ALERT_SEVERITY_FILTERS must contain valid severity levels: informational,low,medium,high,critical'
    })
        .description('Severity levels that should trigger alerts'),
    ALERT_RATE_LIMIT_WINDOW_MINUTES: joi_1.default.number()
        .integer()
        .min(0)
        .max(time_constants_1.ALERT_RATE_LIMIT_MAX_MINUTES) // Maximum 24 hours
        .default(time_constants_1.ALERT_RATE_LIMIT_DEFAULT_MINUTES)
        .description('Rate limiting window for alerts in minutes (0 to disable)'),
    INCLUDE_FULL_MANIFESTS: joi_1.default.boolean()
        .default(false)
        .description('Include full pod manifests in alert payloads'),
    // ====================================
    // RESILIENCE CONFIGURATION
    // ====================================
    RECONNECTION_ENABLED: joi_1.default.boolean()
        .default(true)
        .description('Enable/disable automatic reconnection on connection failures'),
    RECONNECTION_INITIAL_BACKOFF_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.RECONNECTION_BACKOFF_MIN_MS)
        .max(time_constants_1.RECONNECTION_BACKOFF_MAX_MS)
        .default(time_constants_1.RECONNECTION_BACKOFF_DEFAULT_MS)
        .description('Initial backoff delay for reconnection attempts (milliseconds)'),
    RECONNECTION_MAX_BACKOFF_MS: joi_1.default.number()
        .integer()
        .min(time_constants_1.RECONNECTION_MAX_BACKOFF_MIN_MS)
        .max(time_constants_1.RECONNECTION_MAX_BACKOFF_MAX_MS)
        .default(time_constants_1.RECONNECTION_MAX_BACKOFF_DEFAULT_MS)
        .description('Maximum backoff delay for reconnection attempts (milliseconds)'),
    RECONNECTION_BACKOFF_MULTIPLIER: joi_1.default.number()
        .min(1.1)
        .max(10)
        .default(2)
        .description('Multiplier for exponential backoff calculation'),
    RECONNECTION_MAX_FAILURES: joi_1.default.number()
        .integer()
        .min(1)
        .max(100)
        .default(5)
        .description('Maximum consecutive failures before giving up reconnection'),
    // ====================================
    // HEALTH CHECK CONFIGURATION
    // ====================================
    ENABLE_HEALTH_CHECK: joi_1.default.boolean()
        .default(false)
        .description('Enable HTTP health check server'),
    HEALTH_CHECK_PORT: joi_1.default.number()
        .integer()
        .min(1024)
        .max(65535)
        .default(3000)
        .description('Port for health check server'),
    // ====================================
    // DEVELOPMENT CONFIGURATION
    // ====================================
    DEVELOPMENT_MODE: joi_1.default.boolean()
        .default(false)
        .description('Enable development features and detailed logging'),
    KUBERNETES_DEBUG: joi_1.default.boolean()
        .default(false)
        .description('Enable debug output for Kubernetes client'),
    KUBECONFIG_PATH: joi_1.default.string()
        .allow('')
        .default('')
        .description('Custom kubeconfig path (empty for default)'),
    // ====================================
    // CLUSTER REGISTRATION CONFIGURATION
    // ====================================
    CLUSTER_NAME: joi_1.default.string()
        .optional()
        .pattern(/^[a-zA-Z0-9-_]+$/)
        .min(1)
        .max(64)
        .messages({
        'string.pattern.base': 'CLUSTER_NAME must contain only alphanumeric characters, hyphens, and underscores',
        'string.min': 'CLUSTER_NAME must be at least 1 character long',
        'string.max': 'CLUSTER_NAME must be less than 64 characters long'
    })
        .description('Unique name for this cluster (for registration with backend)'),
    USER_EMAIL: joi_1.default.string()
        .optional()
        .email()
        .description('User email address for cluster registration'),
    OPSCTRL_BACKEND_URL: joi_1.default.string()
        .optional()
        .uri({ scheme: ['http', 'https'] })
        .default('https://api.opsctrl.dev')
        .description('Backend URL for cluster registration'),
}).required();
/**
 * WatchdogConfig class with comprehensive Joi validation
 */
class WatchdogConfig {
    constructor(validatedConfig) {
        this.validatedConfig = validatedConfig;
    }
    /**
     * Validates environment variables and creates a WatchdogConfig instance
     *
     * @throws {Error} When validation fails with detailed error messages
     * @returns {WatchdogConfig} Validated configuration instance
     */
    static fromEnvironment() {
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
    static validateEnvironment() {
        const { error, value } = environmentSchema.validate(process.env, {
            allowUnknown: true,
            stripUnknown: false,
            abortEarly: false,
            convert: true
        });
        const currentClusterName = (0, kube_1.getCurrentContext)();
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
        const config = {
            nodeEnv: value.NODE_ENV,
            logLevel: value.LOG_LEVEL,
            monitoring: {
                namespaces: value.WATCH_NAMESPACES.split(',').map((ns) => ns.trim()),
                excludeNamespaces: value.EXCLUDE_NAMESPACES.split(',').map((ns) => ns.trim()),
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
                severityFilters: value.ALERT_SEVERITY_FILTERS.split(',').map((filter) => filter.trim()),
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
            clusterRegistration: {
                clusterName: currentClusterName || undefined,
                userEmail: value.USER_EMAIL || undefined,
                backendUrl: value.OPSCTRL_BACKEND_URL,
            },
        };
        const warnings = [];
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
    toWatchdogConfiguration() {
        return {
            monitoring: this.validatedConfig.monitoring,
            diagnosis: this.validatedConfig.diagnosis,
            alerting: this.validatedConfig.alerting, // Type assertion for severity filter compatibility
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
    /**
     * Get cluster registration configuration
     */
    getClusterRegistrationConfig() {
        return this.validatedConfig.clusterRegistration;
    }
}
exports.WatchdogConfig = WatchdogConfig;
//# sourceMappingURL=watchdog-config.js.map