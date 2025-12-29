import { PodStatus } from "./podstatus.interface";

// Re-export from helm-release-resolver for consistency
export type { HelmReleaseInfo, HelmReleaseEvidence } from '../../core/helm-release-resolver';

export interface StackComponent {
  podName: string;
  status: PodStatus;
  events: string[];
  logs: string[];
}

export interface StackAnalysisPayload {
  primaryPod: string;
  helmRelease: string;
  namespace: string;
  timestamp: string;
  components: StackComponent[];
}

export interface StackAnalysisResponse {
  stackOverview: {
    totalPods: number;
    failingPods: number;
    healthyPods: number;
    namespace: string;
    helmRelease: string;
  };
  rootCauseAnalysis: {
    primaryCause: string;
    confidence: number;
    evidence: string[];
  };
  recommendations: string[];
  analysis: string;
}