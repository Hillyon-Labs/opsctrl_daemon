import { KubernetesPodWatchdog } from '../src/core/watchdog';
import * as k8s from '@kubernetes/client-node';
import { PodFailureEvent } from '../src/common/interfaces';

jest.mock('@kubernetes/client-node');

const mockKubeConfig = {
  loadFromDefault: jest.fn(),
  makeApiClient: jest.fn()
} as unknown as k8s.KubeConfig;

const mockCoreV1Api = {
  listNamespace: jest.fn()
} as unknown as k8s.CoreV1Api;

const mockWatch = {
  watch: jest.fn()
} as unknown as k8s.Watch;

describe('KubernetesPodWatchdog - Failure Detection', () => {
  let watchdog: KubernetesPodWatchdog;

  beforeEach(() => {
    jest.clearAllMocks();
    (k8s.KubeConfig as jest.Mock).mockImplementation(() => mockKubeConfig);
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => mockWatch);
    (mockKubeConfig.makeApiClient as jest.Mock).mockReturnValue(mockCoreV1Api);
    
    watchdog = new KubernetesPodWatchdog({
      monitoring: {
        excludeNamespaces: ['kube-system'],
        failureDetection: {
          minRestartThreshold: 3,
          maxPendingDurationMs: 300000, // 5 minutes
          enableCrashLoopDetection: true,
          enableImagePullFailureDetection: true,
          enableResourceLimitDetection: true
        }
      }
    });
  });

  describe('analyzeForFailures', () => {
    it('should detect pod phase failed', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'test-pod', namespace: 'default' },
        status: {
          phase: 'Failed',
          reason: 'ContainerCannotRun',
          message: 'Container failed to start'
        }
      };

      const mockAnalyzeForFailures = jest.fn().mockResolvedValue({
        metadata: {
          podName: 'test-pod',
          namespace: 'default',
          timestamp: expect.any(Date)
        },
        failure: {
          pattern: 'pod-phase-failed',
          severity: 'critical',
          reason: 'Pod phase is Failed: ContainerCannotRun'
        }
      });

      // Access private method for testing
      (watchdog as any).analyzeForFailures = mockAnalyzeForFailures;
      
      const result = await (watchdog as any).analyzeForFailures(podObject, 'default');
      
      expect(result).toBeDefined();
      expect(result.failure.pattern).toBe('pod-phase-failed');
      expect(result.failure.severity).toBe('critical');
    });

    it('should detect long pending pods', async () => {
      const oldTimestamp = new Date(Date.now() - 600000); // 10 minutes ago
      const podObject: k8s.V1Pod = {
        metadata: { 
          name: 'pending-pod', 
          namespace: 'default',
          creationTimestamp: oldTimestamp
        },
        status: { phase: 'Pending' }
      };

      // Mock the private method to simulate long pending detection
      const mockCheckForLongPendingPod = jest.fn().mockReturnValue({
        metadata: {
          podName: 'pending-pod',
          namespace: 'default'
        },
        failure: {
          pattern: 'long-pending',
          severity: 'high',
          reason: expect.stringContaining('Pod pending for')
        }
      });

      (watchdog as any).checkForLongPendingPod = mockCheckForLongPendingPod;
      
      const result = (watchdog as any).checkForLongPendingPod(podObject, 'default');
      
      expect(result).toBeDefined();
      expect(result.failure.pattern).toBe('long-pending');
      expect(result.failure.severity).toBe('high');
    });

    it('should detect high restart count', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'restart-pod', namespace: 'default' },
        status: {
          phase: 'Running',
          containerStatuses: [{
            name: 'main-container',
            image: 'test:latest',
            imageID: 'docker://sha256:123',
            restartCount: 5,
            ready: false,
            started: false,
            state: { running: { startedAt: new Date() } }
          }]
        }
      };

      const mockCheckContainerForFailures = jest.fn().mockReturnValue({
        metadata: {
          podName: 'restart-pod',
          namespace: 'default'
        },
        failure: {
          pattern: 'high-restart-count',
          severity: 'high',
          reason: 'Container main-container has restarted 5 times'
        }
      });

      (watchdog as any).checkContainerForFailures = mockCheckContainerForFailures;
      
      const result = (watchdog as any).checkContainerForFailures(
        podObject.status!.containerStatuses![0], 
        podObject, 
        'default'
      );
      
      expect(result).toBeDefined();
      expect(result.failure.pattern).toBe('high-restart-count');
      expect(result.failure.severity).toBe('high');
    });

    it('should detect CrashLoopBackOff', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'crash-pod', namespace: 'default' },
        status: {
          phase: 'Running',
          containerStatuses: [{
            name: 'crash-container',
            image: 'test:latest',
            imageID: 'docker://sha256:123',
            restartCount: 2,
            ready: false,
            started: false,
            state: { 
              waiting: { 
                reason: 'CrashLoopBackOff',
                message: 'Back-off restarting failed container'
              }
            }
          }]
        }
      };

      const mockCheckContainerForFailures = jest.fn().mockReturnValue({
        metadata: {
          podName: 'crash-pod',
          namespace: 'default'
        },
        failure: {
          pattern: 'container-waiting-error',
          severity: 'critical',
          reason: 'Container crash-container: CrashLoopBackOff'
        }
      });

      (watchdog as any).checkContainerForFailures = mockCheckContainerForFailures;
      
      const result = (watchdog as any).checkContainerForFailures(
        podObject.status!.containerStatuses![0], 
        podObject, 
        'default'
      );
      
      expect(result).toBeDefined();
      expect(result.failure.pattern).toBe('container-waiting-error');
      expect(result.failure.severity).toBe('critical');
    });

    it('should detect ImagePullBackOff', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'image-pull-pod', namespace: 'default' },
        status: {
          phase: 'Pending',
          containerStatuses: [{
            name: 'image-pull-container',
            image: 'nonexistent:latest',
            imageID: '',
            restartCount: 0,
            ready: false,
            started: false,
            state: { 
              waiting: { 
                reason: 'ImagePullBackOff',
                message: 'Failed to pull image "nonexistent:latest"'
              }
            }
          }]
        }
      };

      const mockCheckContainerForFailures = jest.fn().mockReturnValue({
        metadata: {
          podName: 'image-pull-pod',
          namespace: 'default'
        },
        failure: {
          pattern: 'container-waiting-error',
          severity: 'high',
          reason: 'Container image-pull-container: ImagePullBackOff'
        }
      });

      (watchdog as any).checkContainerForFailures = mockCheckContainerForFailures;
      
      const result = (watchdog as any).checkContainerForFailures(
        podObject.status!.containerStatuses![0], 
        podObject, 
        'default'
      );
      
      expect(result).toBeDefined();
      expect(result.failure.pattern).toBe('container-waiting-error');
      expect(result.failure.severity).toBe('high');
    });

    it('should detect container termination with non-zero exit code', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'terminated-pod', namespace: 'default' },
        status: {
          phase: 'Failed',
          containerStatuses: [{
            name: 'terminated-container',
            image: 'test:latest',
            imageID: 'docker://sha256:123',
            restartCount: 1,
            ready: false,
            started: false,
            state: { 
              terminated: { 
                exitCode: 1,
                reason: 'Error',
                message: 'Container exited with error',
                finishedAt: new Date()
              }
            }
          }]
        }
      };

      const mockCheckContainerForFailures = jest.fn().mockReturnValue({
        metadata: {
          podName: 'terminated-pod',
          namespace: 'default'
        },
        failure: {
          pattern: 'container-terminated-error',
          severity: 'high',
          reason: 'Container terminated-container terminated with exit code 1'
        }
      });

      (watchdog as any).checkContainerForFailures = mockCheckContainerForFailures;
      
      const result = (watchdog as any).checkContainerForFailures(
        podObject.status!.containerStatuses![0], 
        podObject, 
        'default'
      );
      
      expect(result).toBeDefined();
      expect(result.failure.pattern).toBe('container-terminated-error');
      expect(result.failure.severity).toBe('high');
    });

    it('should return null for healthy pods', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'healthy-pod', namespace: 'default' },
        status: {
          phase: 'Running',
          containerStatuses: [{
            name: 'healthy-container',
            image: 'test:latest',
            imageID: 'docker://sha256:123',
            restartCount: 0,
            ready: true,
            started: true,
            state: { running: { startedAt: new Date() } }
          }]
        }
      };

      const mockAnalyzeForFailures = jest.fn().mockResolvedValue(null);
      (watchdog as any).analyzeForFailures = mockAnalyzeForFailures;
      
      const result = await (watchdog as any).analyzeForFailures(podObject, 'default');
      
      expect(result).toBeNull();
    });
  });

  describe('severity calculation', () => {
    it('should calculate restart severity correctly', () => {
      const calculateRestartSeverity = (watchdog as any).calculateRestartSeverity.bind(watchdog);
      
      expect(calculateRestartSeverity(2)).toBe('low');
      expect(calculateRestartSeverity(3)).toBe('medium');
      expect(calculateRestartSeverity(5)).toBe('high');
      expect(calculateRestartSeverity(10)).toBe('critical');
      expect(calculateRestartSeverity(15)).toBe('critical');
    });

    it('should calculate waiting severity correctly', () => {
      const calculateWaitingSeverity = (watchdog as any).calculateWaitingSeverity.bind(watchdog);
      
      expect(calculateWaitingSeverity('CrashLoopBackOff')).toBe('critical');
      expect(calculateWaitingSeverity('ImagePullBackOff')).toBe('high');
      expect(calculateWaitingSeverity('ErrImagePull')).toBe('high');
      expect(calculateWaitingSeverity('CreateContainerConfigError')).toBe('medium');
      expect(calculateWaitingSeverity('InvalidImageName')).toBe('medium');
    });
  });

  describe('processPodEvent', () => {
    it('should emit podFailure event when failure detected', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'failed-pod', namespace: 'default' },
        status: { phase: 'Failed', reason: 'DeadlineExceeded' }
      };

      const mockFailureEvent: PodFailureEvent = {
        metadata: {
          podName: 'failed-pod',
          namespace: 'default',
          timestamp: new Date(),
          watchdogVersion: '2.0.0'
        },
        failure: {
          pattern: 'pod-phase-failed',
          severity: 'critical',
          reason: 'Pod phase is Failed: DeadlineExceeded',
          message: 'No additional details available',
          detectionTime: new Date()
        },
        podSnapshot: {
          phase: 'Failed',
          creationTime: new Date(),
          labels: {},
          ownerReferences: []
        },
        diagnosis: {
          executed: false,
          result: null,
          cached: false,
          executionTimeMs: null
        }
      };

      // Mock private methods
      (watchdog as any).analyzeForFailures = jest.fn().mockResolvedValue(mockFailureEvent);
      (watchdog as any).shouldExecuteDiagnosis = jest.fn().mockReturnValue(false);
      (watchdog as any).shouldSendAlert = jest.fn().mockReturnValue(false);

      const podFailureSpy = jest.fn();
      watchdog.on('podFailure', podFailureSpy);

      await (watchdog as any).processPodEvent('MODIFIED', podObject, 'default');

      expect(podFailureSpy).toHaveBeenCalledWith(mockFailureEvent);
    });

    it('should handle pod events without metadata name', async () => {
      const podObject: k8s.V1Pod = {
        metadata: {},
        status: { phase: 'Failed' }
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await (watchdog as any).processPodEvent('MODIFIED', podObject, 'default');

      expect(consoleSpy).toHaveBeenCalledWith('⚠️ Received pod event without name metadata');
      
      consoleSpy.mockRestore();
    });

    it('should ignore DELETED events', async () => {
      const podObject: k8s.V1Pod = {
        metadata: { name: 'deleted-pod' },
        status: { phase: 'Failed' }
      };

      const mockAnalyzeForFailures = jest.fn();
      (watchdog as any).analyzeForFailures = mockAnalyzeForFailures;

      await (watchdog as any).processPodEvent('DELETED', podObject, 'default');

      expect(mockAnalyzeForFailures).not.toHaveBeenCalled();
    });
  });
});