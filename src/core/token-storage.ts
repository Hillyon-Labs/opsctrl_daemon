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

    // Check if token expires within the next 5 minutes
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    return Date.now() < (tokenInfo.expiresAt - bufferTime);
  }

  async getValidAccessToken(): Promise<string | null> {
    const isValid = await this.isTokenValid();
    if (isValid) {
      const tokenInfo = await this.loadTokens();
      return tokenInfo?.accessToken || null;
    }

    // Token is expired or invalid, try to refresh
    const refreshed = await this.refreshTokens();
    if (refreshed) {
      const tokenInfo = await this.loadTokens();
      return tokenInfo?.accessToken || null;
    }

    return null;
  }

  async refreshTokens(): Promise<boolean> {
    try {
      const tokenInfo = await this.loadTokens();
      if (!tokenInfo || !tokenInfo.refreshToken) {
        return false;
      }

      console.log('🔄 Refreshing authentication tokens...');
      
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
        }
      );
      
      await this.saveTokens(
        response.data.accessToken,
        response.data.refreshToken,
        response.data.expiresIn,
        tokenInfo.clusterId,
        tokenInfo.orgId
      );

      console.log('✅ Tokens refreshed successfully');
      return true;
    } catch (error) {
      console.error(`❌ Failed to refresh tokens: ${error instanceof Error ? error.message : error}`);
      // Clear invalid tokens
      await this.clearTokens();
      return false;
    }
  }
}