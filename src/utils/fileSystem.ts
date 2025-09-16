/**
 * Enhanced File System Access API utilities for _output folder management
 */

import { debugController } from './debugMode';

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemDirectoryHandle | string;
  suggestedName?: string;
}

type ExtendedWindow = Window & {
  folderHandleCache?: Map<string, FileSystemDirectoryHandle>;
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
};

type FileWithRelativePath = File & { webkitRelativePath?: string };
type FileWithHandle = File & {
  handle?: FileSystemFileHandle & {
    getParent?: () => Promise<FileSystemDirectoryHandle>;
  };
};
type FileWithPath = File & { path?: string };

function getExtendedWindow(): ExtendedWindow | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window as ExtendedWindow;
}

function ensureFolderHandleCache(target: ExtendedWindow): Map<string, FileSystemDirectoryHandle> {
  if (!target.folderHandleCache) {
    target.folderHandleCache = new Map();
  }
  return target.folderHandleCache;
}

function getWebkitRelativePath(file: File): string | undefined {
  if ('webkitRelativePath' in file) {
    const relativePath = (file as FileWithRelativePath).webkitRelativePath;
    if (typeof relativePath === 'string' && relativePath.length > 0) {
      return relativePath;
    }
  }
  return undefined;
}

function getFileHandle(file: File): (FileSystemFileHandle & { getParent?: () => Promise<FileSystemDirectoryHandle> }) | null {
  if ('handle' in file) {
    const handleCandidate = (file as FileWithHandle).handle;
    if (handleCandidate && handleCandidate.kind === 'file') {
      return handleCandidate;
    }
  }
  return null;
}

function getFilePath(file: File): string {
  if ('path' in file) {
    const pathCandidate = (file as FileWithPath).path;
    if (typeof pathCandidate === 'string' && pathCandidate.length > 0) {
      return pathCandidate;
    }
  }
  return file.name;
}

/**
 * Detect parent folder from file handles and set up _output folder
 */
export async function detectAndSetupOutputFromFiles(files: File[]): Promise<{
  outputHandle: FileSystemDirectoryHandle | null;
  displayName: string;
  hasExistingOutput: boolean;
}> {
  try {
    debugController.log('FileSystem', 'Attempting to detect parent folder from files');

    // Try to get parent directory handle from the first file
    const extendedWindow = getExtendedWindow();

    for (const file of files) {
      // Check if file has webkitRelativePath (from folder drag & drop)
      const relativePath = getWebkitRelativePath(file);
      if (relativePath) {
        const pathParts = relativePath.split('/');
        if (pathParts.length > 1) {
          const parentFolderName = pathParts[0];
          debugController.log('FileSystem', 'Detected parent from webkitRelativePath:', parentFolderName);
          
          // Create a unique cache key based on the folder path and name
          const folderCacheKey = `${parentFolderName}_${relativePath}`;
          
          // Check if we already have a cached directory handle for this specific folder
          if (!extendedWindow) {
            break;
          }
          const folderCache = ensureFolderHandleCache(extendedWindow);
          const cachedHandle = folderCache.get(folderCacheKey);
          if (cachedHandle) {
            debugController.log('FileSystem', 'Using cached parent handle for folder:', parentFolderName);
            return await setupOutputInDirectory(cachedHandle);
          }

          // Ask user to select the parent directory that contains the dragged folder
          // Try to determine the best startIn location based on common folder structures
          let startIn = 'desktop'; // Default fallback
          
          // Analyze the folder name to suggest appropriate startIn location
          const folderNameLower = parentFolderName.toLowerCase();
          if (folderNameLower.includes('document') || folderNameLower.includes('doc')) {
            startIn = 'documents';
          } else if (folderNameLower.includes('download')) {
            startIn = 'downloads';
          } else if (folderNameLower.includes('picture') || folderNameLower.includes('photo') || folderNameLower.includes('image')) {
            startIn = 'pictures';
          }
          
          debugController.log('FileSystem', `Suggesting startIn: ${startIn} based on folder: ${parentFolderName}`);
          
          const directoryPicker = extendedWindow?.showDirectoryPicker;
          if (!directoryPicker) {
            throw new Error('showDirectoryPicker not supported in this browser');
          }

          const inputHandle = await directoryPicker({
            mode: 'readwrite',
            startIn: startIn
          });

          debugController.log('FileSystem', 'User selected directory:', inputHandle.name);
          
          // Cache the handle for this specific folder
          folderCache.set(folderCacheKey, inputHandle);
          
          return await setupOutputInDirectory(inputHandle);
        }
      }

      // Check if file has a directory handle (File System Access API)
      const fileHandle = getFileHandle(file);
      if (fileHandle) {
        try {
          // Try to get parent directory (this might not work in all browsers)
          if (fileHandle.getParent) {
            const parentHandle = await fileHandle.getParent();
            debugController.log('FileSystem', 'Got parent handle from file:', parentHandle.name);
            return await setupOutputInDirectory(parentHandle);
          }
        } catch (e) {
          debugController.log('FileSystem', 'Could not get parent from file handle:', e);
        }
      }
    }

    // Fallback: prompt for directory selection
    debugController.log('FileSystem', 'Could not detect parent folder, falling back to directory picker');
    const result = await autoDetectAndSetupOutputFolder();
    if (result.inputHandle && result.outputHandle) {
      const displayName = `${result.inputHandle.name}/_output`;
      return { 
        outputHandle: result.outputHandle, 
        displayName, 
        hasExistingOutput: result.hasExistingOutput 
      };
    }
    return { outputHandle: null, displayName: '', hasExistingOutput: false };
  } catch (e) {
    debugController.log('FileSystem', 'Failed to detect and setup output from files:', e);
    return { outputHandle: null, displayName: '', hasExistingOutput: false };
  }
}

