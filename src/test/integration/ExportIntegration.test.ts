import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileExportService } from '../../services/FileExportService';
import { DirectoryService, type IStorageService, type DirectoryHandle } from '../../services/DirectoryService';
import { MockWorkerService } from '../../services/WorkerService';
import type { ComposePayload } from '../../components/CanvasEditor';
import type { OutputProfile } from '../../services/FileExportService';

// Mock dependencies
vi.mock('../../utils/fileSystem', () => ({
  autoDetectAndSetupOutputFolder: vi.fn()
}));
vi.mock('../../utils/debugMode', () => ({
  debugController: {
    log: vi.fn()
  }
}));

class InMemoryStorageService implements IStorageService {
  private storage = new Map<string, string>();

  getItem(key: string): string | null {
    return this.storage.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }
}

const createMockWindow = () => ({ autoSaveHandle: null }) as unknown as typeof window & {
  autoSaveHandle?: DirectoryHandle | null;
};

describe('Export Integration Tests', () => {
  let fileExportService: FileExportService;
  let directoryService: DirectoryService;
  let workerService: MockWorkerService;
  let mockStorageService: InMemoryStorageService;

  const mockPayload: ComposePayload = {
    image: {} as ImageBitmap,
    bbox: [10, 20, 100, 200],
    sizes: [],
    exportPsd: false
  };

  const mockProfiles: Record<string, OutputProfile> = {
    mobile: {
      sizes: [{ name: 'mobile', width: 400, height: 400 }],
      formats: ['jpg', 'png'],
      exportPsd: false
    },
    pc: {
      sizes: [{ name: 'pc', width: 800, height: 600 }],
      formats: ['jpg'],
      exportPsd: true
    }
  };

  beforeEach(() => {
    // Setup mock storage
    mockStorageService = new InMemoryStorageService();

    // Initialize services
    directoryService = new DirectoryService(mockStorageService, createMockWindow());
    workerService = new MockWorkerService();

    // Setup directory service to simulate successful directory setup
    vi.spyOn(directoryService, 'ensureDirectoryHandle').mockResolvedValue(true);
    vi.spyOn(directoryService, 'writeFile').mockResolvedValue(true);

    // Create file export service with dependencies
    fileExportService = new FileExportService(directoryService, workerService);
  });

  describe('Single Profile Export Flow', () => {
    it('should complete full export flow for single profile', async () => {
      // Execute export
      const result = await fileExportService.exportSingleProfile({
        payload: mockPayload,
        profile: mockProfiles.mobile,
        profileKey: 'mobile'
      });

      // Verify export result
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);

      // Verify worker message was sent
      expect(workerService.getMessageCount()).toBe(1);
      const lastMessage = workerService.getLastMessage();
      expect(lastMessage?.type).toBe('compose');
      expect(lastMessage?.profileKey).toBe('mobile');
      const composePayload = lastMessage?.payload as ComposePayload | undefined;
      expect(composePayload?.sizes).toEqual(mockProfiles.mobile.sizes);
    });

    it('should handle export failure gracefully', async () => {
      // Simulate directory handle failure
      vi.spyOn(directoryService, 'ensureDirectoryHandle').mockResolvedValue(false);

      const result = await fileExportService.exportSingleProfile({
        payload: mockPayload,
        profile: mockProfiles.mobile,
        profileKey: 'mobile'
      });

      // Verify failure handling
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Directory handle not available');
      expect(workerService.getMessageCount()).toBe(0);
    });
  });

  describe('All Profiles Export Flow', () => {
    it('should export all profiles successfully', async () => {
      const result = await fileExportService.exportAllProfiles(mockPayload, mockProfiles);

      // Verify overall success
      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();

      // Verify worker messages for all profiles
      expect(workerService.getMessageCount()).toBe(2);
      
      const messages = workerService.sentMessages;
      expect(messages[0].profileKey).toBe('mobile');
      expect(messages[1].profileKey).toBe('pc');
    });

    it('should calculate correct total file count', () => {
      const totalFiles = fileExportService.calculateTotalFileCount(mockProfiles);
      
      // mobile: jpg + png = 2, pc: jpg = 1, total = 3
      expect(totalFiles).toBe(3);
    });
  });

  describe('Export with BBox Changes Flow', () => {
    it('should update bbox and export all profiles', async () => {
      const onBboxUpdate = vi.fn();

      const result = await fileExportService.exportWithBboxChanges(
        mockPayload,
        mockProfiles,
        onBboxUpdate
      );

      // Verify bbox update callback was called
      expect(onBboxUpdate).toHaveBeenCalledWith(mockPayload.bbox);

      // Verify export was executed
      expect(result.success).toBe(true);
      expect(workerService.getMessageCount()).toBe(2);
    });

    it('should work without bbox update callback', async () => {
      const result = await fileExportService.exportWithBboxChanges(
        mockPayload,
        mockProfiles
      );

      expect(result.success).toBe(true);
      expect(workerService.getMessageCount()).toBe(2);
    });
  });

  describe('Directory and File Management Integration', () => {
    it('should setup directory and write files in correct sequence', async () => {
      const ensureHandleSpy = vi.spyOn(directoryService, 'ensureDirectoryHandle');

      await fileExportService.exportSingleProfile({
        payload: mockPayload,
        profile: mockProfiles.mobile,
        profileKey: 'mobile'
      });

      // Verify directory was ensured before attempting export
      expect(ensureHandleSpy).toHaveBeenCalled();
      
      // Verify worker message was sent (file writing happens via worker response)
      expect(workerService.getMessageCount()).toBe(1);
    });

    it('should handle directory setup failure', async () => {
      vi.spyOn(directoryService, 'ensureDirectoryHandle').mockResolvedValue(false);

      const result = await fileExportService.exportAllProfiles(mockPayload, mockProfiles);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Directory handle not available');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should aggregate errors from multiple failed exports', async () => {
      // Simulate intermittent failures
      let callCount = 0;
      vi.spyOn(directoryService, 'ensureDirectoryHandle').mockImplementation(async () => {
        callCount++;
        return callCount !== 1; // First call fails, second succeeds
      });

      const result = await fileExportService.exportAllProfiles(mockPayload, mockProfiles);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Directory handle not available');
    });

    it('should handle unexpected errors gracefully', async () => {
      vi.spyOn(directoryService, 'ensureDirectoryHandle').mockRejectedValue(new Error('Unexpected error'));

      const result = await fileExportService.exportSingleProfile({
        payload: mockPayload,
        profile: mockProfiles.mobile,
        profileKey: 'mobile'
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Unexpected error');
    });
  });

  describe('File Count Calculations', () => {
    it('should calculate file counts correctly for different profile configurations', () => {
      const testProfiles = {
        noFormats: { sizes: [] }, // defaults to jpg = 1
        emptyFormats: { sizes: [], formats: [] }, // 0 files
        multipleFormats: { sizes: [], formats: ['jpg', 'png', 'psd'] }, // 3 files
      };

      expect(fileExportService.calculateFileCount(testProfiles.noFormats)).toBe(1);
      expect(fileExportService.calculateFileCount(testProfiles.emptyFormats)).toBe(0);
      expect(fileExportService.calculateFileCount(testProfiles.multipleFormats)).toBe(3);

      const totalCount = fileExportService.calculateTotalFileCount(testProfiles);
      expect(totalCount).toBe(4); // 1 + 0 + 3
    });
  });

  describe('Service Integration', () => {
    it('should integrate all services for complete export workflow', async () => {
      // Setup directory service with successful initialization
      await directoryService.initialize();
      directoryService.setAutoSave(true);

      // Execute complete workflow
      const result = await fileExportService.exportWithBboxChanges(
        mockPayload,
        mockProfiles,
        (bbox) => {
          // Simulate bbox update in parent component
          expect(bbox).toEqual(mockPayload.bbox);
        }
      );

      // Verify all services worked together
      expect(result.success).toBe(true);
      expect(workerService.getMessageCount()).toBe(2);
      expect(directoryService.isAutoSaveEnabled).toBe(true);
    });
  });
});
