import { useEffect, useRef, useState } from 'react';
import { makeZip } from '../utils/zip';
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
}

export default function OutputPanel({ worker, payload }: OutputPanelProps) {
  const { config } = useProfiles();
  const profiles = config.profiles as unknown as OutputProfiles;
  const [selected, setSelected] = useState<string>('');
  
  console.log('[OutputPanel] Config loaded:', config);
  console.log('[OutputPanel] Profiles:', profiles);
  console.log('[OutputPanel] Profile keys:', Object.keys(profiles || {}));

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
        console.log('[OutputPanel] Using handle from Dropzone:', folderName);
        return;
      }

      const savedDirName = localStorage.getItem('imagetool.autoSave.dirName');
      const wasAutoSaveEnabled = localStorage.getItem('imagetool.autoSave.enabled') === 'true';
      
      if (savedDirName) {
        setDirName(savedDirName);
        console.log('[OutputPanel] Restored saved directory name:', savedDirName);
        
        // If auto-save was enabled before, restore that state (will prompt for folder when needed)
        if (wasAutoSaveEnabled) {
          setAutoSave(true);
          console.log('[OutputPanel] Auto-save was previously enabled - restored state');
        }
      }
    };
    
    loadSavedHandle();
  }, []);

  // Also check for global handle periodically in case it gets set after mount
  useEffect(() => {
    const checkGlobalHandle = () => {
      if ((window as any).autoSaveHandle && !dirHandleRef.current) {
        dirHandleRef.current = (window as any).autoSaveHandle;
        const folderName = dirHandleRef.current.name || '';
        setDirName(folderName);
        setAutoSave(true);
        console.log('[OutputPanel] Received handle from Dropzone:', folderName);
      }
    };

    const interval = setInterval(checkGlobalHandle, 100);
    return () => clearInterval(interval);
  }, []);

  // Function to prompt for directory selection when needed
  const promptDirectoryIfNeeded = async () => {
    const savedDirName = localStorage.getItem('imagetool.autoSave.dirName');
    const wasAutoSaveEnabled = localStorage.getItem('imagetool.autoSave.enabled') === 'true';
    
    if (savedDirName && wasAutoSaveEnabled && !dirHandleRef.current && 'showDirectoryPicker' in window) {
      console.log('[OutputPanel] Auto-prompting for directory re-selection...');
      
      if (confirm(`前回使用したフォルダ「${savedDirName}」に自動保存しますか？`)) {
        await pickDirectory();
        return true; // Directory was selected
      } else {
        // User declined, disable auto-save for this session
        setAutoSave(false);
        return false;
      }
    }
    return dirHandleRef.current !== null; // Return whether we have a valid handle
  };

  useEffect(() => {
    const keys = Object.keys(profiles || {});
    if (keys.length && !selected) setSelected(keys[0]);
  }, [profiles, selected]);

  const pickDirectory = async () => {
    try {
      const picker: any = (window as any).showDirectoryPicker;
      if (!picker) {
        alert('このブラウザはフォルダ保存に対応していません（ZIP保存をご利用ください）');
        return;
      }
      const handle = await (window as any).showDirectoryPicker({ 
        mode: 'readwrite',
        startIn: 'downloads' // Start in downloads folder for better UX
      });
      dirHandleRef.current = handle;
      (window as any).autoSaveHandle = handle; // Also set globally
      const folderName = handle.name || '';
      setDirName(folderName);
      setAutoSave(true);
      
      // Save to localStorage for next time
      localStorage.setItem('imagetool.autoSave.dirName', folderName);
      localStorage.setItem('imagetool.autoSave.enabled', 'true');
      console.log('[OutputPanel] Directory selected and saved:', folderName);
    } catch (e) {
      console.log('[OutputPanel] Directory selection cancelled');
    }
  };

  async function writeFile(filename: string, blob: Blob) {
    const handle = dirHandleRef.current;
    console.log('[OutputPanel] writeFile called:', filename, 'handle:', !!handle, 'autoSave:', autoSave);
    if (!handle) {
      console.warn('[OutputPanel] No directory handle available for:', filename);
      return false;
    }
    try {
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(blob);
      await stream.close();
      console.log('[OutputPanel] Successfully saved:', filename);
      return true;
    } catch (e) {
      console.warn('[OutputPanel] Failed to save', filename, e);
      return false;
    }
  }

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      const data: any = e.data;
      console.log('[OutputPanel] Received worker message:', data?.type);
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
          
          if (autoSave && dirHandleRef.current) {
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
          
          if (autoSave && dirHandleRef.current) {
            await writeFile('document.psd', psd);
          } else {
            entries.push({ name: 'document.psd', url: URL.createObjectURL(psd) });
          }
        }
        if (entries.length) setDownloads(entries);
      } else if (data?.type === 'composeMany') {
        console.log('[OutputPanel] Received composeMany result:', data);
        
        const entries: { name: string; url: string }[] = [];
        const outs: Array<{ filename: string; image: ImageBitmap }> = data.outputs || [];
        console.log('[OutputPanel] Processing outputs:', outs.length);
        for (const o of outs) {
          const canvas = new OffscreenCanvas(o.image.width, o.image.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(o.image, 0, 0);
          const blob = await (canvas as any).convertToBlob?.() || (await new Promise<Blob>((resolve) => {
            const c = document.createElement('canvas');
            c.width = o.image.width; c.height = o.image.height;
            const cx = c.getContext('2d')!; cx.drawImage(o.image, 0, 0);
            c.toBlob((b) => resolve(b!), 'image/jpeg');
          }));
          // Always add to ZIP array for later download
          filesForZip.current.push({ name: o.filename, blob });
          console.log('[OutputPanel] Added to ZIP:', o.filename, 'Total files:', filesForZip.current.length);
          
          if (autoSave && dirHandleRef.current) {
            console.log('[OutputPanel] Attempting auto-save for:', o.filename);
            const saved = await writeFile(o.filename, blob);
            console.log('[OutputPanel] Auto-save result:', o.filename, saved);
          } else {
            console.log('[OutputPanel] Auto-save skipped for:', o.filename, 'autoSave:', autoSave, 'handle:', !!dirHandleRef.current);
            const url = URL.createObjectURL(blob);
            entries.push({ name: o.filename, url });
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
    console.log('[OutputPanel] handleRun - selected:', selected, 'profile:', profile);
    if (!profile) return;
    const composePayload: ComposePayload = {
      ...payload,
      sizes: profile.sizes,
      exportPsd: profile.exportPsd ?? payload.exportPsd,
    };
    console.log('[OutputPanel] handleRun - composePayload:', composePayload);
    if (!worker) return;
    worker.postMessage({ type: 'compose', payload: composePayload });
  };

  const handleZipAll = async () => {
    console.log('[OutputPanel] ZIP button clicked, files:', filesForZip.current.length);
    if (filesForZip.current.length === 0) {
      console.warn('[OutputPanel] No files in ZIP array');
      return;
    }
    try {
      // convert blobs to Uint8Array and build zip
      const items = await Promise.all(
        filesForZip.current.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))
      );
      console.log('[OutputPanel] Prepared ZIP items:', items.length);
      const zipBlob = await makeZip(items);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'outputs.zip';
      a.click();
      console.log('[OutputPanel] ZIP download triggered');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error('[OutputPanel] ZIP creation failed:', e);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={pickDirectory}>
          {dirName && dirHandleRef.current ? '出力フォルダを変更' : '出力フォルダを選択'}
        </button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={autoSave} onChange={(e) => {
            const enabled = e.target.checked;
            setAutoSave(enabled);
            localStorage.setItem('imagetool.autoSave.enabled', enabled.toString());
            console.log('[OutputPanel] Auto-save toggled:', enabled);
          }} disabled={!dirName} />
          自動保存
        </label>
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
        console.log('[OutputPanel] Profile changed to:', e.target.value);
        setSelected(e.target.value);
      }}>
        {Object.keys(profiles).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <button onClick={handleRun}>Run</button>
      <button onClick={handleZipAll} disabled={filesForZip.current.length === 0} style={{ marginLeft: 8 }}>すべてZIPで保存</button>
      {downloads.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {downloads.map((d, index) => (
            <div key={`${d.name}-${index}-${d.url.slice(-8)}`}>
              <a href={d.url} download={d.name}>{d.name}</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
