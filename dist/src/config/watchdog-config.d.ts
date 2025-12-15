import { WatchdogConfiguration } from '../common/interfaces/watchdog.interfaces';
/**
 * WatchdogConfig class with comprehensive Joi validation
 */
export declare class WatchdogConfig {
    private readonly validatedConfig;
    private constructor();
    /**
     * Validates environment variables and creates a WatchdogConfig instance
     *
     * @throws {Error} When validation fails with detailed error messages
     * @returns {WatchdogConfig} Validated configuration instance
     */
    static fromEnvironment(): WatchdogConfig;
    /**
     * Validates environment variables using Joi schema
     *
     * @private
     * @returns {ValidationResult} Validation result with typed config or errors
     */
    private static validateEnvironment;
    /**
     * Converts validated config to the interface expected by the watchdog
     *
     * @returns {WatchdogConfiguration} Configuration for the watchdog system
     */
    toWatchdogConfiguration(): WatchdogConfiguration;
    /**
     * Get health check configuration
     */
    getHealthCheckConfig(): {
        enabled: boolean;
        port: number;
    };
    /**
     * Get development configuration
     */
    getDevelopmentConfig(): {
        mode: boolean;
        kubernetesDebug: boolean;
        kubeconfigPath?: string;
    };
    /**
     * Get application configuration
     */
    getAppConfig(): {
        nodeEnv: string;
        logLevel: string;
    };
    /**
     * Get cluster registration configuration
     */
    getClusterRegistrationConfig(): {
        clusterName?: string;
        userEmail?: string;
        backendUrl: string;
    };
}
//# sourceMappingURL=watchdog-config.d.ts.map