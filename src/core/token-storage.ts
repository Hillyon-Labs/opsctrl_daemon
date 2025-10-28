import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { DEFAULT_API_URL } from './config';

interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  clusterId: string;
  orgId?: string;
}

const TOKEN_FILE = path.join(os.homedir(), '.opsctrl', 'tokens.json');

export class TokenStorage {
  private ensureDirectory(): void {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async saveTokens(
    accessToken: string, 
    refreshToken: string, 
    expiresIn: number,
    clusterId: string,
    orgId?: string
  ): Promise<void> {
    this.ensureDirectory();
    
    const tokenInfo: TokenInfo = {
      accessToken,
      refreshToken,
      expiresIn,
      expiresAt: Date.now() + (expiresIn * 1000),
      clusterId,
      orgId
    };

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenInfo, null, 2));
  }

  async loadTokens(): Promise<TokenInfo | null> {
    if (!fs.existsSync(TOKEN_FILE)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(raw) as TokenInfo;
    } catch (error) {
      console.error('Failed to load tokens:', error);
      return null;
    }
  }

  async clearTokens(): Promise<void> {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  }

  async isTokenValid(): Promise<boolean> {
    const tokenInfo = await this.loadTokens();
    if (!tokenInfo) {
      return false;
    }

    // Check if token expires within the next 2 minutes (reduced buffer)
    const bufferTime = 2 * 60 * 1000; // 2 minutes in milliseconds
    return Date.now() < (tokenInfo.expiresAt - bufferTime);
  }

  async getValidAccessToken(): Promise<string | null> {
    const tokenInfo = await this.loadTokens();
    if (!tokenInfo) {
      return null;
    }

    const isValid = await this.isTokenValid();
    if (isValid) {
      return tokenInfo.accessToken;
    }

    // Token is expired or invalid, try to refresh
    const refreshed = await this.refreshTokens();
    if (refreshed) {
      const newTokenInfo = await this.loadTokens();
      if (newTokenInfo?.accessToken) {
        return newTokenInfo.accessToken;
      }
    }

    // If refresh failed but we still have tokens, return the existing one
    // The API call will get a 401 and trigger the refresh retry mechanism
    if (tokenInfo?.accessToken) {
      return tokenInfo.accessToken;
    }

    return null;
  }

  async refreshTokens(retryCount = 0): Promise<boolean> {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    try {
      const tokenInfo = await this.loadTokens();
      if (!tokenInfo || !tokenInfo.refreshToken) {
        return false;
      }

      // Call refresh endpoint directly to avoid circular dependency
      const response = await axios.post(
        `${DEFAULT_API_URL}/auth/cluster/refresh`,
        { 
          refreshToken: tokenInfo.refreshToken, 
          clusterId: tokenInfo.clusterId 
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        }
      );
      
      await this.saveTokens(
        response.data.accessToken,
        response.data.refreshToken,
        response.data.expiresIn,
        tokenInfo.clusterId,
        tokenInfo.orgId
      );

      return true;
    } catch (error: any) {
      const isNetworkError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT';
      const is5xxError = error.response?.status >= 500;
      
      if ((isNetworkError || is5xxError) && retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.refreshTokens(retryCount + 1);
      }
      
      // Only clear tokens if it's a 401/403 (invalid refresh token)
      // DO NOT clear tokens for network errors or retries - that prevents recovery
      if (error.response?.status === 401 || error.response?.status === 403) {
        await this.clearTokens();
        await this.refreshTokens();
      }
      
      return false;
    }
  }

  /**
   * Debug token storage status
   */
  async debugTokenStatus(): Promise<void> {
    console.log('🔍 Token storage debug:');
    console.log(`📁 Token file path: ${TOKEN_FILE}`);
    console.log(`📄 File exists: ${fs.existsSync(TOKEN_FILE)}`);
    
    if (fs.existsSync(TOKEN_FILE)) {
      try {
        const stats = fs.statSync(TOKEN_FILE);
        console.log(`📅 File modified: ${stats.mtime}`);
        console.log(`📏 File size: ${stats.size} bytes`);
        
        const tokenInfo = await this.loadTokens();
        if (tokenInfo) {
          console.log(`🆔 Cluster ID: ${tokenInfo.clusterId}`);
          console.log(`⏰ Expires at: ${new Date(tokenInfo.expiresAt)}`);
          console.log(`⏰ Current time: ${new Date()}`);
          console.log(`⏱️  Time until expiry: ${Math.round((tokenInfo.expiresAt - Date.now()) / 1000 / 60)} minutes`);
          console.log(`✅ Has access token: ${!!tokenInfo.accessToken}`);
          console.log(`🔄 Has refresh token: ${!!tokenInfo.refreshToken}`);
        }
      } catch (error) {
        console.error('❌ Error reading token file:', error);
      }
    }
  }

  /**
   * Make an authenticated API call with automatic token refresh on 401
   */
  async makeAuthenticatedRequest<T>(
    requestFn: (token: string) => Promise<T>,
    retryCount = 0
  ): Promise<T | null> {

    try {
      const token = await this.getValidAccessToken();
      if (!token) {
        return null;
      }

      return await requestFn(token);
    } catch (error: any) {
      // If we get a 401 and haven't retried yet, refresh token and try again
      if (error.response?.status === 401 && retryCount === 0) {
        const refreshed = await this.refreshTokens();
        
        if (refreshed) {
          return this.makeAuthenticatedRequest(requestFn, retryCount + 1);
        }
      }
      
      throw error;
    }
  }
}