import { CoreV1Event, V1Pod } from '@kubernetes/client-node';
import chalk from 'chalk';

import { ContainerStatusSummary } from "../common/interfaces/containerStatus.interface";
import { LocalDiagnosisResult, MatchLine, PreliminaryCheckOutcome } from "../common/interfaces/rules.interface";
import { SanitizedPodDiagnostics } from "../common/interfaces/sanitizedpod.interface";
import { getCoreV1 } from "./kube";
import { PodStatus } from '../common/interfaces/podstatus.interface';
import { parseContainerState, printErrorAndExit } from '../utils/utils';
import { StackComponent } from '../common/interfaces/client.interface';

import rules from '../assets/rules.json'

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
    throw error; // This will never execute but satisfies TypeScript
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
    throw err; // This will never execute but satisfies TypeScript
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

  // Step 4: Analyze stack locally
  console.log(chalk.gray('🧠 Analyzing stack relationships and dependencies...\n'));
  const analysis = analyzeStackLocally(stackDiagnostics, releaseInfo.releaseName, podName);

  // Display results
  console.log(chalk.green('✅ Stack Analysis Complete:\n'));
  console.log(analysis);

  const duration = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.gray(`\n⏱  Completed in ${duration}s`));
}

/**
 * Extracts Helm release information from a pod using local heuristics.
 * @param podName
 * @param namespace
 * @returns
 */
