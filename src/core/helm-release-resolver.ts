import { V1Pod } from '@kubernetes/client-node';
import { getCoreV1 } from './kube';
import { TokenStorage } from './token-storage';
import axios from 'axios';
import { DEFAULT_API_URL } from './config';

/**
 * Evidence supporting the release detection
 */
export interface HelmReleaseEvidence {
  labelFound?: string;        // e.g., "app.kubernetes.io/instance=myapp"
  annotationFound?: string;   // e.g., "meta.helm.sh/release-name=myapp"
  namingPattern?: string;     // e.g., "pod name follows {release}-{component}-{hash} pattern"
}

/**
 * Result of Helm release resolution
 */
export interface HelmReleaseInfo {
  releaseName: string;
  confidence: number;
  detectionMethod: 'label' | 'annotation' | 'naming_convention' | 'owner_reference' | 'none';
  evidence: HelmReleaseEvidence;
}

/**
 * Configuration for the resolver
 */
export interface ResolverConfig {
  /** Minimum confidence to accept local result (default: 0.7) */
  localConfidenceThreshold: number;
  /** Whether to use backend LLM fallback (default: true) */
  enableBackendFallback: boolean;
  /** Timeout for backend calls in ms (default: 5000) */
  backendTimeoutMs: number;
}

const DEFAULT_CONFIG: ResolverConfig = {
  localConfidenceThreshold: 0.7,
  enableBackendFallback: true,
  backendTimeoutMs: 5000,
};

/**
 * HelmReleaseResolver - Resolves Helm release names from pods
 *
 * Uses a hybrid approach:
 * 1. First tries fast local label-based extraction
 * 2. Falls back to backend LLM inference if confidence is low
 *
 * @example
 * ```ts
 * const resolver = new HelmReleaseResolver();
 * const release = await resolver.resolve('my-pod', 'default');
 * console.log(release.releaseName, release.confidence);
 * ```
 */
export class HelmReleaseResolver {
  private config: ResolverConfig;

