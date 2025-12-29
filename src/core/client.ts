import axios from 'axios';
import { printErrorAndExit } from "../utils/utils";
import { StackAnalysisPayload, StackAnalysisResponse } from "../common/interfaces/client.interface";
import { DEFAULT_API_URL } from "./config";
import { TokenStorage } from "./token-storage";

interface RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function runStackAnalysis(payload: StackAnalysisPayload): Promise<StackAnalysisResponse | null> {
  try {
    const tokenStorage = new TokenStorage();

    return await tokenStorage.makeAuthenticatedRequest(async (token) => {
      const response = await axios.post(
        `${DEFAULT_API_URL}/daemon/analyze-stack`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data as StackAnalysisResponse;
    });
  } catch (error: any) {
    console.error(`❌ Failed to analyze stack: ${error.response?.data?.message || error.message}`);
    return null;
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

    return await tokenStorage.makeAuthenticatedRequest(async (token) => {
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
    });
  } catch (error: any) {
    console.error(error.response?.data.message ?? 'Failed to get daemon info');
    return null;
  }
}
