"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFurtherDiagnosis = runFurtherDiagnosis;
exports.parsePodManifest = parsePodManifest;
exports.runStackAnalysis = runStackAnalysis;
exports.refreshClusterToken = refreshClusterToken;
exports.getUserClusterTokens = getUserClusterTokens;
exports.getDaemonInfo = getDaemonInfo;
exports.reportPodFailure = reportPodFailure;
const util_1 = require("util");
const zlib_1 = require("zlib");
const axios_1 = __importDefault(require("axios"));
const utils_1 = require("../utils/utils");
const config_1 = require("./config");
const token_storage_1 = require("./token-storage");
const gzipAsync = (0, util_1.promisify)(zlib_1.gzip);
async function runFurtherDiagnosis(payload) {
    try {
        const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload)));
        const tokenStorage = new token_storage_1.TokenStorage();
        const token = await tokenStorage.getValidAccessToken();
        if (!token) {
            console.warn('No valid authentication token available. Please ensure cluster is registered.');
        }
        const response = await axios_1.default.post(`${config_1.DEFAULT_API_URL}/diagnose`, compressed, {
            headers: {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                Authorization: `Bearer ${token}`,
            },
        });
        return response.data;
    }
    catch (error) {
        (0, utils_1.printErrorAndExit)(error.response?.data.message ?? 'External request failed');
    }
}
async function parsePodManifest(manifest) {
    try {
        const tokenStorage = new token_storage_1.TokenStorage();
        const token = await tokenStorage.getValidAccessToken();
        if (!token) {
            console.warn('No valid authentication token available. Please ensure cluster is registered.');
        }
        const response = await fetch(`${config_1.DEFAULT_API_URL}/diagnose/parse-pod-manifest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(manifest),
        });
        return await response.json();
    }
    catch (error) {
        (0, utils_1.printErrorAndExit)('Error parsing pod manifest');
        throw error; // This will never execute but satisfies TypeScript
    }
}
async function runStackAnalysis(compressedPayload) {
    try {
        const tokenStorage = new token_storage_1.TokenStorage();
        const token = await tokenStorage.getValidAccessToken();
        if (!token) {
            console.warn('No valid authentication token available. Please ensure cluster is registered.');
        }
        const response = await axios_1.default.post(`${config_1.DEFAULT_API_URL}/diagnose/analyze-stack`, compressedPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                Authorization: `Bearer ${token}`,
            },
        });
        return response.data.analysis || response.data; // depends on backend response shape
    }
    catch (error) {
        (0, utils_1.printErrorAndExit)(error.response?.data.message ?? 'Failed to analyze stack');
        throw error; // This will never execute but satisfies TypeScript
    }
}
async function refreshClusterToken(refreshToken, clusterId) {
    try {
        const response = await axios_1.default.post(`${config_1.DEFAULT_API_URL}/auth/cluster/refresh`, { refreshToken, clusterId }, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    }
    catch (error) {
        (0, utils_1.printErrorAndExit)(error.response?.data.message ?? 'Failed to refresh cluster token');
    }
}
async function getUserClusterTokens(clusterId, orgId) {
    try {
        const response = await axios_1.default.get(`${config_1.DEFAULT_API_URL}/auth/cluster/tokens?clusterId=${clusterId}&orgId=${orgId}`, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    }
    catch (error) {
        console.error(`📡 getUserClusterTokens error:`, error.response?.data || error.message);
    }
}
async function getDaemonInfo() {
    try {
        const tokenStorage = new token_storage_1.TokenStorage();
        return await tokenStorage.makeAuthenticatedRequest(async (token) => {
            const response = await axios_1.default.get(`${config_1.DEFAULT_API_URL}/daemon/me`, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
            });
            return response.data;
        });
    }
    catch (error) {
        console.error(error.response?.data.message ?? 'Failed to get daemon info');
        return null;
    }
}
async function reportPodFailure(failureData) {
    try {
        const tokenStorage = new token_storage_1.TokenStorage();
        return await tokenStorage.makeAuthenticatedRequest(async (token) => {
            const response = await axios_1.default.post(`${config_1.DEFAULT_API_URL}/daemon/diagnose-pod`, failureData, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
            });
            return response.data;
        });
    }
    catch (error) {
        console.error(`❌ Failed to report pod failure: ${error.response?.data?.message || error.message}`);
        return null;
    }
}
//# sourceMappingURL=client.js.map