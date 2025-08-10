import * as timeConstants from '../src/common/time.constants';

// Mock environment variables for testing
const originalEnv = process.env;

describe('Configuration Integration with Time Constants', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use time constants as default values in configuration validation', () => {
    // Set required environment variables
    process.env.WATCH_NAMESPACES = 'default,test';
    
    // Import after setting env vars to ensure proper initialization
    const { WatchdogConfig } = require('../src/config/watchdog-config');
    
    // This should not throw since we have valid env vars
    expect(() => {
      const config = WatchdogConfig.fromEnvironment();
      const watchdogConfig = config.toWatchdogConfiguration();
      
      // Verify that default values match our constants
      expect(watchdogConfig.diagnosis.timeoutMs).toBe(timeConstants.DIAGNOSIS_DEFAULT_TIMEOUT_MS);
      expect(watchdogConfig.diagnosis.cacheConfig.ttlMs).toBe(timeConstants.DIAGNOSIS_CACHE_DEFAULT_TTL_MS);
      expect(watchdogConfig.monitoring.failureDetection.maxPendingDurationMs).toBe(timeConstants.MAX_PENDING_DURATION_DEFAULT_MS);
      expect(watchdogConfig.alerting.retryPolicy.backoffMs).toBe(timeConstants.ALERT_BACKOFF_DEFAULT_MS);
      expect(watchdogConfig.alerting.retryPolicy.maxBackoffMs).toBe(timeConstants.ALERT_MAX_BACKOFF_DEFAULT_MS);
      expect(watchdogConfig.resilience.reconnectionPolicy.initialBackoffMs).toBe(timeConstants.RECONNECTION_BACKOFF_DEFAULT_MS);
      expect(watchdogConfig.resilience.reconnectionPolicy.maxBackoffMs).toBe(timeConstants.RECONNECTION_MAX_BACKOFF_DEFAULT_MS);
      
    }).not.toThrow();
  });

  it('should respect time constant limits in validation', () => {
    // Set required environment variables with values that should be within limits
    process.env.WATCH_NAMESPACES = 'default';
    process.env.DIAGNOSIS_TIMEOUT_MS = timeConstants.DIAGNOSIS_MIN_TIMEOUT_MS.toString();
    process.env.DIAGNOSIS_CACHE_TTL_MS = timeConstants.DIAGNOSIS_CACHE_MAX_TTL_MS.toString();
    
    const { WatchdogConfig } = require('../src/config/watchdog-config');
    
    expect(() => {
      WatchdogConfig.fromEnvironment();
    }).not.toThrow();
  });

  it('should reject values outside time constant limits', () => {
    // Set required environment variables
    process.env.WATCH_NAMESPACES = 'default';
    // Set an invalid timeout (below minimum)
    process.env.DIAGNOSIS_TIMEOUT_MS = (timeConstants.DIAGNOSIS_MIN_TIMEOUT_MS - 1).toString();
    
    const { WatchdogConfig } = require('../src/config/watchdog-config');
    
    expect(() => {
      WatchdogConfig.fromEnvironment();
    }).toThrow();
  });
});