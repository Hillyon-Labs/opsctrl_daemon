import { CoreV1Event, V1Pod } from '@kubernetes/client-node';
import chalk from 'chalk';

import { gzip } from "zlib";
import { ContainerStatusSummary } from "../common/interfaces/containerStatus.interface";
import { LocalDiagnosisResult, MatchLine, PreliminaryCheckOutcome } from "../common/interfaces/rules.interface";
import { SanitizedPodDiagnostics } from "../common/interfaces/sanitizedpod.interface";
import { getCoreV1 } from "./kube";
import { PodStatus } from '../common/interfaces/podstatus.interface';
import { parseContainerState, printErrorAndExit } from '../../utils/utils';
import { promisify } from 'util';
import { HelmReleaseInfo, StackComponent } from '../common/interfaces/client.interface';
import { runStackAnalysis, parsePodManifest } from './client';

import rules from '../assets/rules.json'



const gzipAsync = promisify(gzip);

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
export async function diagnosePod(
  podName: string,
  namespace: string,
  container?: string,
): Promise<SanitizedPodDiagnostics | any> {
  const start = performance.now();

  const [status, events, logs] = await Promise.all([
    getPodStatus(podName, namespace),
    getPodEvents(podName, namespace),
    getContainerLogs(podName, namespace, container),
  ]);

  const sanitizedLogs = sanitizeLogs(logs);

  const localMatch = runLocalDiagnosis(status.containerStates, events, sanitizedLogs);



  const end = performance.now();
  const durationSeconds = ((end - start) / 1000).toFixed(1);
  console.log(`\n⏱ Resolved in ${durationSeconds}s`);

  process.exit(0);
}

async function getPodStatus(podName: string, namespace: string): Promise<PodStatus> {
  const coreV1 = getCoreV1();

  try {
    const pod: V1Pod = await coreV1.readNamespacedPod({
      name: podName,
      namespace,
      pretty: 'true',
    });

    const phase = pod.status?.phase || 'Unknown';

    const containerStates: ContainerStatusSummary[] = [];

    const initContainers = pod.status?.initContainerStatuses || [];
    const mainContainers = pod.status?.containerStatuses || [];

    initContainers.forEach((initContainer) => {
      containerStates.push(parseContainerState(initContainer, 'init'));
    });

    mainContainers.forEach((mainContainer) => {
      containerStates.push(parseContainerState(mainContainer, 'main'));
    });

    return { phase, containerStates };
  } catch (error: any) {
    const parsedError = JSON.parse(error?.body);
    const message = parsedError?.message ?? 'Failed to fetch pod status';

    printErrorAndExit(message);
  }
}

/**
 * Fetches recent Kubernetes events related to the specified pod.
 * @param podName - The name of the pod to fetch events for.
 * @param namespace - The namespace in which the pod resides.
 * @returns A promise that resolves to an array of event messages related to the pod.
 */
export async function getPodEvents(podName: string, namespace: string): Promise<string[]> {
  const coreV1 = getCoreV1();

  try {
    const res = await coreV1.listNamespacedEvent({ namespace, limit: 10, timeoutSeconds: 10 });

    const events: CoreV1Event[] = res.items;

    const filteredEvents = events
      .filter((event) => event.involvedObject?.name === podName)
      .sort((a, b) => {
        const aTime = new Date(a.lastTimestamp || a.eventTime || '').getTime();
        const bTime = new Date(b.lastTimestamp || b.eventTime || '').getTime();
        return bTime - aTime;
      })
      .slice(0, 20);

    return filteredEvents.map((e) => e.message || '(no message)');
  } catch (err) {
    console.log(err);

    console.error(`\n ${chalk.red(`Error fetching events for pod ${podName}`)}`);

    printErrorAndExit(`Error fetching events for pod ${podName}`);
  }
}

/**
 * Fetches logs from the specified pod and container in a Kubernetes cluster.
 * ====================================================================
 * @param podName
 * @param namespace
 * @param container
 * @param tailLines
 * @returns
 */
export async function getContainerLogs(
  podName: string,
  namespace: string,
  container?: string,
  tailLines = 200,
): Promise<string[]> {
  const coreV1 = getCoreV1();
  try {
    // Fetch pod so we can list all containers
    const pod = await coreV1.readNamespacedPod({ name: podName, namespace });
    const allContainers = [
      ...(pod.status?.initContainerStatuses || []).map((c) => ({
        name: c.name,
        type: 'init' as const,
      })),
      ...(pod.status?.containerStatuses || []).map((c) => ({
        name: c.name,
        type: 'main' as const,
      })),
    ];

    if (container) {
      // Fetch logs for the specified container only
      try {
        const rawLog = await coreV1.readNamespacedPodLog({
          name: podName,
          namespace,
          container,
          tailLines,
        });
        return rawLog
          .split('\n')
          .filter(Boolean)
          .map((line) => `[${container}] ${line}`);
      } catch (err) {
        console.log(`\n [${container}] Failed to fetch logs`);
        return [''];
      }
    }

    // No container specified: try all
    const logPromises = allContainers.map(async ({ name, type }) => {
      try {
        const rawLog = await coreV1.readNamespacedPodLog({
          name: podName,
          namespace,
          container: name, // 🔥 key fix here
          tailLines,
        });

        return rawLog
          .split('\n')
          .filter(Boolean)
          .map((line) => `[${type}:${name}] ${line}`);
      } catch (err: any) {
        const parsedError = JSON.parse(err?.body);
        const message = parsedError?.message || 'Log fetch error';
        console.log(chalk.red(`[${name}] log fetch failed — ${message}`));
        return [`[${type}:${name}] log fetch failed — ${message}`];
      }
    });

    const logChunks = await Promise.all(logPromises);
    return logChunks.flat();
  } catch (err: any) {
    const parsedError = JSON.parse(err?.body) ?? null;
    const message = parsedError?.message || 'Failed to fetch logs';

    console.log(message);

    return [''];
  }
}

