import * as crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ClusterRegistrationConfig {
  clusterName: string;
  userEmail: string;
  version: string;
  backendUrl?: string;
}

export interface ClusterRegistrationResponse {
  cluster_id: string;
  status: string;
  message?: string;
  registration_url?: string;
  requires_browser_confirmation?: boolean;
}

export interface ClusterInfo {
  cluster_id: string;
  cluster_name: string;
  user_email: string;
  registered_at: string;
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
const DEFAULT_BACKEND_URL = process.env.OPSCTRL_BACKEND_URL || 'https://api.opsctrl.io';

export class ClusterRegistrationService {
  private readonly config: ClusterRegistrationConfig;
  private readonly backendUrl: string;

  constructor(config: ClusterRegistrationConfig) {
    this.config = config;
    this.backendUrl = config.backendUrl || DEFAULT_BACKEND_URL;
  }

  generateClusterId(): string {
    const randomBytes = crypto.randomBytes(8);
    const clusterId = 'clu_' + randomBytes.toString('hex');
    return clusterId;
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
        `${this.backendUrl}/api/clusters/${clusterId}/status`,
        {
          timeout: 30000,
          headers: {
            'User-Agent': `opsctrl-daemon/${this.config.version}`
          }
        }
      );

      const data = response.data;
      if (data.status === 'active' || data.status === 'confirmed') {
        // Registration is complete, create ClusterInfo
        const clusterInfo: ClusterInfo = {
          cluster_id: clusterId,
          cluster_name: this.config.clusterName,
          user_email: this.config.userEmail,
          registered_at: new Date().toISOString()
        };

        await this.saveClusterInfo(clusterInfo);
        await this.removePendingRegistration();
        
        console.log(`✅ Cluster registration confirmed by backend!`);
        console.log(`   Cluster ID: ${clusterInfo.cluster_id}`);
        
        return clusterInfo;
      }
      
      return null; // Still pending
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

  async registerCluster(maxRetries: number = 3): Promise<ClusterRegistrationResponse> {
    const clusterId = this.generateClusterId();
    
    const registrationPayload = {
      cluster_id: clusterId,
      cluster_name: this.config.clusterName,
      user_email: this.config.userEmail,
      version: this.config.version
    };

    console.log(`🔄 Registering cluster with backend: ${this.backendUrl}`);
    console.log(`   Cluster ID: ${clusterId}`);
    console.log(`   Cluster Name: ${this.config.clusterName}`);
    console.log(`   User Email: ${this.config.userEmail}`);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.backendUrl}/api/clusters/register`,
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
          cluster_id: result.cluster_id || clusterId,
          cluster_name: this.config.clusterName,
          user_email: this.config.userEmail,
          registered_at: new Date().toISOString()
        };

        // Handle registration completion based on backend response
        if (result.registration_url) {
          // Save pending registration state
          const pendingReg: PendingRegistration = {
            cluster_id: result.cluster_id || clusterId,
            cluster_name: this.config.clusterName,
            user_email: this.config.userEmail,
            registration_url: result.registration_url,
            requires_browser_confirmation: result.requires_browser_confirmation || false,
            created_at: new Date().toISOString()
          };

          await this.savePendingRegistration(pendingReg);
          
          console.log(`📧 Cluster pre-registered successfully! Awaiting backend confirmation.`);
          console.log(`   Cluster ID: ${clusterInfo.cluster_id}`);
          console.log(`\n🌐 Complete your cluster registration:`);
          console.log(`   ${result.registration_url}`);
          
          if (result.requires_browser_confirmation) {
            console.log(`\n⚠️  Registration confirmation required - please check your email or visit the link above.`);
            console.log(`   The daemon will automatically detect when registration is confirmed.`);
          } else {
            console.log(`\n💡 Visit the link above to access your cluster dashboard (optional).`);
          }
        } else {
          // Direct registration (no URL provided)
          await this.saveClusterInfo(clusterInfo);
          console.log(`✅ Cluster registered successfully!`);
          console.log(`   Cluster ID: ${clusterInfo.cluster_id}`);
        }
        
        return result;

      } catch (error) {
        const isRetryableError = this.isRetryableError(error);
        
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const message = error.response?.data?.message || error.message;
          
          lastError = new Error(`HTTP ${status}: ${message}`);
          
          console.error(`❌ Registration attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
          
          if (!isRetryableError || attempt === maxRetries) {
            break;
          }
        } else {
          lastError = new Error(`${error}`);
          console.error(`❌ Registration attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
          
          if (!isRetryableError || attempt === maxRetries) {
            break;
          }
        }

        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          console.log(`   Retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw new Error(`Cluster registration failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
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
      return existingClusterInfo;
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
    if (result.registration_url) {
      throw new Error('Cluster registration initiated. Please check your email or visit the registration URL to complete the process.');
    }
    
    // Direct registration completed
    const clusterInfo = await this.loadClusterInfo();
    if (!clusterInfo) {
      throw new Error('Failed to save cluster information after registration');
    }
    
    return clusterInfo;
  }
}