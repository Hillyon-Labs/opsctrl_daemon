import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as crypto from 'crypto';
import { ClusterRegistrationService, ClusterRegistrationConfig, ClusterInfo, ClusterRegistrationResponse, PendingRegistration } from '../src/core/cluster-registration';

jest.mock('axios');
jest.mock('fs');
jest.mock('path');
jest.mock('os');
jest.mock('crypto', () => ({
  randomBytes: jest.fn()
}));

jest.mock('path', () => ({
  join: jest.fn((...args) => {
    if (args.includes('.opsctrl') && args.includes('cluster.json')) {
      return '/mock/home/.opsctrl/cluster.json';
    }
    if (args.includes('.opsctrl') && args.includes('pending.json')) {
      return '/mock/home/.opsctrl/pending.json';
    }
    return args.join('/');
  }),
  dirname: jest.fn()
}));

jest.mock('os', () => ({
  homedir: jest.fn(() => '/mock/home')
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;
const mockedOs = os as jest.Mocked<typeof os>;
const mockedCrypto = crypto as jest.Mocked<typeof crypto>;

describe('ClusterRegistrationService', () => {
  let service: ClusterRegistrationService;
  let config: ClusterRegistrationConfig;
  const mockClusterInfoFile = '/mock/home/.opsctrl/cluster.json';
  const mockPendingRegistrationFile = '/mock/home/.opsctrl/pending.json';

  beforeEach(() => {
    jest.clearAllMocks();
    
    config = {
      clusterName: 'test-cluster',
      userEmail: 'test@example.com',
      version: '1.0.0'
    };
    
    service = new ClusterRegistrationService(config);
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(service).toBeInstanceOf(ClusterRegistrationService);
    });

    it('should use default backend URL when not provided', () => {
      const testService = new ClusterRegistrationService(config);
      expect(testService).toBeInstanceOf(ClusterRegistrationService);
    });

    it('should use custom backend URL when provided', () => {
      const customConfig = {
        ...config,
        backendUrl: 'https://custom-backend.com'
      };
      const testService = new ClusterRegistrationService(customConfig);
      expect(testService).toBeInstanceOf(ClusterRegistrationService);
    });
  });

  describe('generateClusterId', () => {
    it('should generate cluster ID with correct format', () => {
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);

      const clusterId = service.generateClusterId();

      expect(mockedCrypto.randomBytes).toHaveBeenCalledWith(8);
      expect(clusterId).toBe('clu_abcd1234');
    });

    it('should generate different IDs on multiple calls', () => {
      (mockedCrypto.randomBytes as jest.Mock)
        .mockReturnValueOnce(Buffer.from([0xab, 0xcd, 0x12, 0x34, 0xef, 0x56, 0x78, 0x90]))
        .mockReturnValueOnce(Buffer.from([0xef, 0x56, 0x78, 0x90, 0x12, 0x34, 0xab, 0xcd]));

      const id1 = service.generateClusterId();
      const id2 = service.generateClusterId();

      expect(id1).toMatch(/^clu_[a-f0-9]{16}$/);
      expect(id2).toMatch(/^clu_[a-f0-9]{16}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('isClusterRegistered', () => {
    it('should return true when cluster info file exists', async () => {
      mockedFs.existsSync.mockReturnValue(true);

      const result = await service.isClusterRegistered();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockClusterInfoFile);
    });

    it('should return false when cluster info file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await service.isClusterRegistered();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockClusterInfoFile);
    });
  });

  describe('loadClusterInfo', () => {
    it('should return null when file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await service.loadClusterInfo();

      expect(result).toBeNull();
      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockClusterInfoFile);
    });

    it('should load and parse cluster info when file exists', async () => {
      const mockClusterInfo: ClusterInfo = {
        cluster_id: 'clu_test123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: '2023-01-01T00:00:00.000Z'
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockClusterInfo));

      const result = await service.loadClusterInfo();

      expect(result).toEqual(mockClusterInfo);
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(mockClusterInfoFile, 'utf-8');
    });

    it('should return null and log error when JSON parsing fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('invalid json');

      const result = await service.loadClusterInfo();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load cluster info:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should return null and log error when file read fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const readError = new Error('File read error');
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation(() => {
        throw readError;
      });

      const result = await service.loadClusterInfo();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load cluster info:', readError);
      
      consoleSpy.mockRestore();
    });
  });

  describe('registerCluster', () => {
    beforeEach(() => {
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);
      
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');
    });

    it('should successfully register cluster on first attempt', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
      };

      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      const result = await service.registerCluster();

      expect(result).toEqual(mockResponse);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.opsctrl.io/api/clusters/register',
        {
          cluster_id: 'clu_abcd1234',
          cluster_name: 'test-cluster',
          user_email: 'test@example.com',
          version: '1.0.0'
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'opsctrl-daemon/1.0.0'
          }
        }
      );
      
      consoleSpy.mockRestore();
    });

    it('should create directory if it does not exist', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
      };

      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      await service.registerCluster();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/mock/home/.opsctrl', { recursive: true });
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockClusterInfoFile,
        expect.stringContaining('"cluster_id": "clu_abcd1234"')
      );
      
      consoleSpy.mockRestore();
    });

    it('should retry on retryable errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const retryableError = new AxiosError('Network Error');
      retryableError.code = 'ECONNREFUSED';
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
      };

      mockedAxios.post
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue({ data: mockResponse });

      const result = await service.registerCluster(3);

      expect(result).toEqual(mockResponse);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Registration attempt 1/3 failed')
      );
      
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should throw error after max retries with retryable errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const retryableError = new AxiosError('Network Error');
      retryableError.code = 'ECONNREFUSED';

      mockedAxios.post.mockRejectedValue(retryableError);

      await expect(service.registerCluster(2)).rejects.toThrow(
        'Cluster registration failed after 2 attempts'
      );
      
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      
      consoleSpy.mockRestore();
    });

    it('should not retry on non-retryable HTTP errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const nonRetryableError = new AxiosError('Bad Request');
      nonRetryableError.response = {
        status: 400,
        data: { message: 'Invalid request' }
      } as any;

      mockedAxios.post.mockRejectedValue(nonRetryableError);

      await expect(service.registerCluster(3)).rejects.toThrow(
        'Cluster registration failed after 3 attempts'
      );
      
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      
      consoleSpy.mockRestore();
    });

    it('should use custom backend URL when provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const customConfig = {
        ...config,
        backendUrl: 'https://custom-backend.com'
      };
      
      const customService = new ClusterRegistrationService(customConfig);
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
      };

      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      await customService.registerCluster();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://custom-backend.com/api/clusters/register',
        expect.any(Object),
        expect.any(Object)
      );
      
      consoleSpy.mockRestore();
    });

    it('should save pending registration when URL provided in response', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success',
        registration_url: 'https://dashboard.opsctrl.io/clusters/clu_abcd1234/complete',
        requires_browser_confirmation: false
      };

      mockedAxios.post.mockResolvedValue({ data: mockResponse });
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      await service.registerCluster();

      // Check that pending registration was saved
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockPendingRegistrationFile,
        expect.stringContaining('"cluster_id": "clu_abcd1234"')
      );
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockPendingRegistrationFile,
        expect.stringContaining('"registration_url": "https://dashboard.opsctrl.io/clusters/clu_abcd1234/complete"')
      );

      // Check logs
      const calls = consoleSpy.mock.calls.map(call => call[0]);
      expect(calls).toContain('📧 Cluster pre-registered successfully! Awaiting backend confirmation.');
      expect(calls).toContain('\n🌐 Complete your cluster registration:');
      expect(calls).toContain('   https://dashboard.opsctrl.io/clusters/clu_abcd1234/complete');
      
      consoleSpy.mockRestore();
    });

    it('should save cluster info directly when no URL provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
        // No registration_url provided
      };

      mockedAxios.post.mockResolvedValue({ data: mockResponse });
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      await service.registerCluster();

      // Check that cluster info was saved (not pending)
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockClusterInfoFile,
        expect.stringContaining('"cluster_id": "clu_abcd1234"')
      );

      const calls = consoleSpy.mock.calls.map(call => call[0]);
      expect(calls).toContain('✅ Cluster registered successfully!');
      
      consoleSpy.mockRestore();
    });
  });

  describe('pending registration management', () => {
    it('should load pending registration when file exists', async () => {
      const mockPendingReg: PendingRegistration = {
        cluster_id: 'clu_pending123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registration_url: 'https://dashboard.opsctrl.io/clusters/clu_pending123/complete',
        requires_browser_confirmation: true,
        created_at: '2023-01-01T00:00:00.000Z'
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockPendingReg));

      const result = await service.loadPendingRegistration();

      expect(result).toEqual(mockPendingReg);
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(mockPendingRegistrationFile, 'utf-8');
    });

    it('should return null when pending registration file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await service.loadPendingRegistration();

      expect(result).toBeNull();
    });

    it('should verify pending registration and complete it when backend confirms', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockBackendResponse = {
        data: {
          status: 'active',
          cluster_id: 'clu_pending123'
        }
      };

      mockedAxios.get.mockResolvedValue(mockBackendResponse);
      mockedFs.existsSync
        .mockReturnValueOnce(false)  // mkdirSync directory check for saveClusterInfo
        .mockReturnValueOnce(true);  // PENDING_REGISTRATION_FILE exists for removePendingRegistration
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedFs.unlinkSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      const result = await service.verifyPendingRegistration('clu_pending123');

      expect(result).toBeTruthy();
      expect(result?.cluster_id).toBe('clu_pending123');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.opsctrl.io/api/clusters/clu_pending123/status',
        expect.objectContaining({
          timeout: 30000
        })
      );
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockClusterInfoFile,
        expect.stringContaining('"cluster_id": "clu_pending123"')
      );
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(mockPendingRegistrationFile);
      
      const calls = consoleSpy.mock.calls.map(call => call[0]);
      expect(calls).toContain('✅ Cluster registration confirmed by backend!');
      
      consoleSpy.mockRestore();
    });

    it('should return null when backend says registration is still pending', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockBackendResponse = {
        data: {
          status: 'pending',
          cluster_id: 'clu_pending123'
        }
      };

      mockedAxios.get.mockResolvedValue(mockBackendResponse);

      const result = await service.verifyPendingRegistration('clu_pending123');

      expect(result).toBeNull();
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('ensureClusterRegistration', () => {
    it('should return existing cluster info if already registered', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const existingClusterInfo: ClusterInfo = {
        cluster_id: 'clu_existing',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: '2023-01-01T00:00:00.000Z'
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingClusterInfo));

      const result = await service.ensureClusterRegistration();

      expect(result).toEqual(existingClusterInfo);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should register new cluster if not already registered (direct registration)', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
        // No registration_url - direct registration
      };

      const expectedClusterInfo: ClusterInfo = {
        cluster_id: 'clu_abcd1234',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: '2023-01-01T00:00:00.000Z'
      };

      mockedFs.existsSync
        .mockReturnValueOnce(false)  // No existing cluster.json
        .mockReturnValueOnce(false)  // No pending.json
        .mockReturnValueOnce(false)  // mkdirSync check
        .mockReturnValueOnce(true);  // cluster.json exists after save
      
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(expectedClusterInfo));
      mockedAxios.post.mockResolvedValue({ data: mockResponse });
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      const result = await service.ensureClusterRegistration();

      expect(result).toEqual(expectedClusterInfo);
      expect(mockedAxios.post).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should throw error when new registration requires browser confirmation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success',
        registration_url: 'https://dashboard.opsctrl.io/clusters/clu_abcd1234/complete',
        requires_browser_confirmation: true
      };

      mockedFs.existsSync
        .mockReturnValueOnce(false)  // No existing cluster.json
        .mockReturnValueOnce(false); // No pending.json
      
      mockedAxios.post.mockResolvedValue({ data: mockResponse });
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      await expect(service.ensureClusterRegistration()).rejects.toThrow(
        'Cluster registration initiated. Please check your email or visit the registration URL to complete the process.'
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle pending registration and verify with backend', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockPendingReg: PendingRegistration = {
        cluster_id: 'clu_pending123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registration_url: 'https://dashboard.opsctrl.io/clusters/clu_pending123/complete',
        requires_browser_confirmation: true,
        created_at: '2023-01-01T00:00:00.000Z'
      };

      const mockBackendResponse = {
        data: {
          status: 'active',
          cluster_id: 'clu_pending123'
        }
      };

      const expectedClusterInfo: ClusterInfo = {
        cluster_id: 'clu_pending123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registered_at: expect.any(String)
      };

      mockedFs.existsSync
        .mockReturnValueOnce(false)  // No existing cluster.json
        .mockReturnValueOnce(true)   // Has pending.json
        .mockReturnValueOnce(false); // mkdirSync check for verification save
      
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockPendingReg));
      mockedAxios.get.mockResolvedValue(mockBackendResponse);
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedFs.unlinkSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      const result = await service.ensureClusterRegistration();

      expect(result.cluster_id).toBe('clu_pending123');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.opsctrl.io/api/clusters/clu_pending123/status',
        expect.any(Object)
      );
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(mockPendingRegistrationFile);
      
      consoleSpy.mockRestore();
    });

    it('should throw error when pending registration is still not confirmed', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockPendingReg: PendingRegistration = {
        cluster_id: 'clu_pending123',
        cluster_name: 'test-cluster',
        user_email: 'test@example.com',
        registration_url: 'https://dashboard.opsctrl.io/clusters/clu_pending123/complete',
        requires_browser_confirmation: true,
        created_at: '2023-01-01T00:00:00.000Z'
      };

      const mockBackendResponse = {
        data: {
          status: 'pending',
          cluster_id: 'clu_pending123'
        }
      };

      mockedFs.existsSync
        .mockReturnValueOnce(false)  // No existing cluster.json
        .mockReturnValueOnce(true);  // Has pending.json
      
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockPendingReg));
      mockedAxios.get.mockResolvedValue(mockBackendResponse);

      await expect(service.ensureClusterRegistration()).rejects.toThrow(
        'Cluster registration is pending completion. Please check your email or visit the registration URL.'
      );
      
      consoleSpy.mockRestore();
    });

    it('should throw error if cluster info cannot be loaded after registration', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockRandomBytes = Buffer.from('abcd1234', 'hex');
      (mockedCrypto.randomBytes as jest.Mock).mockReturnValue(mockRandomBytes);
      
      const mockResponse: ClusterRegistrationResponse = {
        cluster_id: 'clu_abcd1234',
        status: 'success'
      };

      mockedFs.existsSync
        .mockReturnValueOnce(false)  // No existing cluster.json
        .mockReturnValueOnce(false)  // No pending.json  
        .mockReturnValueOnce(false)  // mkdirSync directory check
        .mockReturnValueOnce(false); // cluster.json still doesn't exist after save attempt 
      
      mockedAxios.post.mockResolvedValue({ data: mockResponse });
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
      mockedPath.dirname.mockReturnValue('/mock/home/.opsctrl');

      await expect(service.ensureClusterRegistration()).rejects.toThrow(
        'Failed to save cluster information after registration'
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('isRetryableError', () => {
    const testConfig: ClusterRegistrationConfig = {
      clusterName: 'test-cluster',
      userEmail: 'test@example.com',
      version: '1.0.0'
    };
    const service = new ClusterRegistrationService(testConfig);

    it('should return true for 5xx HTTP errors', () => {
      const error = {
        isAxiosError: true,
        response: { status: 500 }
      };
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = (service as any).isRetryableError(error);
      expect(result).toBe(true);
    });

    it('should return true for 429 HTTP error', () => {
      const error = {
        isAxiosError: true,
        response: { status: 429 }
      };
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = (service as any).isRetryableError(error);
      expect(result).toBe(true);
    });

    it('should return true for 408 HTTP error', () => {
      const error = {
        isAxiosError: true,
        response: { status: 408 }
      };
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = (service as any).isRetryableError(error);
      expect(result).toBe(true);
    });

    it('should return false for 4xx HTTP errors (except 408, 429)', () => {
      const error = {
        isAxiosError: true,
        response: { status: 400 }
      };
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = (service as any).isRetryableError(error);
      expect(result).toBe(false);
    });

    it('should return true for network errors without response', () => {
      const error = {
        isAxiosError: true,
        response: undefined
      };
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = (service as any).isRetryableError(error);
      expect(result).toBe(true);
    });

    it('should return true for specific error codes', () => {
      const errorCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'];
      
      errorCodes.forEach(code => {
        const error = { code };
        mockedAxios.isAxiosError.mockReturnValue(false);
        const result = (service as any).isRetryableError(error);
        expect(result).toBe(true);
      });
    });

    it('should return false for non-axios errors without retryable codes', () => {
      const error = new Error('Generic error');
      mockedAxios.isAxiosError.mockReturnValue(false);
      
      const result = (service as any).isRetryableError(error);
      expect(result).toBe(false);
    });
  });
});