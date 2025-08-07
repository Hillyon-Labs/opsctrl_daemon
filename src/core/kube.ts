import * as k8s from '@kubernetes/client-node';
import chalk from 'chalk';
import { printErrorAndExit } from '../../utils/utils';

let coreV1: k8s.CoreV1Api;

export function initKube(context?: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  if (context) {
    kc.setCurrentContext(context);
  }

  const currentContext = kc.getCurrentContext();
  console.log(`\n 🔧 Active cluster: ${chalk.cyan(currentContext)}`);

  coreV1 = kc.makeApiClient(k8s.CoreV1Api);
}

export function getCoreV1(): k8s.CoreV1Api {
  if (!coreV1)
    printErrorAndExit('Kubernetes client not initialized. Call initKube(context) first.');
  return coreV1;
}
