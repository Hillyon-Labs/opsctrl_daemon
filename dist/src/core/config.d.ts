import 'dotenv/config';
export declare const CREDENTIALS_JSON_FILE: string;
export declare const DEFAULT_API_URL: string | undefined;
/**
 * Shape of the saved CLI credentials file
 */
export interface OpsctrlConfig {
    token: string;
    user_id: string;
    authenticated: boolean;
    first_name?: string;
}
/**
 * Load config from ~/.opsctrl/credentials.json
 */
export declare function loadConfig(): OpsctrlConfig;
export declare function saveConfig(config: OpsctrlConfig): void;
export declare function invalidateToken(): Promise<void>;
/**
 * Check if token is expired
 */
export declare function isTokenExpired(expiresAt?: string): boolean;
//# sourceMappingURL=config.d.ts.map