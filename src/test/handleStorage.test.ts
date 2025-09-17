import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleStorage } from '../utils/handleStorage';

type MockDirectoryHandle = FileSystemDirectoryHandle & {
  name: string;
  kind: FileSystemHandleKind;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
};

const createMockDirectoryHandle = (name: string): MockDirectoryHandle => ({
  name,
  kind: 'directory' as FileSystemHandleKind,
  queryPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
  requestPermission: vi.fn().mockResolvedValue('granted' as PermissionState)
}) as unknown as MockDirectoryHandle;

// Mock IndexedDB
const mockIDBDatabase = {
  transaction: vi.fn(),
  close: vi.fn(),
};

const mockIDBTransaction = {
  objectStore: vi.fn(),
  oncomplete: null,
  onerror: null,
};

const mockIDBObjectStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

const mockIDBRequest = {
  result: null,
  error: null,
  onsuccess: null,
  onerror: null,
};

// Mock debugController
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn(),
  }
}));

describe('handleStorage', () => {
  let mockHandle: MockDirectoryHandle;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Create mock FileSystemDirectoryHandle
    mockHandle = createMockDirectoryHandle('TestHandle');

    // Mock IndexedDB
    global.indexedDB = {
      open: vi.fn().mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.result = mockIDBDatabase;
          if (request.onsuccess) request.onsuccess(new Event('success'));
        }, 0);
        return request;
      }),
      databases: vi.fn().mockResolvedValue([]),
      deleteDatabase: vi.fn(),
    } as unknown as IDBFactory;

    mockIDBDatabase.transaction.mockReturnValue(mockIDBTransaction);
    mockIDBTransaction.objectStore.mockReturnValue(mockIDBObjectStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('storeHandle', () => {
    it('should store handle with display name successfully', async () => {
      // Mock successful put operation
      mockIDBObjectStore.put.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.onsuccess?.(new Event('success'));
        }, 0);
        return request;
      });

      await expect(
        handleStorage.storeHandle('test-id', mockHandle, 'Test Display Name')
      ).resolves.toBeUndefined();

      expect(mockIDBObjectStore.put).toHaveBeenCalledWith({
        id: 'test-id',
        handle: mockHandle,
        displayName: 'Test Display Name',
        lastUsed: expect.any(Number),
      });
    });

    it('should handle database errors gracefully', async () => {
      // Mock failed put operation
      mockIDBObjectStore.put.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.error = new Error('Database error');
          request.onerror?.(new Event('error'));
        }, 0);
        return request;
      });

      await expect(
        handleStorage.storeHandle('test-id', mockHandle, 'Test Display Name')
      ).rejects.toThrow('Database error');
    });

    it('should handle database opening errors', async () => {
      // Mock failed database opening
      global.indexedDB.open = vi.fn().mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.error = new Error('Database opening failed');
          request.onerror?.(new Event('error'));
        }, 0);
        return request;
      });

      await expect(
        handleStorage.storeHandle('test-id', mockHandle, 'Test Display Name')
      ).rejects.toThrow('Database error');
    });
  });

  describe('getHandle', () => {
    it('should retrieve stored handle successfully', async () => {
      const storedData = {
        id: 'test-id',
        handle: mockHandle,
        displayName: 'Test Display Name',
        lastUsed: Date.now(),
      };

      // Mock successful get operation
      mockIDBObjectStore.get.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.result = storedData;
          request.onsuccess?.(new Event('success'));
        }, 0);
        return request;
      });

      const result = await handleStorage.getHandle('test-id');

      expect(result).toEqual({
        handle: mockHandle,
        displayName: 'Test Display Name',
      });
      expect(mockIDBObjectStore.get).toHaveBeenCalledWith('test-id');
    });

    it('should return null when handle not found', async () => {
      // Mock get operation with no result
      mockIDBObjectStore.get.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.result = undefined;
          request.onsuccess?.(new Event('success'));
        }, 0);
        return request;
      });

      const result = await handleStorage.getHandle('non-existent-id');

      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      // Mock failed get operation
      mockIDBObjectStore.get.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.error = new Error('Database error');
          request.onerror?.(new Event('error'));
        }, 0);
        return request;
      });

      await expect(
        handleStorage.getHandle('test-id')
      ).rejects.toThrow('Database error');
    });
  });

  describe('removeHandle', () => {
    it('should remove handle successfully', async () => {
      // Mock successful delete operation
      mockIDBObjectStore.delete.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.onsuccess?.(new Event('success'));
        }, 0);
        return request;
      });

      await expect(
        handleStorage.removeHandle('test-id')
      ).resolves.toBeUndefined();

      expect(mockIDBObjectStore.delete).toHaveBeenCalledWith('test-id');
    });

    it('should handle database errors gracefully', async () => {
      // Mock failed delete operation
      mockIDBObjectStore.delete.mockImplementation(() => {
        const request = { ...mockIDBRequest };
        setTimeout(() => {
          request.error = new Error('Database error');
          request.onerror?.(new Event('error'));
        }, 0);
        return request;
      });

      await expect(
        handleStorage.removeHandle('test-id')
      ).rejects.toThrow('Database error');
    });
  });

  describe('checkPermission', () => {
    it('should return true when permission is granted', async () => {
      mockHandle.queryPermission.mockResolvedValue('granted');

      const result = await handleStorage.checkPermission(mockHandle);

      expect(result).toBe(true);
      expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    });

    it('should return false when permission is denied', async () => {
      mockHandle.queryPermission.mockResolvedValue('denied');

      const result = await handleStorage.checkPermission(mockHandle);

      expect(result).toBe(false);
    });

    it('should return false when permission is prompt', async () => {
      mockHandle.queryPermission.mockResolvedValue('prompt');

      const result = await handleStorage.checkPermission(mockHandle);

      expect(result).toBe(false);
    });

    it('should handle errors gracefully and return false', async () => {
      mockHandle.queryPermission.mockRejectedValue(new Error('Permission check failed'));

      const result = await handleStorage.checkPermission(mockHandle);

      expect(result).toBe(false);
    });
  });

  describe('requestPermission', () => {
    it('should return true when permission is granted', async () => {
      mockHandle.requestPermission.mockResolvedValue('granted');

      const result = await handleStorage.requestPermission(mockHandle);

      expect(result).toBe(true);
      expect(mockHandle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    });

    it('should return false when permission is denied', async () => {
      mockHandle.requestPermission.mockResolvedValue('denied');

      const result = await handleStorage.requestPermission(mockHandle);

      expect(result).toBe(false);
    });

    it('should handle errors gracefully and return false', async () => {
      mockHandle.requestPermission.mockRejectedValue(new Error('Permission request failed'));

      const result = await handleStorage.requestPermission(mockHandle);

      expect(result).toBe(false);
    });
  });
});
