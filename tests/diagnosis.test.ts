import { KubernetesPodWatchdog } from '../src/core/watchdog';
import * as k8s from '@kubernetes/client-node';
import { ChildProcess } from 'child_process';
import { PodFailureEvent } from '../src/common/interfaces';

jest.mock('@kubernetes/client-node');
jest.mock('child_process');

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
    (k8s.KubeConfig as jest.Mock).mockImplementation(() => mockKubeConfig);
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
        opsctrlIntegration: {
          command: 'npm',
          args: ['run', 'dev', '--', 'diagnose'],
          workingDirectory: process.cwd()
        }
      }
    });
  });

  describe('shouldExecuteDiagnosis', () => {
    it('should return false when diagnosis is disabled', () => {
      const watchdogDisabled = new KubernetesPodWatchdog({
        diagnosis: { 
          enabled: false,
          timeoutMs: 30000,
          cacheConfig: { ttlMs: 300000, maxEntries: 100 },
          opsctrlIntegration: { command: 'npm', args: ['test'], workingDirectory: '.' }
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

  describe('executeOpsctrlDiagnosis', () => {
    let mockSpawn: jest.Mock;
    let mockChildProcess: {
      stdout: { on: jest.Mock };
      stderr: { on: jest.Mock };
      on: jest.Mock;
      kill: jest.Mock;
    };

    beforeEach(() => {
      mockChildProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };

      mockSpawn = jest.fn().mockReturnValue(mockChildProcess);
      jest.doMock('child_process', () => ({ spawn: mockSpawn }));
    });

    it('should execute diagnosis command successfully', async () => {
      const { spawn } = require('child_process');
      spawn.mockReturnValue(mockChildProcess);

      // Mock successful execution
      mockChildProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('Diagnosis completed successfully'));
        }
      });

      mockChildProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          callback(0); // Exit code 0 for success
        }
      });

      const promise = (watchdog as any).executeOpsctrlDiagnosis('test-pod', 'default');
      
      // Trigger the callbacks
      const dataCallback = mockChildProcess.stdout.on.mock.calls.find(call => call[0] === 'data')[1];
      const closeCallback = mockChildProcess.on.mock.calls.find(call => call[0] === 'close')[1];
      
      dataCallback(Buffer.from('Diagnosis completed successfully'));
      closeCallback(0);

      const result = await promise;
      
      expect(result).toBe('Diagnosis completed successfully');
      expect(spawn).toHaveBeenCalledWith('npm', 
        ['run', 'dev', '--', 'diagnose', 'test-pod', '-n', 'default'], 
        expect.objectContaining({
          cwd: process.cwd(),
          stdio: 'pipe',
          timeout: 30000
        })
      );
    });

    it('should handle diagnosis command failure', async () => {
      const { spawn } = require('child_process');
      spawn.mockReturnValue(mockChildProcess);

      mockChildProcess.stderr.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('Error: Pod not found'));
        }
      });

      mockChildProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          callback(1); // Non-zero exit code for failure
        }
      });

      const promise = (watchdog as any).executeOpsctrlDiagnosis('test-pod', 'default');
      
      const errorCallback = mockChildProcess.stderr.on.mock.calls.find(call => call[0] === 'data')[1];
      const closeCallback = mockChildProcess.on.mock.calls.find(call => call[0] === 'close')[1];
      
      errorCallback(Buffer.from('Error: Pod not found'));
      closeCallback(1);

      await expect(promise).rejects.toThrow('Diagnosis process exited with code 1');
    });

    it('should handle diagnosis command timeout', async () => {
      jest.useFakeTimers();
      
      const { spawn } = require('child_process');
      spawn.mockReturnValue(mockChildProcess);

      const promise = (watchdog as any).executeOpsctrlDiagnosis('test-pod', 'default');
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(30001);

      await expect(promise).rejects.toThrow('Diagnosis timeout after 30000ms');
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
      
      jest.useRealTimers();
    });

    it('should handle spawn error', async () => {
      const { spawn } = require('child_process');
      spawn.mockReturnValue(mockChildProcess);

      mockChildProcess.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Command not found'));
        }
      });

      const promise = (watchdog as any).executeOpsctrlDiagnosis('test-pod', 'default');
      
      const errorCallback = mockChildProcess.on.mock.calls.find(call => call[0] === 'error')[1];
      errorCallback(new Error('Command not found'));

      await expect(promise).rejects.toThrow('Failed to execute diagnosis command');
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
      (watchdog as any).executeOpsctrlDiagnosis = jest.fn().mockResolvedValue('Fresh diagnosis result');
      (watchdog as any).cacheDiagnosisResult = jest.fn();

      await (watchdog as any).executeDiagnosisWorkflow(failureEvent);

      expect(failureEvent.diagnosis.executed).toBe(true);
      expect(failureEvent.diagnosis.result).toBe('Fresh diagnosis result');
      expect(failureEvent.diagnosis.cached).toBe(false);
      expect((watchdog as any).executeOpsctrlDiagnosis).toHaveBeenCalledWith('test-pod', 'default');
      expect((watchdog as any).cacheDiagnosisResult).toHaveBeenCalledWith('default/test-pod', 'Fresh diagnosis result');
    });

    it('should handle diagnosis execution failure', async () => {
      const failureEvent: PodFailureEvent = {
        metadata: { podName: 'test-pod', namespace: 'default', timestamp: new Date(), watchdogVersion: '2.0.0' },
        failure: { pattern: 'pod-phase-failed', severity: 'critical', reason: 'test', message: 'test', detectionTime: new Date() },
        podSnapshot: { phase: 'Failed', creationTime: new Date(), labels: {}, ownerReferences: [] },
        diagnosis: { executed: false, result: null, cached: false, executionTimeMs: null }
      };

      (watchdog as any).getDiagnosisFromCache = jest.fn().mockReturnValue(null);
      (watchdog as any).executeOpsctrlDiagnosis = jest.fn().mockRejectedValue(new Error('Diagnosis failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await (watchdog as any).executeDiagnosisWorkflow(failureEvent);

      expect(failureEvent.diagnosis.executed).toBe(false);
      expect(failureEvent.diagnosis.result).toContain('Diagnosis failed');
      expect(failureEvent.diagnosis.cached).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});