export function runLocalDiagnosis(
  containerStates: ContainerStatusSummary[],
  events: string[],
  logs: string[],
): LocalDiagnosisResult | null {
  const ruleFiles = loadAllRules(); // JSON objects from rules folder

  const allHealthy =
    containerStates.every(
      (cs) => cs.state === 'Running' || cs.state.startsWith('Terminated: Completed'),
    ) && events.length === 0;

  if (allHealthy) {
    console.log(chalk.green(`✅ Pod appears healthy. No issues detected.`));
    process.exit(0);
  }

  for (const rule of ruleFiles) {
    const matchingContainerState = rule.match.containerStates?.some((state: any) =>
      containerStates.some((cs) => cs.state.includes(state)),
    );

    const matchLogs = rule.match.logs?.some((matcher: any) =>
      logs.some((line) => matchLine(line, matcher)),
    );

    const matchEvents = rule.match.events?.some((matcher: any) =>
      events.some((line) => matchLine(line, matcher)),
    );

    if (matchingContainerState || matchLogs || matchEvents) {
      return {
        ...rule.diagnosis,
        matched: true,
        ruleId: rule.id,
      };
    }
  }

  console.info(
    chalk.yellow(
      '\n INFO: Preliminary diagnostics found no matching errors escalation in progress.',
    ),
  );
  return null;
}

/**
 * Diagnoses a stack of components by extracting Helm release information, finding all components, and collecting diagnostics.
 *  ====================================================================
 * @param podName
 * @param namespace
 * @returns
 */
export async function diagnoseStack(podName: string, namespace: string): Promise<void> {
  const startTime = performance.now();

  console.log(chalk.blue('\n🔍 Running deep stack analysis...\n'));

  // Step 1: Extract Helm release
  const releaseInfo = await extractHelmRelease(podName, namespace);

  if (!releaseInfo.releaseName || releaseInfo.confidence < 0.7) {
    console.log(chalk.yellow('Could not identify Helm release with high confidence.'));
    console.log(chalk.yellow('Falling back to single pod diagnosis.\n'));
    return diagnosePod(podName, namespace);
  }

  console.log(
    chalk.gray(
      `📦 Helm release detected: ${chalk.bold(releaseInfo.releaseName)} (${Math.round(
        releaseInfo.confidence * 100,
      )}% confidence)`,
    ),
  );

  // Step 2: Find all components
  const stackPods = await findStackComponents(releaseInfo.releaseName, namespace, podName);
  console.log(chalk.gray(`🔗 Found ${chalk.bold(stackPods.length)} components in stack\n`));

  // Step 3: Collect diagnostics in parallel
  console.log(chalk.gray('📊 Collecting diagnostics for all components...'));
  const stackDiagnostics = await collectStackDiagnostics(stackPods, namespace);

  // Step 4: Prepare and compress payload
  const payload = {
    primaryPod: podName,
    helmRelease: releaseInfo.releaseName,
    namespace,
    timestamp: new Date().toISOString(),
    components: stackDiagnostics,
  };

  const compressedPayload = await gzipAsync(Buffer.from(JSON.stringify(payload)));
  console.log(
    chalk.gray(`📦 Compressed payload: ${(compressedPayload.length / 1024).toFixed(1)}KB\n`),
  );

  // Step 5: Send for analysis
  console.log(chalk.gray('🧠 Analyzing stack relationships and dependencies...\n'));
  const analysis = await runStackAnalysis(compressedPayload);

  // Display results
  console.log(chalk.green('✅ Stack Analysis Complete:\n'));

  const duration = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.gray(`\n⏱  Completed in ${duration}s`));
}

/**
 * Extracts Helm release information from a pod.
 * @param podName
 * @param namespace
 * @returns
 */
