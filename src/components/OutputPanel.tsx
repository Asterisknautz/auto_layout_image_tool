import { useEffect, useRef, useState, useMemo } from 'react';
// import { autoDetectAndSetupOutputFolder } from '../utils/fileSystem'; // Not used in new system
import { debugController } from '../utils/debugMode';
import { outputRootManager } from '../utils/outputRootManager';
import type { ComposePayload } from './CanvasEditor';
import { useProfiles } from '../context/ProfilesContext';
import { FileExportService, type OutputProfile, type IFileWriteService, type IWorkerService } from '../services/FileExportService';

type OutputProfiles = Record<string, OutputProfile>;

interface OutputPanelProps {
  worker?: Worker;
  payload?: ComposePayload;
  onProfileChange?: (profileName: string) => void;
  onShowToast?: (message: string) => void;
  onSaveChanges?: (newBBox: [number, number, number, number]) => void;
}

export default function OutputPanel({ 
  worker, 
  payload, 
  onProfileChange,
  onShowToast,
  onSaveChanges 
}: OutputPanelProps) {
  const { config } = useProfiles();
  const profiles = config.profiles as unknown as OutputProfiles;
  const [selected, setSelected] = useState<string>('');
  
  debugController.log('OutputPanel', 'Config loaded:', config);
  debugController.log('OutputPanel', 'Profiles:', profiles);
  debugController.log('OutputPanel', 'Profile keys:', Object.keys(profiles || {}));

  // Service implementations for FileExportService
  const fileWriteService = useMemo<IFileWriteService>(() => ({
    async writeFile(filename: string, blob: Blob): Promise<boolean> {
      return writeFile(filename, blob);
    },
    async ensureDirectoryHandle(): Promise<boolean> {
      return ensureDirectoryHandle();
    }
  }), []);

  const workerService = useMemo<IWorkerService>(() => ({
    postMessage(message: any): void {
      if (worker) {
        worker.postMessage(message);
      }
    }
  }), [worker]);

  const fileExportService = useMemo(() => 
    new FileExportService(fileWriteService, workerService), 
    [fileWriteService, workerService]
  );

  const dirHandleRef = useRef<any | null>(null);
  const [autoSave] = useState(true); // Always enabled for simplified UI
  const [dirName, setDirName] = useState('');

  // Load saved directory handle on mount and check for global handle
  useEffect(() => {
    const loadSavedHandle = async () => {
      // Check if Dropzone has already set up a handle
      if ((window as any).autoSaveHandle) {
        dirHandleRef.current = (window as any).autoSaveHandle;
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

  // Listen for auto-save setup events and check for global handle
  useEffect(() => {
    const handleAutoSaveSetup = (event: any) => {
      const { displayName, outputHandle } = event.detail;
      debugController.log('OutputPanel', 'Received auto-save setup event:', {
        displayName,
        hasOutputHandle: !!outputHandle,
        outputHandleName: outputHandle?.name
      });
      
      dirHandleRef.current = outputHandle;
      setDirName(displayName);
      
      // Also set global handle for consistency
      (window as any).autoSaveHandle = outputHandle;
      
      debugController.log('OutputPanel', 'Auto-save setup completed:', {
        dirHandleRefSet: !!dirHandleRef.current,
        globalHandleSet: !!((window as any).autoSaveHandle),
        dirName: displayName
      });
    };
    
    // 🚀 NEW: Handle auto-save requests from CanvasEditor adjustments
    const handleAutoSaveRequest = async (event: any) => {
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
      
      // Auto-save the processed images
      try {
        let savedCount = 0;
        for (const [name, imageBitmap] of Object.entries(images)) {
          if (!(imageBitmap instanceof ImageBitmap)) continue;
          
          const filename = `${name}.jpg`;
          const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(imageBitmap, 0, 0);
          const blob = await (canvas as any).convertToBlob?.({ 
            type: 'image/jpeg', 
            quality: 0.9 
          });
          
          if (blob && await writeFile(filename, blob)) {
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
      if ((window as any).autoSaveHandle && !dirHandleRef.current) {
        dirHandleRef.current = (window as any).autoSaveHandle;
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

  useEffect(() => {
    const keys = Object.keys(profiles || {});
    if (keys.length && !selected) {
      const firstKey = keys[0];
      setSelected(firstKey);
      onProfileChange?.(firstKey);
    }
  }, [profiles, selected, onProfileChange]);

  const pickDirectory = async () => {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('このブラウザはフォルダ保存に対応していません');
        return;
      }

      debugController.log('OutputPanel', 'Setting up output root...');
      
      const setupResult = await outputRootManager.setupOutputRoot();
      
      if (setupResult.success) {
        const rootInfo = outputRootManager.getOutputRootInfo();
        setDirName(rootInfo.name);
        debugController.log('OutputPanel', 'Output root set successfully:', rootInfo.name);
        
        // Clear current handle since it's now managed by outputRootManager
        dirHandleRef.current = null;
        (window as any).autoSaveHandle = null;
      } else {
        debugController.log('OutputPanel', 'Failed to setup output root');
      }
    } catch (e) {
      debugController.log('OutputPanel', 'Output root setup failed:', e);
    }
  };

  // Reset output root
  const resetOutputRoot = async () => {
    if (confirm('出力ルートをリセットしますか？\n次回ドラッグ時に再設定が必要になります。\n\n※IndexedDBとグローバル変数をすべてクリアします')) {
      await outputRootManager.resetOutputRoot();
      setDirName('');
      dirHandleRef.current = null;
      (window as any).autoSaveHandle = null;
      
      // IndexedDBを完全にクリア
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
            debugController.log('OutputPanel', 'Deleted IndexedDB:', db.name);
          }
        }
      } catch (error) {
        debugController.log('OutputPanel', 'Failed to clear IndexedDB:', error);
      }
      
      debugController.log('OutputPanel', 'Complete output root reset performed');
      alert('出力ルートをリセットしました。ページをリロードしてください。');
    }
  };

  // Ensure directory handle is available for writing
  const ensureDirectoryHandle = async (): Promise<boolean> => {
    debugController.log('OutputPanel', 'ensureDirectoryHandle called', {
      hasCurrentHandle: !!dirHandleRef.current,
      hasAutoSaveHandle: !!((window as any).autoSaveHandle),
      autoSaveEnabled: autoSave,
      currentHandleName: dirHandleRef.current?.name,
      autoSaveHandleName: (window as any).autoSaveHandle?.name
    });

    // 1. 既存のハンドルがある場合はそれを使用
    if (dirHandleRef.current) {
      debugController.log('OutputPanel', 'Using existing handle:', dirHandleRef.current.name);
      return true;
    }

    // 2. グローバルハンドルをチェック
    if ((window as any).autoSaveHandle) {
      dirHandleRef.current = (window as any).autoSaveHandle;
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
  };

  async function writeFile(filename: string, blob: Blob) {
    debugController.log('OutputPanel', 'writeFile called:', filename, 'autoSave:', autoSave);
    debugController.log('OutputPanel', 'Pre-writeFile handle state:', {
      dirHandleRef: !!dirHandleRef.current,
      dirHandleRefName: dirHandleRef.current?.name,
      autoSaveHandle: !!((window as any).autoSaveHandle),
      autoSaveHandleName: (window as any).autoSaveHandle?.name
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

    try {
      debugController.log('OutputPanel', 'Creating file handle for:', filename);
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(blob);
      await stream.close();
      debugController.log('OutputPanel', 'Successfully saved:', filename);
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
  }

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      const data: any = e.data;
      debugController.log('OutputPanel', 'Received worker message:', data?.type);
      if (data?.type === 'compose') {
        const images: Record<string, ImageBitmap> = data.images || {};
        let filesProcessed = 0;
        
        for (const [name, bmp] of Object.entries(images)) {
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bmp, 0, 0);
          const blob = await (canvas as any).convertToBlob?.() || (await new Promise<Blob>((resolve) => {
            // Fallback for environments without convertToBlob
            const c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height;
            const cx = c.getContext('2d')!; cx.drawImage(bmp, 0, 0);
            c.toBlob((b) => resolve(b!), 'image/png');
          }));
          
          // Always auto-save (simplified UI)
          await writeFile(`${name}.png`, blob);
          filesProcessed++;
        }
        
        const psd: Blob | null = data.psd || null;
        if (psd) {
          await writeFile('document.psd', psd);
          filesProcessed++;
        }
        
        // Show processing completion notification
        if (onShowToast && filesProcessed > 0) {
          onShowToast(`${filesProcessed}個のファイルを保存しました`);
        }
      } else if (data?.type === 'composeMany') {
        debugController.log('OutputPanel', 'Received composeMany result:', data);
        
        const outs: Array<{ filename: string; image: ImageBitmap; psd?: Blob; png?: Blob; formats?: string[] }> = data.outputs || [];
        debugController.log('OutputPanel', 'Processing outputs:', outs.length);
        for (const o of outs) {
          const formats = o.formats || ['jpg']; // Default to JPG if no formats specified
          debugController.log('OutputPanel', `Processing "${o.filename}" with formats:`, formats);
          
          // Generate JPG only if explicitly requested - auto-save only
          if (formats.includes('jpg')) {
            const canvas = new OffscreenCanvas(o.image.width, o.image.height);
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(o.image, 0, 0);
            const jpgBlob = await (canvas as any).convertToBlob?.({ type: 'image/jpeg' }) || (await new Promise<Blob>((resolve) => {
              const c = document.createElement('canvas');
              c.width = o.image.width; c.height = o.image.height;
              const cx = c.getContext('2d')!; cx.drawImage(o.image, 0, 0);
              c.toBlob((b) => resolve(b!), 'image/jpeg');
            }));
            
            const jpgFilename = `${o.filename}.jpg`;
            await writeFile(jpgFilename, jpgBlob);
          }
          
          // Handle PNG file if available and requested - auto-save only
          if (o.png && formats.includes('png')) {
            const pngFilename = `${o.filename}.png`;
            await writeFile(pngFilename, o.png);
          }
          
          // Handle PSD file if available and requested - auto-save only
          if (o.psd && formats.includes('psd')) {
            const psdFilename = `${o.filename}.psd`;
            await writeFile(psdFilename, o.psd);
          }
        }
        
        // Show batch processing completion toast
        if (onShowToast) {
          const totalFiles = outs.length;
          onShowToast(`バッチ処理完了：${totalFiles}個のファイルを書き出しました`);
        }
      }
    };
    if (!worker) return;
    worker.addEventListener('message', handler);
    return () => worker?.removeEventListener('message', handler);
  }, [worker, autoSave]);



  // Note: handleRunAllProfiles functionality is now handled by fileExportService.exportAllProfiles

  // Handler for single image mode "Save Changes" button
  const handleSaveChanges = async () => {
    if (!payload) return;
    
    debugController.log('OutputPanel', 'handleSaveChanges called with payload:', payload);
    
    // Ensure directory is set up for auto-save
    if (!dirHandleRef.current) {
      await pickDirectory();
      if (!dirHandleRef.current) {
        alert('保存するにはフォルダを選択してください');
        return;
      }
    }
    
    try {
      // Use FileExportService to handle bbox changes and export
      const result = await fileExportService.exportWithBboxChanges(
        payload,
        profiles,
        onSaveChanges // Pass the bbox update callback
      );
      
      if (result.success) {
        debugController.log('OutputPanel', 'Save changes export successful');
        // Note: Toast notification is now handled by handleRunAllProfiles
      } else {
        console.error('Save changes export failed:', result.errors);
        if (onShowToast) {
          onShowToast('保存に失敗しました');
        }
      }
    } catch (error) {
      console.error('Unexpected error during save changes:', error);
      if (onShowToast) {
        onShowToast('予期しないエラーが発生しました');
      }
    }
  };


  const isSingleImageMode = !!payload;
  
  // Debug info component
  const DebugInfo = () => {
    if (!debugController.shouldShowProfileDebugInfo()) return null;
    
    const currentProfile = profiles[selected];
    
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
          🐛 Profile Debug Info
        </div>
        <div><strong>Selected:</strong> {selected}</div>
        <div><strong>Available Profiles:</strong> {Object.keys(profiles || {}).length}</div>
        {currentProfile && (
          <>
            <div><strong>Sizes:</strong> {currentProfile.sizes?.length || 0}</div>
            <div><strong>Export PSD:</strong> {currentProfile.exportPsd ? 'Yes' : 'No'}</div>
            {currentProfile.sizes && (
              <div style={{ marginTop: 4 }}>
                <strong>Size Details:</strong>
                <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
                  {currentProfile.sizes.map((size, idx) => (
                    <li key={idx}>
                      {size.name}: {size.width}x{size.height}
                      {size.pad && ` pad:${JSON.stringify(size.pad)}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div><strong>Mode:</strong> {isSingleImageMode ? 'Single Image' : 'Batch'}</div>
        <div><strong>Auto-save:</strong> {autoSave ? 'Enabled' : 'Disabled'}</div>
        <div><strong>Dir Handle:</strong> {dirHandleRef.current ? 'Available' : 'None'}</div>
      </div>
    );
  };
  
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={pickDirectory}>
          {dirName ? '出力ルートを変更' : '出力ルートを選択'}
        </button>
        {dirName && (
          <button onClick={resetOutputRoot} style={{ fontSize: 11, padding: '2px 6px', marginLeft: 4 }}>
            リセット
          </button>
        )}
        {dirName && (
          <span style={{ fontSize: 12, color: '#555' }}>
            📁 出力ルート: {dirName}
          </span>
        )}
      </div>
      {isSingleImageMode && (
        <>
          <select value={selected} onChange={(e) => {
            const newProfile = e.target.value;
            debugController.log('OutputPanel', 'Profile changed to:', newProfile);
            setSelected(newProfile);
            onProfileChange?.(newProfile);
          }}>
            {Object.keys(profiles).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <button onClick={handleSaveChanges} style={{ backgroundColor: '#28a745', color: 'white', marginLeft: 8 }}>
            反映を保存
          </button>
        </>
      )}
      <DebugInfo />
    </div>
  );
}
