import * as crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as k8s from '@kubernetes/client-node';
import { printErrorAndExit } from '../utils/utils';
import { TokenStorage } from './token-storage';
import { getUserClusterTokens, refreshClusterToken } from './client';

export interface ClusterRegistrationConfig {
  clusterName: string;
  userEmail: string;
  version: string;
  backendUrl?: string;
}

export interface ClusterRegistrationResponse {
  id: string;
  externalRefId: string;
  clusterName: string;
  userEmail: string;
  orgId?: string;
  organization?: {
    id: string;
    name: string;
  };
  isClaimed: boolean;
  claimedAt?: Date;
  claimedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClusterInfo {
  cluster_id: string;
  cluster_name: string;
  user_email: string;
  registered_at: string;
  org_id?: string;
  is_claimed?: boolean;
  cluster_foreign_id: string;
}

export interface PendingRegistration {
  cluster_id: string;
  cluster_name: string;
  user_email: string;
  registration_url: string;
  requires_browser_confirmation: boolean;
  created_at: string;
}

const CLUSTER_INFO_FILE = path.join(os.homedir(), '.opsctrl', 'cluster.json');
const PENDING_REGISTRATION_FILE = path.join(os.homedir(), '.opsctrl', 'pending.json');
const DEFAULT_BACKEND_URL = process.env.OPSCTRL_BACKEND_URL || 'https://api.opsctrl.dev';
const DEFAULT_FRONTEND_URL = process.env.OPSCTRL_FRONTEND_URL || 'https://app.opsctrl.dev';

export class ClusterRegistrationService {
  private readonly config: ClusterRegistrationConfig;
  private readonly backendUrl: string;
  private readonly DEFAULT_FRONTEND_URL: string;
  private readonly tokenStorage: TokenStorage;

  constructor(config: ClusterRegistrationConfig) {
    this.config = config;
    this.backendUrl = config.backendUrl || DEFAULT_BACKEND_URL;
    this.DEFAULT_FRONTEND_URL = DEFAULT_FRONTEND_URL;
    this.tokenStorage = new TokenStorage();
  }

  async getClusterId(): Promise<string> {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
      
      const response = await k8sApi.readNamespace({ name: 'kube-system' });
      const uid = response.metadata!.uid!;
      return 'clu_' + uid;
    } catch (error) {
      console.error('Failed to get kube-system namespace UID:', error);
      // Fallback to random ID if k8s client fails
      const randomBytes = crypto.randomBytes(8);
      return 'clu_' + randomBytes.toString('hex');
    }
  }

  async isClusterRegistered(): Promise<boolean> {
    return fs.existsSync(CLUSTER_INFO_FILE);
  }

  async loadClusterInfo(): Promise<ClusterInfo | null> {
    if (!fs.existsSync(CLUSTER_INFO_FILE)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(CLUSTER_INFO_FILE, 'utf-8');
      return JSON.parse(raw) as ClusterInfo;
    } catch (error) {
      console.error('Failed to load cluster info:', error);
      return null;
    }
  }

  async loadPendingRegistration(): Promise<PendingRegistration | null> {
    if (!fs.existsSync(PENDING_REGISTRATION_FILE)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(PENDING_REGISTRATION_FILE, 'utf-8');
      return JSON.parse(raw) as PendingRegistration;
    } catch (error) {
      console.error('Failed to load pending registration:', error);
      return null;
    }
  }

