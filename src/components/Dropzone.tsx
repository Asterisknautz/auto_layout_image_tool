import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ResizeSpec } from '../worker/opencv';
import { useProfiles } from '../context/ProfilesContext';
import { detectAndSetupOutputFromFiles } from '../utils/fileSystem';
import { debugController } from '../utils/debugMode';

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
  
  // Simple center crop for white background product photos
  const getProductCenterCrop = (w: number, h: number): [number, number, number, number] => {
    // Assume product is centered and crop to 80% of the smaller dimension
    // This gives 20% margin (10% on each side) as requested
    const minDim = Math.min(w, h);
    const cropSize = Math.floor(minDim * 0.8); // 80% of smaller dimension
    
    // Center the crop
    const centerX = Math.floor(w / 2);
    const centerY = Math.floor(h / 2);
    const left = centerX - Math.floor(cropSize / 2);
    const top = centerY - Math.floor(cropSize / 2);
    
    console.log(`[Product Crop] Image: ${w}x${h}, Crop: ${cropSize}x${cropSize} at (${left},${top}) - 20% margin`);
    
    return [left, top, cropSize, cropSize];
  };

  // White background detection for product photos
  const detectWhiteBackground = (imageData: ImageData): boolean => {
    const { data, width, height } = imageData;
    const sampleSize = 100; // Sample 100 pixels from edges
    let whitePixels = 0;
    
    // Sample pixels from edges (likely background)
    for (let i = 0; i < sampleSize; i++) {
      // Top edge
      const topIdx = (Math.floor(Math.random() * width)) * 4;
      // Bottom edge  
      const bottomIdx = ((height - 1) * width + Math.floor(Math.random() * width)) * 4;
      // Left edge
      const leftIdx = (Math.floor(Math.random() * height) * width) * 4;
      // Right edge
      const rightIdx = (Math.floor(Math.random() * height) * width + (width - 1)) * 4;
      
      [topIdx, bottomIdx, leftIdx, rightIdx].forEach(idx => {
        const r = data[idx];
        const g = data[idx + 1]; 
        const b = data[idx + 2];
        // Consider white-ish if all RGB values are > 220 (adjusted for darker product photos)
        if (r > 220 && g > 220 && b > 220) {
          whitePixels++;
        }
      });
    }
    
    // If more than 70% of edge samples are white-ish, consider it white background
    const whitePercentage = (whitePixels / (sampleSize * 4)) * 100;
    const isWhite = whitePercentage > 70;
    console.log(`[Background Detection] White pixels: ${whitePixels}/${sampleSize * 4} (${whitePercentage.toFixed(1)}%) → ${isWhite ? 'WHITE' : 'NATURAL'}`);
    return isWhite;
  };
  
  // Check if files suggest an _output folder might exist (based on file paths)
  const checkForPotentialOutputFolder = (files: File[]): { 
    likelyHasOutput: boolean; 
    baseFolderName?: string; 
  } => {
    const paths = files.map(f => (f as any).path || f.name);
    const topLevelFolders = new Set<string>();
    let hasSubfolders = false;
    
    for (const path of paths) {
      const parts = path.split('/');
      if (parts.length > 1) {
        hasSubfolders = true;
        topLevelFolders.add(parts[0]);
      }
    }
    
    // If files come from a single folder structure, likely from drag & drop
    const likelyHasOutput = hasSubfolders && topLevelFolders.size === 1;
    const baseFolderName = likelyHasOutput ? Array.from(topLevelFolders)[0] : undefined;
    
    debugController.log('Dropzone', 'Potential output folder check:', {
      likelyHasOutput,
      baseFolderName,
      fileCount: files.length,
      topLevelFolders: Array.from(topLevelFolders)
    });
    
    return { likelyHasOutput, baseFolderName };
  };

  // Enhanced function that avoids showing dialog when folder structure is clear
  const setupAutoSaveIfNeeded = async (files: File[]) => {
    const savedDirName = localStorage.getItem('imagetool.autoSave.dirName');
    const wasAutoSaveEnabled = localStorage.getItem('imagetool.autoSave.enabled') === 'true';
    
    // Check if files suggest a clear folder structure
    const { likelyHasOutput, baseFolderName } = checkForPotentialOutputFolder(files);
    
    if (likelyHasOutput && baseFolderName && 'showDirectoryPicker' in window) {
      debugController.log('Dropzone', 'Detected organized folder structure:', baseFolderName);
      
      if (confirm(`フォルダ「${baseFolderName}」の親フォルダに_outputフォルダを作成して自動保存を有効にしますか？\n\n次のダイアログで「${baseFolderName}」が含まれる親フォルダを選択してください。\n一度設定すれば、今後は自動的に保存されます。`)) {
        try {
          const { outputHandle, displayName, hasExistingOutput } = await detectAndSetupOutputFromFiles(files);
          
          if (outputHandle) {
            (window as any).autoSaveHandle = outputHandle;
            localStorage.setItem('imagetool.autoSave.dirName', displayName);
            localStorage.setItem('imagetool.autoSave.enabled', 'true');
            
            // Notify OutputPanel about the auto-save setup
            window.dispatchEvent(new CustomEvent('autoSaveSetup', { 
              detail: { displayName, outputHandle } 
            }));
            
            debugController.log('Dropzone', 'Auto-save configured from files:', {
              displayName,
              hadExistingOutput: hasExistingOutput
            });
            
            return true;
          }
        } catch (e) {
          debugController.log('Dropzone', 'Auto-save setup from files failed:', e);
        }
      }
    }
    
    // Fallback to old behavior for unclear structures
    if (savedDirName && wasAutoSaveEnabled && 'showDirectoryPicker' in window) {
      debugController.log('Dropzone', 'Using fallback auto-save prompt');
      
      if (confirm(`フォルダ「${savedDirName}」に自動保存しますか？\n（_outputフォルダが自動検出・作成されます）`)) {
        try {
          const { outputHandle, displayName, hasExistingOutput } = await detectAndSetupOutputFromFiles(files);
          
          if (outputHandle) {
            (window as any).autoSaveHandle = outputHandle;
            localStorage.setItem('imagetool.autoSave.dirName', displayName);
            localStorage.setItem('imagetool.autoSave.enabled', 'true');
            
            // Notify OutputPanel about the auto-save setup
            window.dispatchEvent(new CustomEvent('autoSaveSetup', { 
              detail: { displayName, outputHandle } 
            }));
            
            debugController.log('Dropzone', 'Manual auto-save configured:', {
              displayName,
              hadExistingOutput: hasExistingOutput
            });
            
            return true;
          }
        } catch (e) {
          debugController.log('Dropzone', 'Manual directory selection cancelled:', e);
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
    
    // Debug each profile's formats
    if (config.profiles) {
      for (const [key, profile] of Object.entries(config.profiles)) {
        console.log(`[Dropzone] Profile "${key}" formats:`, (profile as any)?.formats);
      }
    }
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
        // choose best bbox with area constraints, fallback to center square
        if (bmp) {
          let bbox: [number, number, number, number];
          const w = bmp.width;
          const h = bmp.height;
          
          // Detect white background images for special handling
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bmp, 0, 0);
          const imageData = ctx.getImageData(0, 0, w, h);
          const isWhiteBackground = detectWhiteBackground(imageData);
          
          const fileName = (fileId && (fileNames.current.get(fileId) || 'unknown')) || 'single-image';
          const totalArea = w * h; // Define totalArea here for all branches
          
          if (isWhiteBackground) {
            // White background product photos - use center crop with 20% margin
            bbox = getProductCenterCrop(w, h);
            const [left, top, size] = bbox;
            const percentage = ((size * size) / totalArea * 100).toFixed(1);
            console.log('[Dropzone]', fileName, 
              `White background detected, center crop: ${size}x${size} (${percentage}%) at (${left},${top})`);
          } else if (preds.length > 0) {
            // Natural photos - use original logic with area constraints
            const minArea = Math.max(1000, totalArea * 0.02); // Min 2% of image or 1000px, whichever is larger
            const maxArea = Math.min(totalArea * 0.8, 200000); // Max 80% of image or 200k pixels
            console.log('[Dropzone]', fileName, 
              `Natural photo - Area constraints: min=${minArea.toLocaleString()} max=${maxArea.toLocaleString()}`);
              
            // Handle case where minArea > maxArea for very large images
            if (minArea > maxArea) {
              // Use center square for oversized images
              const side = Math.min(w, h) * 0.8;
              bbox = [Math.floor((w - side) / 2), Math.floor((h - side) / 2), Math.floor(side), Math.floor(side)];
              console.log('[Dropzone]', fileName, 'Image too large for constraints, using center square (80%)');
            } else {
              // Filter predictions by area and confidence constraints
              const minConfidence = 0.3; // Minimum confidence threshold
              const validPreds = preds.filter(p => {
                const area = p.bbox[2] * p.bbox[3];
                return area >= minArea && area <= maxArea && (p as any).score >= minConfidence;
              });
              
              console.log('[Dropzone]', fileName, 
                `Predictions: total=${preds.length} valid=${validPreds.length}`);
              
              if (validPreds.length > 0) {
                // Choose largest area among valid predictions (best for composed photos)
                const best = validPreds
                  .map((p) => ({ p, a: p.bbox[2] * p.bbox[3] }))
                  .sort((a, b) => b.a - a.a)[0].p; // Sort by area within valid range
                bbox = best.bbox as [number, number, number, number];
                const bboxArea = best.bbox[2] * best.bbox[3];
                const percentage = ((bboxArea / totalArea) * 100).toFixed(1);
                console.log('[Dropzone]', fileName, 
                  `Image: ${w}x${h} (${totalArea.toLocaleString()})`,
                  `Selected bbox: area=${bboxArea.toLocaleString()} (${percentage}%)`,
                  `confidence=${(best as any).score.toFixed(3)}`
                );
              } else {
                // All predictions failed area constraints, use center square
                const side = Math.min(w, h) * 0.8;
                bbox = [Math.floor((w - side) / 2), Math.floor((h - side) / 2), Math.floor(side), Math.floor(side)];
                console.log('[Dropzone]', fileName, 'All predictions outside area constraints, using center square (80%)');
              }
            }
          } else {
            // No predictions on natural photos, use center square
            const side = Math.min(w, h) * 0.8;
            bbox = [Math.floor((w - side) / 2), Math.floor((h - side) / 2), Math.floor(side), Math.floor(side)];
            console.log('[Dropzone]', fileName, 'No predictions, using center square (80%)');
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
          // Skip _output folders to avoid processing generated files
          if (entry.name === '_output') {
            debugController.log('Dropzone', 'Skipping _output folder:', path + entry.name);
            return [];
          }
          
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

      // For batch mode, wait until proper profiles are loaded
      if (batchMode.current) {
        console.log('[Dropzone] Batch mode detected, checking profile availability...');
        setStatus('プロファイルを読み込み中...');
        
        // Wait for proper profiles to be loaded (retry up to 10 times with 500ms delay)
        let retryCount = 0;
        const maxRetries = 10;
        
        while (retryCount < maxRetries) {
          const profileKeys = Object.keys(config.profiles || {});
          const hasValidProfiles = profileKeys.length > 1 || (profileKeys.length === 1 && profileKeys[0] !== 'default');
          
          console.log(`[Dropzone] Retry ${retryCount + 1}: Profile keys = [${profileKeys.join(', ')}], Valid = ${hasValidProfiles}`);
          
          if (hasValidProfiles) {
            console.log('[Dropzone] Valid profiles found, proceeding with batch processing');
            break;
          }
          
          if (retryCount < maxRetries - 1) {
            console.log('[Dropzone] Waiting for profiles to load...');
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          retryCount++;
        }
        
        if (retryCount >= maxRetries) {
          console.error('[Dropzone] Timeout waiting for profiles to load');
          setStatus('プロファイルの読み込みでエラーが発生しました');
          return;
        }
        
        await setupAutoSaveIfNeeded(images);
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

      // In batch mode, load profile sizes and regenerate from current config
      let currentProfiles = profilesAll;
      let currentLayouts = layoutsCfg;
      
      if (batchMode.current) {
        console.log('[Dropzone] Batch mode: Always regenerating profiles from current config to ensure format sync');
        console.log('[Dropzone] config.profiles:', config.profiles);
        console.log('[Dropzone] config.profiles keys:', Object.keys(config.profiles || {}));
        
        // Check if we have valid profiles (not just old default)
        const profileKeys = Object.keys(config.profiles || {});
        if (profileKeys.length === 1 && profileKeys[0] === 'default') {
          console.log('[Dropzone] Only default profile available, waiting for proper profiles...');
          return; // Skip processing until proper profiles are loaded
        }
        
        // Detailed debug: show actual profile contents  
        if (config.profiles) {
          for (const [key, profile] of Object.entries(config.profiles)) {
            console.log(`[Dropzone] Profile "${key}":`, profile);
          }
        }
        
        // Use ProfilesContext configuration (which includes user modifications)
        const json = { profiles: config.profiles, layouts: config.layouts };
        console.log('[Dropzone] Using context configuration for accurate formats:', json);
        
        console.log('[Dropzone] Fresh profiles from JSON:', json);
        console.log('[Dropzone] Layouts from JSON:', json.layouts);
        const keys = Object.keys(json.profiles || {});
        console.log('[Dropzone] Profile keys:', keys);
        
        // Use first profile for batchSizes, but skip 'default' if it exists
        const validKeys = keys.filter(k => k !== 'default');
        const key = validKeys.length > 0 ? validKeys[0] : keys[0];
        console.log('[Dropzone] Available keys:', keys);
        console.log('[Dropzone] Valid keys (excluding default):', validKeys);
        console.log('[Dropzone] Using profile for batchSizes:', key);
        const sizes = json.profiles?.[key]?.sizes as ResizeSpec[] | undefined;
        console.log('[Dropzone] Sizes for batchSizes:', sizes);
        if (sizes && sizes.length) setBatchSizes(sizes);
        
        // Generate profiles from ALL profiles, excluding default
        const profs: { tag: string; size: string; formats?: string[] }[] = [];
        for (const k of validKeys.length > 0 ? validKeys : keys) {
          const p = json.profiles[k];
          if (p?.sizes && Array.isArray(p.sizes)) {
            // For composeMany, we use the first size from each profile
            const firstSize = p.sizes[0];
            if (firstSize) {
              const formats = (p as any).formats || [];
              console.log(`[Dropzone] Profile "${k}" formats:`, formats);
              
              // Skip profiles with no formats selected
              if (formats.length === 0) {
                console.log(`[Dropzone] Skipping profile "${k}" - no formats selected`);
                continue;
              }
              
              profs.push({ 
                tag: k, 
                size: `${firstSize.width}x${firstSize.height}`,
                formats: formats
              });
            }
          }
        }
        console.log('[Dropzone] Generated profiles for composeMany:', profs);
        if (profs.length) {
          setProfilesAll(profs);
          currentProfiles = profs; // Use immediately for composeMany
        }
        if (json.layouts) {
          console.log('[Dropzone] Setting layouts config:', json.layouts);
          setLayoutsCfg(json.layouts);
          currentLayouts = json.layouts; // Use immediately for composeMany
        } else {
          console.warn('[Dropzone] No layouts found in JSON');
        }
      }

      setPredCount(null);
      setGallery([]);
      setIsBatchUI(batchMode.current);
      setStatus(batchMode.current ? `処理中 0/${images.length}` : '検出中...');
      
      // Notify parent about batch mode
      onBatchMode?.(batchMode.current);

      // Process all images
      const groupsMap = new Map<string, { images: ImageBitmap[]; filenames: string[] }>();
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
        const arr = groupsMap.get(group) || { images: [], filenames: [] };
        arr.images.push(bitmap);
        arr.filenames.push(file.name);
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
        const groups = Array.from(groupsMap.entries()).map(([name, data]) => ({ 
          name, 
          images: data.images, 
          filenames: data.filenames 
        }));
        console.log('[Dropzone] Sending composeMany:', groups.length, 'groups', currentProfiles.length, 'profiles');
        console.log('[Dropzone] Groups:', groups.map(g => ({ name: g.name, imageCount: g.images.length })));
        console.log('[Dropzone] Sending layouts to worker:', currentLayouts);
        worker.postMessage({ type: 'composeMany', payload: { groups, profiles: currentProfiles, layouts: currentLayouts || undefined } });
      } else {
        console.warn('[Dropzone] Not sending composeMany - conditions not met');
      }
    },
    [worker, batchSizes, config]
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
