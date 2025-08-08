import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ResizeSpec } from '../worker/opencv';
import { useProfiles } from '../context/ProfilesContext';

export interface DetectedHandler {
  (image: ImageBitmap, bbox: [number, number, number, number]): void;
}

export interface BatchModeHandler {
  (isBatch: boolean): void;
}

/**
 * Dropzone component that accepts a single image file and sends it to the worker
 * for object detection.
 */
type Props = { worker?: Worker; onDetected?: DetectedHandler; onBatchMode?: BatchModeHandler };
export default function Dropzone({ worker: workerProp, onDetected, onBatchMode }: Props) {
  // create or reuse worker
  const worker = useMemo(
    () => workerProp ?? new Worker(new URL('../worker/core.ts', import.meta.url), { type: 'module' }),
    [workerProp]
  );

  const [status, setStatus] = useState<string>('画像をドロップしてください');
  const [predCount, setPredCount] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  type GalleryItem = { url: string; label: string; bmp: ImageBitmap; bbox: [number, number, number, number]; group: string };
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [isBatchUI, setIsBatchUI] = useState<boolean>(false);

  const fileBitmaps = useRef(new Map<string, ImageBitmap>());
  const fileNames = useRef(new Map<string, string>());
  const batchMode = useRef(false);
  const totalRef = useRef(0);
  const doneRef = useRef(0);
  const [batchSizes, setBatchSizes] = useState<ResizeSpec[] | null>(null);
  const [profilesAll, setProfilesAll] = useState<{ tag: string; size: string }[] | null>(null);
  const [layoutsCfg, setLayoutsCfg] = useState<any | null>(null);
  const topNameRef = useRef<string>('output');
  const { config } = useProfiles();
  
  // Function to prompt for auto-save directory if needed
  const promptAutoSaveIfNeeded = async () => {
    const savedDirName = localStorage.getItem('imagetool.autoSave.dirName');
    const wasAutoSaveEnabled = localStorage.getItem('imagetool.autoSave.enabled') === 'true';
    
    if (savedDirName && wasAutoSaveEnabled && 'showDirectoryPicker' in window) {
      console.log('[Dropzone] Auto-prompting for directory selection...');
      
      if (confirm(`前回使用したフォルダ「${savedDirName}」に自動保存しますか？`)) {
        try {
          const handle = await (window as any).showDirectoryPicker({ 
            mode: 'readwrite',
            startIn: 'downloads'
          });
          
          // Store the handle for OutputPanel to use
          (window as any).autoSaveHandle = handle;
          console.log('[Dropzone] Auto-save directory selected:', handle.name);
          return true;
        } catch (e) {
          console.log('[Dropzone] Directory selection cancelled');
          return false;
        }
      }
    }
    return false;
  };
  
  // Debug: Log config changes
  useEffect(() => {
    console.log('[Dropzone] Config updated:', config);
    console.log('[Dropzone] Config profiles keys:', Object.keys(config.profiles || {}));
  }, [config]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data: any = e.data;
      if (data?.type === 'detect') {
        const preds = (data.predictions || []) as Array<{ bbox: [number, number, number, number] }>;
        setPredCount(preds.length);
        setStatus('検出が完了しました');
        const fileId = (data as any).fileId as string | undefined;
        const bmp = (fileId && fileBitmaps.current.get(fileId)) || lastBitmapRef.current;
        // choose best bbox (max area) or fallback to center square
        if (bmp) {
          let bbox: [number, number, number, number];
          if (preds.length > 0) {
            const best = preds
              .map((p) => ({ p, a: p.bbox[2] * p.bbox[3] }))
              .sort((a, b) => b.a - a.a)[0].p.bbox;
            bbox = best as [number, number, number, number];
          } else {
            const w = bmp.width;
            const h = bmp.height;
            const side = Math.min(w, h) * 0.8;
            bbox = [Math.floor((w - side) / 2), Math.floor((h - side) / 2), Math.floor(side), Math.floor(side)];
          }

          // draw bbox overlay on preview canvas (single mode)
          const preview = canvasRef.current;
          if (!batchMode.current && preview) {
            const pctx = preview.getContext('2d');
            if (pctx) {
              pctx.clearRect(0, 0, preview.width, preview.height);
              pctx.drawImage(bmp, 0, 0);
              pctx.save();
              pctx.lineWidth = Math.max(2, Math.min(preview.width, preview.height) * 0.004);
              pctx.strokeStyle = 'rgba(255,0,0,0.9)';
              pctx.setLineDash([8, 6]);
              pctx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
              pctx.restore();
            }
          }

          // add thumbnail to gallery (batch mode)
          if (batchMode.current) {
            const maxW = 200;
            const scale = Math.min(1, maxW / bmp.width);
            const tw = Math.round(bmp.width * scale);
            const th = Math.round(bmp.height * scale);
            const c = document.createElement('canvas');
            c.width = tw; c.height = th;
            const cx = c.getContext('2d')!;
            cx.drawImage(bmp, 0, 0, tw, th);
            cx.save();
            cx.strokeStyle = 'rgba(255,0,0,0.9)';
            cx.setLineDash([6, 4]);
            cx.lineWidth = Math.max(1, Math.min(tw, th) * 0.01);
            cx.strokeRect(bbox[0] * scale, bbox[1] * scale, bbox[2] * scale, bbox[3] * scale);
            cx.restore();
            (async () => {
              const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
              const url = URL.createObjectURL(blob);
              const fullPath = (fileId && (fileNames.current.get(fileId) || 'image')) || 'image';
              // グループは "最上位/サブフォルダ/ファイル" の2番目の要素（直下は topName）
              let group = topNameRef.current;
              const topPrefix = `${topNameRef.current}/`;
              const rel = fullPath.startsWith(topPrefix) ? fullPath.slice(topPrefix.length) : fullPath;
              if (rel.includes('/')) {
                group = rel.split('/')[0];
              }
              const label = fullPath;
              setGallery((prev) => [...prev, { url, label, bmp, bbox, group }]);
            })();
          }
          if (batchMode.current && batchSizes && fileId) {
            worker.postMessage({ type: 'compose', payload: { image: bmp, bbox, sizes: batchSizes, exportPsd: false } });
            doneRef.current += 1;
            setStatus(`処理中 ${doneRef.current}/${totalRef.current}`);
            fileBitmaps.current.delete(fileId);
          } else if (!batchMode.current) {
            onDetected?.(bmp, bbox);
          }
        }
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker, batchSizes, onDetected]);

  const lastBitmapRef = useRef<ImageBitmap | null>(null);
  const getFilesFromEvent = useCallback(async (event: any): Promise<File[]> => {
    const items = event?.dataTransfer?.items;
    if (items && items.length) {
      const traverseEntry = async (entry: any, path = ''): Promise<File[]> => {
        if (!entry) return [];
        if (entry.isFile) {
          const file: File = await new Promise((resolve) => entry.file(resolve));
          (file as any).path = path + entry.name;
          return [file];
        }
        if (entry.isDirectory) {
          if (!path) {
            // top-level directory name
            topNameRef.current = entry.name;
          }
          const reader = entry.createReader();
          const entries: any[] = await new Promise((resolve) => reader.readEntries(resolve));
          const nested = await Promise.all(entries.map((e) => traverseEntry(e, path + entry.name + '/')));
          return nested.flat();
        }
        return [];
      };
      const entries = Array.from(items)
        .map((it: any) => (it as any).webkitGetAsEntry?.())
        .filter(Boolean);
      if (entries.length) {
        // if user drops multiple items, use the first directory name if any
        const firstDir = entries.find((e: any) => e.isDirectory);
        if (firstDir) topNameRef.current = firstDir.name;
        const all = await Promise.all(entries.map((e) => traverseEntry(e)));
        return all.flat();
      }
    }
    return (event?.dataTransfer?.files ? Array.from(event.dataTransfer.files) : []) as File[];
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      // filter images only
      const images = acceptedFiles.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(f.name));
      if (images.length === 0) return;
      batchMode.current = images.length > 1;
      totalRef.current = images.length;
      doneRef.current = 0;

      // Prompt for auto-save directory BEFORE processing if needed
      if (batchMode.current) {
        await promptAutoSaveIfNeeded();
      }

      // Ensure preview canvas is ready with first image size
      const firstBitmap = await createImageBitmap(images[0]);
      lastBitmapRef.current = firstBitmap;
      const preview = canvasRef.current;
      if (preview) {
        preview.width = firstBitmap.width;
        preview.height = firstBitmap.height;
        const pctx = preview.getContext('2d');
        pctx?.drawImage(firstBitmap, 0, 0);
      }

      // In batch mode, load default profile sizes once
      let currentProfiles = profilesAll;
      
      if (batchMode.current && (!batchSizes || !profilesAll)) {
        console.log('[Dropzone] Loading profiles for batch mode, config:', config);
        console.log('[Dropzone] config.profiles:', config.profiles);
        console.log('[Dropzone] config.profiles keys:', Object.keys(config.profiles || {}));
        
        // Force re-fetch from JSON file to avoid stale state
        const json = await (async () => {
          try {
            const base = (import.meta as any).env?.BASE_URL ?? '/';
            const res = await fetch(`${base}output_profiles.json`);
            if (res.ok) {
              return await res.json();
            }
          } catch {}
          return { profiles: config.profiles, layouts: config.layouts };
        })();
        
        console.log('[Dropzone] Fresh profiles from JSON:', json);
        const keys = Object.keys(json.profiles || {});
        console.log('[Dropzone] Profile keys:', keys);
        
        // Use default profile for batchSizes (backward compatibility)
        const key = keys.includes('default') ? 'default' : keys[0];
        const sizes = json.profiles?.[key]?.sizes as ResizeSpec[] | undefined;
        if (sizes && sizes.length) setBatchSizes(sizes);
        
        // Generate profiles from ALL profiles, not just default
        const profs: { tag: string; size: string }[] = [];
        for (const k of keys) {
          const p = json.profiles[k];
          if (p?.sizes && Array.isArray(p.sizes)) {
            // For composeMany, we use the first size from each profile
            const firstSize = p.sizes[0];
            if (firstSize) {
              profs.push({ tag: k, size: `${firstSize.width}x${firstSize.height}` });
            }
          }
        }
        console.log('[Dropzone] Generated profiles for composeMany:', profs);
        if (profs.length) {
          setProfilesAll(profs);
          currentProfiles = profs; // Use immediately for composeMany
        }
        if (json.layouts) setLayoutsCfg(json.layouts);
      }

      setPredCount(null);
      setGallery([]);
      setIsBatchUI(batchMode.current);
      setStatus(batchMode.current ? `処理中 0/${images.length}` : '検出中...');
      
      // Notify parent about batch mode
      onBatchMode?.(batchMode.current);

      // Process all images
      const groupsMap = new Map<string, ImageBitmap[]>();
      for (const file of images) {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const fileId = crypto.randomUUID();
        fileBitmaps.current.set(fileId, bitmap);
        fileNames.current.set(fileId, (file as any).path || file.name);
        worker.postMessage({ type: 'detect', payload: { fileId, imageData } });
        // accumulate group
        const fullPath = (file as any).path || file.name;
        // group 名はサブフォルダ名 / 直下は topName
        let group = topNameRef.current;
        const topPrefix = `${topNameRef.current}/`;
        const rel = fullPath.startsWith(topPrefix) ? fullPath.slice(topPrefix.length) : fullPath;
        if (rel.includes('/')) {
          group = rel.split('/')[0];
        }
        const arr = groupsMap.get(group) || [];
        arr.push(bitmap);
        groupsMap.set(group, arr);
      }

      // Trigger folder-level compose for all profiles (variations)
      console.log('[Dropzone] Checking composeMany conditions:', {
        batchMode: batchMode.current,
        currentProfiles: currentProfiles?.length,
        profilesAll: profilesAll?.length,
        groupsMapSize: groupsMap.size
      });
      
      if (batchMode.current && currentProfiles && currentProfiles.length > 0 && groupsMap.size > 0) {
        const groups = Array.from(groupsMap.entries()).map(([name, bitmaps]) => ({ name, images: bitmaps }));
        console.log('[Dropzone] Sending composeMany:', groups.length, 'groups', currentProfiles.length, 'profiles');
        console.log('[Dropzone] Groups:', groups.map(g => ({ name: g.name, imageCount: g.images.length })));
        worker.postMessage({ type: 'composeMany', payload: { groups, profiles: currentProfiles, layouts: layoutsCfg || undefined } });
      } else {
        console.warn('[Dropzone] Not sending composeMany - conditions not met');
      }
    },
    [worker, batchSizes]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, getFilesFromEvent, multiple: true });

  return (
    <div>
      <div
        {...getRootProps()}
        style={{ border: '2px dashed #888', padding: '16px', textAlign: 'center', cursor: 'pointer' }}
      >
        <input {...getInputProps({ webkitdirectory: "true" as any, directory: "true" as any, multiple: true })} />
        <p style={{ margin: 0 }}>{isDragActive ? 'ここにドロップ' : status}</p>
      </div>
      <div style={{ marginTop: 12 }}>
        {!isBatchUI && (
          <canvas ref={canvasRef} style={{ maxWidth: '100%', display: 'block' }} />
        )}
        {isBatchUI && gallery.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from(new Set(gallery.map((g) => g.group))).map((group) => (
              <div key={group}>
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#333' }}>{group}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {gallery.filter((g) => g.group === group).map((g, idx) => (
                    <button
                      key={g.url + idx}
                      onClick={() => onDetected?.(g.bmp, g.bbox)}
                      style={{ border: '1px solid #ddd', padding: 4, cursor: 'pointer', background: '#fff' }}
                      title="クリックで編集"
                    >
                      <img src={g.url} alt={g.label} style={{ width: '100%', display: 'block' }} />
                      <div style={{ fontSize: 12, color: '#555', marginTop: 4, wordBreak: 'break-all', textAlign: 'left' }}>{g.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {predCount !== null && (
          <p style={{ fontSize: 12, color: '#444' }}>検出数: {predCount}</p>
        )}
      </div>
    </div>
  );
}
