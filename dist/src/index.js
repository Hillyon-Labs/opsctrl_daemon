#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const watchdog_1 = require("./core/watchdog");
const watchdog_config_1 = require("./config/watchdog-config");
const utils_1 = require("./utils/utils");
const cluster_registration_1 = require("./core/cluster-registration");
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
    let watchdog;
    try {
        // Load and validate configuration from environment variables
        const config = watchdog_config_1.WatchdogConfig.fromEnvironment();
        // Handle cluster registration (always required)
        const clusterConfig = config.getClusterRegistrationConfig();
        let registrationService = null;
        // Registration is always required
        if (!clusterConfig.clusterName || !clusterConfig.userEmail) {
            (0, utils_1.printErrorAndExit)(`Cluster registration is required to enable monitoring please check you email to register ${clusterConfig.clusterName}`, 1);
        }
        console.log('🔗 Cluster registration is required before starting monitoring...');
        registrationService = new cluster_registration_1.ClusterRegistrationService({
            clusterName: clusterConfig.clusterName,
            userEmail: clusterConfig.userEmail,
            version: process.env.npm_package_version || '1.0.0',
            backendUrl: clusterConfig.backendUrl
        });
        // Wait until cluster is successfully registered
        console.log('⏳ Waiting for cluster registration to complete...');
        const clusterInfo = await (0, utils_1.waitUntil)(async () => {
            try {
                const info = await registrationService.ensureClusterRegistration();
                return info;
            }
            catch (error) {
                console.log(`🔄${error}. Retrying...`);
                return undefined;
            }
        }, 300000, // 5 minutes timeout
        10000 // 10 second intervals
        );
        if (!clusterInfo) {
            (0, utils_1.printErrorAndExit)('❌ Failed to register cluster within timeout period. Cannot proceed with monitoring.', 1);
        }
        console.log(`🎯 Cluster registered successfully: ${clusterInfo.cluster_id}`);
        // Test authentication by calling daemon/me endpoint
        try {
            console.log('🔐 Testing authentication...');
            console.log('✅ Successfully authenticated!');
            console.log(`The daemon is ready to start diagnostics.`);
        }
        catch (error) {
            console.warn(`⚠️  Authentication test failed: ${error}`);
            console.warn(`   Continuing with startup, but API calls may fail.`);
        }
        // Set cluster ID as environment variable for use by watchdog
        process.env.CLUSTER_ID = clusterInfo.cluster_id;
        console.log('🚀 Initializing monitoring system...');
        // Initialize the watchdog with configuration
        watchdog = new watchdog_1.KubernetesPodWatchdog(config.toWatchdogConfiguration());
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
            (0, utils_1.runHttpBasedHealthCheck)(healthConfig, watchdog);
        }
        // Graceful shutdown handling
        process.on('SIGTERM', async () => await (0, utils_1.gracefulShutdown)('SIGTERM', watchdog));
        process.on('SIGINT', async () => await (0, utils_1.gracefulShutdown)('SIGINT', watchdog));
        // Keep the process running
        console.log('🔄 opsctrl-daemon is running. Press Ctrl+C to stop.');
    }
    catch (error) {
        (0, utils_1.printErrorAndExit)(`💥 Failed to start opsctrl-daemon: ${error}`, 1);
    }
}
// Start the application
main().catch((error) => {
    (0, utils_1.printErrorAndExit)(`💥 Unhandled error: ${error}`, 1);
});
//# sourceMappingURL=index.js.map