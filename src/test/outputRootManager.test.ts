import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OutputRootManager } from '../utils/outputRootManager';

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
  let mockHandle: any;
  let mockSubHandle: any;

  beforeEach(() => {
    outputRootManager = new OutputRootManager();
    
    // Create mock FileSystemDirectoryHandle
    mockHandle = {
      name: 'TestOutputRoot',
      kind: 'directory',
      getDirectoryHandle: vi.fn(),
      removeEntry: vi.fn(),
      entries: vi.fn().mockReturnValue([]),
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };

    mockSubHandle = {
      name: 'TestProject',
      kind: 'directory',
      entries: vi.fn().mockReturnValue([]),
      removeEntry: vi.fn(),
    };

    // Mock showDirectoryPicker
    (global as any).window = {
      showDirectoryPicker: vi.fn().mockResolvedValue(mockHandle),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('hasOutputRoot', () => {
    it('should return true when output root is already set', async () => {
      // Set up output root directly
      (outputRootManager as any).outputRoot = mockHandle;
      
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
      delete (global as any).window.showDirectoryPicker;

      const result = await outputRootManager.setupOutputRoot();
      
      expect(result.success).toBe(false);
      expect(result.displayName).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      (global as any).window.showDirectoryPicker.mockRejectedValue(new Error('User cancelled'));

      const result = await outputRootManager.setupOutputRoot();
      
      expect(result.success).toBe(false);
    });
  });

  describe('getProjectOutputHandle', () => {
    beforeEach(() => {
      // Set up output root
      (outputRootManager as any).outputRoot = mockHandle;
      (outputRootManager as any).outputRootName = 'TestOutputRoot';
    });

    it('should create and return project output handle', async () => {
      mockHandle.getDirectoryHandle.mockResolvedValue(mockSubHandle);

      const result = await outputRootManager.getProjectOutputHandle('TestProject');
      
      expect(result).toBe(mockSubHandle);
      expect(mockHandle.getDirectoryHandle).toHaveBeenCalledWith('TestProject', { create: true });
    });

    it('should clear existing files in project folder', async () => {
      const mockFileHandle = { kind: 'file', name: 'test.jpg' };
      const mockDirHandle = { kind: 'directory', name: 'subfolder' };
      
      mockSubHandle.entries.mockReturnValue([
        ['test.jpg', mockFileHandle],
        ['subfolder', mockDirHandle]
      ]);
      mockHandle.getDirectoryHandle.mockResolvedValue(mockSubHandle);

      await outputRootManager.getProjectOutputHandle('TestProject');
      
      expect(mockSubHandle.removeEntry).toHaveBeenCalledWith('test.jpg');
      expect(mockSubHandle.removeEntry).not.toHaveBeenCalledWith('subfolder');
    });

    it('should return null when no output root is available', async () => {
      (outputRootManager as any).outputRoot = null;

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
      (outputRootManager as any).outputRoot = mockHandle;
      (outputRootManager as any).outputRootName = 'TestOutputRoot';

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
      (outputRootManager as any).currentProjectHandle = mockSubHandle;

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
      (outputRootManager as any).currentProjectHandle = mockSubHandle;
      (outputRootManager as any).currentProjectName = 'TestProject';

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
      (outputRootManager as any).outputRoot = mockHandle;
      (outputRootManager as any).outputRootName = 'TestRoot';
      (outputRootManager as any).currentProjectHandle = mockSubHandle;
      (outputRootManager as any).currentProjectName = 'TestProject';

      await outputRootManager.resetOutputRoot();
      
      expect(handleStorage.removeHandle).toHaveBeenCalledWith('output_root');
      expect((outputRootManager as any).outputRoot).toBeNull();
      expect((outputRootManager as any).outputRootName).toBe('');
      expect((outputRootManager as any).currentProjectHandle).toBeNull();
      expect((outputRootManager as any).currentProjectName).toBe('');
    });
  });
});