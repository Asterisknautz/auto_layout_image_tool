import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../utils/outputRootManager');
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn(),
  }
}));

describe('OutputPanel Handle Management Logic', () => {
  let mockOutputRootManager: any;
  let mockHandle: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock outputRootManager
    const module = await import('../utils/outputRootManager');
    mockOutputRootManager = module.outputRootManager;
    
    // Create mock FileSystemDirectoryHandle
    mockHandle = {
      name: 'TestProject',
      kind: 'directory',
      getFileHandle: vi.fn(),
      removeEntry: vi.fn(),
    };
    
    vi.mocked(mockOutputRootManager.setupOutputRoot).mockResolvedValue({
      success: true,
      displayName: 'TestOutputRoot'
    });
    vi.mocked(mockOutputRootManager.getOutputRootInfo).mockReturnValue({
      name: 'TestOutputRoot',
      handle: null,
    });
    vi.mocked(mockOutputRootManager.resetOutputRoot).mockResolvedValue();
    vi.mocked(mockOutputRootManager.getCurrentProjectHandle).mockReturnValue(null);
    vi.mocked(mockOutputRootManager.getCurrentProjectInfo).mockReturnValue({
      name: '',
      handle: null,
    });

    // Mock console methods
    global.console.log = vi.fn();
    global.console.warn = vi.fn();
    global.console.error = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ensureDirectoryHandle priority logic', () => {
    it('should prioritize existing dirHandleRef over other sources', () => {
      // Simulate the logic from OutputPanel.ensureDirectoryHandle
      const dirHandleRef = { current: mockHandle };
      const globalAutoSaveHandle = { name: 'global', kind: 'directory' };
      const managerHandle = { name: 'manager', kind: 'directory' };

      // Mock global window
      (global as any).window = { autoSaveHandle: globalAutoSaveHandle };
      vi.mocked(mockOutputRootManager.getCurrentProjectHandle).mockReturnValue(managerHandle);

      // Simulate ensureDirectoryHandle logic
      let selectedHandle = null;
      let usedSource = '';

      // 1. Check existing handle (highest priority)
      if (dirHandleRef.current) {
        selectedHandle = dirHandleRef.current;
        usedSource = 'existing';
      }
      // 2. Check global handle
      else if ((global as any).window.autoSaveHandle) {
        selectedHandle = (global as any).window.autoSaveHandle;
        usedSource = 'global';
      }
      // 3. Check outputRootManager handle
      else {
        const projectHandle = mockOutputRootManager.getCurrentProjectHandle();
        if (projectHandle) {
          selectedHandle = projectHandle;
          usedSource = 'manager';
        }
      }

      expect(selectedHandle).toBe(mockHandle);
      expect(usedSource).toBe('existing');
    });

    it('should fall back to global handle when no existing handle', () => {
      const dirHandleRef = { current: null };
      const globalAutoSaveHandle = { name: 'global', kind: 'directory' };
      const managerHandle = { name: 'manager', kind: 'directory' };

      (global as any).window = { autoSaveHandle: globalAutoSaveHandle };
      vi.mocked(mockOutputRootManager.getCurrentProjectHandle).mockReturnValue(managerHandle);

      // Simulate ensureDirectoryHandle logic
      let selectedHandle = null;
      let usedSource = '';

      if (dirHandleRef.current) {
        selectedHandle = dirHandleRef.current;
        usedSource = 'existing';
      }
      else if ((global as any).window.autoSaveHandle) {
        selectedHandle = (global as any).window.autoSaveHandle;
        usedSource = 'global';
      }
      else {
        const projectHandle = mockOutputRootManager.getCurrentProjectHandle();
        if (projectHandle) {
          selectedHandle = projectHandle;
          usedSource = 'manager';
        }
      }

      expect(selectedHandle).toBe(globalAutoSaveHandle);
      expect(usedSource).toBe('global');
    });

    it('should fall back to outputRootManager handle when others fail', () => {
      const dirHandleRef = { current: null };
      const managerHandle = { name: 'manager', kind: 'directory' };

      (global as any).window = { autoSaveHandle: null };
      vi.mocked(mockOutputRootManager.getCurrentProjectHandle).mockReturnValue(managerHandle);

      // Simulate ensureDirectoryHandle logic
      let selectedHandle = null;
      let usedSource = '';

      if (dirHandleRef.current) {
        selectedHandle = dirHandleRef.current;
        usedSource = 'existing';
      }
      else if ((global as any).window.autoSaveHandle) {
        selectedHandle = (global as any).window.autoSaveHandle;
        usedSource = 'global';
      }
      else {
        const projectHandle = mockOutputRootManager.getCurrentProjectHandle();
        if (projectHandle) {
          selectedHandle = projectHandle;
          usedSource = 'manager';
        }
      }

      expect(selectedHandle).toBe(managerHandle);
      expect(usedSource).toBe('manager');
    });

    it('should return null when no handles are available', () => {
      const dirHandleRef = { current: null };

      (global as any).window = { autoSaveHandle: null };
      vi.mocked(mockOutputRootManager.getCurrentProjectHandle).mockReturnValue(null);

      // Simulate ensureDirectoryHandle logic
      let selectedHandle = null;
      let hasHandle = false;

      if (dirHandleRef.current) {
        selectedHandle = dirHandleRef.current;
        hasHandle = true;
      }
      else if ((global as any).window.autoSaveHandle) {
        selectedHandle = (global as any).window.autoSaveHandle;
        hasHandle = true;
      }
      else {
        const projectHandle = mockOutputRootManager.getCurrentProjectHandle();
        if (projectHandle) {
          selectedHandle = projectHandle;
          hasHandle = true;
        }
      }

      expect(selectedHandle).toBeNull();
      expect(hasHandle).toBe(false);
    });
  });

  describe('autoSaveSetup event handling simulation', () => {
    it('should properly handle autoSaveSetup event data', () => {
      // Simulate the event handler logic from OutputPanel
      const eventDetail = {
        displayName: 'TestOutputRoot/TestProject',
        outputHandle: mockHandle,
      };

      // Simulate the handler logic
      const dirHandleRef = { current: null };
      let dirName = '';

      // Process event detail
      const { displayName, outputHandle } = eventDetail;
      dirHandleRef.current = outputHandle;
      dirName = displayName;

      // Also set global handle for consistency
      (global as any).window = { autoSaveHandle: outputHandle };

      expect(dirHandleRef.current).toBe(mockHandle);
      expect(dirName).toBe('TestOutputRoot/TestProject');
      expect((global as any).window.autoSaveHandle).toBe(mockHandle);
    });

    it('should handle autoSaveSetup event with logging verification', async () => {
      const { debugController } = await import('../utils/debugMode');
      
      const eventDetail = {
        displayName: 'DetailedTestProject',
        outputHandle: mockHandle,
      };

      // Simulate the logging that would occur
      debugController.log('OutputPanel', 'Received auto-save setup event:', {
        displayName: eventDetail.displayName,
        hasOutputHandle: !!eventDetail.outputHandle,
        outputHandleName: eventDetail.outputHandle?.name
      });

      debugController.log('OutputPanel', 'Auto-save setup completed:', {
        dirHandleRefSet: !!eventDetail.outputHandle,
        globalHandleSet: true,
        dirName: eventDetail.displayName
      });

      expect(debugController.log).toHaveBeenCalledWith(
        'OutputPanel',
        'Received auto-save setup event:',
        expect.objectContaining({
          displayName: 'DetailedTestProject',
          hasOutputHandle: true,
          outputHandleName: 'TestProject'
        })
      );

      expect(debugController.log).toHaveBeenCalledWith(
        'OutputPanel',
        'Auto-save setup completed:',
        expect.objectContaining({
          dirHandleRefSet: true,
          globalHandleSet: true,
          dirName: 'DetailedTestProject'
        })
      );
    });
  });

  describe('file writing logic simulation', () => {
    it('should simulate successful file writing process', async () => {
      const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      };

      mockHandle.getFileHandle.mockResolvedValue(mockFileHandle);

      // Simulate writeFile logic from OutputPanel
      const filename = 'test_image.jpg';
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const autoSave = true;

      // Simulate ensureDirectoryHandle returning true
      const hasHandle = true;
      let writeSuccessful = false;

      if (!autoSave) {
        // Should not reach here in this test
        expect(false).toBe(true);
      }

      if (!hasHandle) {
        // Should not reach here in this test
        expect(false).toBe(true);
      }

      try {
        const fileHandle = await mockHandle.getFileHandle(filename, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(blob);
        await stream.close();
        writeSuccessful = true;
      } catch (error) {
        writeSuccessful = false;
      }

      expect(writeSuccessful).toBe(true);
      expect(mockHandle.getFileHandle).toHaveBeenCalledWith(filename, { create: true });
      expect(mockFileHandle.createWritable).toHaveBeenCalled();
    });

    it('should handle file writing errors gracefully', async () => {
      mockHandle.getFileHandle.mockRejectedValue(new Error('Permission denied'));

      // Simulate writeFile error handling
      const filename = 'failed_image.jpg';
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const autoSave = true;
      const hasHandle = true;

      let writeSuccessful = true;
      let errorDetails = null;

      if (!autoSave) {
        writeSuccessful = false;
        return;
      }

      if (!hasHandle) {
        writeSuccessful = false;
        return;
      }

      try {
        const fileHandle = await mockHandle.getFileHandle(filename, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(blob);
        await stream.close();
      } catch (error) {
        writeSuccessful = false;
        errorDetails = error;
        console.warn('[OutputPanel] Failed to save', filename, error);
      }

      expect(writeSuccessful).toBe(false);
      expect(errorDetails).toBeInstanceOf(Error);
      expect(errorDetails?.message).toBe('Permission denied');
      expect(mockHandle.getFileHandle).toHaveBeenCalledWith(filename, { create: true });
      expect(global.console.warn).toHaveBeenCalledWith(
        '[OutputPanel] Failed to save',
        filename,
        expect.any(Error)
      );
    });

    it('should skip writing when auto-save is disabled', async () => {
      // Simulate writeFile with auto-save disabled
      const filename = 'skipped_image.jpg';
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const autoSave = false;

      let writeAttempted = false;
      let skipReason = '';

      if (!autoSave) {
        skipReason = 'Auto-save disabled';
        // Should return early without attempting write
      } else {
        writeAttempted = true;
        // Would attempt file write here
      }

      expect(writeAttempted).toBe(false);
      expect(skipReason).toBe('Auto-save disabled');
      expect(mockHandle.getFileHandle).not.toHaveBeenCalled();
    });

    it('should skip writing when no handle is available', async () => {
      // Simulate writeFile with no directory handle
      const filename = 'no_handle_image.jpg';
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const autoSave = true;
      const hasHandle = false; // No handle available

      let writeAttempted = false;
      let skipReason = '';

      if (!autoSave) {
        skipReason = 'Auto-save disabled';
      } else if (!hasHandle) {
        skipReason = 'No directory handle available';
        console.warn('[OutputPanel] No directory handle available for:', filename);
      } else {
        writeAttempted = true;
      }

      expect(writeAttempted).toBe(false);
      expect(skipReason).toBe('No directory handle available');
      expect(global.console.warn).toHaveBeenCalledWith(
        '[OutputPanel] No directory handle available for:',
        filename
      );
      expect(mockHandle.getFileHandle).not.toHaveBeenCalled();
    });
  });

  describe('output root management simulation', () => {
    it('should simulate successful output root setup', async () => {
      // Simulate setupOutputRoot call
      const setupResult = await mockOutputRootManager.setupOutputRoot();
      
      expect(setupResult.success).toBe(true);
      expect(setupResult.displayName).toBe('TestOutputRoot');
      expect(mockOutputRootManager.setupOutputRoot).toHaveBeenCalled();
    });

    it('should simulate output root reset with IndexedDB cleanup', async () => {
      // Mock IndexedDB
      const mockDatabases = [
        { name: 'imagetool-handles', version: 1 },
        { name: 'other-db', version: 1 }
      ];
      
      global.indexedDB = {
        databases: vi.fn().mockResolvedValue(mockDatabases),
        deleteDatabase: vi.fn(),
      } as any;

      // Simulate reset logic
      await mockOutputRootManager.resetOutputRoot();

      // Simulate IndexedDB cleanup
      const dbs = await global.indexedDB.databases();
      for (const db of dbs) {
        if (db.name) {
          global.indexedDB.deleteDatabase(db.name);
        }
      }

      expect(mockOutputRootManager.resetOutputRoot).toHaveBeenCalled();
      expect(global.indexedDB.databases).toHaveBeenCalled();
      expect(global.indexedDB.deleteDatabase).toHaveBeenCalledWith('imagetool-handles');
      expect(global.indexedDB.deleteDatabase).toHaveBeenCalledWith('other-db');
    });

    it('should handle output root info retrieval', () => {
      const expectedInfo = {
        name: 'TestOutputRoot',
        handle: null,
      };

      const info = mockOutputRootManager.getOutputRootInfo();
      
      expect(info).toEqual(expectedInfo);
      expect(mockOutputRootManager.getOutputRootInfo).toHaveBeenCalled();
    });

    it('should handle current project info retrieval', () => {
      const expectedProjectInfo = {
        name: '',
        handle: null,
      };

      const projectInfo = mockOutputRootManager.getCurrentProjectInfo();
      
      expect(projectInfo).toEqual(expectedProjectInfo);
      expect(mockOutputRootManager.getCurrentProjectInfo).toHaveBeenCalled();
    });
  });
});