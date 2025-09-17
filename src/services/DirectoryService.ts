import { autoDetectAndSetupOutputFolder } from '../utils/fileSystem';
import { debugController } from '../utils/debugMode';

export interface DirectoryHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

export interface DirectorySetupResult {
  success: boolean;
  handle?: DirectoryHandle;
  displayName?: string;
  error?: string;
}

export interface IStorageService {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class DirectoryService {
  private dirHandleRef: DirectoryHandle | null = null;
  private autoSave = false;
  private dirName = '';

  constructor(
    private storageService: IStorageService,
    private globalWindowRef: (typeof window) & { autoSaveHandle?: DirectoryHandle | null } = window as (typeof window) & {
      autoSaveHandle?: DirectoryHandle | null;
    }
  ) {}

  // Getters for current state
  get currentHandle(): DirectoryHandle | null {
    return this.dirHandleRef;
  }

  get isAutoSaveEnabled(): boolean {
    return this.autoSave;
  }

  get directoryName(): string {
    return this.dirName;
  }

  /**
   * Initialize directory service by loading saved settings
   */
  async initialize(): Promise<void> {
    debugController.log('DirectoryService', 'Initializing...');
    
    // Check if Dropzone has already set up a handle
    if (this.globalWindowRef.autoSaveHandle) {
      this.dirHandleRef = this.globalWindowRef.autoSaveHandle;
      const folderName = this.dirHandleRef?.name || '';
      this.dirName = folderName;
      this.autoSave = true;
      debugController.log('DirectoryService', 'Using handle from Dropzone:', folderName);
      return;
    }

    // Load from localStorage
    const savedDirName = this.storageService.getItem('imagetool.autoSave.dirName');
    const wasAutoSaveEnabled = this.storageService.getItem('imagetool.autoSave.enabled') === 'true';
    
    if (savedDirName) {
      this.dirName = savedDirName;
      debugController.log('DirectoryService', 'Restored saved directory name:', savedDirName);
      
      if (wasAutoSaveEnabled) {
        this.autoSave = true;
        debugController.log('DirectoryService', 'Auto-save was previously enabled - restored state');
      }
    }
  }

  /**
   * Pick a directory using the smart auto-detection
   */
  async pickDirectory(): Promise<DirectorySetupResult> {
    try {
      if (!('showDirectoryPicker' in window)) {
        return {
          success: false,
          error: 'このブラウザはフォルダ保存に対応していません（ZIP保存をご利用ください）'
        };
      }

      // Use smart directory picker with automatic _output detection
      const { inputHandle, outputHandle, hasExistingOutput } = await autoDetectAndSetupOutputFolder();
      
      if (!inputHandle || !outputHandle) {
        debugController.log('DirectoryService', 'Directory selection cancelled');
        return {
          success: false,
          error: 'Directory selection was cancelled'
        };
      }

      // Set the output handle as the primary directory handle
      this.dirHandleRef = outputHandle as DirectoryHandle;
      if (this.globalWindowRef) {
        this.globalWindowRef.autoSaveHandle = outputHandle; // Also set globally
      }
      
      // Update UI with appropriate folder name
      const displayName = `${inputHandle.name}/_output`;
      this.dirName = displayName;
      this.autoSave = true;
      
      // Save to localStorage for next time
      this.storageService.setItem('imagetool.autoSave.dirName', displayName);
      this.storageService.setItem('imagetool.autoSave.enabled', 'true');
      
      debugController.log('DirectoryService', 'Smart auto-save configured:', {
        input: inputHandle.name,
        output: outputHandle.name,
        hadExistingOutput: hasExistingOutput
      });
      
      return {
        success: true,
        handle: this.dirHandleRef,
        displayName
      };
      
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error occurred';
      debugController.log('DirectoryService', 'Enhanced directory selection failed:', e);
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Ensure directory handle is available for writing
   */
  async ensureDirectoryHandle(): Promise<boolean> {
    debugController.log('DirectoryService', 'ensureDirectoryHandle called', {
      hasCurrentHandle: !!this.dirHandleRef,
      hasAutoSaveHandle: !!(this.globalWindowRef?.autoSaveHandle),
      autoSaveEnabled: this.autoSave
    });

    if (this.dirHandleRef) {
      debugController.log('DirectoryService', 'Using existing handle:', this.dirHandleRef.name);
      return true; // Already have a handle
    }

    // Check if auto-save handle is available from Dropzone
    if (this.globalWindowRef?.autoSaveHandle) {
      this.dirHandleRef = this.globalWindowRef.autoSaveHandle;
      debugController.log('DirectoryService', 'Using auto-save handle from Dropzone:', this.dirHandleRef?.name || 'unknown');
      return true;
    }

    // No handle available - auto-save is not properly configured
    debugController.log('DirectoryService', 'No directory handle available for auto-save');
    return false;
  }

  /**
   * Write a file to the current directory
   */
  async writeFile(filename: string, blob: Blob): Promise<boolean> {
    debugController.log('DirectoryService', 'writeFile called:', filename, 'autoSave:', this.autoSave);
    
    if (!this.autoSave) {
      debugController.log('DirectoryService', 'Auto-save disabled, skipping write');
      return false;
    }

    const hasHandle = await this.ensureDirectoryHandle();
    if (!hasHandle) {
      console.warn('[DirectoryService] No directory handle available for:', filename);
      return false;
    }

    const handle = this.dirHandleRef;
    if (!handle) {
      console.warn('[DirectoryService] Directory handle is null after ensureDirectoryHandle');
      return false;
    }

    try {
      debugController.log('DirectoryService', 'Creating file handle for:', filename);
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(blob);
      await stream.close();
      debugController.log('DirectoryService', 'Successfully saved:', filename);
      return true;
    } catch (e) {
      console.warn('[DirectoryService] Failed to save', filename, e);
      debugController.log('DirectoryService', 'Save error details:', {
        filename,
        hasHandle: !!handle,
        handleName: handle?.name || 'unknown',
        error: e
      });
      return false;
    }
  }

  /**
   * Enable or disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSave = enabled;
    this.storageService.setItem('imagetool.autoSave.enabled', enabled.toString());
    debugController.log('DirectoryService', 'Auto-save toggled:', enabled);
  }

  /**
   * Clear current directory handle and settings
   */
  clearDirectory(): void {
    this.dirHandleRef = null;
    this.autoSave = false;
    this.dirName = '';
    this.storageService.setItem('imagetool.autoSave.enabled', 'false');
    debugController.log('DirectoryService', 'Directory cleared');
  }
}
