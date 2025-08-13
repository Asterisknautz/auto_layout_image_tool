import { useEffect, useRef, useState } from 'react';
import { makeZip } from '../utils/zip';
import { autoDetectAndSetupOutputFolder } from '../utils/fileSystem';
import { debugController } from '../utils/debugMode';
import type { ComposePayload } from './CanvasEditor';
import type { ResizeSpec } from '../worker/opencv';
import { useProfiles } from '../context/ProfilesContext';

interface OutputProfile {
  sizes: ResizeSpec[];
  exportPsd?: boolean;
}

type OutputProfiles = Record<string, OutputProfile>;

interface OutputPanelProps {
  worker?: Worker;
  payload?: ComposePayload;
  onProfileChange?: (profileName: string) => void;
}

export default function OutputPanel({ worker, payload, onProfileChange }: OutputPanelProps) {
  const { config } = useProfiles();
  const profiles = config.profiles as unknown as OutputProfiles;
  const [selected, setSelected] = useState<string>('');
  
  debugController.log('OutputPanel', 'Config loaded:', config);
  debugController.log('OutputPanel', 'Profiles:', profiles);
  debugController.log('OutputPanel', 'Profile keys:', Object.keys(profiles || {}));

  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>([]);
  const filesForZip = useRef<{ name: string; blob: Blob }[]>([]);
  const dirHandleRef = useRef<any | null>(null);
  const [autoSave, setAutoSave] = useState(false);
  const [dirName, setDirName] = useState('');

  // Load saved directory handle on mount and check for global handle
  useEffect(() => {
    const loadSavedHandle = async () => {
      // Check if Dropzone has already set up a handle
      if ((window as any).autoSaveHandle) {
        dirHandleRef.current = (window as any).autoSaveHandle;
        const folderName = dirHandleRef.current.name || '';
        setDirName(folderName);
        setAutoSave(true);
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
          setAutoSave(true);
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
      debugController.log('OutputPanel', 'Received auto-save setup event:', displayName);
      
      dirHandleRef.current = outputHandle;
      setDirName(displayName);
      setAutoSave(true);
    };
    
    const checkGlobalHandle = () => {
      if ((window as any).autoSaveHandle && !dirHandleRef.current) {
        dirHandleRef.current = (window as any).autoSaveHandle;
        const folderName = dirHandleRef.current.name || '';
        setDirName(folderName);
        setAutoSave(true);
        debugController.log('OutputPanel', 'Received handle from Dropzone:', folderName);
      }
    };

    window.addEventListener('autoSaveSetup', handleAutoSaveSetup);
    const interval = setInterval(checkGlobalHandle, 100);
    
    return () => {
      window.removeEventListener('autoSaveSetup', handleAutoSaveSetup);
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
        alert('このブラウザはフォルダ保存に対応していません（ZIP保存をご利用ください）');
        return;
      }

      // Use smart directory picker with automatic _output detection
      const { inputHandle, outputHandle, hasExistingOutput } = await autoDetectAndSetupOutputFolder();
      
      if (!inputHandle || !outputHandle) {
        debugController.log('OutputPanel', 'Directory selection cancelled');
        return;
      }

      // Set the output handle as the primary directory handle
      dirHandleRef.current = outputHandle;
      (window as any).autoSaveHandle = outputHandle; // Also set globally
      
      // Update UI with appropriate folder name
      const displayName = `${inputHandle.name}/_output`;
      
      setDirName(displayName);
      setAutoSave(true);
      
      // Save to localStorage for next time
      localStorage.setItem('imagetool.autoSave.dirName', displayName);
      localStorage.setItem('imagetool.autoSave.enabled', 'true');
      
      debugController.log('OutputPanel', 'Smart auto-save configured:', {
        input: inputHandle.name,
        output: outputHandle.name,
        hadExistingOutput: hasExistingOutput
      });
      
      if (hasExistingOutput) {
        debugController.log('OutputPanel', 'Using existing _output folder');
      } else {
        debugController.log('OutputPanel', 'Created new _output folder');
      }
      
    } catch (e) {
      debugController.log('OutputPanel', 'Enhanced directory selection failed:', e);
    }
  };

  // Ensure directory handle is available for writing
  const ensureDirectoryHandle = async (): Promise<boolean> => {
    debugController.log('OutputPanel', 'ensureDirectoryHandle called', {
      hasCurrentHandle: !!dirHandleRef.current,
      hasAutoSaveHandle: !!((window as any).autoSaveHandle),
      autoSaveEnabled: autoSave
    });

    if (dirHandleRef.current) {
      debugController.log('OutputPanel', 'Using existing handle:', dirHandleRef.current.name);
      return true; // Already have a handle
    }

    // Check if auto-save handle is available from Dropzone
    if ((window as any).autoSaveHandle) {
      dirHandleRef.current = (window as any).autoSaveHandle;
      debugController.log('OutputPanel', 'Using auto-save handle from Dropzone:', dirHandleRef.current.name);
      return true;
    }

    // No handle available - auto-save is not properly configured
    debugController.log('OutputPanel', 'No directory handle available for auto-save');
    return false;
  };

  async function writeFile(filename: string, blob: Blob) {
    debugController.log('OutputPanel', 'writeFile called:', filename, 'autoSave:', autoSave);
    
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
        const entries: { name: string; url: string }[] = [];
        const images: Record<string, ImageBitmap> = data.images || {};
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
          // Always add to ZIP array for later download
          filesForZip.current.push({ name: `${name}.png`, blob });
          
          if (autoSave) {
            await writeFile(`${name}.png`, blob);
          } else {
            const url = URL.createObjectURL(blob);
            entries.push({ name, url });
          }
        }
        const psd: Blob | null = data.psd || null;
        if (psd) {
          // Always add to ZIP array for later download
          filesForZip.current.push({ name: 'document.psd', blob: psd });
          
          if (autoSave) {
            await writeFile('document.psd', psd);
          } else {
            entries.push({ name: 'document.psd', url: URL.createObjectURL(psd) });
          }
        }
        if (entries.length) setDownloads(entries);
      } else if (data?.type === 'composeMany') {
        debugController.log('OutputPanel', 'Received composeMany result:', data);
        
        const entries: { name: string; url: string }[] = [];
        const outs: Array<{ filename: string; image: ImageBitmap; psd?: Blob; png?: Blob; formats?: string[] }> = data.outputs || [];
        debugController.log('OutputPanel', 'Processing outputs:', outs.length);
        for (const o of outs) {
          const formats = o.formats || ['jpg']; // Default to JPG if no formats specified
          debugController.log('OutputPanel', `Processing "${o.filename}" with formats:`, formats);
          
          // Generate JPG only if explicitly requested
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
            filesForZip.current.push({ name: jpgFilename, blob: jpgBlob });
            debugController.log('OutputPanel', 'Added JPG to ZIP:', jpgFilename);
            
            if (autoSave && dirHandleRef.current) {
              await writeFile(jpgFilename, jpgBlob);
            } else {
              const url = URL.createObjectURL(jpgBlob);
              entries.push({ name: jpgFilename, url });
            }
          }
          
          // Handle PNG file if available and requested
          if (o.png && formats.includes('png')) {
            const pngFilename = `${o.filename}.png`;
            filesForZip.current.push({ name: pngFilename, blob: o.png });
            debugController.log('OutputPanel', 'Added PNG to ZIP:', pngFilename);
            
            if (autoSave && dirHandleRef.current) {
              await writeFile(pngFilename, o.png);
            } else {
              const pngUrl = URL.createObjectURL(o.png);
              entries.push({ name: pngFilename, url: pngUrl });
            }
          }
          
          // Handle PSD file if available and requested
          if (o.psd && formats.includes('psd')) {
            const psdFilename = `${o.filename}.psd`;
            filesForZip.current.push({ name: psdFilename, blob: o.psd });
            debugController.log('OutputPanel', 'Added PSD to ZIP:', psdFilename);
            
            if (autoSave && dirHandleRef.current) {
              await writeFile(psdFilename, o.psd);
            } else {
              const psdUrl = URL.createObjectURL(o.psd);
              entries.push({ name: psdFilename, url: psdUrl });
            }
          }
        }
        if (entries.length) setDownloads((prev) => [...prev, ...entries]);
      }
    };
    if (!worker) return;
    worker.addEventListener('message', handler);
    return () => worker?.removeEventListener('message', handler);
  }, [worker, autoSave]);

  const handleRun = () => {
    if (!payload) return;
    const profile = profiles[selected];
    debugController.log('OutputPanel', 'handleRun - selected:', selected, 'profile:', profile);
    if (!profile) return;
    const composePayload: ComposePayload = {
      ...payload,
      sizes: profile.sizes,
      exportPsd: profile.exportPsd ?? payload.exportPsd,
    };
    debugController.log('OutputPanel', 'handleRun - composePayload:', composePayload);
    if (!worker) return;
    worker.postMessage({ type: 'compose', payload: composePayload });
  };

  // Handler for single image mode "Save Changes" button
  const handleSaveChanges = async () => {
    if (!payload) return;
    
    // Ensure auto-save is enabled and directory is set up
    if (!autoSave || !dirHandleRef.current) {
      // If no directory is set, prompt for one
      if (!dirHandleRef.current) {
        await pickDirectory();
        if (!dirHandleRef.current) {
          alert('保存するにはフォルダを選択してください');
          return;
        }
      }
      // Enable auto-save
      setAutoSave(true);
      localStorage.setItem('imagetool.autoSave.enabled', 'true');
    }
    
    // Process the image with current settings
    handleRun();
  };

  const handleZipAll = async () => {
    debugController.log('OutputPanel', 'ZIP button clicked, files:', filesForZip.current.length);
    if (filesForZip.current.length === 0) {
      console.warn('[OutputPanel] No files in ZIP array');
      return;
    }
    try {
      // convert blobs to Uint8Array and build zip
      const items = await Promise.all(
        filesForZip.current.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))
      );
      debugController.log('OutputPanel', 'Prepared ZIP items:', items.length);
      const zipBlob = await makeZip(items);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'outputs.zip';
      a.click();
      debugController.log('OutputPanel', 'ZIP download triggered');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error('[OutputPanel] ZIP creation failed:', e);
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
        <div><strong>Files in ZIP:</strong> {filesForZip.current.length}</div>
        <div><strong>Downloads:</strong> {downloads.length}</div>
      </div>
    );
  };
  
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={pickDirectory}>
          {dirName && dirHandleRef.current ? '出力フォルダを変更' : '出力フォルダを選択'}
        </button>
        {!isSingleImageMode && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={autoSave} onChange={(e) => {
              const enabled = e.target.checked;
              setAutoSave(enabled);
              localStorage.setItem('imagetool.autoSave.enabled', enabled.toString());
              debugController.log('OutputPanel', 'Auto-save toggled:', enabled);
            }} disabled={!dirName} />
            自動保存
          </label>
        )}
        {dirName && (
          <span style={{ fontSize: 12, color: dirHandleRef.current ? '#555' : '#f39c12' }}>
            📁 {dirName} {!dirHandleRef.current && autoSave && '(処理時に確認)'}
          </span>
        )}
        {dirName && !dirHandleRef.current && (
          <button 
            onClick={pickDirectory} 
            style={{ fontSize: 11, padding: '2px 6px', marginLeft: 4 }}
          >
            再選択
          </button>
        )}
      </div>
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
      {isSingleImageMode ? (
        <button onClick={handleSaveChanges} style={{ backgroundColor: '#28a745', color: 'white', marginLeft: 8 }}>
          反映を保存
        </button>
      ) : (
        <button onClick={handleRun}>Run</button>
      )}
      {!isSingleImageMode && (
        <button onClick={handleZipAll} disabled={filesForZip.current.length === 0} style={{ marginLeft: 8 }}>すべてZIPで保存</button>
      )}
      {!isSingleImageMode && downloads.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {downloads.map((d, index) => (
            <div key={`${d.name}-${index}-${d.url.slice(-8)}`}>
              <a href={d.url} download={d.name}>{d.name}</a>
            </div>
          ))}
        </div>
      )}
      <DebugInfo />
    </div>
  );
}
