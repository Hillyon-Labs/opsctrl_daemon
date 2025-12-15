"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initKube = initKube;
exports.getCoreV1 = getCoreV1;
exports.getCurrentContext = getCurrentContext;
const k8s = __importStar(require("@kubernetes/client-node"));
const chalk_1 = __importDefault(require("chalk"));
const utils_1 = require("../utils/utils");
let coreV1;
function initKube(context) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    if (context) {
        kc.setCurrentContext(context);
    }
    const currentContext = kc.getCurrentContext();
    console.log(`\n 🔧 Active cluster: ${chalk_1.default.cyan(currentContext)}`);
    coreV1 = kc.makeApiClient(k8s.CoreV1Api);
}
function getCoreV1() {
    if (!coreV1)
        (0, utils_1.printErrorAndExit)('Kubernetes client not initialized. Call initKube(context) first.');
    return coreV1;
}
function getCurrentContext() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    return kc.getCurrentContext();
}
//# sourceMappingURL=kube.js.map