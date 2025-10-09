import { useCallback, useEffect, useRef, useState } from 'react';
import { debugController } from '../utils/debugMode';
import { outputRootManager } from '../utils/outputRootManager';
import { useProfiles } from '../context/ProfilesContext';
import type { ComposePayload } from './CanvasEditor';
import type { AutoSaveRequestDetail, AutoSaveSetupDetail, WorkerResponseMessage } from '../types/worker';

async function renderBitmapToBlob(
  image: ImageBitmap,
  options: ImageEncodeOptions = { type: 'image/png' }
): Promise<Blob> {
  const { type = 'image/png', quality } = options;
  const offscreen = new OffscreenCanvas(image.width, image.height);
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to obtain 2D context');
  }
  ctx.drawImage(image, 0, 0);

  if (typeof offscreen.convertToBlob === 'function') {
    return offscreen.convertToBlob({ type, quality });
  }

  const fallback = document.createElement('canvas');
  fallback.width = image.width;
  fallback.height = image.height;
  const fallbackCtx = fallback.getContext('2d');
  if (!fallbackCtx) {
    throw new Error('Fallback canvas context unavailable');
  }
  fallbackCtx.drawImage(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => fallback.toBlob(resolve, type, quality));
  if (!blob) {
    throw new Error('Failed to generate blob');
  }
  return blob;
}

type ComposeMessage = Extract<WorkerResponseMessage, { type: 'compose' }>;
type ComposeManyMessage = Extract<WorkerResponseMessage, { type: 'composeMany' }>;

interface OutputPanelProps {
  worker?: Worker;
  payload?: ComposePayload;
  onShowToast?: (message: string) => void;
}

