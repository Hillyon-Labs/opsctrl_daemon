import { PodStatus } from "./podstatus.interface";



export interface DiagnoseRequest {
  podName: string;
  namespace: string;
  logs: string[];
  events?: string[];
  phase?: string;
  containerState?: PodStatus; // refine if needed
}

export interface CredentialsFile {
  authenticated: boolean;
  token: string;
  user_id: string;
  first_name?: string;
}

export interface HelmReleaseInfo {
  releaseName: string;
  confidence: number;
}

export interface StackComponent {
  podName: string;
  status: PodStatus;
  events: string[];
  logs: string[];
}



export interface StackDiagnosisResult {
  stackOverview: {
    summary: string;
    components: Array<{
      name: string;
      role: string;
      status: 'healthy' | 'degraded' | 'down';
      restartCount: number;
      issues: string[];
    }>;
  };
  rootCauseAnalysis: {
    primaryCause: {
      component: string;
      issue: string;
      evidence: string[];
      startTime: string | null;
      containerState: string;
    };
    failureCascade: Array<{
      step: number;
      component: string;
      effect: string;
      evidence: string;
      timestamp: string;
    }>;
  };
  recommendations: {
    immediateFix: {
      description: string;
      commands: string[];
      actions: string[];
    };
    preventRecurrence: {
      description: string;
      helmValues: Record<string, any>;
      configChanges: string[];
    };
    improvements: string[];
  };
  verification: {
    commands: Array<{
      description: string;
      command: string;
      expectedOutput: string;
    }>;
    healthyLogPatterns: string[];
  };
  debuggingCommands: Array<{
    description: string;
    command: string;
  }>;
  confidence: number;
  alternativeCauses: string[];
}