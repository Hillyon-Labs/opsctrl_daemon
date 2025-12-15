import { ContainerStatusSummary } from "../common/interfaces/containerStatus.interface";
import { LocalDiagnosisResult, PreliminaryCheckOutcome } from "../common/interfaces/rules.interface";
/**
 * Diagnoses the specified Kubernetes pod by collecting its status, recent events, and container logs.
   ====================================================================
 * This function gathers diagnostic information for a given pod in a namespace, including:
 * - Pod phase and container states
 * - Recent Kubernetes events related to the pod
 * - Recent logs from all containers (init and main), sanitized for sensitive data
 *
 * @param podName - The name of the pod to diagnose.
 * @param namespace - The namespace in which the pod resides.
 * @param container
 * @returns A promise that resolves to a `SanitizedPodDiagnostics` object containing the pod's diagnostic information.
 */
export declare function diagnosePod(podName: string, namespace: string, _container?: string): Promise<string>;
/**
 * Fetches recent Kubernetes events related to the specified pod.
 * @param podName - The name of the pod to fetch events for.
 * @param namespace - The namespace in which the pod resides.
 * @returns A promise that resolves to an array of event messages related to the pod.
 */
export declare function getPodEvents(podName: string, namespace: string): Promise<string[]>;
/**
 * Fetches logs from the specified pod and container in a Kubernetes cluster.
 * ====================================================================
 * @param podName
 * @param namespace
 * @param container
 * @param tailLines
 * @returns
 */
export declare function getContainerLogs(podName: string, namespace: string, container?: string, tailLines?: number): Promise<string[]>;
export declare function runLocalDiagnosis(containerStates: ContainerStatusSummary[], events: string[], logs: string[]): LocalDiagnosisResult | null;
/**
 * Diagnoses a stack of components by extracting Helm release information, finding all components, and collecting diagnostics.
 *  ====================================================================
 * @param podName
 * @param namespace
 * @returns
 */
export declare function diagnoseStack(podName: string, namespace: string): Promise<string>;
/**
 * Get comprehensive stack data for backend reporting
 * Returns all collected data from the stack analysis without local diagnosis
 */
export declare function getStackDataForBackend(podName: string, namespace: string): Promise<{
    primaryPod: {
        name: string;
        namespace: string;
        events: string[];
        logs: string[];
        containerStates: any[];
    };
    stackComponents?: {
        releaseName: string;
        confidence: number;
        components: any[];
    };
}>;
export declare function loadAllRules(): ({
    id: string;
    match: {
        containerStates: string[];
        events: string[];
        logs?: undefined;
    };
    diagnosis: {
        confidence_score: number;
        diagnosis_summary: string;
        suggested_fix: string;
        incident_tags: string[];
    };
} | {
    id: string;
    match: {
        containerStates: string[];
        events?: undefined;
        logs?: undefined;
    };
    diagnosis: {
        confidence_score: number;
        diagnosis_summary: string;
        suggested_fix: string;
        incident_tags: string[];
    };
} | {
    id: string;
    match: {
        logs: {
            type: string;
            value: string;
        }[];
        containerStates?: undefined;
        events?: undefined;
    };
    diagnosis: {
        confidence_score: number;
        diagnosis_summary: string;
        suggested_fix: string;
        incident_tags: string[];
    };
} | {
    id: string;
    match: {
        events: string[];
        containerStates?: undefined;
        logs?: undefined;
    };
    diagnosis: {
        confidence_score: number;
        diagnosis_summary: string;
        suggested_fix: string;
        incident_tags: string[];
    };
} | {
    id: string;
    match: {
        events: {
            type: string;
            value: string;
        }[];
        containerStates?: undefined;
        logs?: undefined;
    };
    diagnosis: {
        confidence_score: number;
        diagnosis_summary: string;
        suggested_fix: string;
        incident_tags: string[];
    };
})[];
export declare function sanitizeLogs(logLines: string[]): string[];
export declare function handlePreliminaryDiagnostic(match: LocalDiagnosisResult): PreliminaryCheckOutcome;
//# sourceMappingURL=diagnosis.d.ts.map