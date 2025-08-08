import { KubernetesPodWatchdog } from '../src/core/watchdog';
import * as k8s from '@kubernetes/client-node';
import { PodFailureEvent } from '../src/common/interfaces/watchdog.interfaces';

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

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('KubernetesPodWatchdog - Alerting', () => {
  let watchdog: KubernetesPodWatchdog;
  const mockWebhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';

  beforeEach(() => {
    jest.clearAllMocks();
    (k8s.KubeConfig as unknown as jest.Mock).mockImplementation(() => mockKubeConfig);
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => mockWatch);
    (mockKubeConfig.makeApiClient as jest.Mock).mockReturnValue(mockCoreV1Api);
    
    watchdog = new KubernetesPodWatchdog({
      alerting: {
        webhookUrl: mockWebhookUrl,
        retryPolicy: {
          maxAttempts: 3,
          backoffMs: 1000,
          maxBackoffMs: 30000
        },
        severityFilters: ['medium', 'high', 'critical'],
        rateLimitWindowMinutes: 0,
        includeFullManifests: false
      }
    });
  });

  describe('shouldSendAlert', () => {
    it('should return false when webhook URL is not configured', () => {
      const watchdogNoWebhook = new KubernetesPodWatchdog({
        alerting: { 
          webhookUrl: undefined,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000, maxBackoffMs: 30000 },
          severityFilters: ['medium', 'high', 'critical'],
          rateLimitWindowMinutes: 0,
          includeFullManifests: false
        }
      });

      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      const result = (watchdogNoWebhook as any).shouldSendAlert(failureEvent);
      expect(result).toBe(false);
    });

    it('should return true for severities in filter list', () => {
      const shouldSendAlert = (watchdog as any).shouldSendAlert.bind(watchdog);

      const createFailureEvent = (severity: string): PodFailureEvent => ({
        metadata: { podName: 'test', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: severity as any, reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      });

      expect(shouldSendAlert(createFailureEvent('low'))).toBe(false);
      expect(shouldSendAlert(createFailureEvent('medium'))).toBe(true);
      expect(shouldSendAlert(createFailureEvent('high'))).toBe(true);
      expect(shouldSendAlert(createFailureEvent('critical'))).toBe(true);
    });
  });

  describe('sendStructuredAlert', () => {
    it('should send alert with correct payload structure', async () => {
      const failureEvent: PodFailureEvent = {
        metadata: { 
          podName: 'test-pod', 
          namespace: 'production', 
          timestamp: new Date('2024-01-01T12:00:00Z'), 
          watchdogVersion: '2.0.0' 
        },
        failure: { 
          pattern: 'pod-phase-failed', 
          severity: 'critical', 
          reason: 'Pod crashed due to OOM', 
          message: 'Container exceeded memory limits', 
          detectionTime: new Date() 
        },
        podSnapshot: { 
          phase: 'Failed', 
          creationTime: new Date('2024-01-01T11:00:00Z'), 
          labels: { app: 'web-server' }, 
          ownerReferences: [] 
        },
        diagnosis: { 
          executed: true, 
          result: 'Memory usage exceeded 512Mi limit', 
          cached: false, 
          executionTimeMs: 1500 
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });

      (watchdog as any).sendAlertWithRetry = jest.fn().mockResolvedValue(undefined);

      await (watchdog as any).sendStructuredAlert(failureEvent);

      expect((watchdog as any).sendAlertWithRetry).toHaveBeenCalledWith({
        timestamp: '2024-01-01T12:00:00.000Z',
        severity: 'critical',
        namespace: 'production',
        podName: 'test-pod',
        reason: 'Pod crashed due to OOM',
        message: 'Container exceeded memory limits',
        pattern: 'pod-phase-failed',
        diagnosis: 'Memory usage exceeded 512Mi limit',
        podSnapshot: {
          phase: 'Failed',
          creationTime: new Date('2024-01-01T11:00:00Z'),
          labels: { app: 'web-server' },
          ownerReferences: []
        },
        watchdogVersion: '2.0.0'
      });
    });

    it('should not send alert when webhook URL is not configured', async () => {
      const watchdogNoWebhook = new KubernetesPodWatchdog({
        alerting: { 
          webhookUrl: undefined,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000, maxBackoffMs: 30000 },
          severityFilters: ['medium', 'high', 'critical'],
          rateLimitWindowMinutes: 0,
          includeFullManifests: false
        }
      });

      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      await (watchdogNoWebhook as any).sendStructuredAlert(failureEvent);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendAlertWithRetry', () => {
    const alertPayload = {
      timestamp: '2024-01-01T12:00:00.000Z',
      severity: 'critical',
      namespace: 'production',
      podName: 'test-pod',
      reason: 'Pod failed',
      message: 'Container crashed',
      pattern: 'pod-phase-failed',
      diagnosis: 'OOM detected',
      podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
      watchdogVersion: '2.0.0'
    };

    it('should send alert successfully on first attempt', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await (watchdog as any).sendAlertWithRetry(alertPayload);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(mockWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertPayload)
      });

      expect(consoleSpy).toHaveBeenCalledWith('📤 Alert sent successfully (attempt 1)');
      
      consoleSpy.mockRestore();
    });

    it('should retry on HTTP error and succeed on second attempt', async () => {
      jest.useFakeTimers();
      
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK'
        });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const alertPromise = (watchdog as any).sendAlertWithRetry(alertPayload);
      
      // Wait a bit then fast-forward through the backoff delay
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      
      await alertPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        '⚠️ Alert sending failed (attempt 1/3):',
        expect.any(Error)
      );
      expect(consoleSpy).toHaveBeenCalledWith('📤 Alert sent successfully (attempt 2)');

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
      jest.useRealTimers();
    }, 10000);

    it('should fail after max retry attempts', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await (watchdog as any).sendAlertWithRetry(alertPayload);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalledWith('❌ Alert sending failed after all retry attempts');

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should handle network errors with retry', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK'
        });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await (watchdog as any).sendAlertWithRetry(alertPayload);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        '⚠️ Alert sending failed (attempt 1/3):',
        expect.any(Error)
      );
      expect(consoleSpy).toHaveBeenCalledWith('📤 Alert sent successfully (attempt 2)');

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should use exponential backoff correctly', async () => {
      // Test the logic without async complexity by mocking the internal setTimeout calls
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.fn();
      global.setTimeout = setTimeoutSpy as any;
      
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Mock the implementation to immediately call the callback
      setTimeoutSpy.mockImplementation((callback, delay) => {
        callback();
        return {} as any;
      });

      await (watchdog as any).sendAlertWithRetry(alertPayload);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

      global.setTimeout = originalSetTimeout;
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should respect max backoff limit', async () => {
      const watchdogLongRetry = new KubernetesPodWatchdog({
        alerting: {
          webhookUrl: mockWebhookUrl,
          retryPolicy: {
            maxAttempts: 3,
            backoffMs: 10000,
            maxBackoffMs: 15000 // Lower than what exponential backoff would calculate
          },
          severityFilters: ['medium', 'high', 'critical'],
          rateLimitWindowMinutes: 0,
          includeFullManifests: false
        }
      });
      
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.fn();
      global.setTimeout = setTimeoutSpy as any;

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Mock the implementation to immediately call the callback  
      setTimeoutSpy.mockImplementation((callback, delay) => {
        callback();
        return {} as any;
      });

      await (watchdogLongRetry as any).sendAlertWithRetry(alertPayload);

      // Verify max backoff was respected (should not exceed 15000ms)
      const delays = setTimeoutSpy.mock.calls.map(call => call[1]);
      const nonNullDelays = delays.filter(d => d != null) as number[];
      expect(Math.max(...nonNullDelays)).toBeLessThanOrEqual(15000);

      global.setTimeout = originalSetTimeout;
      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});