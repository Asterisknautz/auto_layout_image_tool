/**
 * Enhanced File System Access API utilities for _output folder management
 */

import { debugController } from './debugMode';

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
    let hasOutputFolder = false;
    let topLevelDir: string | undefined;

    for (const file of files) {
      const path = (file as any).path || file.name;
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
    if (!('showDirectoryPicker' in window)) {
      console.warn('[FileSystem] Directory picker not supported');
      return { inputHandle: null, outputHandle: null, hasExistingOutput: false };
    }

    const inputHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads'
    });

    debugController.log('FileSystem', 'Input directory selected:', inputHandle.name);
    
    // Check if _output folder already exists
    let hasExistingOutput = false;
    let outputHandle: FileSystemDirectoryHandle | null = null;
    
    try {
      outputHandle = await inputHandle.getDirectoryHandle('_output');
      hasExistingOutput = true;
      debugController.log('FileSystem', 'Found existing _output folder');
    } catch (e) {
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
    if (!('showDirectoryPicker' in window)) {
      console.warn('[FileSystem] Directory picker not supported');
      return { inputHandle: null, outputHandle: null };
    }

    const options: any = { 
      mode: 'readwrite',
      startIn: 'downloads'
    };

    if (suggestedName) {
      options.suggestedName = suggestedName;
    }

    const inputHandle = await (window as any).showDirectoryPicker(options);
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