  constructor(config: Partial<ResolverConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Resolve Helm release name for a pod
   */
  async resolve(podName: string, namespace: string): Promise<HelmReleaseInfo> {
    // Step 1: Try local extraction first (fast, no network)
    const localResult = await this.extractFromLabels(podName, namespace);

    if (localResult.confidence >= this.config.localConfidenceThreshold) {
      return localResult;
    }

    // Step 2: Fallback to backend LLM if enabled and local confidence is low
    if (this.config.enableBackendFallback) {
      const backendResult = await this.inferFromBackend(podName, namespace);
      if (backendResult && backendResult.confidence > localResult.confidence) {
        return backendResult;
      }
    }

    // Step 3: Return best local result (even if low confidence)
    return localResult;
  }

  /**
   * Extract Helm release from pod labels (fast, local)
   */
  private async extractFromLabels(podName: string, namespace: string): Promise<HelmReleaseInfo> {
    try {
      const coreV1 = getCoreV1();
      const pod = await coreV1.readNamespacedPod({ name: podName, namespace });
      return this.parseLabels(pod, podName);
    } catch {
      return this.fallbackFromPodName(podName);
    }
  }

  /**
   * Parse Helm release info from pod labels and annotations
   */
  private parseLabels(pod: V1Pod, podName: string): HelmReleaseInfo {
    const labels = pod.metadata?.labels || {};
    const annotations = pod.metadata?.annotations || {};

    // Check annotations first (meta.helm.sh/release-name is authoritative)
    if (annotations['meta.helm.sh/release-name']) {
      return {
        releaseName: annotations['meta.helm.sh/release-name'],
        confidence: 0.98,
        detectionMethod: 'annotation',
        evidence: { annotationFound: `meta.helm.sh/release-name=${annotations['meta.helm.sh/release-name']}` }
      };
    }

    // Helm v3 (most common) - highest confidence
    if (labels['app.kubernetes.io/managed-by'] === 'Helm') {
      const releaseName = labels['app.kubernetes.io/instance'] || '';
      if (releaseName) {
        return {
          releaseName,
          confidence: 0.95,
          detectionMethod: 'label',
          evidence: { labelFound: `app.kubernetes.io/instance=${releaseName}` }
        };
      }
    }

    // Helm v2 (legacy Tiller)
    if (labels['heritage'] === 'Tiller') {
      const releaseName = labels['release'] || '';
      if (releaseName) {
        return {
          releaseName,
          confidence: 0.85,
          detectionMethod: 'label',
          evidence: { labelFound: `release=${releaseName}` }
        };
      }
    }

    // Chart label present (partial Helm metadata)
    if (labels['helm.sh/chart']) {
      const releaseName = labels['app.kubernetes.io/instance'] || labels['app'] || '';
      if (releaseName) {
        return {
          releaseName,
          confidence: 0.75,
          detectionMethod: 'label',
          evidence: { labelFound: `helm.sh/chart=${labels['helm.sh/chart']}` }
        };
      }
    }

    // ArgoCD managed (common in GitOps)
    if (labels['argocd.argoproj.io/instance']) {
      return {
        releaseName: labels['argocd.argoproj.io/instance'],
        confidence: 0.8,
        detectionMethod: 'label',
        evidence: { labelFound: `argocd.argoproj.io/instance=${labels['argocd.argoproj.io/instance']}` }
      };
    }

    // Flux managed
    if (labels['helm.toolkit.fluxcd.io/name']) {
      return {
        releaseName: labels['helm.toolkit.fluxcd.io/name'],
        confidence: 0.8,
        detectionMethod: 'label',
        evidence: { labelFound: `helm.toolkit.fluxcd.io/name=${labels['helm.toolkit.fluxcd.io/name']}` }
      };
    }

    // App label as last resort before pod name inference
    if (labels['app'] || labels['app.kubernetes.io/name']) {
      const releaseName = labels['app'] || labels['app.kubernetes.io/name'];
      return {
        releaseName,
        confidence: 0.6,
        detectionMethod: 'label',
        evidence: { labelFound: `app=${releaseName}` }
      };
    }

    return this.fallbackFromPodName(podName);
  }

  /**
   * Infer release name from pod naming pattern
   */
  private fallbackFromPodName(podName: string): HelmReleaseInfo {
    const parts = podName.split('-');

    // Pattern: release-name-component-replicaset-pod (e.g., nginx-app-web-7d4f8b9c6-x2k4p)
    if (parts.length >= 4) {
      const releaseName = parts.slice(0, -2).join('-');
      return {
        releaseName,
        confidence: 0.4,
        detectionMethod: 'naming_convention',
        evidence: { namingPattern: 'pod name follows {release}-{component}-{hash} pattern' }
      };
    }

    // Pattern: release-name-hash (e.g., nginx-7d4f8b9c6)
    if (parts.length >= 2) {
      const releaseName = parts.slice(0, -1).join('-');
      return {
        releaseName,
        confidence: 0.3,
        detectionMethod: 'naming_convention',
        evidence: { namingPattern: 'pod name follows {release}-{hash} pattern' }
      };
    }

    return {
      releaseName: podName,
      confidence: 0.1,
      detectionMethod: 'none',
      evidence: {}
    };
  }

  /**
   * Call backend LLM to infer Helm release (slower, more accurate for edge cases)
   */
  private async inferFromBackend(podName: string, namespace: string): Promise<HelmReleaseInfo | null> {
    try {
      const coreV1 = getCoreV1();
      const pod = await coreV1.readNamespacedPod({ name: podName, namespace });

      // Build manifest matching backend's ParsePodManifestDto
      const manifest = {
        metadata: {
          name: pod.metadata?.name,
          labels: pod.metadata?.labels || {},
          annotations: pod.metadata?.annotations || {},
          ownerReferences: pod.metadata?.ownerReferences?.map(ref => ref.name) || [],
        },
        spec: {
          containers: pod.spec?.containers?.map(c => ({ name: c.name, image: c.image })) || [],
        },
      };

      const tokenStorage = new TokenStorage();
      const result = await tokenStorage.makeAuthenticatedRequest(async (token) => {
        const response = await axios.post(
          `${DEFAULT_API_URL}/daemon/parse-manifest`,
          manifest,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            timeout: this.config.backendTimeoutMs,
          }
        );
        return response.data;
      });

      if (result?.releaseName) {
        // Backend returns the full HelmReleaseInfo structure
        return {
          releaseName: result.releaseName,
          confidence: result.confidence ?? 0.8,
          detectionMethod: result.detectionMethod ?? 'none',
          evidence: result.evidence ?? {}
        };
      }

      return null;
    } catch {
      // Silently fail - local extraction is the fallback
      return null;
    }
  }
}

/**
 * Singleton instance for convenience
 */
let defaultResolver: HelmReleaseResolver | null = null;

export function getHelmReleaseResolver(config?: Partial<ResolverConfig>): HelmReleaseResolver {
  if (!defaultResolver || config) {
    defaultResolver = new HelmReleaseResolver(config);
  }
  return defaultResolver;
}

/**
 * Quick helper for one-off resolution
 */
export async function resolveHelmRelease(
  podName: string,
  namespace: string,
  config?: Partial<ResolverConfig>
): Promise<HelmReleaseInfo> {
  const resolver = getHelmReleaseResolver(config);
  return resolver.resolve(podName, namespace);
}
