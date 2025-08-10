import { KubernetesPodWatchdog } from '../src/core/watchdog';
import * as k8s from '@kubernetes/client-node';
import { PodFailureEvent } from '../src/common/interfaces/watchdog.interfaces';

jest.mock('@kubernetes/client-node');
jest.mock('../src/utils/utils', () => require('./__mocks__/utils'));
jest.mock('../src/core/kube');

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

describe('KubernetesPodWatchdog - Diagnosis', () => {
  let watchdog: KubernetesPodWatchdog;

  beforeEach(() => {
    jest.clearAllMocks();
    (k8s.KubeConfig as unknown as jest.Mock).mockImplementation(() => mockKubeConfig);
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => mockWatch);
    (mockKubeConfig.makeApiClient as jest.Mock).mockReturnValue(mockCoreV1Api);
    
    watchdog = new KubernetesPodWatchdog({
      diagnosis: {
        enabled: true,
        timeoutMs: 30000,
        cacheConfig: {
          ttlMs: 300000,
          maxEntries: 100
        },
      }
    });

    // Mock the internal diagnosis methods to prevent calling actual diagnosis functions
    jest.spyOn(watchdog as any, 'performInternalDiagnosis').mockResolvedValue('Mock diagnosis result');
    jest.spyOn(watchdog as any, 'executeInternalDiagnosis').mockResolvedValue('Mock diagnosis result');
  });

  describe('shouldExecuteDiagnosis', () => {
    it('should return false when diagnosis is disabled', () => {
      const watchdogDisabled = new KubernetesPodWatchdog({
        diagnosis: { 
          enabled: false,
          timeoutMs: 30000,
          cacheConfig: { ttlMs: 300000, maxEntries: 100 },
        }
      });

      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      const result = (watchdogDisabled as any).shouldExecuteDiagnosis(failureEvent);
      expect(result).toBe(false);
    });

    it('should return true for medium severity and above', () => {
      const shouldExecuteDiagnosis = (watchdog as any).shouldExecuteDiagnosis.bind(watchdog);

      const createFailureEvent = (severity: string): PodFailureEvent => ({
        metadata: { podName: 'test', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: severity as any, reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      });

      expect(shouldExecuteDiagnosis(createFailureEvent('low'))).toBe(false);
      expect(shouldExecuteDiagnosis(createFailureEvent('medium'))).toBe(true);
      expect(shouldExecuteDiagnosis(createFailureEvent('high'))).toBe(true);
      expect(shouldExecuteDiagnosis(createFailureEvent('critical'))).toBe(true);
    });
  });

  describe('diagnosis caching', () => {
    it('should return cached diagnosis if available and not expired', () => {
      const cacheKey = 'default/test-pod';
      const cachedDiagnosis = {
        diagnosis: 'Cached diagnosis result',
        timestamp: new Date(Date.now() - 60000) // 1 minute ago, within TTL
      };

      // Set cache entry directly
      (watchdog as any).diagnosisCache.set(cacheKey, cachedDiagnosis);

      const result = (watchdog as any).getDiagnosisFromCache(cacheKey);
      
      expect(result).toEqual(cachedDiagnosis);
    });

    it('should return null for expired cache entries', () => {
      const cacheKey = 'default/test-pod';
      const expiredDiagnosis = {
        diagnosis: 'Expired diagnosis result',
        timestamp: new Date(Date.now() - 600000) // 10 minutes ago, beyond TTL
      };

      (watchdog as any).diagnosisCache.set(cacheKey, expiredDiagnosis);

      const result = (watchdog as any).getDiagnosisFromCache(cacheKey);
      
      expect(result).toBeNull();
      expect((watchdog as any).diagnosisCache.has(cacheKey)).toBe(false);
    });

    it('should respect max cache size', () => {
      const cacheDiagnosisResult = (watchdog as any).cacheDiagnosisResult.bind(watchdog);
      
      // Fill cache to max size
      const maxEntries = (watchdog as any).configuration.diagnosis.cacheConfig.maxEntries;
      for (let i = 0; i < maxEntries; i++) {
        cacheDiagnosisResult(`key-${i}`, `diagnosis-${i}`);
      }

      expect((watchdog as any).diagnosisCache.size).toBe(maxEntries);

      // Add one more entry, should remove oldest
      cacheDiagnosisResult('new-key', 'new-diagnosis');
      
      expect((watchdog as any).diagnosisCache.size).toBe(maxEntries);
      expect((watchdog as any).diagnosisCache.has('new-key')).toBe(true);
    });
  });


  describe('executeDiagnosisWorkflow', () => {
    it('should use cached diagnosis when available', async () => {
      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test-pod', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      const cachedResult = {
        diagnosis: 'Cached diagnosis result',
        timestamp: new Date()
      };

      (watchdog as any).getDiagnosisFromCache = jest.fn().mockReturnValue(cachedResult);

      await (watchdog as any).executeDiagnosisWorkflow(failureEvent);

      expect(failureEvent.diagnosis.executed).toBe(true);
      expect(failureEvent.diagnosis.result).toBe('Cached diagnosis result');
      expect(failureEvent.diagnosis.cached).toBe(true);
      expect(failureEvent.diagnosis.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should execute fresh diagnosis when cache miss', async () => {
      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test-pod', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      (watchdog as any).getDiagnosisFromCache = jest.fn().mockReturnValue(null);
      (watchdog as any).cacheDiagnosisResult = jest.fn();

      // Override the mock from beforeEach for this specific test
      (watchdog as any).executeInternalDiagnosis = jest.fn().mockResolvedValue('Internal diagnosis result');

      await (watchdog as any).executeDiagnosisWorkflow(failureEvent);

      expect(failureEvent.diagnosis.executed).toBe(true);
      expect(failureEvent.diagnosis.result).toBe('Internal diagnosis result');
      expect(failureEvent.diagnosis.cached).toBe(false);
      expect((watchdog as any).executeInternalDiagnosis).toHaveBeenCalledWith('test-pod', 'default');
      expect((watchdog as any).cacheDiagnosisResult).toHaveBeenCalledWith('default/test-pod', 'Internal diagnosis result');
    });

    it('should handle diagnosis execution failure', async () => {
      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test-pod', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      (watchdog as any).getDiagnosisFromCache = jest.fn().mockReturnValue(null);
      
      // Override the mock from beforeEach for this specific test to simulate failure
      (watchdog as any).executeInternalDiagnosis = jest.fn().mockRejectedValue(new Error('Internal diagnosis failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await (watchdog as any).executeDiagnosisWorkflow(failureEvent);

      expect(failureEvent.diagnosis.executed).toBe(false);
      expect(failureEvent.diagnosis.result).toContain('Internal diagnosis failed');
      expect(failureEvent.diagnosis.cached).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});