async function extractHelmRelease(podName: string, namespace: string): Promise<{ releaseName: string; confidence: number }> {
  const coreV1 = getCoreV1();

  try {
    const pod = await coreV1.readNamespacedPod({ name: podName, namespace });
    const labels = pod.metadata?.labels || {};
    const annotations = pod.metadata?.annotations || {};

    let releaseName = '';
    let confidence = 0;

    // Check Helm v3 labels (most common)
    if (labels['app.kubernetes.io/managed-by'] === 'Helm') {
      releaseName = labels['app.kubernetes.io/instance'] || '';
      confidence = 0.9;
    }
    // Check legacy Helm v2 labels
    else if (labels['heritage'] === 'Tiller') {
      releaseName = labels['release'] || '';
      confidence = 0.8;
    }
    // Check app labels that might indicate Helm deployment
    else if (labels['helm.sh/chart']) {
      releaseName = labels['app.kubernetes.io/instance'] || labels['app'] || '';
      confidence = 0.7;
    }
    // Fallback: try to infer from pod name patterns
    else {
      const podNameParts = podName.split('-');
      if (podNameParts.length >= 2) {
        // Common pattern: release-name-component-hash
        releaseName = podNameParts.slice(0, -2).join('-');
        confidence = 0.5;
      }
    }

    console.log(`🔍 Helm release detection: ${releaseName} (confidence: ${Math.round(confidence * 100)}%)`);
    
    return { releaseName, confidence };
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

/**
 * Analyzes stack components locally using rule-based logic
 * @param stackDiagnostics 
 * @param releaseName 
 * @param primaryPod 
 * @returns 
 */
function analyzeStackLocally(stackDiagnostics: StackComponent[], releaseName: string, primaryPod: string): string {
  const failedComponents = stackDiagnostics.filter(component => 
    component.status.phase !== 'Running' && 
    component.status.containerStates.some(state => 
      !state.state.startsWith('Running') && !state.state.startsWith('Terminated: Completed')
    )
  );

  const healthyComponents = stackDiagnostics.filter(component => 
    component.status.phase === 'Running' && 
    component.status.containerStates.every(state => 
      state.state.startsWith('Running') || state.state.startsWith('Terminated: Completed')
    )
  );

  let analysis = `📊 Stack Analysis for Helm Release: ${releaseName}\n\n`;
  
  analysis += `🎯 Primary Pod: ${primaryPod}\n`;
  analysis += `📈 Total Components: ${stackDiagnostics.length}\n`;
  analysis += `✅ Healthy Components: ${healthyComponents.length}\n`;
  analysis += `❌ Failed Components: ${failedComponents.length}\n\n`;

  if (failedComponents.length > 0) {
    analysis += `🚨 Failed Components Analysis:\n`;
    failedComponents.forEach(component => {
      analysis += `\n📦 ${component.podName}:\n`;
      analysis += `   Phase: ${component.status.phase}\n`;
      
      // Analyze container states
      const failedContainers = component.status.containerStates.filter(state => 
        !state.state.startsWith('Running') && !state.state.startsWith('Terminated: Completed')
      );
      
      failedContainers.forEach(container => {
        analysis += `   ❌ Container ${container.name}: ${container.state}\n`;
        if (container.reason) {
          analysis += `      Reason: ${container.reason}\n`;
        }
        // Additional container state information would be included here
        // if available in the container state summary
      });

      // Analyze recent events
      if (component.events.length > 0) {
        analysis += `   📋 Recent Events:\n`;
        component.events.slice(0, 3).forEach(event => {
          analysis += `      • ${event}\n`;
        });
      }

      // Run local diagnosis on this component
      const localMatch = runLocalDiagnosis(component.status.containerStates, component.events, component.logs);
      if (localMatch) {
        analysis += `   🔍 Diagnosis: ${localMatch.diagnosis_summary}\n`;
        analysis += `   📊 Confidence: ${(localMatch.confidence_score * 100).toFixed(0)}%\n`;
      }
    });

    // Stack-level insights
    analysis += `\n🔗 Stack-Level Insights:\n`;
    
    // Check for common failure patterns across components
    const commonFailures = detectCommonFailures(failedComponents);
    if (commonFailures.length > 0) {
      analysis += `\n⚠️  Common Issues Detected:\n`;
      commonFailures.forEach(failure => {
        analysis += `   • ${failure}\n`;
      });
    }

    // Dependency analysis
    const dependencyIssues = analyzeDependencies(stackDiagnostics, releaseName);
    if (dependencyIssues.length > 0) {
      analysis += `\n🔗 Potential Dependency Issues:\n`;
      dependencyIssues.forEach(issue => {
        analysis += `   • ${issue}\n`;
      });
    }
  } else {
    analysis += `✅ All components in the stack are healthy.\n`;
    analysis += `🎉 No issues detected in the ${releaseName} release.\n`;
  }

  return analysis;
}

/**
 * Detects common failure patterns across multiple components
 */
function detectCommonFailures(failedComponents: StackComponent[]): string[] {
  const issues: string[] = [];
  
  // Check for image pull failures
  const imagePullFailures = failedComponents.filter(component =>
    component.events.some(event => event.includes('ImagePull')) ||
    component.status.containerStates.some(state => state.reason?.includes('ImagePull'))
  );
  if (imagePullFailures.length > 0) {
    issues.push(`Image pull failures affecting ${imagePullFailures.length} components`);
  }

  // Check for resource constraints
  const resourceIssues = failedComponents.filter(component =>
    component.events.some(event => 
      event.includes('Insufficient') || event.includes('OutOfMemory') || event.includes('OutOfCPU')
    )
  );
  if (resourceIssues.length > 0) {
    issues.push(`Resource constraints affecting ${resourceIssues.length} components`);
  }

  // Check for configuration issues
  const configIssues = failedComponents.filter(component =>
    component.events.some(event => 
      event.includes('ConfigMap') || event.includes('Secret') || event.includes('Mount')
    )
  );
  if (configIssues.length > 0) {
    issues.push(`Configuration/mounting issues affecting ${configIssues.length} components`);
  }

  return issues;
}

/**
 * Analyzes potential dependency issues between components
 */
function analyzeDependencies(stackDiagnostics: StackComponent[], releaseName: string): string[] {
  const issues: string[] = [];
  
  // Look for database/service dependencies
  const serviceComponents = stackDiagnostics.filter(component => 
    component.podName.includes('db') || 
    component.podName.includes('database') || 
    component.podName.includes('redis') || 
    component.podName.includes('cache')
  );

  const failedServices = serviceComponents.filter(component => 
    component.status.phase !== 'Running'
  );

  if (failedServices.length > 0) {
    const dependentComponents = stackDiagnostics.filter(component => 
      !serviceComponents.includes(component) && 
      component.status.phase !== 'Running'
    );
    
    if (dependentComponents.length > 0) {
      issues.push(`Failed services (${failedServices.map(s => s.podName).join(', ')}) may be causing downstream failures`);
    }
  }

  return issues;
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
