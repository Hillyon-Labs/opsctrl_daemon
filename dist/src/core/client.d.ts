import { DiagnoseRequest, HelmReleaseInfo } from "../common/interfaces/client.interface";
interface RefreshTokenResponseDto {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
export declare function runFurtherDiagnosis(payload: DiagnoseRequest): Promise<any>;
export declare function parsePodManifest(manifest: any): Promise<HelmReleaseInfo>;
export declare function runStackAnalysis(compressedPayload: Buffer): Promise<string>;
export declare function refreshClusterToken(refreshToken: string, clusterId: string): Promise<RefreshTokenResponseDto>;
export declare function getUserClusterTokens(clusterId: string, orgId: string): Promise<any>;
export declare function getDaemonInfo(): Promise<any>;
export declare function reportPodFailure(failureData: {
    podName: string;
    namespace: string;
    logs: string[];
    events?: string[];
    phase?: string;
    containerState?: any;
}): Promise<any>;
export {};
//# sourceMappingURL=client.d.ts.map