export default function OutputPanel({
  worker,
  payload,
  onShowToast
}: OutputPanelProps) {
  const { config } = useProfiles();

  debugController.log('OutputPanel', 'Config loaded:', config);

  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [autoSave] = useState(true); // Always enabled for simplified UI
  const [dirName, setDirName] = useState('');

  // Load saved directory handle on mount and check for global handle
  useEffect(() => {
    const loadSavedHandle = async () => {
      // Check if Dropzone has already set up a handle
      if (window.autoSaveHandle) {
        dirHandleRef.current = window.autoSaveHandle;
        const folderName = dirHandleRef.current.name || '';
        setDirName(folderName);
        debugController.log('OutputPanel', 'Using handle from Dropzone:', folderName);
        return;
      }


      const savedDirName = localStorage.getItem('imagetool.autoSave.dirName');
      const wasAutoSaveEnabled = localStorage.getItem('imagetool.autoSave.enabled') === 'true';
      
      if (savedDirName) {
        setDirName(savedDirName);
        debugController.log('OutputPanel', 'Restored saved directory name:', savedDirName);
        
        // If auto-save was enabled before, restore that state (will prompt for folder when needed)
        if (wasAutoSaveEnabled) {
            debugController.log('OutputPanel', 'Auto-save was previously enabled - restored state');
        }
      }
    };
    
    loadSavedHandle();
  }, []);

  // Function to prompt for directory selection when needed (currently unused)
  // const _promptDirectoryIfNeeded = async () => {
  //   const savedDirName = localStorage.getItem('imagetool.autoSave.dirName');
  //   const wasAutoSaveEnabled = localStorage.getItem('imagetool.autoSave.enabled') === 'true';
  //   
  //   if (savedDirName && wasAutoSaveEnabled && !dirHandleRef.current && 'showDirectoryPicker' in window) {
  //     console.log('[OutputPanel] Auto-prompting for directory re-selection...');
  //     
  //     if (confirm(`前回使用したフォルダ「${savedDirName}」に自動保存しますか？`)) {
  //       await pickDirectory();
  //       return true; // Directory was selected
  //     } else {
  //       // User declined, disable auto-save for this session
  //       setAutoSave(false);
  //       return false;
  //     }
  //   }
  //   return dirHandleRef.current !== null; // Return whether we have a valid handle
  // };




  // Ensure directory handle is available for writing
  const ensureDirectoryHandle = useCallback(async (): Promise<boolean> => {
    debugController.log('OutputPanel', 'ensureDirectoryHandle called', {
      hasCurrentHandle: !!dirHandleRef.current,
      hasAutoSaveHandle: window.autoSaveHandle != null,
      autoSaveEnabled: autoSave,
      currentHandleName: dirHandleRef.current?.name,
      autoSaveHandleName: window.autoSaveHandle?.name
    });

    // 1. 既存のハンドルがある場合はそれを使用
    if (dirHandleRef.current) {
      debugController.log('OutputPanel', 'Using existing handle:', dirHandleRef.current.name);
      return true;
    }

    // 2. グローバルハンドルをチェック
    if (window.autoSaveHandle) {
      dirHandleRef.current = window.autoSaveHandle;
      debugController.log('OutputPanel', 'Using auto-save handle from global:', dirHandleRef.current.name);
      return true;
    }

    // 3. outputRootManagerから取得を試行
    try {
      const projectHandle = outputRootManager.getCurrentProjectHandle();
      if (projectHandle) {
        dirHandleRef.current = projectHandle;
        const projectInfo = outputRootManager.getCurrentProjectInfo();
        debugController.log('OutputPanel', 'Using project handle from outputRootManager:', projectInfo.name);
        return true;
      }
    } catch (error) {
      debugController.log('OutputPanel', 'Failed to get handle from outputRootManager:', error);
    }

    console.warn('[OutputPanel] No directory handle available for auto-save');
    return false;
  }, [autoSave]);

  type WriteFileOptions = {
    ext?: string;
    groupByFormat?: boolean;
  };

  const writeFile = useCallback(async (filename: string, blob: Blob, options?: WriteFileOptions) => {
    debugController.log('OutputPanel', 'writeFile called:', filename, 'autoSave:', autoSave);
    debugController.log('OutputPanel', 'Pre-writeFile handle state:', {
      dirHandleRef: !!dirHandleRef.current,
      dirHandleRefName: dirHandleRef.current?.name,
      autoSaveHandle: window.autoSaveHandle != null,
      autoSaveHandleName: window.autoSaveHandle?.name
    });
    
    if (!autoSave) {
      debugController.log('OutputPanel', 'Auto-save disabled, skipping write');
      return false;
    }

    const hasHandle = await ensureDirectoryHandle();
    if (!hasHandle) {
      console.warn('[OutputPanel] No directory handle available for:', filename);
      return false;
    }

    const handle = dirHandleRef.current;
    if (!handle) {
      console.warn('[OutputPanel] Directory handle is null after ensureDirectoryHandle');
      return false;
    }

    const sanitizedSegmentsFromName = filename.split('/').map((segment) => segment.trim()).filter(Boolean);
    const { ext, groupByFormat } = options ?? {};

    let segments = sanitizedSegmentsFromName;
    if (groupByFormat && ext) {
      const normalizedExt = ext.trim();
      if (normalizedExt.length) {
        if (segments.length === 0 || segments[0].toLowerCase() !== normalizedExt.toLowerCase()) {
          segments = [normalizedExt, ...segments];
        }
      }
    }

    if (segments.length === 0) {
      console.warn('[OutputPanel] Invalid filename provided:', filename);
      return false;
    }

    const pathSegments = [...segments];
    const leafName = pathSegments.pop()!;

    try {
      let targetDir = handle;
      for (const segment of pathSegments) {
        debugController.log('OutputPanel', 'Ensuring subdirectory:', segment);
        targetDir = await targetDir.getDirectoryHandle(segment, { create: true });
      }

      debugController.log('OutputPanel', 'Creating file handle for:', leafName, 'in path:', pathSegments.join('/'));
      const fileHandle = await targetDir.getFileHandle(leafName, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(blob);
      await stream.close();
      debugController.log('OutputPanel', 'Successfully saved:', filename);

      // Remove stale root-level file when grouping by format
      if (groupByFormat && ext) {
        try {
          await handle.removeEntry(leafName);
          debugController.log('OutputPanel', 'Removed root-level file after grouped save:', leafName);
        } catch (removeError) {
          debugController.log('OutputPanel', 'No root-level file to remove (or removal failed):', {
            leafName,
            error: removeError instanceof Error ? removeError.message : String(removeError)
          });
        }
      }
      return true;
    } catch (e) {
      console.warn('[OutputPanel] Failed to save', filename, e);
      debugController.log('OutputPanel', 'Save error details:', {
        filename,
        hasHandle: !!handle,
        handleName: handle?.name || 'unknown',
        error: e
      });
      return false;
    }
  }, [autoSave, ensureDirectoryHandle]);

  // Listen for auto-save setup events and check for global handle
  useEffect(() => {
    const handleAutoSaveSetup = (event: CustomEvent<AutoSaveSetupDetail>) => {
      const { displayName, outputHandle } = event.detail;
      debugController.log('OutputPanel', 'Received auto-save setup event:', {
        displayName,
        hasOutputHandle: !!outputHandle,
        outputHandleName: outputHandle?.name
      });
      
      dirHandleRef.current = outputHandle;
      setDirName(displayName);
      
      // Also set global handle for consistency
      window.autoSaveHandle = outputHandle;
      
      debugController.log('OutputPanel', 'Auto-save setup completed:', {
        dirHandleRefSet: !!dirHandleRef.current,
        globalHandleSet: window.autoSaveHandle != null,
        dirName: displayName
      });
    };
    
    const handleAutoSaveRequest = async (event: CustomEvent<AutoSaveRequestDetail>) => {
      const { images, psd, source } = event.detail;
      debugController.log('OutputPanel', 'Received auto-save request:', {
        source,
        imageCount: Object.keys(images || {}).length,
        hasPsd: !!psd
      });
      
      if (!images || !dirHandleRef.current) {
        debugController.log('OutputPanel', 'Auto-save skipped: no images or directory handle');
        return;
      }
      
      try {
        let savedCount = 0;
        for (const [name, imageBitmap] of Object.entries(images)) {
          if (!(imageBitmap instanceof ImageBitmap)) continue;
          
          const filename = `${name}.jpg`;
          const blob = await renderBitmapToBlob(imageBitmap, { type: 'image/jpeg', quality: 0.9 });
          if (await writeFile(filename, blob)) {
            savedCount++;
          }
        }
        
        debugController.log('OutputPanel', 'Auto-save completed:', {
          savedCount,
          totalImages: Object.keys(images).length
        });
      } catch (error) {
        debugController.log('OutputPanel', 'Auto-save failed:', error);
      }
    };
    
    const checkGlobalHandle = () => {
      if (window.autoSaveHandle && !dirHandleRef.current) {
        dirHandleRef.current = window.autoSaveHandle;
        const folderName = dirHandleRef.current.name || '';
        setDirName(folderName);
        debugController.log('OutputPanel', 'Received handle from Dropzone:', folderName);
      }
    };

    window.addEventListener('autoSaveSetup', handleAutoSaveSetup);
    window.addEventListener('autoSaveRequest', handleAutoSaveRequest);
    const interval = setInterval(checkGlobalHandle, 100);
    
    return () => {
      window.removeEventListener('autoSaveSetup', handleAutoSaveSetup);
      window.removeEventListener('autoSaveRequest', handleAutoSaveRequest);
      clearInterval(interval);
    };
  }, [writeFile]);

  const processComposeMessage = useCallback(
    async (message: ComposeMessage) => {
      const images = message.images ?? {};
      let filesProcessed = 0;

      for (const [name, bitmap] of Object.entries(images)) {
        const blob = await renderBitmapToBlob(bitmap);
        if (await writeFile(`${name}.png`, blob)) {
          filesProcessed += 1;
        }
      }

      if (message.psd && (await writeFile('document.psd', message.psd))) {
        filesProcessed += 1;
      }

      if (onShowToast && filesProcessed > 0) {
        onShowToast(`${filesProcessed}個のファイルを保存しました`);
      }
    },
    [onShowToast, writeFile]
  );

  const processComposeManyMessage = useCallback(
    async (message: ComposeManyMessage) => {
      const outputs = message.outputs ?? [];
      for (const output of outputs) {
        const formats = output.formats ?? ['jpg'];

        const groupByFormat = Boolean(output.groupByFormat);
        if (formats.includes('jpg')) {
          const jpgBlob = await renderBitmapToBlob(output.image, { type: 'image/jpeg' });
          await writeFile(`${output.filename}.jpg`, jpgBlob, {
            ext: 'jpg',
            groupByFormat
          });
        }

        if (output.png && formats.includes('png')) {
          await writeFile(`${output.filename}.png`, output.png, {
            ext: 'png',
            groupByFormat
          });
        }

        if (output.psd && formats.includes('psd')) {
          await writeFile(`${output.filename}.psd`, output.psd, {
            ext: 'psd',
            groupByFormat
          });
        }
      }

      if (onShowToast) {
        onShowToast(`バッチ処理完了：${outputs.length}個のファイルを書き出しました`);
      }
    },
    [onShowToast, writeFile]
  );

  useEffect(() => {
    if (!worker) return;

    const handler = (event: Event) => {
      const message = event as MessageEvent<WorkerResponseMessage>;
      const data = message.data;
      if (!data) return;

      debugController.log('OutputPanel', 'Received worker message:', data.type);

      if (data.type === 'compose') {
        void processComposeMessage(data);
      } else if (data.type === 'composeMany') {
        void processComposeManyMessage(data);
      }
    };

    worker.addEventListener('message', handler);
    return () => {
      worker.removeEventListener('message', handler);
    };
  }, [worker, processComposeMessage, processComposeManyMessage]);





  const isSingleImageMode = !!payload;
  
  // Debug info component  
  const DebugInfo = () => {
    if (!debugController.shouldShowProfileDebugInfo()) return null;

    return (
      <div style={{ 
        marginTop: 8, 
        padding: 8, 
        backgroundColor: '#f0f0f0', 
        borderRadius: 4, 
        fontSize: 11,
        fontFamily: 'monospace'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#1976D2' }}>
          🐛 Output Debug Info
        </div>
        <div><strong>Mode:</strong> {isSingleImageMode ? 'Single Image' : 'Batch'}</div>
        <div><strong>Auto-save:</strong> {autoSave ? 'Enabled' : 'Disabled'}</div>
        <div><strong>Dir Handle:</strong> {dirHandleRef.current ? 'Available' : 'None'}</div>
        <div><strong>Dir Name:</strong> {dirName || '未選択'}</div>
        <div><strong>Available Profiles:</strong> {Object.keys(config.profiles || {}).length}</div>
      </div>
    );
  };
  
  return (
    <div>
      <DebugInfo />
    </div>
  );
}
