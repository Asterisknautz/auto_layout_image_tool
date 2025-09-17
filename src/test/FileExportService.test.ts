import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileExportService, type OutputProfile, type IFileWriteService, type IWorkerService, type ExportOptions } from '../services/FileExportService';
import type { ComposePayload } from '../components/CanvasEditor';

// Mock implementations
class MockFileWriteService implements IFileWriteService {
  public writeFileCalled = false;
  public ensureDirectoryHandleCalled = false;
  public shouldReturnHandle = true;
  public writtenFiles: { filename: string; blob: Blob }[] = [];

  async writeFile(filename: string, blob: Blob): Promise<boolean> {
    this.writeFileCalled = true;
    this.writtenFiles.push({ filename, blob });
    return true;
  }

  async ensureDirectoryHandle(): Promise<boolean> {
    this.ensureDirectoryHandleCalled = true;
    return this.shouldReturnHandle;
  }

  reset() {
    this.writeFileCalled = false;
    this.ensureDirectoryHandleCalled = false;
    this.writtenFiles = [];
  }
}

type WorkerMessage = Parameters<IWorkerService['postMessage']>[0];

class MockWorkerService implements IWorkerService {
  public messages: WorkerMessage[] = [];

  postMessage(message: WorkerMessage): void {
    this.messages.push(message);
  }

  reset() {
    this.messages = [];
  }
}

describe('FileExportService', () => {
  let fileExportService: FileExportService;
  let mockFileWriteService: MockFileWriteService;
  let mockWorkerService: MockWorkerService;

  const mockPayload: ComposePayload = {
    image: {} as ImageBitmap, // Mock ImageBitmap
    bbox: [10, 20, 100, 200],
    sizes: [],
    exportPsd: false
  };

  const mockProfile: OutputProfile = {
    sizes: [
      { name: 'small', width: 100, height: 100 },
      { name: 'large', width: 200, height: 200 }
    ],
    exportPsd: false,
    formats: ['jpg', 'png']
  };

  beforeEach(() => {
    mockFileWriteService = new MockFileWriteService();
    mockWorkerService = new MockWorkerService();
    fileExportService = new FileExportService(mockFileWriteService, mockWorkerService);
  });

  describe('calculateFileCount', () => {
    it('should calculate file count based on formats', () => {
      const profile: OutputProfile = {
        sizes: [],
        formats: ['jpg', 'png', 'psd']
      };
      
      const count = fileExportService.calculateFileCount(profile);
      expect(count).toBe(3);
    });

    it('should default to jpg if no formats specified', () => {
      const profile: OutputProfile = {
        sizes: []
      };
      
      const count = fileExportService.calculateFileCount(profile);
      expect(count).toBe(1);
    });

    it('should handle empty formats array', () => {
      const profile: OutputProfile = {
        sizes: [],
        formats: []
      };
      
      const count = fileExportService.calculateFileCount(profile);
      expect(count).toBe(0);
    });
  });

  describe('calculateTotalFileCount', () => {
    it('should sum file counts across all profiles', () => {
      const profiles = {
        profile1: { sizes: [], formats: ['jpg', 'png'] },
        profile2: { sizes: [], formats: ['jpg'] },
        profile3: { sizes: [] } // defaults to jpg
      };
      
      const totalCount = fileExportService.calculateTotalFileCount(profiles);
      expect(totalCount).toBe(4); // 2 + 1 + 1
    });

    it('should handle empty profiles object', () => {
      const totalCount = fileExportService.calculateTotalFileCount({});
      expect(totalCount).toBe(0);
    });
  });

  describe('exportSingleProfile', () => {
    it('should successfully export when directory handle is available', async () => {
      const options: ExportOptions = {
        payload: mockPayload,
        profile: mockProfile,
        profileKey: 'test-profile'
      };

      const result = await fileExportService.exportSingleProfile(options);

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(mockFileWriteService.ensureDirectoryHandleCalled).toBe(true);
      expect(mockWorkerService.messages).toHaveLength(1);
      expect(mockWorkerService.messages[0]).toEqual({
        type: 'compose',
        payload: {
          ...mockPayload,
          sizes: mockProfile.sizes,
          exportPsd: false
        },
        profileKey: 'test-profile'
      });
    });

    it('should fail when directory handle is not available', async () => {
      mockFileWriteService.shouldReturnHandle = false;
      
      const options: ExportOptions = {
        payload: mockPayload,
        profile: mockProfile,
        profileKey: 'test-profile'
      };

      const result = await fileExportService.exportSingleProfile(options);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Directory handle not available');
      expect(mockWorkerService.messages).toHaveLength(0);
    });

    it('should use profile exportPsd setting over payload setting', async () => {
      const profileWithPsd: OutputProfile = {
        ...mockProfile,
        exportPsd: true
      };
      
      const options: ExportOptions = {
        payload: mockPayload,
        profile: profileWithPsd,
        profileKey: 'psd-profile'
      };

      await fileExportService.exportSingleProfile(options);

      expect(mockWorkerService.messages[0].payload.exportPsd).toBe(true);
    });
  });

  describe('exportAllProfiles', () => {
    it('should export all profiles and aggregate results', async () => {
      const profiles = {
        profile1: { sizes: [], formats: ['jpg'] },
        profile2: { sizes: [], formats: ['png', 'psd'] }
      };

      const result = await fileExportService.exportAllProfiles(mockPayload, profiles);

      expect(result.success).toBe(true);
      expect(mockWorkerService.messages).toHaveLength(2);
      expect(mockWorkerService.messages[0].profileKey).toBe('profile1');
      expect(mockWorkerService.messages[1].profileKey).toBe('profile2');
    });

    it('should handle empty profiles object', async () => {
      const result = await fileExportService.exportAllProfiles(mockPayload, {});

      expect(result.success).toBe(true);
      expect(result.filesCreated).toEqual([]);
      expect(mockWorkerService.messages).toHaveLength(0);
    });

    it('should aggregate errors from failed exports', async () => {
      mockFileWriteService.shouldReturnHandle = false;
      
      const profiles = {
        profile1: { sizes: [], formats: ['jpg'] }
      };

      const result = await fileExportService.exportAllProfiles(mockPayload, profiles);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Directory handle not available');
    });
  });

  describe('exportWithBboxChanges', () => {
    it('should call bbox update callback and export all profiles', async () => {
      const onBboxUpdate = vi.fn();
      const profiles = {
        profile1: { sizes: [], formats: ['jpg'] }
      };

      const result = await fileExportService.exportWithBboxChanges(
        mockPayload,
        profiles,
        onBboxUpdate
      );

      expect(onBboxUpdate).toHaveBeenCalledWith(mockPayload.bbox);
      expect(result.success).toBe(true);
      expect(mockWorkerService.messages).toHaveLength(1);
    });

    it('should work without bbox update callback', async () => {
      const profiles = {
        profile1: { sizes: [], formats: ['jpg'] }
      };

      const result = await fileExportService.exportWithBboxChanges(
        mockPayload,
        profiles
      );

      expect(result.success).toBe(true);
      expect(mockWorkerService.messages).toHaveLength(1);
    });
  });
});
