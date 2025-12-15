"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_API_URL = exports.CREDENTIALS_JSON_FILE = void 0;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.invalidateToken = invalidateToken;
exports.isTokenExpired = isTokenExpired;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
require("dotenv/config");
const chalk_1 = __importDefault(require("chalk"));
const utils_1 = require("../utils/utils");
exports.CREDENTIALS_JSON_FILE = path_1.default.join(os_1.default.homedir(), '.opsctrl', 'credentials.json');
exports.DEFAULT_API_URL = process.env.OPSCTRL_BACKEND_URL;
/**
 * Load config from ~/.opsctrl/credentials.json
 */
function loadConfig() {
    if (!fs_1.default.existsSync(exports.CREDENTIALS_JSON_FILE)) {
        console.log('You are not logged in. Run `opsctrl login` to authenticate.');
    }
    const raw = fs_1.default.readFileSync(exports.CREDENTIALS_JSON_FILE, 'utf-8');
    const config = JSON.parse(raw);
    if (!config.token || !config.user_id) {
        (0, utils_1.printErrorAndExit)('Invalid credentials file. Please re-run `opsctrl login`.');
    }
    return config;
}
function saveConfig(config) {
    const dir = path_1.default.dirname(exports.CREDENTIALS_JSON_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(exports.CREDENTIALS_JSON_FILE, JSON.stringify(config, null, 2));
}
async function invalidateToken() {
    if (fs_1.default.existsSync(exports.CREDENTIALS_JSON_FILE)) {
        fs_1.default.unlinkSync(exports.CREDENTIALS_JSON_FILE);
        console.log(chalk_1.default.green('🔒 Logged out successfully. Token removed.'));
    }
    else {
        console.log(chalk_1.default.yellow('⚠️ No active session found.'));
    }
}
/**
 * Check if token is expired
 */
function isTokenExpired(expiresAt) {
    if (!expiresAt)
        return false;
    return Date.now() > new Date(expiresAt).getTime();
}
//# sourceMappingURL=config.js.map