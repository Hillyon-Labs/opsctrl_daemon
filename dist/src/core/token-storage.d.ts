interface TokenInfo {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    expiresAt: number;
    clusterId: string;
    orgId?: string;
}
export declare class TokenStorage {
    private ensureDirectory;
    saveTokens(accessToken: string, refreshToken: string, expiresIn: number, clusterId: string, orgId?: string): Promise<void>;
    loadTokens(): Promise<TokenInfo | null>;
    clearTokens(): Promise<void>;
    isTokenValid(): Promise<boolean>;
    getValidAccessToken(): Promise<string | null>;
    refreshTokens(retryCount?: number): Promise<boolean>;
    /**
     * Debug token storage status
     */
    debugTokenStatus(): Promise<void>;
    /**
     * Make an authenticated API call with automatic token refresh on 401
     */
    makeAuthenticatedRequest<T>(requestFn: (token: string) => Promise<T>, retryCount?: number): Promise<T | null>;
}
export {};
//# sourceMappingURL=token-storage.d.ts.map