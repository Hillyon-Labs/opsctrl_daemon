import { promisify } from "util";
import { gzip } from "zlib";
import axios from 'axios';
import { printErrorAndExit } from "../utils/utils";
import { DiagnoseRequest, HelmReleaseInfo } from "../common/interfaces/client.interface";
import { DEFAULT_API_URL } from "./config";

const gzipAsync = promisify(gzip);

export async function runFurtherDiagnosis(payload: DiagnoseRequest): Promise<any> {
  try {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload)));

    const token = "token";

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
    const response = await fetch(`${DEFAULT_API_URL}/diagnose/parse-pod-manifest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer `,
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
    const response = await axios.post(
      `${DEFAULT_API_URL}/diagnose/analyze-stack`,
      compressedPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          Authorization: `Bearer `,
        },
      },
    );

    return response.data.analysis || response.data; // depends on backend response shape
  } catch (error: any) {
    printErrorAndExit(error.response?.data.message ?? 'Failed to analyze stack');
    throw error; // This will never execute but satisfies TypeScript
  }
}
