import type { ComposePayload } from '../components/CanvasEditor';
import type { ResizeSpec } from '../worker/opencv';

export interface OutputProfile {
  sizes: ResizeSpec[];
  exportPsd?: boolean;
  formats?: string[];
}

export interface ExportResult {
  success: boolean;
  filesCreated: string[];
  errors?: string[];
}

export interface ExportOptions {
  payload: ComposePayload;
  profile: OutputProfile;
  profileKey: string;
}

export interface IFileWriteService {
  writeFile(filename: string, blob: Blob): Promise<boolean>;
  ensureDirectoryHandle(): Promise<boolean>;
}

export interface IWorkerService {
  postMessage(message: WorkerMessage): void;
}

interface WorkerMessage {
  type: string;
  payload?: ComposePayload;
  profileKey?: string;
}

export class FileExportService {
  constructor(
    private fileWriteService: IFileWriteService,
    private workerService: IWorkerService
  ) {}

  /**
   * Calculate the number of files that will be created for a given profile
   */
  calculateFileCount(profile: OutputProfile): number {
    const formats = profile.formats || ['jpg'];
    return formats.length;
  }

  /**
   * Calculate total file count across all profiles
   */
  calculateTotalFileCount(profiles: Record<string, OutputProfile>): number {
    return Object.values(profiles).reduce((total, profile) => {
      return total + this.calculateFileCount(profile);
    }, 0);
  }

  /**
   * Export files for a single profile
   */
  async exportSingleProfile(options: ExportOptions): Promise<ExportResult> {
    const { payload, profile, profileKey } = options;
    
    try {
      // Ensure directory is available for writing
      const hasHandle = await this.fileWriteService.ensureDirectoryHandle();
      if (!hasHandle) {
        return {
          success: false,
          filesCreated: [],
          errors: ['Directory handle not available']
        };
      }

      // Create compose payload for worker
      const composePayload: ComposePayload = {
        ...payload,
        sizes: profile.sizes,
        exportPsd: profile.exportPsd ?? payload.exportPsd,
      };

      // Send to worker for processing
      this.workerService.postMessage({ 
        type: 'compose', 
        payload: composePayload,
        profileKey 
      });

      // Return expected result (actual files will be created via worker message handling)
      return {
        success: true,
        filesCreated: [], // Will be populated by worker response handler
        errors: []
      };
    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Export files for all profiles
   */
  async exportAllProfiles(
    payload: ComposePayload, 
    profiles: Record<string, OutputProfile>
  ): Promise<ExportResult> {
    const results: ExportResult[] = [];
    const allFilesCreated: string[] = [];
    const allErrors: string[] = [];

    for (const [profileKey, profile] of Object.entries(profiles)) {
      const result = await this.exportSingleProfile({
        payload,
        profile,
        profileKey
      });
      
      results.push(result);
      allFilesCreated.push(...result.filesCreated);
      if (result.errors) {
        allErrors.push(...result.errors);
      }
    }

    const allSuccessful = results.every(r => r.success);
    
    return {
      success: allSuccessful,
      filesCreated: allFilesCreated,
      errors: allErrors.length > 0 ? allErrors : undefined
    };
  }

  /**
   * Prepare export for single image mode with bbox changes
   */
  async exportWithBboxChanges(
    payload: ComposePayload,
    profiles: Record<string, OutputProfile>,
    onBboxUpdate?: (bbox: [number, number, number, number]) => void
  ): Promise<ExportResult> {
    // Update bbox in parent component if callback provided
    if (onBboxUpdate) {
      onBboxUpdate(payload.bbox);
    }

    // Export to all profiles
    return this.exportAllProfiles(payload, profiles);
  }
}