  private async savePendingRegistration(pendingReg: PendingRegistration): Promise<void> {
    const dir = path.dirname(PENDING_REGISTRATION_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(PENDING_REGISTRATION_FILE, JSON.stringify(pendingReg, null, 2));
  }

  private async removePendingRegistration(): Promise<void> {
    if (fs.existsSync(PENDING_REGISTRATION_FILE)) {
      fs.unlinkSync(PENDING_REGISTRATION_FILE);
    }
  }

  async verifyPendingRegistration(clusterId: string): Promise<ClusterInfo | null> {
    try {
      const response = await axios.get(
        `${this.backendUrl}/clusters/${clusterId}`,
        {
          timeout: 30000,
          headers: {
            'User-Agent': `opsctrl-daemon/${this.config.version}`
          }
        }
      );

      if(!response || !response.data) return null


      const results : ClusterRegistrationResponse = response.data;





      if (results.isClaimed === true && results.userEmail === this.config.userEmail) {
        // Registration is complete, create ClusterInfo
        const clusterInfo: ClusterInfo = {
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

      if(results.isClaimed === false && results.userEmail === this.config.userEmail) {
        const clusterInfo: ClusterInfo = {
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
        
        // Fetch and store tokens after successful registration
        console.log(`🚀 About to fetch and store tokens (path 2)...`);
        await this.fetchAndStoreTokens(clusterInfo);
        console.log(`🚀 Finished fetching and storing tokens (path 2).`);
      }
      
       // Still pending
      return null;
    } catch (error) {
      console.log(`🔄 Could not verify pending registration: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private async saveClusterInfo(clusterInfo: ClusterInfo): Promise<void> {
    const dir = path.dirname(CLUSTER_INFO_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(CLUSTER_INFO_FILE, JSON.stringify(clusterInfo, null, 2));
  }

  async registerCluster(): Promise<ClusterRegistrationResponse | null> {
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

    let lastError: Error | null = null;

    try {
      const response = await axios.post(
        `${this.backendUrl}/clusters`,
        registrationPayload,
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': `opsctrl-daemon/${this.config.version}`
          }
        }
      );

      const result: ClusterRegistrationResponse = response.data;
      
      const clusterInfo: ClusterInfo = {
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
        const pendingReg: PendingRegistration = {
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
        
        if (result.isClaimed === false) {
          console.log(`\n⚠️  Registration confirmation required - please check your email or visit the link above.`);
          console.log(`   The daemon will automatically detect when registration is confirmed.`);
        } else {
          console.log(`\n💡 Visit the link above to access your cluster dashboard (optional).`);
        }
        return result;
      } else {
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
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;
        
        lastError = new Error(`HTTP ${status}: ${message}`);

        console.error(`❌ Registration failed: ${lastError.message}`);

        return null;

      } else {
        lastError = new Error(`${error}`);
        console.error(`❌ Registration failed: ${lastError.message}`);

        return null;
      }
    }
    // Ensure all code paths return a value
    return null;
  }

  private isRetryableError(error: any): boolean {
    if (axios.isAxiosError(error)) {
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

  async ensureClusterRegistration(): Promise<ClusterInfo> {
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
        if (fs.existsSync(CLUSTER_INFO_FILE)) {
          fs.unlinkSync(CLUSTER_INFO_FILE);
        }
        
        // Also clear any stored tokens since they're for the wrong cluster
        const tokenStorage = new TokenStorage();
        await tokenStorage.clearTokens();
        
        console.log(`🔄 Proceeding with fresh cluster registration...`);
        // Continue with registration flow below
      } else {
        // Cluster ID matches, check tokens
        const tokenStorage = new TokenStorage();
        const hasValidToken = await tokenStorage.isTokenValid();
        
        if (!hasValidToken) {
          console.log(`🔐 No valid tokens found, fetching tokens for existing cluster...`);
          await this.fetchAndStoreTokens(existingClusterInfo);
        } else {
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

    console.log('🚀 No existing cluster registration found. Registering new cluster...');
    
    const result = await this.registerCluster();
    
    // If registration returned a URL, it's now pending
    if (result?.isClaimed === false) {
      throw new Error('Cluster registration initiated. Please check your email or visit the registration URL to complete the process.');
    }
    
    // Direct registration completed
    const clusterInfo = await this.loadClusterInfo();
    if (!clusterInfo) {
      throw new Error('Failed to save cluster information after registration');
    }
    
    return clusterInfo;
  }

  private async fetchAndStoreTokens(clusterInfo: ClusterInfo): Promise<void> {
    try {
      console.log(`🔐 Fetching authentication tokens for cluster ${clusterInfo.cluster_foreign_id}...`);
      console.log(`   Cluster ID: ${clusterInfo.cluster_foreign_id}`);
      console.log(`   Org ID: ${clusterInfo.org_id || 'none'}`);
      
      const tokens = await getUserClusterTokens(clusterInfo.cluster_foreign_id, clusterInfo.org_id || '');
      console.log(`📋 Received tokens response:`, tokens);
      
      if (tokens && tokens.length > 0) {
        const latestToken = tokens[0]; // Assuming the first token is the most recent
        console.log(`🎫 Latest token:`, latestToken);
        
        // The getUserClusterTokens returns refresh tokens, we need to use one to get access token
        const refreshTokenValue = latestToken.id; // Based on the backend response structure
        console.log(`🔄 Using refresh token: ${refreshTokenValue}`);
        
        // Use the refresh token to get access token
        const authResponse = await refreshClusterToken(refreshTokenValue, clusterInfo.cluster_id);
        console.log(`🔑 Auth response:`, authResponse);
        
        await this.tokenStorage.saveTokens(
          authResponse.accessToken,
          authResponse.refreshToken,
          authResponse.expiresIn,
          clusterInfo.cluster_id,
          clusterInfo.org_id
        );
        
        console.log(`✅ Authentication tokens stored successfully`);
      } else {
        console.log(`⚠️  No tokens found for cluster. Authentication may be required later.`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch tokens: ${error instanceof Error ? error.message : error}`);
      console.error(`   Full error:`, error);
      console.log(`   Authentication tokens can be fetched manually later if needed.`);
    }
  }
}