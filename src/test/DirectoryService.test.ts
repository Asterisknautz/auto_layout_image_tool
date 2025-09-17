import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectoryService, type IStorageService, type DirectoryHandle } from '../services/DirectoryService';
import { autoDetectAndSetupOutputFolder } from '../utils/fileSystem';

// Mock implementations
class MockStorageService implements IStorageService {
  private storage = new Map<string, string>();

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  clear() {
    this.storage.clear();
  }
}

class MockDirectoryHandle implements DirectoryHandle {
  constructor(public name: string) {}

  async getFileHandle(name: string): Promise<FileSystemFileHandle> {
    const mockHandle = {
      name,
      createWritable: async () => ({
        write: vi.fn(),
        close: vi.fn()
      })
    } as unknown as FileSystemFileHandle;
    return mockHandle;
  }
}

class MockGlobalWindow {
  public autoSaveHandle: DirectoryHandle | null = null;
  public showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  
  reset() {
    this.autoSaveHandle = null;
  }
}

// Mock autoDetectAndSetupOutputFolder
vi.mock('../utils/fileSystem', () => ({
  autoDetectAndSetupOutputFolder: vi.fn()
}));

const ensureWindow = () => {
  if (typeof window === 'undefined') {
    vi.stubGlobal('window', {} as unknown as typeof window);
  }
  return window;
};

// Mock debugController
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn()
  }
}));

