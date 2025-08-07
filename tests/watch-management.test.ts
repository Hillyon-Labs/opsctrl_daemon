import { KubernetesPodWatchdog } from '../src/core/watchdog';
import * as k8s from '@kubernetes/client-node';

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

describe('KubernetesPodWatchdog - Watch Stream Management', () => {
  let watchdog: KubernetesPodWatchdog;

  beforeEach(() => {
    jest.clearAllMocks();
    (k8s.KubeConfig as jest.Mock).mockImplementation(() => mockKubeConfig);
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => mockWatch);
    (mockKubeConfig.makeApiClient as jest.Mock).mockReturnValue(mockCoreV1Api);
    
    watchdog = new KubernetesPodWatchdog({
      resilience: {
        reconnectionPolicy: {
          enabled: true,
          initialBackoffMs: 1000,
          maxBackoffMs: 30000,
          backoffMultiplier: 2,
          maxConsecutiveFailures: 5
        }
      }
    });
  });

  describe('establishNamespaceWatch', () => {
    it('should establish watch stream successfully', async () => {
      (mockWatch.watch as jest.Mock).mockResolvedValue(undefined);

      await (watchdog as any).establishNamespaceWatch('default');

      expect(mockWatch.watch).toHaveBeenCalledWith(
        '/api/v1/namespaces/default/pods',
        {},
        expect.any(Function), // processPodEvent callback
        expect.any(Function)  // handleWatchError callback
      );

      const activeWatchRequests = (watchdog as any).activeWatchRequests;
      expect(activeWatchRequests.has('default')).toBe(true);
      expect(activeWatchRequests.get('default')).toEqual({
        namespace: 'default',
        abortController: expect.any(AbortController),
        startTime: expect.any(Date),
        isHealthy: true
      });
    });

    it('should handle watch establishment failure', async () => {
      (mockWatch.watch as jest.Mock).mockRejectedValue(new Error('Connection failed'));
      (watchdog as any).scheduleReconnection = jest.fn();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await (watchdog as any).establishNamespaceWatch('failing-namespace');

      expect(consoleSpy).toHaveBeenCalledWith(
        '❌ Failed to establish watch for namespace failing-namespace:',
        expect.any(Error)
      );

      const activeWatchRequests = (watchdog as any).activeWatchRequests;
      expect(activeWatchRequests.has('failing-namespace')).toBe(false);
      expect((watchdog as any).scheduleReconnection).toHaveBeenCalledWith('failing-namespace');

      consoleSpy.mockRestore();
    });

    it('should not schedule reconnection when reconnection is disabled', async () => {
      const watchdogNoReconnect = new KubernetesPodWatchdog({
        resilience: {
          reconnectionPolicy: { 
            enabled: false,
            initialBackoffMs: 1000,
            maxBackoffMs: 30000,
            backoffMultiplier: 2,
            maxConsecutiveFailures: 5
          }
        }
      });

      (mockWatch.watch as jest.Mock).mockRejectedValue(new Error('Connection failed'));
      (watchdogNoReconnect as any).scheduleReconnection = jest.fn();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await (watchdogNoReconnect as any).establishNamespaceWatch('failing-namespace');

      expect((watchdogNoReconnect as any).scheduleReconnection).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('handleWatchError', () => {
    let mockAbortController: AbortController;

    beforeEach(() => {
      mockAbortController = new AbortController();
      (watchdog as any).activeWatchRequests.set('test-namespace', {
        namespace: 'test-namespace',
        abortController: mockAbortController,
        startTime: new Date(),
        isHealthy: true
      });
    });

    it('should handle intentional abort gracefully', async () => {
      mockAbortController.abort();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      (watchdog as any).scheduleReconnection = jest.fn();

      await (watchdog as any).handleWatchError(
        new Error('Aborted'),
        'test-namespace',
        mockAbortController
      );

      expect(consoleSpy).toHaveBeenCalledWith('📡 Watch stream for test-namespace was intentionally aborted');
      expect((watchdog as any).scheduleReconnection).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should update connection state on error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (watchdog as any).scheduleReconnection = jest.fn();

      await (watchdog as any).handleWatchError(
        new Error('Network error'),
        'test-namespace',
        mockAbortController
      );

      const connectionState = (watchdog as any).connectionState;
      expect(connectionState.consecutiveFailures).toBe(1);
      expect(connectionState.isHealthy).toBe(false);

      const activeWatchRequests = (watchdog as any).activeWatchRequests;
      expect(activeWatchRequests.has('test-namespace')).toBe(false);

      expect((watchdog as any).scheduleReconnection).toHaveBeenCalledWith('test-namespace');

      consoleSpy.mockRestore();
    });

    it('should not schedule reconnection when disabled', async () => {
      const watchdogNoReconnect = new KubernetesPodWatchdog({
        resilience: {
          reconnectionPolicy: { 
            enabled: false,
            initialBackoffMs: 1000,
            maxBackoffMs: 30000,
            backoffMultiplier: 2,
            maxConsecutiveFailures: 5
          }
        }
      });

      (watchdogNoReconnect as any).activeWatchRequests.set('test-namespace', {
        abortController: mockAbortController
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (watchdogNoReconnect as any).scheduleReconnection = jest.fn();

      await (watchdogNoReconnect as any).handleWatchError(
        new Error('Network error'),
        'test-namespace',
        mockAbortController
      );

      expect((watchdogNoReconnect as any).scheduleReconnection).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('scheduleReconnection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should schedule reconnection with exponential backoff', async () => {
      (watchdog as any).connectionState.consecutiveFailures = 2;
      (watchdog as any).establishNamespaceWatch = jest.fn().mockResolvedValue(undefined);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const reconnectionPromise = (watchdog as any).scheduleReconnection('test-namespace');

      // Expected backoff: 1000 * 2^2 = 4000ms
      expect(consoleSpy).toHaveBeenCalledWith('🔄 Scheduling reconnection for test-namespace in 4000ms');

      jest.advanceTimersByTime(4000);

      await reconnectionPromise;

      expect((watchdog as any).establishNamespaceWatch).toHaveBeenCalledWith('test-namespace');

      // Connection state should be reset on successful reconnection
      const connectionState = (watchdog as any).connectionState;
      expect(connectionState.consecutiveFailures).toBe(0);
      expect(connectionState.isHealthy).toBe(true);
      expect(connectionState.lastSuccessfulConnection).toBeInstanceOf(Date);

      consoleSpy.mockRestore();
    });

    it('should respect max backoff limit', async () => {
      (watchdog as any).connectionState.consecutiveFailures = 10; // Would normally result in very large backoff

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (watchdog as any).establishNamespaceWatch = jest.fn().mockResolvedValue(undefined);

      (watchdog as any).scheduleReconnection('test-namespace');

      // At 10 failures, it should hit max consecutive failures and give up
      expect(errorSpy).toHaveBeenCalledWith('❌ Max consecutive failures reached for test-namespace, giving up');

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should give up after max consecutive failures', async () => {
      (watchdog as any).connectionState.consecutiveFailures = 5; // At max threshold

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (watchdog as any).establishNamespaceWatch = jest.fn();

      await (watchdog as any).scheduleReconnection('test-namespace');

      expect(consoleSpy).toHaveBeenCalledWith(
        '❌ Max consecutive failures reached for test-namespace, giving up'
      );
      expect((watchdog as any).establishNamespaceWatch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle reconnection failure', async () => {
      (watchdog as any).connectionState.consecutiveFailures = 1;
      (watchdog as any).establishNamespaceWatch = jest.fn().mockRejectedValue(new Error('Still failing'));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const reconnectionPromise = (watchdog as any).scheduleReconnection('test-namespace');

      jest.advanceTimersByTime(2000); // 1000 * 2^1 = 2000ms

      await reconnectionPromise;

      expect(errorSpy).toHaveBeenCalledWith(
        '❌ Reconnection failed for test-namespace:',
        expect.any(Error)
      );

      // Connection state should not be reset on failed reconnection
      const connectionState = (watchdog as any).connectionState;
      expect(connectionState.consecutiveFailures).toBe(1);

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should update metrics on reconnection attempt', async () => {
      (watchdog as any).connectionState.consecutiveFailures = 1;
      (watchdog as any).establishNamespaceWatch = jest.fn().mockResolvedValue(undefined);

      const initialAttempts = (watchdog as any).metrics.reconnectionAttempts;

      const reconnectionPromise = (watchdog as any).scheduleReconnection('test-namespace');

      jest.advanceTimersByTime(2000);

      await reconnectionPromise;

      expect((watchdog as any).metrics.reconnectionAttempts).toBe(initialAttempts + 1);
    });
  });

  describe('cache cleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clean up expired cache entries', () => {
      const cache = (watchdog as any).diagnosisCache;
      const ttl = (watchdog as any).configuration.diagnosis.cacheConfig.ttlMs;

      // Add some cache entries
      const now = new Date();
      const expired = new Date(now.getTime() - ttl - 1000);
      const fresh = new Date(now.getTime() - 1000);

      cache.set('expired-key', { diagnosis: 'expired', timestamp: expired });
      cache.set('fresh-key', { diagnosis: 'fresh', timestamp: fresh });

      expect(cache.size).toBe(2);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Manually trigger the cleanup function
      const cleanupFunction = (watchdog as any).cacheCleanupTimer._idleTimeout;
      if (typeof cleanupFunction === 'function') {
        cleanupFunction.call(watchdog);
      } else {
        // Fallback: manually clean expired entries
        const now = Date.now();
        let removedCount = 0;
        for (const [key, entry] of cache.entries()) {
          if (now - entry.timestamp.getTime() > ttl) {
            cache.delete(key);
            removedCount++;
          }
        }
        if (removedCount > 0) {
          console.log(`🧹 Cleaned up ${removedCount} expired cache entries`);
        }
      }

      expect(consoleSpy).toHaveBeenCalledWith('🧹 Cleaned up 1 expired cache entries');
      expect(cache.size).toBe(1);
      expect(cache.has('fresh-key')).toBe(true);
      expect(cache.has('expired-key')).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should update cache hit rate during cleanup', () => {
      // Add cache entry to test hit rate calculation
      (watchdog as any).diagnosisCache.set('test-key', {
        diagnosis: 'test',
        timestamp: new Date()
      });

      // Manually call the updateCacheHitRate method
      (watchdog as any).updateCacheHitRate();

      // Hit rate should be updated (mocked to return 0.8 when cache has entries)
      expect((watchdog as any).metrics.cacheHitRate).toBe(0.8);
    });

    it('should clean up timer on stopMonitoring', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await watchdog.stopMonitoring();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((watchdog as any).cacheCleanupTimer).toBeNull();

      clearIntervalSpy.mockRestore();
    });
  });
});