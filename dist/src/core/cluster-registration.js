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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterRegistrationService = void 0;
const crypto = __importStar(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const k8s = __importStar(require("@kubernetes/client-node"));
const token_storage_1 = require("./token-storage");
const client_1 = require("./client");
const CLUSTER_INFO_FILE = path_1.default.join(os_1.default.homedir(), '.opsctrl', 'cluster.json');
const PENDING_REGISTRATION_FILE = path_1.default.join(os_1.default.homedir(), '.opsctrl', 'pending.json');
const DEFAULT_BACKEND_URL = process.env.OPSCTRL_BACKEND_URL || 'https://api.opsctrl.dev';
const DEFAULT_FRONTEND_URL = process.env.OPSCTRL_FRONTEND_URL || 'https://app.opsctrl.dev';
class ClusterRegistrationService {
    constructor(config) {
        this.registrationInProgress = false;
        this.config = config;
        this.backendUrl = config.backendUrl || DEFAULT_BACKEND_URL;
        this.DEFAULT_FRONTEND_URL = DEFAULT_FRONTEND_URL;
        this.tokenStorage = new token_storage_1.TokenStorage();
    }
    async getClusterId() {
        try {
            const kc = new k8s.KubeConfig();
            kc.loadFromDefault();
            const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
            const response = await k8sApi.readNamespace({ name: 'kube-system' });
            const uid = response.metadata.uid;
            return 'clu_' + uid;
        }
        catch (error) {
            console.error('Failed to get kube-system namespace UID:', error);
            // Fallback to random ID if k8s client fails
            const randomBytes = crypto.randomBytes(8);
            return 'clu_' + randomBytes.toString('hex');
        }
    }
    async isClusterRegistered() {
        return fs_1.default.existsSync(CLUSTER_INFO_FILE);
    }
    async loadClusterInfo() {
        if (!fs_1.default.existsSync(CLUSTER_INFO_FILE)) {
            return null;
        }
        try {
            const raw = fs_1.default.readFileSync(CLUSTER_INFO_FILE, 'utf-8');
            return JSON.parse(raw);
        }
        catch (error) {
            console.error('Failed to load cluster info:', error);
            return null;
        }
    }
    async loadPendingRegistration() {
        if (!fs_1.default.existsSync(PENDING_REGISTRATION_FILE)) {
            return null;
        }
        try {
            const raw = fs_1.default.readFileSync(PENDING_REGISTRATION_FILE, 'utf-8');
            return JSON.parse(raw);
        }
        catch (error) {
            console.error('Failed to load pending registration:', error);
            return null;
        }
    }
    async savePendingRegistration(pendingReg) {
        const dir = path_1.default.dirname(PENDING_REGISTRATION_FILE);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(PENDING_REGISTRATION_FILE, JSON.stringify(pendingReg, null, 2));
    }
    async removePendingRegistration() {
        if (fs_1.default.existsSync(PENDING_REGISTRATION_FILE)) {
            fs_1.default.unlinkSync(PENDING_REGISTRATION_FILE);
        }
    }
    async verifyPendingRegistration(clusterId) {
        try {
            const response = await axios_1.default.get(`${this.backendUrl}/clusters/${clusterId}`, {
                timeout: 30000,
                headers: {
                    'User-Agent': `opsctrl-daemon/${this.config.version}`
                }
            });
            if (!response || !response.data)
                return null;
            const results = response.data;
            if (results.isClaimed === true && results.userEmail === this.config.userEmail) {
                // Registration is complete, create ClusterInfo
                const clusterInfo = {
                    cluster_id: clusterId,
                    cluster_name: this.config.clusterName,
                    user_email: this.config.userEmail,
                    registered_at: new Date().toISOString(),
                    is_claimed: true,
                    org_id: results.orgId,
                    cluster_foreign_id: results.id
                };
                await this.saveClusterInfo(clusterInfo);
                await this.removePendingRegistration();
                console.log(`✅ Cluster registration confirmed by backend!`);
                console.log(`   Cluster ID: ${clusterInfo.cluster_id}`);
                // Fetch and store tokens after successful registration
                console.log(`🚀 About to fetch and store tokens...`);
                await this.fetchAndStoreTokens(clusterInfo);
                console.log(`🚀 Finished fetching and storing tokens.`);
                return clusterInfo;
            }
            if (results.isClaimed === false && results.userEmail === this.config.userEmail) {
                // Still not claimed, keep waiting
                console.log(`⏳ Cluster registration still pending user confirmation`);
                return null;
            }
            // Still pending
            return null;
        }
        catch (error) {
            console.log(`🔄 Could not verify pending registration: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }
    async saveClusterInfo(clusterInfo) {
        const dir = path_1.default.dirname(CLUSTER_INFO_FILE);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(CLUSTER_INFO_FILE, JSON.stringify(clusterInfo, null, 2));
    }
    async registerCluster() {
        const clusterId = await this.getClusterId();
        const registrationPayload = {
            externalRefId: clusterId,
            clusterName: this.config.clusterName,
            userEmail: this.config.userEmail,
        };
        console.log(`🔄 Registering cluster with backend: ${this.backendUrl}`);
        console.log(`   Cluster ID: ${clusterId}`);
        console.log(`   Cluster Name: ${this.config.clusterName}`);
        console.log(`   User Email: ${this.config.userEmail}`);
        let lastError = null;
        try {
            const response = await axios_1.default.post(`${this.backendUrl}/clusters`, registrationPayload, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': `opsctrl-daemon/${this.config.version}`
                }
            });
            const result = response.data;
            const clusterInfo = {
                cluster_id: clusterId,
                cluster_name: this.config.clusterName,
                user_email: this.config.userEmail,
                registered_at: new Date().toISOString(),
                is_claimed: result.isClaimed || false,
                org_id: result.orgId,
                cluster_foreign_id: result.id
            };
            // Handle registration completion based on backend response
            if (result.isClaimed === false) {
                // Save pending registration state
                const pendingReg = {
                    cluster_id: clusterId,
                    cluster_name: this.config.clusterName,
                    user_email: this.config.userEmail,
                    created_at: new Date().toISOString(),
                    registration_url: `${this.DEFAULT_FRONTEND_URL}/`,
                    requires_browser_confirmation: false
                };
                await this.savePendingRegistration(pendingReg);
                console.log(`📧 Cluster pre-registered successfully! Awaiting backend confirmation.`);
                console.log(`   Cluster ID: ${clusterInfo.cluster_id}`);
                console.log(`\n🌐 Complete your cluster registration:`);
                console.log(`   ${this.DEFAULT_FRONTEND_URL}/claim?cluster=${clusterId}`);
                return result;
            }
            else {
                // Direct registration (no URL provided)
                await this.saveClusterInfo(clusterInfo);
                console.log(`✅ Cluster already registered and claimed!`);
                console.log(`   Cluster ID: ${clusterInfo.cluster_id}`);
                // Fetch and store tokens after successful registration
                console.log(`🚀 About to fetch and store tokens (path 3)...`);
                await this.fetchAndStoreTokens(clusterInfo);
                console.log(`🚀 Finished fetching and storing tokens (path 3).`);
                return result;
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                const status = error.response?.status;
                const message = error.response?.data?.message || error.message;
                lastError = new Error(`HTTP ${status}: ${message}`);
                console.error(`❌ Registration failed: ${lastError.message}`);
                return null;
            }
            else {
                lastError = new Error(`${error}`);
                console.error(`❌ Registration failed: ${lastError.message}`);
                return null;
            }
        }
        // Ensure all code paths return a value
        return null;
    }
    isRetryableError(error) {
        if (axios_1.default.isAxiosError(error)) {
            const status = error.response?.status;
            if (!status) {
                return true;
            }
            return status >= 500 || status === 429 || status === 408;
        }
        return error.code === 'ENOTFOUND' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNRESET';
    }
    async ensureClusterRegistration() {
        // Prevent concurrent registration attempts
        if (this.registrationInProgress) {
            throw new Error('Cluster registration already in progress. Please wait for completion.');
        }
        // First check for completed registration
        const existingClusterInfo = await this.loadClusterInfo();
        if (existingClusterInfo) {
            console.log(`🔍 Found existing cluster registration: ${existingClusterInfo.cluster_id}`);
            // Validate that the existing cluster info matches current environment
            const currentClusterId = await this.getClusterId();
            if (existingClusterInfo.cluster_id !== currentClusterId) {
                console.log(`⚠️  Cluster ID mismatch detected!`);
                console.log(`   Saved cluster ID: ${existingClusterInfo.cluster_id}`);
                console.log(`   Current cluster ID: ${currentClusterId}`);
                console.log(`🗑️  Deleting existing cluster.json to prevent conflicts...`);
                // Delete the existing cluster.json file
                if (fs_1.default.existsSync(CLUSTER_INFO_FILE)) {
                    fs_1.default.unlinkSync(CLUSTER_INFO_FILE);
                }
                // Also clear any stored tokens since they're for the wrong cluster
                const tokenStorage = new token_storage_1.TokenStorage();
                await tokenStorage.clearTokens();
                console.log(`🔄 Proceeding with fresh cluster registration...`);
                // Continue with registration flow below
            }
            else {
                // Cluster ID matches, check tokens
                const tokenStorage = new token_storage_1.TokenStorage();
                const hasValidToken = await tokenStorage.isTokenValid();
                if (!hasValidToken) {
                    console.log(`🔐 No valid tokens found, fetching tokens for existing cluster...`);
                    await this.fetchAndStoreTokens(existingClusterInfo);
                }
                else {
                    console.log(`✅ Valid tokens already exist for cluster`);
                }
                return existingClusterInfo;
            }
        }
        // Check for pending registration
        const pendingRegistration = await this.loadPendingRegistration();
        if (pendingRegistration) {
            console.log(`🔄 Found pending cluster registration: ${pendingRegistration.cluster_id}`);
            console.log(`   Registration URL: ${pendingRegistration.registration_url}`);
            // Try to verify if registration is now complete
            const verifiedClusterInfo = await this.verifyPendingRegistration(pendingRegistration.cluster_id);
            if (verifiedClusterInfo) {
                return verifiedClusterInfo;
            }
            console.log(`⏳ Registration still pending. Please complete registration:`);
            console.log(`   ${pendingRegistration.registration_url}`);
            if (pendingRegistration.requires_browser_confirmation) {
                console.log(`   📧 Check your email for registration confirmation.`);
            }
            // Return the cluster info from pending registration (but monitoring won't start)
            throw new Error('Cluster registration is pending completion. Please check your email or visit the registration URL.');
        }
        try {
            this.registrationInProgress = true;
            console.log('🚀 No existing cluster registration found. Registering new cluster...');
            const result = await this.registerCluster();
            // If registration returned a pending state, throw error to wait for completion
            if (result?.isClaimed === false) {
                throw new Error('Cluster registration initiated. Please check your email or visit the registration URL to complete the process.');
            }
            // Direct registration completed - load the saved cluster info
            const clusterInfo = await this.loadClusterInfo();
            if (!clusterInfo) {
                throw new Error('Registration appeared to complete but cluster info was not saved properly.');
            }
            return clusterInfo;
        }
        finally {
            this.registrationInProgress = false;
        }
    }
    async fetchAndStoreTokens(clusterInfo) {
        try {
            console.log(`🔐 Fetching authentication tokens...`);
            const tokens = await (0, client_1.getUserClusterTokens)(clusterInfo.cluster_foreign_id, clusterInfo.org_id);
            if (tokens && tokens.length > 0) {
                const latestToken = tokens[0]; // Assuming the first token is the most recent
                const refreshTokenValue = latestToken.token; // Based on the backend response structure
                // Use the refresh token to get access token
                const authResponse = await (0, client_1.refreshClusterToken)(refreshTokenValue, clusterInfo.cluster_foreign_id);
                await this.tokenStorage.saveTokens(authResponse.accessToken, authResponse.refreshToken, authResponse.expiresIn, clusterInfo.cluster_id, clusterInfo.org_id);
                console.log(`✅ Authentication tokens stored successfully`);
            }
            else {
                console.log(`⚠️  No tokens found for cluster. Authentication may be required later.`);
            }
        }
        catch (error) {
            console.error(`❌ Failed to fetch tokens: ${error instanceof Error ? error.message : error}`);
            console.error(`   Full error:`, error);
            console.log(`   Authentication tokens can be fetched manually later if needed.`);
        }
    }
}
exports.ClusterRegistrationService = ClusterRegistrationService;
//# sourceMappingURL=cluster-registration.js.map