import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OutputRootManager } from '../utils/outputRootManager';
import {
  createDirectoryHandleMock,
  createAsyncIterator,
  ensureWindow,
  createFileHandleMock,
  type DirectoryHandleMock,
} from './utils/mockFileSystem';

const getWindowWithPicker = () =>
  ensureWindow<{ showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }>();

const getManagerInternals = (manager: OutputRootManager) =>
  manager as unknown as {
    outputRoot: DirectoryHandleMock | null;
    outputRootName: string;
    currentProjectHandle: DirectoryHandleMock | null;
    currentProjectName: string;
  };

// Mock handleStorage
vi.mock('../utils/handleStorage', () => ({
  handleStorage: {
    getHandle: vi.fn(),
    storeHandle: vi.fn(),
    removeHandle: vi.fn(),
    checkPermission: vi.fn(),
    requestPermission: vi.fn(),
  }
}));

// Mock debugController
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn(),
  }
}));

describe('OutputRootManager', () => {
  let outputRootManager: OutputRootManager;
  let mockHandle: DirectoryHandleMock;
  let mockSubHandle: DirectoryHandleMock;

  beforeEach(() => {
    outputRootManager = new OutputRootManager();
    
    // Create mock FileSystemDirectoryHandle
    mockHandle = createDirectoryHandleMock('TestOutputRoot');

    mockSubHandle = createDirectoryHandleMock('TestProject', {
      entries: vi.fn().mockReturnValue(createAsyncIterator<[string, FileSystemHandle]>([])),
    });

    // Mock showDirectoryPicker
    Object.defineProperty(getWindowWithPicker(), 'showDirectoryPicker', {
      value: vi.fn().mockResolvedValue(mockHandle),
      configurable: true,
      writable: true
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('hasOutputRoot', () => {
    it('should return true when output root is already set', async () => {
      // Set up output root directly
      const internals = getManagerInternals(outputRootManager);
      internals.outputRoot = mockHandle;
      
      const result = await outputRootManager.hasOutputRoot();
      expect(result).toBe(true);
    });

    it('should return true when stored handle exists and has permission', async () => {
      const { handleStorage } = await import('../utils/handleStorage');
      
      vi.mocked(handleStorage.getHandle).mockResolvedValue({
        handle: mockHandle,
        displayName: 'TestOutputRoot'
      });
      vi.mocked(handleStorage.checkPermission).mockResolvedValue(true);

      const result = await outputRootManager.hasOutputRoot();
      expect(result).toBe(true);
      expect(handleStorage.getHandle).toHaveBeenCalledWith('output_root');
      expect(handleStorage.checkPermission).toHaveBeenCalledWith(mockHandle);
    });

    it('should request permission when stored handle exists but no permission', async () => {
      const { handleStorage } = await import('../utils/handleStorage');
      
      vi.mocked(handleStorage.getHandle).mockResolvedValue({
        handle: mockHandle,
        displayName: 'TestOutputRoot'
      });
      vi.mocked(handleStorage.checkPermission).mockResolvedValue(false);
      vi.mocked(handleStorage.requestPermission).mockResolvedValue(true);

      const result = await outputRootManager.hasOutputRoot();
      expect(result).toBe(true);
      expect(handleStorage.requestPermission).toHaveBeenCalledWith(mockHandle);
    });

    it('should return false when no stored handle exists', async () => {
      const { handleStorage } = await import('../utils/handleStorage');
      
      vi.mocked(handleStorage.getHandle).mockResolvedValue(null);

      const result = await outputRootManager.hasOutputRoot();
      expect(result).toBe(false);
    });
  });

  describe('setupOutputRoot', () => {
    it('should successfully set up output root when showDirectoryPicker is available', async () => {
      const { handleStorage } = await import('../utils/handleStorage');
      
      vi.mocked(handleStorage.storeHandle).mockResolvedValue();

      const result = await outputRootManager.setupOutputRoot();
      
      expect(result.success).toBe(true);
      expect(result.displayName).toBe('TestOutputRoot');
      expect(handleStorage.storeHandle).toHaveBeenCalledWith('output_root', mockHandle, 'TestOutputRoot');
    });

    it('should return failure when showDirectoryPicker is not available', async () => {
      delete getWindowWithPicker().showDirectoryPicker;

      const result = await outputRootManager.setupOutputRoot();
      
      expect(result.success).toBe(false);
      expect(result.displayName).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      getWindowWithPicker().showDirectoryPicker?.mockRejectedValue(new Error('User cancelled'));

      const result = await outputRootManager.setupOutputRoot();
      
      expect(result.success).toBe(false);
    });
  });

  describe('getProjectOutputHandle', () => {
    beforeEach(() => {
      // Set up output root
      const internals = getManagerInternals(outputRootManager);
      internals.outputRoot = mockHandle;
      internals.outputRootName = 'TestOutputRoot';
    });

    it('should create and return project output handle', async () => {
      mockHandle.getDirectoryHandle.mockResolvedValue(mockSubHandle);

      const result = await outputRootManager.getProjectOutputHandle('TestProject');
      
      expect(result).toBe(mockSubHandle);
      expect(mockHandle.getDirectoryHandle).toHaveBeenCalledWith('TestProject', { create: true });
    });

    it('should clear existing files in project folder', async () => {
      const mockFileHandle = createFileHandleMock('test.jpg').handle;
      const mockDirHandle = createDirectoryHandleMock('subfolder');
      
      mockSubHandle.entries.mockReturnValue(
        createAsyncIterator([
          ['test.jpg', mockFileHandle as FileSystemHandle],
          ['subfolder', mockDirHandle as FileSystemHandle]
        ])
      );
      mockHandle.getDirectoryHandle.mockResolvedValue(mockSubHandle);

      await outputRootManager.getProjectOutputHandle('TestProject');
      
      expect(mockSubHandle.removeEntry).toHaveBeenCalledWith('test.jpg');
      expect(mockSubHandle.removeEntry).not.toHaveBeenCalledWith('subfolder');
    });

    it('should return null when no output root is available', async () => {
      getManagerInternals(outputRootManager).outputRoot = null;

      const result = await outputRootManager.getProjectOutputHandle('TestProject');
      
      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      mockHandle.getDirectoryHandle.mockRejectedValue(new Error('Permission denied'));

      const result = await outputRootManager.getProjectOutputHandle('TestProject');
      
      expect(result).toBeNull();
    });
  });

  describe('getOutputRootInfo', () => {
    it('should return current output root info', () => {
      const internals = getManagerInternals(outputRootManager);
      internals.outputRoot = mockHandle;
      internals.outputRootName = 'TestOutputRoot';

      const result = outputRootManager.getOutputRootInfo();
      
      expect(result.name).toBe('TestOutputRoot');
      expect(result.handle).toBe(mockHandle);
    });

    it('should return empty info when no output root is set', () => {
      const result = outputRootManager.getOutputRootInfo();
      
      expect(result.name).toBe('');
      expect(result.handle).toBeNull();
    });
  });

  describe('getCurrentProjectHandle', () => {
    it('should return current project handle when set', () => {
      getManagerInternals(outputRootManager).currentProjectHandle = mockSubHandle;

      const result = outputRootManager.getCurrentProjectHandle();
      
      expect(result).toBe(mockSubHandle);
    });

    it('should return null when no current project handle is set', () => {
      const result = outputRootManager.getCurrentProjectHandle();
      
      expect(result).toBeNull();
    });
  });

  describe('getCurrentProjectInfo', () => {
    it('should return current project info when set', () => {
      const internals = getManagerInternals(outputRootManager);
      internals.currentProjectHandle = mockSubHandle;
      internals.currentProjectName = 'TestProject';

      const result = outputRootManager.getCurrentProjectInfo();
      
      expect(result.name).toBe('TestProject');
      expect(result.handle).toBe(mockSubHandle);
    });

    it('should return empty info when no current project is set', () => {
      const result = outputRootManager.getCurrentProjectInfo();
      
      expect(result.name).toBe('');
      expect(result.handle).toBeNull();
    });
  });

  describe('resetOutputRoot', () => {
    it('should clear all state and remove stored handle', async () => {
      const { handleStorage } = await import('../utils/handleStorage');
      
      // Set up some state
      const internals = getManagerInternals(outputRootManager);
      internals.outputRoot = mockHandle;
      internals.outputRootName = 'TestRoot';
      internals.currentProjectHandle = mockSubHandle;
      internals.currentProjectName = 'TestProject';

      await outputRootManager.resetOutputRoot();
      
      expect(handleStorage.removeHandle).toHaveBeenCalledWith('output_root');
      expect(internals.outputRoot).toBeNull();
      expect(internals.outputRootName).toBe('');
      expect(internals.currentProjectHandle).toBeNull();
      expect(internals.currentProjectName).toBe('');
    });
  });
});
