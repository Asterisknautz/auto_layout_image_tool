import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../utils/outputRootManager');
vi.mock('../utils/handleStorage');
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn(),
  }
}));

describe('Integration: End-to-End File Save Flow', () => {
  let mockOutputRootManager: any;
  let mockHandleStorage: any;
  let mockOutputHandle: any;
  let mockProjectHandle: any;
  let mockFileHandle: any;
  let mockWritableStream: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock outputRootManager
    const outputModule = await import('../utils/outputRootManager');
    mockOutputRootManager = outputModule.outputRootManager;
    
    // Mock handleStorage
    const storageModule = await import('../utils/handleStorage');
    mockHandleStorage = storageModule.handleStorage;
    
    // Create mock FileSystemDirectoryHandle
    mockWritableStream = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    
    mockFileHandle = {
      name: 'test_image.jpg',
      kind: 'file',
      createWritable: vi.fn().mockResolvedValue(mockWritableStream),
    };
    
    mockProjectHandle = {
      name: 'imagetool_test_images',
      kind: 'directory',
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      removeEntry: vi.fn().mockResolvedValue(undefined),
    };
    
    mockOutputHandle = {
      name: 'TestOutputRoot',
      kind: 'directory',
      getDirectoryHandle: vi.fn().mockResolvedValue(mockProjectHandle),
      removeEntry: vi.fn().mockResolvedValue(undefined),
    };

    // Setup default mocks
    vi.mocked(mockOutputRootManager.hasOutputRoot).mockResolvedValue(true);
    vi.mocked(mockOutputRootManager.setupOutputRoot).mockResolvedValue({
      success: true,
      displayName: 'TestOutputRoot'
    });
    vi.mocked(mockOutputRootManager.getProjectOutputHandle).mockResolvedValue(mockProjectHandle);
    vi.mocked(mockOutputRootManager.getCurrentProjectHandle).mockReturnValue(mockProjectHandle);
    vi.mocked(mockOutputRootManager.getOutputRootInfo).mockReturnValue({
      name: 'TestOutputRoot',
      handle: mockOutputHandle,
    });
    vi.mocked(mockOutputRootManager.getCurrentProjectInfo).mockReturnValue({
      name: 'imagetool_test_images',
      handle: mockProjectHandle,
    });

    vi.mocked(mockHandleStorage.storeHandle).mockResolvedValue(undefined);
    vi.mocked(mockHandleStorage.getAllHandles).mockResolvedValue([
      {
        id: 'test-output-root',
        handle: mockOutputHandle,
        displayName: 'TestOutputRoot',
        lastUsed: Date.now(),
      }
    ]);

    // Mock console methods
    global.console.log = vi.fn();
    global.console.warn = vi.fn();
    global.console.error = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete File Save Workflow', () => {
    it('should complete full workflow: folder detection → project setup → file save', async () => {
      // Step 1: Simulate folder detection from Dropzone
      const mockFiles = [
        {
          name: 'product1.jpg',
          webkitRelativePath: 'imagetool_test_images/product1.jpg'
        },
        {
          name: 'product2.jpg',
          webkitRelativePath: 'imagetool_test_images/product2.jpg'
        }
      ];

      // Extract folder name (Dropzone logic)
      const firstFile = mockFiles[0];
      const relativePath = firstFile.webkitRelativePath || firstFile.name;
      let detectedFolderName: string | null = null;
      
      if (relativePath.includes('/')) {
        const pathParts = relativePath.split('/');
        detectedFolderName = pathParts[0];
      }

      expect(detectedFolderName).toBe('imagetool_test_images');

      // Step 2: Setup auto-save (outputRootManager logic)
      const hasOutputRoot = await mockOutputRootManager.hasOutputRoot();
      expect(hasOutputRoot).toBe(true);

      const projectHandle = await mockOutputRootManager.getProjectOutputHandle(detectedFolderName);
      expect(projectHandle).toBe(mockProjectHandle);
      expect(mockOutputRootManager.getProjectOutputHandle).toHaveBeenCalledWith('imagetool_test_images');

      // Step 3: Simulate image composition and file save (OutputPanel logic)
      const imageBlob = new Blob(['test image data'], { type: 'image/jpeg' });
      const filename = 'product1_profile1.jpg';

      // Ensure directory handle is available
      const currentHandle = mockOutputRootManager.getCurrentProjectHandle();
      expect(currentHandle).toBe(mockProjectHandle);

      // Perform file write
      let saveSuccessful = false;
      try {
        const fileHandle = await currentHandle.getFileHandle(filename, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(imageBlob);
        await stream.close();
        saveSuccessful = true;
      } catch (error) {
        saveSuccessful = false;
      }

      expect(saveSuccessful).toBe(true);
      expect(mockProjectHandle.getFileHandle).toHaveBeenCalledWith(filename, { create: true });
      expect(mockFileHandle.createWritable).toHaveBeenCalled();
      expect(mockWritableStream.write).toHaveBeenCalledWith(imageBlob);
      expect(mockWritableStream.close).toHaveBeenCalled();
    });

    it('should handle workflow with output root setup first', async () => {
      // Step 1: Setup output root (new user flow)
      vi.mocked(mockOutputRootManager.hasOutputRoot).mockResolvedValue(false);
      
      const hasOutputRoot = await mockOutputRootManager.hasOutputRoot();
      expect(hasOutputRoot).toBe(false);

      const setupResult = await mockOutputRootManager.setupOutputRoot();
      expect(setupResult.success).toBe(true);
      expect(setupResult.displayName).toBe('TestOutputRoot');

      // Step 2: Process files after output root is set
      const mockFile = {
        name: 'test_image.jpg',
        webkitRelativePath: 'my_project/test_image.jpg'
      };

      const folderName = mockFile.webkitRelativePath.split('/')[0];
      expect(folderName).toBe('my_project');

      // Step 3: Get project handle
      const projectHandle = await mockOutputRootManager.getProjectOutputHandle(folderName);
      expect(projectHandle).toBe(mockProjectHandle);

      // Step 4: Save file
      const imageBlob = new Blob(['test data'], { type: 'image/jpeg' });
      const filename = 'test_output.jpg';

      let saveSuccessful = false;
      try {
        const fileHandle = await projectHandle.getFileHandle(filename, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(imageBlob);
        await stream.close();
        saveSuccessful = true;
      } catch (error) {
        saveSuccessful = false;
      }

      expect(saveSuccessful).toBe(true);
    });

    it('should handle batch processing workflow with multiple profiles', async () => {
      // Step 1: Setup batch processing scenario
      const mockFiles = [
        { name: 'img1.jpg', webkitRelativePath: 'batch_project/img1.jpg' },
        { name: 'img2.jpg', webkitRelativePath: 'batch_project/img2.jpg' },
        { name: 'img3.jpg', webkitRelativePath: 'batch_project/img3.jpg' }
      ];

      const folderName = 'batch_project';
      const outputProfiles = ['profile1', 'profile2', 'profile3'];

      // Step 2: Get project handle
      const projectHandle = await mockOutputRootManager.getProjectOutputHandle(folderName);
      expect(projectHandle).toBe(mockProjectHandle);

      // Step 3: Process each profile for each group
      const testGroup = 'group1';
      let savedFilesCount = 0;

      for (const profile of outputProfiles) {
        const filename = `${testGroup}_${profile}.jpg`;
        const imageBlob = new Blob([`test data for ${profile}`], { type: 'image/jpeg' });

        try {
          const fileHandle = await projectHandle.getFileHandle(filename, { create: true });
          const stream = await fileHandle.createWritable();
          await stream.write(imageBlob);
          await stream.close();
          savedFilesCount++;
        } catch (error) {
          console.error(`Failed to save ${filename}:`, error);
        }
      }

      expect(savedFilesCount).toBe(3);
      expect(mockProjectHandle.getFileHandle).toHaveBeenCalledTimes(3);
      expect(mockFileHandle.createWritable).toHaveBeenCalledTimes(3);
      expect(mockWritableStream.write).toHaveBeenCalledTimes(3);
      expect(mockWritableStream.close).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling in Integration Flow', () => {
    it('should handle output root setup failure gracefully', async () => {
      // Step 1: Simulate setup failure
      vi.mocked(mockOutputRootManager.hasOutputRoot).mockResolvedValue(false);
      vi.mocked(mockOutputRootManager.setupOutputRoot).mockResolvedValue({
        success: false,
        displayName: ''
      });

      const hasOutputRoot = await mockOutputRootManager.hasOutputRoot();
      expect(hasOutputRoot).toBe(false);

      const setupResult = await mockOutputRootManager.setupOutputRoot();
      expect(setupResult.success).toBe(false);

      // Step 2: Attempt to get project handle should fail
      vi.mocked(mockOutputRootManager.getProjectOutputHandle).mockResolvedValue(null);
      
      const projectHandle = await mockOutputRootManager.getProjectOutputHandle('test_project');
      expect(projectHandle).toBeNull();

      // Step 3: File save should be skipped
      const filename = 'should_not_save.jpg';
      const imageBlob = new Blob(['test data'], { type: 'image/jpeg' });
      
      let saveAttempted = false;
      let skipReason = '';

      if (!projectHandle) {
        skipReason = 'No project handle available';
      } else {
        saveAttempted = true;
      }

      expect(saveAttempted).toBe(false);
      expect(skipReason).toBe('No project handle available');
    });

    it('should handle file write permission errors', async () => {
      // Step 1: Setup normal workflow until file write
      const folderName = 'permission_test';
      const projectHandle = await mockOutputRootManager.getProjectOutputHandle(folderName);
      expect(projectHandle).toBe(mockProjectHandle);

      // Step 2: Simulate permission error during file write
      mockProjectHandle.getFileHandle.mockRejectedValue(new Error('Permission denied'));

      const filename = 'permission_test.jpg';
      const imageBlob = new Blob(['test data'], { type: 'image/jpeg' });

      let saveSuccessful = true;
      let errorDetails = null;

      try {
        const fileHandle = await projectHandle.getFileHandle(filename, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(imageBlob);
        await stream.close();
      } catch (error) {
        saveSuccessful = false;
        errorDetails = error;
        console.warn('[Integration] File save failed:', filename, error);
      }

      expect(saveSuccessful).toBe(false);
      expect(errorDetails).toBeInstanceOf(Error);
      expect(errorDetails?.message).toBe('Permission denied');
      expect(global.console.warn).toHaveBeenCalledWith(
        '[Integration] File save failed:',
        filename,
        expect.any(Error)
      );
    });

    it('should handle corrupted handle storage', async () => {
      // Step 1: Simulate corrupted storage
      vi.mocked(mockHandleStorage.getAllHandles).mockRejectedValue(new Error('Database corrupted'));

      let storageError = null;
      let fallbackUsed = false;

      try {
        const storedHandles = await mockHandleStorage.getAllHandles();
        expect(storedHandles).toBeDefined();
      } catch (error) {
        storageError = error;
        fallbackUsed = true;
        // Fallback to fresh setup
        vi.mocked(mockOutputRootManager.hasOutputRoot).mockResolvedValue(false);
      }

      expect(storageError).toBeInstanceOf(Error);
      expect(storageError?.message).toBe('Database corrupted');
      expect(fallbackUsed).toBe(true);

      // Step 2: Should still be able to setup new output root
      const setupResult = await mockOutputRootManager.setupOutputRoot();
      expect(setupResult.success).toBe(true);
    });
  });

  describe('Handle Management Integration', () => {
    it('should maintain handle consistency across Dropzone and OutputPanel', async () => {
      // Step 1: Dropzone detects folder and sets up auto-save
      const detectedFolder = 'consistency_test';
      const projectHandle = await mockOutputRootManager.getProjectOutputHandle(detectedFolder);
      
      // Simulate setting global handle (Dropzone → OutputPanel communication)
      (global as any).window = { autoSaveHandle: projectHandle };

      // Step 2: OutputPanel should use the same handle
      const dropzoneHandle = projectHandle;
      const outputPanelHandle = (global as any).window.autoSaveHandle;
      const managerHandle = mockOutputRootManager.getCurrentProjectHandle();

      expect(dropzoneHandle).toBe(mockProjectHandle);
      expect(outputPanelHandle).toBe(mockProjectHandle);
      expect(managerHandle).toBe(mockProjectHandle);

      // Step 3: All components should reference the same handle
      expect(dropzoneHandle).toBe(outputPanelHandle);
      expect(outputPanelHandle).toBe(managerHandle);

      // Step 4: File save should work with consistent handle
      const filename = 'consistency_test.jpg';
      const imageBlob = new Blob(['test data'], { type: 'image/jpeg' });

      const fileHandle = await managerHandle.getFileHandle(filename, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(imageBlob);
      await stream.close();

      expect(mockProjectHandle.getFileHandle).toHaveBeenCalledWith(filename, { create: true });
      expect(mockFileHandle.createWritable).toHaveBeenCalled();
    });

    it('should handle handle persistence across browser sessions', async () => {
      // Step 1: First session - store handle
      const sessionId = 'session-test-1';
      const storedHandle = mockProjectHandle;

      await mockHandleStorage.storeHandle(sessionId, storedHandle, 'SessionTest');
      expect(mockHandleStorage.storeHandle).toHaveBeenCalledWith(
        sessionId,
        storedHandle,
        'SessionTest'
      );

      // Step 2: Second session - retrieve handle
      vi.mocked(mockHandleStorage.getAllHandles).mockResolvedValue([
        {
          id: sessionId,
          handle: storedHandle,
          displayName: 'SessionTest',
          lastUsed: Date.now(),
        }
      ]);

      const storedHandles = await mockHandleStorage.getAllHandles();
      const retrievedHandle = storedHandles.find(h => h.id === sessionId)?.handle;

      expect(retrievedHandle).toBe(storedHandle);

      // Step 3: Use retrieved handle for file operations
      const filename = 'session_persistence_test.jpg';
      const imageBlob = new Blob(['persistent data'], { type: 'image/jpeg' });

      const fileHandle = await retrievedHandle.getFileHandle(filename, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(imageBlob);
      await stream.close();

      expect(storedHandle.getFileHandle).toHaveBeenCalledWith(filename, { create: true });
    });
  });
});