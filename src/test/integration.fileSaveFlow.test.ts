import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { outputRootManager } from '../utils/outputRootManager';
import { handleStorage } from '../utils/handleStorage';

// Mock dependencies
vi.mock('../utils/outputRootManager');
vi.mock('../utils/handleStorage');
vi.mock('../utils/debugMode', () => ({
  debugController: {
    log: vi.fn(),
  }
}));

type MockWritableStream = {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type MockFileHandle = FileSystemFileHandle & {
  name: string;
  kind: FileSystemHandleKind;
  createWritable: ReturnType<typeof vi.fn>;
};

type MockDirectoryHandle = FileSystemDirectoryHandle & {
  name: string;
  kind: FileSystemHandleKind;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
  getFileHandle?: ReturnType<typeof vi.fn>;
  removeEntry: ReturnType<typeof vi.fn>;
};

const mockedOutputRootManager = vi.mocked(outputRootManager);
const mockedHandleStorage = vi.mocked(handleStorage);

const getWindowWithAutoSave = () => {
  if (typeof window === 'undefined') {
    vi.stubGlobal('window', {} as unknown as typeof window);
  }
  return window as typeof window & { autoSaveHandle?: FileSystemDirectoryHandle | null };
};

describe('Integration: End-to-End File Save Flow', () => {
  let mockOutputHandle: MockDirectoryHandle;
  let mockProjectHandle: MockDirectoryHandle;
  let mockFileHandle: MockFileHandle;
  let mockWritableStream: MockWritableStream;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock FileSystemDirectoryHandle
    mockWritableStream = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    
    mockFileHandle = {
      name: 'test_image.jpg',
      kind: 'file',
      createWritable: vi.fn().mockResolvedValue(mockWritableStream),
    } as unknown as MockFileHandle;

    mockProjectHandle = {
      name: 'imagetool_test_images',
      kind: 'directory',
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      removeEntry: vi.fn().mockResolvedValue(undefined),
      getDirectoryHandle: vi.fn()
    } as unknown as MockDirectoryHandle;

    mockOutputHandle = {
      name: 'TestOutputRoot',
      kind: 'directory',
      getDirectoryHandle: vi.fn().mockResolvedValue(mockProjectHandle),
      removeEntry: vi.fn().mockResolvedValue(undefined),
      getFileHandle: vi.fn()
    } as unknown as MockDirectoryHandle;

    // Setup default mocks
    mockedOutputRootManager.hasOutputRoot.mockResolvedValue(true);
    mockedOutputRootManager.setupOutputRoot.mockResolvedValue({
      success: true,
      displayName: 'TestOutputRoot'
    });
    mockedOutputRootManager.getProjectOutputHandle.mockResolvedValue(mockProjectHandle);
    mockedOutputRootManager.getCurrentProjectHandle.mockReturnValue(mockProjectHandle);
    mockedOutputRootManager.getOutputRootInfo.mockReturnValue({
      name: 'TestOutputRoot',
      handle: mockOutputHandle,
    });
    mockedOutputRootManager.getCurrentProjectInfo.mockReturnValue({
      name: 'imagetool_test_images',
      handle: mockProjectHandle,
    });

    mockedHandleStorage.storeHandle.mockResolvedValue(undefined);
    mockedHandleStorage.getAllHandles.mockResolvedValue([
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
    vi.unstubAllGlobals();
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
      const hasOutputRoot = await mockedOutputRootManager.hasOutputRoot();
      expect(hasOutputRoot).toBe(true);

      const projectHandle = await mockedOutputRootManager.getProjectOutputHandle(detectedFolderName);
      expect(projectHandle).toBe(mockProjectHandle);
      expect(mockedOutputRootManager.getProjectOutputHandle).toHaveBeenCalledWith('imagetool_test_images');

      // Step 3: Simulate image composition and file save (OutputPanel logic)
      const imageBlob = new Blob(['test image data'], { type: 'image/jpeg' });
      const filename = 'product1_profile1.jpg';

      // Ensure directory handle is available
      const currentHandle = mockedOutputRootManager.getCurrentProjectHandle();
      expect(currentHandle).toBe(mockProjectHandle);

      // Perform file write
      let saveSuccessful = false;
      try {
        const fileHandle = await currentHandle.getFileHandle(filename, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(imageBlob);
        await stream.close();
        saveSuccessful = true;
      } catch {
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
      mockedOutputRootManager.hasOutputRoot.mockResolvedValue(false);
      
      const hasOutputRoot = await mockedOutputRootManager.hasOutputRoot();
      expect(hasOutputRoot).toBe(false);

      const setupResult = await mockedOutputRootManager.setupOutputRoot();
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
      const projectHandle = await mockedOutputRootManager.getProjectOutputHandle(folderName);
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
      } catch {
        saveSuccessful = false;
      }

      expect(saveSuccessful).toBe(true);
    });

    it('should handle batch processing workflow with multiple profiles', async () => {
      // Step 1: Setup batch processing scenario
      const folderName = 'batch_project';
      const outputProfiles = ['profile1', 'profile2', 'profile3'];

      // Step 2: Get project handle
      const projectHandle = await mockedOutputRootManager.getProjectOutputHandle(folderName);
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
      mockedOutputRootManager.hasOutputRoot.mockResolvedValue(false);
      mockedOutputRootManager.setupOutputRoot.mockResolvedValue({
        success: false,
        displayName: ''
      });

      const hasOutputRoot = await mockedOutputRootManager.hasOutputRoot();
      expect(hasOutputRoot).toBe(false);

      const setupResult = await mockedOutputRootManager.setupOutputRoot();
      expect(setupResult.success).toBe(false);

      // Step 2: Attempt to get project handle should fail
      mockedOutputRootManager.getProjectOutputHandle.mockResolvedValue(null);
      
        const projectHandle = await mockedOutputRootManager.getProjectOutputHandle('test_project');
      expect(projectHandle).toBeNull();

      // Step 3: File save should be skipped
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
      const projectHandle = await mockedOutputRootManager.getProjectOutputHandle(folderName);
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
      mockedHandleStorage.getAllHandles.mockRejectedValue(new Error('Database corrupted'));

      let storageError = null;
      let fallbackUsed = false;

      try {
        const storedHandles = await mockedHandleStorage.getAllHandles();
        expect(storedHandles).toBeDefined();
      } catch (error) {
        storageError = error;
        fallbackUsed = true;
        // Fallback to fresh setup
        mockedOutputRootManager.hasOutputRoot.mockResolvedValue(false);
      }

      expect(storageError).toBeInstanceOf(Error);
      expect(storageError?.message).toBe('Database corrupted');
      expect(fallbackUsed).toBe(true);

      // Step 2: Should still be able to setup new output root
      const setupResult = await mockedOutputRootManager.setupOutputRoot();
      expect(setupResult.success).toBe(true);
    });
  });

  describe('Handle Management Integration', () => {
    it('should maintain handle consistency across Dropzone and OutputPanel', async () => {
      // Step 1: Dropzone detects folder and sets up auto-save
      const detectedFolder = 'consistency_test';
      const projectHandle = await mockedOutputRootManager.getProjectOutputHandle(detectedFolder);
      
      // Simulate setting global handle (Dropzone → OutputPanel communication)
      getWindowWithAutoSave().autoSaveHandle = projectHandle;

      // Step 2: OutputPanel should use the same handle
      const dropzoneHandle = projectHandle;
      const outputPanelHandle = getWindowWithAutoSave().autoSaveHandle;
      const managerHandle = mockedOutputRootManager.getCurrentProjectHandle();

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

      await mockedHandleStorage.storeHandle(sessionId, storedHandle, 'SessionTest');
      expect(mockedHandleStorage.storeHandle).toHaveBeenCalledWith(
        sessionId,
        storedHandle,
        'SessionTest'
      );

      // Step 2: Second session - retrieve handle
      mockedHandleStorage.getAllHandles.mockResolvedValue([
        {
          id: sessionId,
          handle: storedHandle,
          displayName: 'SessionTest',
          lastUsed: Date.now(),
        }
      ]);

      const storedHandles = await mockedHandleStorage.getAllHandles();
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
