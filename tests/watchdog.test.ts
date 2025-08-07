import { KubernetesPodWatchdog } from '../src/core/watchdog';
import * as k8s from '@kubernetes/client-node';
import { EventEmitter } from 'events';

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

describe('KubernetesPodWatchdog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (k8s.KubeConfig as jest.Mock).mockImplementation(() => mockKubeConfig);
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => mockWatch);
    (mockKubeConfig.makeApiClient as jest.Mock).mockReturnValue(mockCoreV1Api);
    (mockKubeConfig.loadFromDefault as jest.Mock).mockImplementation(() => {}); // Reset to success
  });

  describe('constructor', () => {
    it('should create instance with default configuration', () => {
      const watchdog = new KubernetesPodWatchdog();
      expect(watchdog).toBeInstanceOf(EventEmitter);
      expect(k8s.KubeConfig).toHaveBeenCalled();
      expect(mockKubeConfig.loadFromDefault).toHaveBeenCalled();
    });

    it('should merge user configuration with defaults', () => {
      const userConfig = {
        monitoring: {
          namespaces: ['custom-namespace'],
          excludeNamespaces: ['kube-system'],
          failureDetection: {
            minRestartThreshold: 5,
            maxPendingDurationMs: 300000,
            enableCrashLoopDetection: true,
            enableImagePullFailureDetection: true,
            enableResourceLimitDetection: true
          }
        }
      };

      const watchdog = new KubernetesPodWatchdog(userConfig);
      expect(watchdog).toBeDefined();
    });

    it('should throw error if Kubernetes config fails to load', () => {
      (mockKubeConfig.loadFromDefault as jest.Mock).mockImplementation(() => {
        throw new Error('Config load failed');
      });

      expect(() => new KubernetesPodWatchdog()).toThrow('Failed to load Kubernetes configuration');
    });
  });

  describe('initialize', () => {
    let watchdog: KubernetesPodWatchdog;

    beforeEach(() => {
      watchdog = new KubernetesPodWatchdog();
    });

    it('should successfully initialize with valid cluster connectivity', async () => {
      (mockCoreV1Api.listNamespace as jest.Mock).mockResolvedValue({
        body: { items: [] }
      });

      await expect(watchdog.initialize()).resolves.not.toThrow();
      expect(mockCoreV1Api.listNamespace).toHaveBeenCalled();
    });

    it('should throw error if cluster connectivity validation fails', async () => {
      (mockCoreV1Api.listNamespace as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(watchdog.initialize()).rejects.toThrow('Watchdog initialization failed');
    });

    it('should handle empty namespace list', async () => {
      (mockCoreV1Api.listNamespace as jest.Mock).mockResolvedValue(null);

      await expect(watchdog.initialize()).rejects.toThrow('Cluster connectivity validation failed');
    });
  });

  describe('startMonitoring', () => {
    let watchdog: KubernetesPodWatchdog;

    beforeEach(() => {
      watchdog = new KubernetesPodWatchdog();
      (mockCoreV1Api.listNamespace as jest.Mock).mockResolvedValue({
        body: { 
          items: [
            { metadata: { name: 'default' } },
            { metadata: { name: 'custom' } }
          ] 
        }
      });
    });

    it('should start monitoring successfully', async () => {
      (mockWatch.watch as jest.Mock).mockResolvedValue(undefined);
      
      const monitoringStartedSpy = jest.fn();
      watchdog.on('monitoringStarted', monitoringStartedSpy);

      await watchdog.startMonitoring();

      expect(monitoringStartedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
          namespacesMonitored: expect.any(Number)
        })
      );
    });

    it('should handle watch establishment failure', async () => {
      (mockWatch.watch as jest.Mock).mockRejectedValue(new Error('Watch failed'));

      // The startMonitoring method catches watch failures and continues
      // It uses Promise.allSettled, so it won't throw even if watches fail
      await expect(watchdog.startMonitoring()).resolves.not.toThrow();
    });

    it('should filter excluded namespaces', async () => {
      (mockCoreV1Api.listNamespace as jest.Mock).mockResolvedValue({
        body: { 
          items: [
            { metadata: { name: 'default' } },
            { metadata: { name: 'kube-system' } }, // Should be excluded
            { metadata: { name: 'custom' } }
          ] 
        }
      });

      (mockWatch.watch as jest.Mock).mockResolvedValue(undefined);

      await watchdog.startMonitoring();

      // Should only establish watches for 'default' and 'custom', not 'kube-system'
      expect(mockWatch.watch).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopMonitoring', () => {
    let watchdog: KubernetesPodWatchdog;

    beforeEach(() => {
      watchdog = new KubernetesPodWatchdog();
    });

    it('should stop monitoring gracefully', async () => {
      const monitoringStoppedSpy = jest.fn();
      watchdog.on('monitoringStopped', monitoringStoppedSpy);

      await watchdog.stopMonitoring();

      expect(monitoringStoppedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
          metrics: expect.any(Object)
        })
      );
    });

    it('should handle errors during shutdown', async () => {
      // Create a mock watch request with abort controller
      const mockAbortController = {
        abort: jest.fn().mockImplementation(() => {
          throw new Error('Abort failed');
        })
      };

      // Access private member for testing
      (watchdog as any).activeWatchRequests.set('test-namespace', {
        abortController: mockAbortController
      });

      await expect(watchdog.stopMonitoring()).resolves.not.toThrow();
    });
  });

  describe('getHealthStatus', () => {
    let watchdog: KubernetesPodWatchdog;

    beforeEach(() => {
      watchdog = new KubernetesPodWatchdog();
    });

    it('should return comprehensive health status', () => {
      const healthStatus = watchdog.getHealthStatus();

      expect(healthStatus).toEqual({
        isHealthy: expect.any(Boolean),
        connectionState: expect.objectContaining({
          isHealthy: expect.any(Boolean),
          lastSuccessfulConnection: expect.any(Date),
          consecutiveFailures: expect.any(Number),
          reconnectionBackoffMs: expect.any(Number)
        }),
        metrics: expect.objectContaining({
          totalFailuresDetected: expect.any(Number),
          diagnosisCallsExecuted: expect.any(Number),
          cacheHitRate: expect.any(Number),
          reconnectionAttempts: expect.any(Number),
          lastHealthCheck: expect.any(Date)
        }),
        activeNamespaces: expect.any(Array),
        cacheStats: expect.objectContaining({
          entries: expect.any(Number),
          hitRate: expect.any(Number)
        })
      });
    });

    it('should reflect current connection state', () => {
      const healthStatus = watchdog.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(true);
      expect(healthStatus.connectionState.consecutiveFailures).toBe(0);
    });
  });
});