async function extractHelmRelease(podName: string, namespace: string): Promise<HelmReleaseInfo> {
  const coreV1 = getCoreV1();

  try {
    const pod = await coreV1.readNamespacedPod({ name: podName, namespace });

    // Explicit serialization of Kubernetes object fields
    const podManifest = {
      metadata: {
        name: pod.metadata?.name,
        labels: pod.metadata?.labels,
        annotations: pod.metadata?.annotations ?? {},
        ownerReferences: (pod.metadata?.ownerReferences ?? []).map((ref) => ({
          kind: ref.kind,
          name: ref.name,
          apiVersion: ref.apiVersion,
          controller: ref.controller,
          uid: ref.uid,
        })),
      },
      spec: {
        containers: (pod.spec?.containers ?? []).map((c) => ({
          name: c.name,
          image: c.image,
        })),
      },
    };

    // Send to your backend for LLM analysis
    const response = await parsePodManifest(podManifest);

    return response;
  } catch (error) {
    console.error('Failed to extract Helm release:', error);
    return { releaseName: '', confidence: 0 };
  }
}

/**
 *
 * Finds all components in a Helm release stack by listing pods in the namespace.
 * @param releaseName
 * @param namespace
 * @param originalPod
 * @returns
 */
async function findStackComponents(
  releaseName: string,
  namespace: string,
  originalPod: string,
): Promise<string[]> {
  const coreV1 = getCoreV1();

  try {
    // Get all pods in namespace
    const allPods = await coreV1.listNamespacedPod({ namespace });

    // Filter pods that likely belong to this release
    const stackPods = allPods.items
      .filter((pod) => {
        const podName = pod.metadata?.name || '';
        // Check if pod name starts with release name
        return podName.startsWith(`${releaseName}-`) || podName === releaseName;
      })
      .map((pod) => pod.metadata!.name!)
      .filter((name) => name !== originalPod); // Avoid duplicating the original pod

    // Add the original pod at the beginning
    return [originalPod, ...stackPods];
  } catch (error) {
    console.error('Failed to find stack components:', error);
    return [originalPod]; // At minimum, analyze the original pod
  }
}

async function collectStackDiagnostics(
  pods: string[],
  namespace: string,
): Promise<StackComponent[]> {
  // Collect diagnostics for all pods in parallel
  const diagnosticsPromises = pods.map(async (podName) => {
    try {
      const [status, events, logs] = await Promise.all([
        getPodStatus(podName, namespace),
        getPodEvents(podName, namespace),
        getContainerLogs(podName, namespace, undefined, 200), // 200 lines per pod
      ]);

      return {
        podName,
        status,
        events,
        logs: sanitizeLogs(logs),
      };
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Failed to collect diagnostics for ${podName}`));
      return {
        podName,
        status: { phase: 'Unknown', containerStates: [] },
        events: [],
        logs: [`Failed to collect logs: ${error}`],
      };
    }
  });

  const results = await Promise.all(diagnosticsPromises);

  // Show progress
  results.forEach((r, i) => {
    const icon = r.logs.length > 1 ? '✓' : '⚠';
    console.log(chalk.gray(`  ${icon} ${r.podName}`));
  });

  return results;
}

function matchLine(line: string, matcher: MatchLine): boolean {
  if (!line || !matcher) return false;

  if (typeof matcher === 'string') {
    return line.toLowerCase().includes(matcher.toLowerCase());
  }

  if (!matcher.value) return false;

  try {
    return matcher.type === 'regex'
      ? new RegExp(matcher.value, 'i').test(line)
      : line.toLowerCase().includes(matcher.value.toLowerCase());
  } catch {
    return false;
  }
}

export function loadAllRules() {
  rules.forEach((rule: any, i: number) => {
    if (!rule.id || !rule.diagnosis || typeof rule.diagnosis.diagnosis_summary !== 'string') {
      console.warn(`Invalid rule format at index ${i}`);
    }
  });

  if (!Array.isArray(rules)) {
    console.warn('Expected rules.json to contain an array of rules.');
  }

  return rules;
}

export function sanitizeLogs(logLines: string[]): string[] {
  const ipRegex = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/gi;
  const tokenRegex = /\b(?:eyJ[^\s"]+|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36,})\b/g;
  const ansiEscapeRegex = /\x1b\[[0-9;]*m/g;

  return logLines.map((line) =>
    line
      .replace(ipRegex, 'REDACTED_IP')
      .replace(emailRegex, 'REDACTED_EMAIL')
      .replace(tokenRegex, 'REDACTED_SECRET')
      .replace(ansiEscapeRegex, '')
      .replace(/\s{2,}/g, ' ') // collapse excessive spacing
      .trim(),
  );
}

export function handlePreliminaryDiagnostic(match: LocalDiagnosisResult): PreliminaryCheckOutcome {
  const { confidence_score, diagnosis_summary } = match;

  if (confidence_score >= 0.92) {
    console.log(chalk.green(`\n ✅ Diagnosis locked: ${diagnosis_summary}`));
    return { handled: true, result: match };
  }

  console.log(chalk.yellow(`\n ⚠️  Preliminary diagnosis: ${diagnosis_summary}`));
  console.log(
    chalk.gray(`\n 🔍We’re double-checking logs and cluster context to refine this result...`),
  );

  return { handled: false, reason: 'low-confidence', match };
}
