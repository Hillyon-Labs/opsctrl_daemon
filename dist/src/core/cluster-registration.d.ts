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
export declare class ClusterRegistrationService {
    private readonly config;
    private readonly backendUrl;
    private readonly DEFAULT_FRONTEND_URL;
    private readonly tokenStorage;
    private registrationInProgress;
    constructor(config: ClusterRegistrationConfig);
    getClusterId(): Promise<string>;
    isClusterRegistered(): Promise<boolean>;
    loadClusterInfo(): Promise<ClusterInfo | null>;
    loadPendingRegistration(): Promise<PendingRegistration | null>;
    private savePendingRegistration;
    private removePendingRegistration;
    verifyPendingRegistration(clusterId: string): Promise<ClusterInfo | null>;
    private saveClusterInfo;
    registerCluster(): Promise<ClusterRegistrationResponse | null>;
    private isRetryableError;
    ensureClusterRegistration(): Promise<ClusterInfo>;
    private fetchAndStoreTokens;
}
//# sourceMappingURL=cluster-registration.d.ts.map