/**
 * Enhanced File System Access API utilities for _output folder management
 */

/**
 * Create or get the _output subdirectory from an input folder handle
 */
export async function setupOutputFolder(inputFolderHandle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  try {
    const outputHandle = await inputFolderHandle.getDirectoryHandle('_output', { create: true });
    console.log('[FileSystem] Created/found _output folder in:', inputFolderHandle.name);
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