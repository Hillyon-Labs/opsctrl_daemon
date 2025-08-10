import { waitUntil } from '../src/utils/utils';
import { ClusterRegistrationService } from '../src/core/cluster-registration';

jest.mock('../src/core/cluster-registration');

const MockedClusterRegistrationService = ClusterRegistrationService as jest.MockedClass<typeof ClusterRegistrationService>;

describe('Cluster Registration Startup Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('waitUntil with cluster registration', () => {
    it('should successfully wait for cluster registration', async () => {
      const mockClusterInfo = {
        cluster_id: 'clu_test123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: '2023-01-01T00:00:00.000Z'
      };

      let attemptCount = 0;
      const mockRegistrationFn = jest.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Registration failed');
        }
        return mockClusterInfo;
      });

      const result = await waitUntil(
        async () => {
          try {
            return await mockRegistrationFn();
          } catch (error) {
            return undefined;
          }
        },
        10000, // 10 seconds timeout
        100    // 100ms intervals
      );

      expect(result).toEqual(mockClusterInfo);
      expect(mockRegistrationFn).toHaveBeenCalledTimes(3);
    });

    it('should return undefined when registration times out', async () => {
      const mockRegistrationFn = jest.fn(async () => {
        throw new Error('Registration always fails');
      });

      const result = await waitUntil(
        async () => {
          try {
            return await mockRegistrationFn();
          } catch (error) {
            return undefined;
          }
        },
        500,  // 500ms timeout (short)
        100   // 100ms intervals
      );

      expect(result).toBeUndefined();
      expect(mockRegistrationFn).toHaveBeenCalledTimes(5); // 0, 100, 200, 300, 400ms
    });

    it('should return immediately when registration succeeds on first attempt', async () => {
      const mockClusterInfo = {
        cluster_id: 'clu_test123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: '2023-01-01T00:00:00.000Z'
      };

      const mockRegistrationFn = jest.fn(async () => mockClusterInfo);

      const startTime = Date.now();
      const result = await waitUntil(
        async () => {
          try {
            return await mockRegistrationFn();
          } catch (error) {
            return undefined;
          }
        },
        10000, // 10 seconds timeout
        1000   // 1 second intervals
      );
      const endTime = Date.now();

      expect(result).toEqual(mockClusterInfo);
      expect(mockRegistrationFn).toHaveBeenCalledTimes(1);
      expect(endTime - startTime).toBeLessThan(100); // Should complete quickly
    });
  });

  describe('ClusterRegistrationService integration pattern', () => {
    it('should demonstrate the startup pattern used in index.ts', async () => {
      const mockService = {
        ensureClusterRegistration: jest.fn()
      };

      const mockClusterInfo = {
        cluster_id: 'clu_test123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: '2023-01-01T00:00:00.000Z'
      };

      // Simulate failure then success
      mockService.ensureClusterRegistration
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce(mockClusterInfo);

      // This simulates the pattern used in index.ts
      const clusterInfo = await waitUntil(
        async () => {
          try {
            const info = await mockService.ensureClusterRegistration();
            return info;
          } catch (error) {
            // In real app, this would log: console.log(`🔄 Registration attempt failed: ${error}. Retrying...`);
            return undefined;
          }
        },
        10000, // 5 minutes timeout (using shorter for test)
        100    // 10 second intervals (using shorter for test)
      );

      expect(clusterInfo).toEqual(mockClusterInfo);
      expect(mockService.ensureClusterRegistration).toHaveBeenCalledTimes(3);
    });
  });
});