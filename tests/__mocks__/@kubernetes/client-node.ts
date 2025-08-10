export const KubeConfig = jest.fn().mockImplementation(() => ({
  loadFromDefault: jest.fn(),
  makeApiClient: jest.fn(),
  getCurrentContext: jest.fn().mockReturnValue('test-context'),
  getCurrentCluster: jest.fn().mockReturnValue({ server: 'https://test-cluster' })
}));

export const CoreV1Api = jest.fn().mockImplementation(() => ({
  listNamespace: jest.fn(),
  readNamespacedPod: jest.fn(),
  listNamespacedEvent: jest.fn(),
  readNamespacedPodLog: jest.fn()
}));

export const Watch = jest.fn().mockImplementation(() => ({
  watch: jest.fn()
}));

export interface V1Pod {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: V1OwnerReference[];
  };
  status?: {
    phase?: string;
    containerStatuses?: V1ContainerStatus[];
    initContainerStatuses?: V1ContainerStatus[];
  };
  spec?: {
    containers?: Array<{
      name: string;
      image?: string;
    }>;
  };
}

export interface V1ContainerStatus {
  name: string;
  state?: {
    running?: any;
    waiting?: {
      reason?: string;
      message?: string;
    };
    terminated?: {
      reason?: string;
      message?: string;
      exitCode?: number;
    };
  };
}

export interface V1OwnerReference {
  kind?: string;
  name?: string;
  apiVersion?: string;
  controller?: boolean;
  uid?: string;
}

export interface CoreV1Event {
  message?: string;
  involvedObject?: {
    name?: string;
  };
  lastTimestamp?: string;
  eventTime?: string;
}

export interface V1Namespace {
  metadata?: {
    name?: string;
  };
}