/**
 * Set up _output folder in a given directory
 */
async function setupOutputInDirectory(inputHandle: FileSystemDirectoryHandle): Promise<{
  outputHandle: FileSystemDirectoryHandle | null;
  displayName: string;
  hasExistingOutput: boolean;
}> {
  let outputHandle: FileSystemDirectoryHandle | null = null;
  let hasExistingOutput = false;

  try {
    outputHandle = await inputHandle.getDirectoryHandle('_output');
    hasExistingOutput = true;
    debugController.log('FileSystem', 'Found existing _output folder');
  } catch {
    outputHandle = await setupOutputFolder(inputHandle);
    debugController.log('FileSystem', 'Created new _output folder');
  }

  const displayName = `${inputHandle.name}/_output`;
  return { outputHandle, displayName, hasExistingOutput };
}

/**
 * Check if a directory contains an _output subfolder
 */
export async function checkForExistingOutputFolder(files: File[]): Promise<{
  hasOutputFolder: boolean;
  topLevelDir?: string;
}> {
  try {
    // Check if any file path contains _output at the top level
    const topLevelDirs = new Set<string>();
    const hasOutputFolder = false;
    let topLevelDir: string | undefined;

    for (const file of files) {
      const path = getFilePath(file);
      const pathParts = path.split('/');
      
      if (pathParts.length > 1) {
        const topDir = pathParts[0];
        topLevelDirs.add(topDir);
        
        // Store the first top-level directory name
        if (!topLevelDir) {
          topLevelDir = topDir;
        }
      }
    }

    // If we have a common top-level directory, we might be able to detect _output
    debugController.log('FileSystem', 'Top-level directories detected:', Array.from(topLevelDirs));
    debugController.log('FileSystem', 'Primary directory:', topLevelDir);

    return {
      hasOutputFolder,
      topLevelDir
    };
  } catch (e) {
    console.warn('[FileSystem] Failed to check for existing output folder:', e);
    return { hasOutputFolder: false };
  }
}

/**
 * Enhanced directory picker that automatically sets up _output folder
 * and checks for existing _output folders
 */
export async function autoDetectAndSetupOutputFolder(): Promise<{
  inputHandle: FileSystemDirectoryHandle | null;
  outputHandle: FileSystemDirectoryHandle | null;
  hasExistingOutput: boolean;
}> {
  try {
    const extendedWindow = getExtendedWindow();
    if (!extendedWindow?.showDirectoryPicker) {
      console.warn('[FileSystem] Directory picker not supported');
      return { inputHandle: null, outputHandle: null, hasExistingOutput: false };
    }

    const inputHandle = await extendedWindow.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'desktop' // Start from desktop instead of downloads
    });

    debugController.log('FileSystem', 'Input directory selected:', inputHandle.name);
    
    // Check if _output folder already exists
    let hasExistingOutput = false;
    let outputHandle: FileSystemDirectoryHandle | null = null;
    
    try {
      outputHandle = await inputHandle.getDirectoryHandle('_output');
      hasExistingOutput = true;
      debugController.log('FileSystem', 'Found existing _output folder');
    } catch {
      // _output doesn't exist, create it
      outputHandle = await setupOutputFolder(inputHandle);
      debugController.log('FileSystem', 'Created new _output folder');
    }
    
    return {
      inputHandle,
      outputHandle,
      hasExistingOutput
    };
  } catch (e) {
    debugController.log('FileSystem', 'Directory selection cancelled:', e);
    return { inputHandle: null, outputHandle: null, hasExistingOutput: false };
  }
}

/**
 * Create or get the _output subdirectory from an input folder handle
 */
export async function setupOutputFolder(inputFolderHandle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  try {
    const outputHandle = await inputFolderHandle.getDirectoryHandle('_output', { create: true });
    debugController.log('FileSystem', 'Created/found _output folder in:', inputFolderHandle.name);
    return outputHandle;
  } catch (e) {
    console.warn('[FileSystem] Failed to create _output folder:', e);
    return null;
  }
}

/**
 * Enhanced directory picker with _output folder auto-creation
 */
export async function enhancedDirectoryPicker(suggestedName?: string): Promise<{
  inputHandle: FileSystemDirectoryHandle | null;
  outputHandle: FileSystemDirectoryHandle | null;
}> {
  try {
    const extendedWindow = getExtendedWindow();
    if (!extendedWindow?.showDirectoryPicker) {
      console.warn('[FileSystem] Directory picker not supported');
      return { inputHandle: null, outputHandle: null };
    }

    const options: DirectoryPickerOptions & { suggestedName?: string } = { 
      mode: 'readwrite',
      startIn: 'desktop' // Start from desktop for better user experience
    };

    if (suggestedName) {
      options.suggestedName = suggestedName;
    }

    const inputHandle = await extendedWindow.showDirectoryPicker(options);
    console.log('[FileSystem] Input directory selected:', inputHandle.name);
    
    // Try to create _output subfolder
    const outputHandle = await setupOutputFolder(inputHandle);
    
    return {
      inputHandle,
      outputHandle: outputHandle || inputHandle // Fallback to input folder
    };
  } catch (e) {
    console.log('[FileSystem] Directory selection cancelled:', e);
    return { inputHandle: null, outputHandle: null };
  }
}