describe('DirectoryService', () => {
  let directoryService: DirectoryService;
  let mockStorageService: MockStorageService;
  let mockGlobalWindow: MockGlobalWindow;
  let mockAutoDetect: vi.MockedFunction<typeof autoDetectAndSetupOutputFolder>;

  const getServiceInternals = (service: DirectoryService) =>
    service as unknown as {
      dirHandleRef: DirectoryHandle | null;
      dirName: string;
    };

beforeEach(async () => {
    mockStorageService = new MockStorageService();
    mockGlobalWindow = new MockGlobalWindow();
    mockStorageService.clear();
    mockGlobalWindow.reset();

    // Reset the mock
    mockAutoDetect = vi.mocked(autoDetectAndSetupOutputFolder);
    mockAutoDetect.mockReset();

    directoryService = new DirectoryService(
      mockStorageService,
      mockGlobalWindow as unknown as typeof window & { autoSaveHandle?: DirectoryHandle }
    );
  });

  describe('initialize', () => {
    it('should use handle from global window if available', async () => {
      const mockHandle = new MockDirectoryHandle('test-folder');
      mockGlobalWindow.autoSaveHandle = mockHandle;

      await directoryService.initialize();

      expect(directoryService.currentHandle).toBe(mockHandle);
      expect(directoryService.isAutoSaveEnabled).toBe(true);
      expect(directoryService.directoryName).toBe('test-folder');
    });

    it('should restore from localStorage when auto-save was enabled', async () => {
      mockStorageService.setItem('imagetool.autoSave.dirName', 'saved-folder');
      mockStorageService.setItem('imagetool.autoSave.enabled', 'true');

      await directoryService.initialize();

      expect(directoryService.directoryName).toBe('saved-folder');
      expect(directoryService.isAutoSaveEnabled).toBe(true);
      expect(directoryService.currentHandle).toBeNull(); // Handle not restored, only settings
    });

    it('should restore directory name but not enable auto-save when it was disabled', async () => {
      mockStorageService.setItem('imagetool.autoSave.dirName', 'saved-folder');
      mockStorageService.setItem('imagetool.autoSave.enabled', 'false');

      await directoryService.initialize();

      expect(directoryService.directoryName).toBe('saved-folder');
      expect(directoryService.isAutoSaveEnabled).toBe(false);
    });

    it('should handle empty localStorage gracefully', async () => {
      await directoryService.initialize();

      expect(directoryService.directoryName).toBe('');
      expect(directoryService.isAutoSaveEnabled).toBe(false);
      expect(directoryService.currentHandle).toBeNull();
    });
  });

  describe('pickDirectory', () => {
    beforeEach(() => {
      // Mock showDirectoryPicker as available
      Object.defineProperty(ensureWindow(), 'showDirectoryPicker', {
        value: vi.fn(),
        configurable: true,
        writable: true
      });
    });

    it('should successfully pick directory with auto-detection', async () => {
      const inputHandle = new MockDirectoryHandle('input-folder');
      const outputHandle = new MockDirectoryHandle('_output');
      
      mockAutoDetect.mockResolvedValue({
        inputHandle,
        outputHandle,
        hasExistingOutput: false
      });

      const result = await directoryService.pickDirectory();

      expect(result.success).toBe(true);
      expect(result.handle).toBe(outputHandle);
      expect(result.displayName).toBe('input-folder/_output');
      expect(directoryService.currentHandle).toBe(outputHandle);
      expect(directoryService.isAutoSaveEnabled).toBe(true);
      expect(mockStorageService.getItem('imagetool.autoSave.dirName')).toBe('input-folder/_output');
      expect(mockStorageService.getItem('imagetool.autoSave.enabled')).toBe('true');
    });

    it('should handle cancelled directory selection', async () => {
      mockAutoDetect.mockResolvedValue({
        inputHandle: null,
        outputHandle: null,
        hasExistingOutput: false
      });

      const result = await directoryService.pickDirectory();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Directory selection was cancelled');
      expect(directoryService.currentHandle).toBeNull();
    });

    it('should handle browser not supporting directory picker', async () => {
      delete window.showDirectoryPicker;

      const result = await directoryService.pickDirectory();

      expect(result.success).toBe(false);
      expect(result.error).toBe('このブラウザはフォルダ保存に対応していません（ZIP保存をご利用ください）');
    });

    it('should handle auto-detection errors', async () => {
      mockAutoDetect.mockRejectedValue(new Error('Permission denied'));

      const result = await directoryService.pickDirectory();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });
  });

  describe('ensureDirectoryHandle', () => {
    it('should return true when handle is already available', async () => {
      const mockHandle = new MockDirectoryHandle('test-folder');
      await directoryService.initialize();
      // Simulate having a handle
      getServiceInternals(directoryService).dirHandleRef = mockHandle;

      const result = await directoryService.ensureDirectoryHandle();

      expect(result).toBe(true);
    });

    it('should use global window handle when available', async () => {
      const mockHandle = new MockDirectoryHandle('global-folder');
      mockGlobalWindow.autoSaveHandle = mockHandle;
      await directoryService.initialize();
      // Clear local handle to test fallback
      getServiceInternals(directoryService).dirHandleRef = null;

      const result = await directoryService.ensureDirectoryHandle();

      expect(result).toBe(true);
      expect(directoryService.currentHandle).toBe(mockHandle);
    });

    it('should return false when no handle is available', async () => {
      await directoryService.initialize();

      const result = await directoryService.ensureDirectoryHandle();

      expect(result).toBe(false);
    });
  });

  describe('writeFile', () => {
    it('should successfully write file when auto-save is enabled and handle is available', async () => {
      const mockHandle = new MockDirectoryHandle('test-folder');
      await directoryService.initialize();
      directoryService.setAutoSave(true);
      getServiceInternals(directoryService).dirHandleRef = mockHandle;

      const blob = new Blob(['test content'], { type: 'text/plain' });
      const result = await directoryService.writeFile('test.txt', blob);

      expect(result).toBe(true);
    });

    it('should return false when auto-save is disabled', async () => {
      await directoryService.initialize();
      directoryService.setAutoSave(false);

      const blob = new Blob(['test content'], { type: 'text/plain' });
      const result = await directoryService.writeFile('test.txt', blob);

      expect(result).toBe(false);
    });

    it('should return false when no directory handle is available', async () => {
      await directoryService.initialize();
      directoryService.setAutoSave(true);

      const blob = new Blob(['test content'], { type: 'text/plain' });
      const result = await directoryService.writeFile('test.txt', blob);

      expect(result).toBe(false);
    });

    it('should handle file write errors gracefully', async () => {
      const failingHandle: DirectoryHandle = {
        name: 'test-folder',
        async getFileHandle() {
          throw new Error('Write permission denied');
        }
      };
      
      await directoryService.initialize();
      directoryService.setAutoSave(true);
      getServiceInternals(directoryService).dirHandleRef = failingHandle;

      const blob = new Blob(['test content'], { type: 'text/plain' });
      const result = await directoryService.writeFile('test.txt', blob);

      expect(result).toBe(false);
    });
  });

  describe('setAutoSave', () => {
    it('should enable auto-save and persist to storage', async () => {
      await directoryService.initialize();

      directoryService.setAutoSave(true);

      expect(directoryService.isAutoSaveEnabled).toBe(true);
      expect(mockStorageService.getItem('imagetool.autoSave.enabled')).toBe('true');
    });

    it('should disable auto-save and persist to storage', async () => {
      await directoryService.initialize();
      directoryService.setAutoSave(true);

      directoryService.setAutoSave(false);

      expect(directoryService.isAutoSaveEnabled).toBe(false);
      expect(mockStorageService.getItem('imagetool.autoSave.enabled')).toBe('false');
    });
  });

  describe('clearDirectory', () => {
    it('should clear all directory settings and disable auto-save', async () => {
      const mockHandle = new MockDirectoryHandle('test-folder');
      await directoryService.initialize();
      directoryService.setAutoSave(true);
      getServiceInternals(directoryService).dirHandleRef = mockHandle;
      getServiceInternals(directoryService).dirName = 'test-folder';

      directoryService.clearDirectory();

      expect(directoryService.currentHandle).toBeNull();
      expect(directoryService.isAutoSaveEnabled).toBe(false);
      expect(directoryService.directoryName).toBe('');
      expect(mockStorageService.getItem('imagetool.autoSave.enabled')).toBe('false');
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
