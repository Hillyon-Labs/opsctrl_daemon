import * as timeConstants from '../src/common/time.constants';

describe('Time Constants', () => {
  describe('Base time units', () => {
    it('should define correct base time units', () => {
      expect(timeConstants.ONE_SECOND_IN_MILLISECONDS).toBe(1000);
      expect(timeConstants.ONE_MINUTE_IN_MILLISECONDS).toBe(60000);
      expect(timeConstants.ONE_HOUR_IN_MILLISECONDS).toBe(3600000);
      expect(timeConstants.ONE_DAY_IN_MILLISECONDS).toBe(86400000);
    });
  });

  describe('Common short durations', () => {
    it('should define correct short durations', () => {
      expect(timeConstants.FIVE_SECONDS_IN_MILLISECONDS).toBe(5000);
      expect(timeConstants.TEN_SECONDS_IN_MILLISECONDS).toBe(10000);
      expect(timeConstants.THIRTY_SECONDS_IN_MILLISECONDS).toBe(30000);
    });
  });

  describe('Common medium durations', () => {
    it('should define correct medium durations', () => {
      expect(timeConstants.FIVE_MINUTES_IN_MILLISECONDS).toBe(300000);
      expect(timeConstants.TEN_MINUTES_IN_MILLISECONDS).toBe(600000);
      expect(timeConstants.THIRTY_MINUTES_IN_MILLISECONDS).toBe(1800000);
    });
  });

  describe('Diagnosis timeouts', () => {
    it('should have consistent diagnosis timeout constants', () => {
      expect(timeConstants.DIAGNOSIS_MIN_TIMEOUT_MS).toBe(5000);
      expect(timeConstants.DIAGNOSIS_MAX_TIMEOUT_MS).toBe(300000);
      expect(timeConstants.DIAGNOSIS_DEFAULT_TIMEOUT_MS).toBe(30000);
      
      // Ensure min < default < max
      expect(timeConstants.DIAGNOSIS_MIN_TIMEOUT_MS).toBeLessThan(timeConstants.DIAGNOSIS_DEFAULT_TIMEOUT_MS);
      expect(timeConstants.DIAGNOSIS_DEFAULT_TIMEOUT_MS).toBeLessThan(timeConstants.DIAGNOSIS_MAX_TIMEOUT_MS);
    });
  });

  describe('Cache timeouts', () => {
    it('should have consistent cache timeout constants', () => {
      expect(timeConstants.DIAGNOSIS_CACHE_MIN_TTL_MS).toBe(60000);
      expect(timeConstants.DIAGNOSIS_CACHE_MAX_TTL_MS).toBe(86400000);
      expect(timeConstants.DIAGNOSIS_CACHE_DEFAULT_TTL_MS).toBe(300000);
      
      // Ensure min < default < max
      expect(timeConstants.DIAGNOSIS_CACHE_MIN_TTL_MS).toBeLessThan(timeConstants.DIAGNOSIS_CACHE_DEFAULT_TTL_MS);
      expect(timeConstants.DIAGNOSIS_CACHE_DEFAULT_TTL_MS).toBeLessThan(timeConstants.DIAGNOSIS_CACHE_MAX_TTL_MS);
    });
  });

  describe('Backoff timeouts', () => {
    it('should have consistent alert backoff constants', () => {
      expect(timeConstants.ALERT_BACKOFF_MIN_MS).toBe(100);
      expect(timeConstants.ALERT_BACKOFF_MAX_MS).toBe(60000);
      expect(timeConstants.ALERT_BACKOFF_DEFAULT_MS).toBe(1000);
      
      expect(timeConstants.ALERT_MAX_BACKOFF_MIN_MS).toBe(1000);
      expect(timeConstants.ALERT_MAX_BACKOFF_MAX_MS).toBe(300000);
      expect(timeConstants.ALERT_MAX_BACKOFF_DEFAULT_MS).toBe(30000);
      
      // Ensure logical relationships
      expect(timeConstants.ALERT_BACKOFF_MIN_MS).toBeLessThan(timeConstants.ALERT_BACKOFF_DEFAULT_MS);
      expect(timeConstants.ALERT_BACKOFF_DEFAULT_MS).toBeLessThan(timeConstants.ALERT_BACKOFF_MAX_MS);
    });

    it('should have consistent reconnection backoff constants', () => {
      expect(timeConstants.RECONNECTION_BACKOFF_MIN_MS).toBe(100);
      expect(timeConstants.RECONNECTION_BACKOFF_MAX_MS).toBe(60000);
      expect(timeConstants.RECONNECTION_BACKOFF_DEFAULT_MS).toBe(1000);
      
      expect(timeConstants.RECONNECTION_MAX_BACKOFF_MIN_MS).toBe(1000);
      expect(timeConstants.RECONNECTION_MAX_BACKOFF_MAX_MS).toBe(600000);
      expect(timeConstants.RECONNECTION_MAX_BACKOFF_DEFAULT_MS).toBe(30000);
      
      // Ensure logical relationships
      expect(timeConstants.RECONNECTION_BACKOFF_MIN_MS).toBeLessThan(timeConstants.RECONNECTION_BACKOFF_DEFAULT_MS);
      expect(timeConstants.RECONNECTION_BACKOFF_DEFAULT_MS).toBeLessThan(timeConstants.RECONNECTION_BACKOFF_MAX_MS);
    });
  });

  describe('Rate limiting', () => {
    it('should have correct rate limiting constants', () => {
      expect(timeConstants.ALERT_RATE_LIMIT_MAX_MINUTES).toBe(1440); // 24 hours
      expect(timeConstants.ALERT_RATE_LIMIT_DEFAULT_MINUTES).toBe(5);
      
      expect(timeConstants.ALERT_RATE_LIMIT_DEFAULT_MINUTES).toBeLessThan(timeConstants.ALERT_RATE_LIMIT_MAX_MINUTES);
    });
  });
});