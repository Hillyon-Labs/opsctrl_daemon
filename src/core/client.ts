import { promisify } from "util";
import { gzip } from "zlib";
import axios from 'axios';
import { printErrorAndExit } from "../utils/utils";
import { DiagnoseRequest, HelmReleaseInfo } from "../common/interfaces/client.interface";
import { DEFAULT_API_URL } from "./config";
import { TokenStorage } from "./token-storage";

interface RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const gzipAsync = promisify(gzip);

export async function runFurtherDiagnosis(payload: DiagnoseRequest): Promise<any> {
  try {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload)));

    const tokenStorage = new TokenStorage();
    const token = await tokenStorage.getValidAccessToken();
    if (!token) {
      console.warn('No valid authentication token available. Please ensure cluster is registered.');
    }

    const response = await axios.post(`${DEFAULT_API_URL}/diagnose`, compressed, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  } catch (error: any) {
    printErrorAndExit(error.response?.data.message ?? 'External request failed');
  }
}

export async function parsePodManifest(manifest: any): Promise<HelmReleaseInfo> {
  try {
    const tokenStorage = new TokenStorage();
    const token = await tokenStorage.getValidAccessToken();
    if (!token) {
      console.warn('No valid authentication token available. Please ensure cluster is registered.');
    }

    const response = await fetch(`${DEFAULT_API_URL}/diagnose/parse-pod-manifest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(manifest),
    });

    return await response.json() as HelmReleaseInfo;
  } catch (error) {
    printErrorAndExit('Error parsing pod manifest');
    throw error; // This will never execute but satisfies TypeScript
  }
}

export async function runStackAnalysis(compressedPayload: Buffer): Promise<string> {
  try {
    const tokenStorage = new TokenStorage();
    const token = await tokenStorage.getValidAccessToken();
    if (!token) {
      console.warn('No valid authentication token available. Please ensure cluster is registered.');
    }

    const response = await axios.post(
      `${DEFAULT_API_URL}/diagnose/analyze-stack`,
      compressedPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data.analysis || response.data; // depends on backend response shape
  } catch (error: any) {
    printErrorAndExit(error.response?.data.message ?? 'Failed to analyze stack');
    throw error; // This will never execute but satisfies TypeScript
  }
}

export async function refreshClusterToken(
  refreshToken: string,
  clusterId: string
): Promise<RefreshTokenResponseDto> {
  try {
    const response = await axios.post(
      `${DEFAULT_API_URL}/auth/cluster/refresh`,
      { refreshToken, clusterId },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    printErrorAndExit(error.response?.data.message ?? 'Failed to refresh cluster token');
  }
}

export async function getUserClusterTokens(
  clusterId: string,
  orgId: string
): Promise<any> {
  try {
    
    const response = await axios.get(
      `${DEFAULT_API_URL}/auth/cluster/tokens?clusterId=${clusterId}&orgId=${orgId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error(`📡 getUserClusterTokens error:`, error.response?.data || error.message);
    }
}

export async function getDaemonInfo(): Promise<any> {
  try {
    const tokenStorage = new TokenStorage();
    const token = await tokenStorage.getValidAccessToken();
    if (!token) {
      console.warn('No valid authentication token available. Please ensure cluster is registered.');
    }
    
    

    const response = await axios.get(
      `${DEFAULT_API_URL}/daemon/me`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error: any) {    
    console.error(error.response?.data.message ?? 'Failed to get daemon info');
    }
}
