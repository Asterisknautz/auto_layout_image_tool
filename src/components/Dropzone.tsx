import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ResizeSpec } from '../worker/opencv';
import { useProfiles } from '../context/ProfilesContext';
// import { detectAndSetupOutputFromFiles } from '../utils/fileSystem'; // Not used in new system
import { debugController } from '../utils/debugMode';
import { outputRootManager } from '../utils/outputRootManager';

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
  
  // 画像データを永続化して設定変更時の再処理に使用
  const [savedGroups, setSavedGroups] = useState<Array<{ name: string; images: ImageBitmap[]; filenames: string[] }>>([]);
  const [isReprocessing, setIsReprocessing] = useState(false);
  
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
  // Not used in new system - commented out
  /*
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
  */

  /*
  // Disabled: Complex chunk processing caused infinite loops and memory leaks
  // Simple warning system is used instead for large batches
  */

  // New output root based auto-save setup
  const setupAutoSaveIfNeeded = async (files: File[], detectedFolderName?: string | null): Promise<boolean> => {
    console.log('[DEBUG] setupAutoSaveIfNeeded called with:', { 
      filesCount: files.length, 
      detectedFolderName: detectedFolderName 
    });
    
    if (files.length === 0) {
      console.log('[DEBUG] No files, returning false');
      return false;
    }

    // Extract folder information from various sources
    const firstFile = files[0];
    const webkitRelativePath = (firstFile as any).webkitRelativePath || '';
    const relativePath = webkitRelativePath || firstFile.name;
    
    console.log('[DEBUG] File analysis:', {
      fileName: firstFile.name,
      webkitRelativePath: webkitRelativePath,
      relativePath: relativePath,
      hasWebkitPath: !!webkitRelativePath,
      topNameRefCurrent: topNameRef.current
    });
    
    // Try to get folder name from different sources
    let folderName: string | null = null;
    
    // 1. Use detected folder name from webkitEntry (most reliable for folder drops)
    if (detectedFolderName) {
      folderName = detectedFolderName;
      console.log('[DEBUG] Using detected folder name:', folderName);
    }
    // 2. Try webkitRelativePath (for file-based drops)
    else if (relativePath.includes('/')) {
      const pathParts = relativePath.split('/');
      folderName = pathParts[0];
      console.log('[DEBUG] Using folder name from webkitRelativePath:', folderName, 'from path:', relativePath);
    }
    // 3. Fallback: Check if we have webkitRelativePath but no detected folder name yet
    else if ((firstFile as any).webkitRelativePath && (firstFile as any).webkitRelativePath.includes('/')) {
      const pathParts = (firstFile as any).webkitRelativePath.split('/');
      folderName = pathParts[0];
      console.log('[DEBUG] Using folder name from file webkitRelativePath:', folderName);
    }
    
    // 4. Special case: Extract from topNameRef which might contain folder information from directory drops
    if (!folderName && topNameRef.current) {
      folderName = topNameRef.current;
      console.log('[DEBUG] Using folder name from topNameRef:', folderName);
    }
    
    // 5. Additional fallback: If we still don't have a folder name but we have files with paths in their processing
    // Check if any file has path information embedded (this catches cases where webkitRelativePath might be processed differently)
    if (!folderName) {
      for (const file of files) {
        const filePath = (file as any).webkitRelativePath;
        if (filePath && typeof filePath === 'string' && filePath.includes('/')) {
          const parts = filePath.split('/');
          if (parts.length > 1 && parts[0]) {
            folderName = parts[0];
            console.log('[DEBUG] Found folder name from file iteration:', folderName, 'from file:', file.name);
            break;
          }
        }
      }
    }
    
    debugController.log('Dropzone', 'Setting up auto-save for files:', {
      fileCount: files.length,
      fileName: firstFile.name,
      webkitRelativePath: (firstFile as any).webkitRelativePath,
      relativePath: relativePath,
      detectedFolderName: detectedFolderName,
      finalFolderName: folderName,
      pathIncludes: relativePath.includes('/'),
      pathParts: relativePath.includes('/') ? relativePath.split('/') : []
    });
    
    // フォルダ名が取得できない場合は、ファイル名（拡張子なし）を使用
    if (!folderName) {
      const fileNameWithoutExt = firstFile.name.replace(/\.[^.]+$/, '');
      folderName = fileNameWithoutExt;
      console.log('[DEBUG] No folder name detected, using filename:', folderName);
    }
    
    console.log('[DEBUG] Final folder name determined:', folderName);

    try {
      // Check if output root is already configured
      debugController.log('Dropzone', 'Checking output root status...');
      const hasRoot = await outputRootManager.hasOutputRoot();
      debugController.log('Dropzone', 'Output root status:', hasRoot);
      
      if (!hasRoot) {
        // First time setup - ask user to select output root
        const confirmation = confirm(
          `📁 出力フォルダの設定\n\n` +
          `最初に「出力の家」となるフォルダを選択してください。\n` +
          `今後すべてのプロジェクトがここに整理されます。\n\n` +
          `例：デスクトップに「ImageTool-Output」を作成し、\n` +
          `　　その中に各プロジェクトのフォルダが作られます\n\n` +
          `✅ 一度設定すれば以降は完全自動\n` +
          `✅ 既存ファイルは削除してから新しいファイルを保存`
        );
        
        if (!confirmation) {
          debugController.log('Dropzone', 'User declined output root setup');
          return false;
        }
        
        setStatus('出力ルートフォルダを設定中...');
        const setupResult = await outputRootManager.setupOutputRoot();
        
        if (!setupResult.success) {
          setStatus('❌ 出力ルートの設定に失敗しました');
          return false;
        }
        
        setStatus('✅ 出力ルートを設定しました: ' + setupResult.displayName);
      }
      
      // Get project output handle using the detected folder name
      const projectOutputHandle = await outputRootManager.getProjectOutputHandle(folderName);
      
      if (!projectOutputHandle) {
        setStatus('❌ プロジェクト出力フォルダの作成に失敗しました');
        return false;
      }
      
      // Set global handle for OutputPanel compatibility
      (window as any).autoSaveHandle = projectOutputHandle;
      
      // Notify OutputPanel
      const rootInfo = outputRootManager.getOutputRootInfo();
      const displayName = `${rootInfo.name}/${folderName}`;
      
      window.dispatchEvent(new CustomEvent('autoSaveSetup', { 
        detail: { displayName, outputHandle: projectOutputHandle } 
      }));
      
      debugController.log('Dropzone', 'Auto-save configured for folder:', {
        folderName: folderName,
        displayName: displayName,
        detectedFolderName: detectedFolderName,
        relativePath: relativePath
      });
      
      setStatus('✅ 自動保存準備完了: ' + displayName);
      return true;
      
    } catch (error) {
      console.error('[Dropzone] Failed to setup auto-save:', error);
      setStatus('❌ 自動保存の設定に失敗しました');
      return false;
    }
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

  // 設定変更時の自動再処理
  useEffect(() => {
    // 保存された画像データがあり、バッチモードの場合は再処理
    if (savedGroups.length > 0 && batchMode.current) {
      console.log('[Dropzone] Config changed, triggering re-process for saved groups:', savedGroups.length);
      
      // 新しい設定でプロファイルを再生成
      const profileKeys = Object.keys(config.profiles || {});
      const validKeys = profileKeys.filter(k => k !== 'default');
      const useKeys = validKeys.length > 0 ? validKeys : profileKeys;
      
      const updatedProfiles: { tag: string; size: string; formats?: string[] }[] = [];
      for (const k of useKeys) {
        const p = config.profiles[k];
        if (p?.sizes && Array.isArray(p.sizes)) {
          const firstSize = p.sizes[0];
          if (firstSize) {
            const formats = (p as any).formats || [];
            if (formats.length > 0) {
              updatedProfiles.push({ 
                tag: k, 
                size: `${firstSize.width}x${firstSize.height}`,
                formats: formats
              });
            }
          }
        }
      }
      
      if (updatedProfiles.length > 0) {
        console.log('[Dropzone] Re-processing with updated profiles:', updatedProfiles);
        setIsReprocessing(true);
        setStatus('設定変更を適用中...');
        
        // Use original composeMany for config changes
        try {
          worker.postMessage({ 
            type: 'composeMany', 
            payload: { 
              groups: savedGroups, 
              profiles: updatedProfiles, 
              layouts: config.layouts || undefined 
            },
            source: 'config-change'
          });
        } catch (error) {
          console.error('[Dropzone] Failed to re-process with updated config:', error);
          setStatus(`設定変更エラー: ${error instanceof Error ? error.message : String(error)}`);
          alert(`⚠️ 設定変更エラー\n\n${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }, [config, savedGroups, worker]);

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
          if (batchMode.current && fileId) {
            // バッチモードでは個別のcompose処理は不要（composeManyで一括処理）
            console.log('[Dropzone] Batch mode - skipping individual compose processing for:', fileId);
            doneRef.current += 1;
            setStatus(`処理中 ${doneRef.current}/${totalRef.current}`);
            fileBitmaps.current.delete(fileId);
          } else if (!batchMode.current) {
            onDetected?.(bmp, bbox);
          }
        }
      } else if (data?.type === 'composeMany') {
        // composeMany完了時の処理
        debugController.log('Dropzone', 'composeMany completed');
        
        // Simple check of auto-save handle after composeMany
        debugController.log('Dropzone', 'Auto-save handle status after composeMany:', {
          hasGlobalHandle: !!((window as any).autoSaveHandle),
          handleName: (window as any).autoSaveHandle?.name
        });
        
        if (isReprocessing) {
          setIsReprocessing(false);
          setStatus('設定変更の適用が完了しました');
          // 2秒後にステータスをクリア
          setTimeout(() => {
            if (batchMode.current) {
              setStatus(`処理完了`);
            }
          }, 2000);
        }
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker, batchSizes, onDetected, isReprocessing]);

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
    async (acceptedFiles: File[], event?: any) => {
      console.log('[DEBUG] onDrop called with files:', acceptedFiles.length);
      if (acceptedFiles.length === 0) return;
      
      // Get folder name from DataTransfer items if available
      let folderName: string | null = null;
      if (event && event.dataTransfer && event.dataTransfer.items) {
        debugController.log('Dropzone', 'Analyzing DataTransfer items:', event.dataTransfer.items.length);
        for (let i = 0; i < event.dataTransfer.items.length; i++) {
          const item = event.dataTransfer.items[i];
          debugController.log('Dropzone', `Item ${i}:`, { 
            kind: item.kind, 
            type: item.type,
            hasWebkitGetAsEntry: !!item.webkitGetAsEntry 
          });
          
          if (item.webkitGetAsEntry) {
            const entry = item.webkitGetAsEntry();
            debugController.log('Dropzone', `Entry ${i}:`, {
              name: entry?.name,
              isDirectory: entry?.isDirectory,
              isFile: entry?.isFile
            });
            
            if (entry && entry.isDirectory) {
              folderName = entry.name;
              debugController.log('Dropzone', 'Detected folder from webkitEntry:', folderName);
              break;
            }
          }
        }
      }
      
      debugController.log('Dropzone', 'Final detected folder name:', folderName);
      
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
        
        const autoSaveSetup = await setupAutoSaveIfNeeded(images, folderName);
        debugController.log('Dropzone', 'Auto-save setup result:', autoSaveSetup);
      } else {
        // Single file mode - also setup auto-save
        console.log('[Dropzone] Single file mode, setting up auto-save...');
        const autoSaveSetup = await setupAutoSaveIfNeeded(images, folderName);
        debugController.log('Dropzone', 'Single mode auto-save setup result:', autoSaveSetup);
      }

      // Ensure preview canvas is ready with first image size
      try {
        // Check first image format and size
        const firstFile = images[0];
        const extension = firstFile.name.split('.').pop()?.toLowerCase() || '';
        const supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
      // Note: TIF/TIFF support will be added in future with dedicated library
        
        if (!supportedFormats.includes(extension)) {
          setStatus(`エラー: 非対応形式 (.${extension.toUpperCase()})`);
          alert(`⚠️ 非対応ファイル形式\n\n` +
                `ファイル: ${firstFile.name}\n` +
                `形式: .${extension.toUpperCase()}\n\n` +
                `💡 対応方法:\n` +
                `TIF/TIFFファイルはJPG/PNGに変換してからご利用ください。`);
          return;
        }
        
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (firstFile.size > maxSize) {
          setStatus(`エラー: ファイルサイズ超過 (${(firstFile.size / 1024 / 1024).toFixed(1)}MB)`);
          alert(`⚠️ ファイルサイズが大きすぎます\n\n` +
                `ファイル: ${firstFile.name}\n` +
                `サイズ: ${(firstFile.size / 1024 / 1024).toFixed(1)}MB\n` +
                `制限: 50MB\n\n` +
                `💡 対応方法:\n` +
                `画像を圧縮してからご利用ください。`);
          return;
        }
        
        const firstBitmap = await createImageBitmap(images[0]);
        lastBitmapRef.current = firstBitmap;
        const preview = canvasRef.current;
        if (preview) {
          preview.width = firstBitmap.width;
          preview.height = firstBitmap.height;
          const pctx = preview.getContext('2d');
          pctx?.drawImage(firstBitmap, 0, 0);
        }
        
      } catch (error) {
        console.error('[Dropzone] Error processing first image:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        setStatus(`エラー: ${errorMessage.includes('createImageBitmap') ? '画像読み込み失敗' : '処理エラー'}`);
        alert(`⚠️ 画像処理エラー\n\n` +
              `ファイル: ${images[0]?.name || '不明'}\n` +
              `エラー: ${errorMessage}\n\n` +
              `💡 対応方法:\n` +
              `• ファイルが破損していないか確認してください\n` +
              `• 対応形式（JPG、PNG、WebP、GIF、BMP）に変換してください`);
        return;
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

      // Process all images with error handling
      const groupsMap = new Map<string, { images: ImageBitmap[]; filenames: string[] }>();
      const errorFiles: { name: string; reason: string; size: number }[] = [];
      const supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
      // Note: TIF/TIFF support will be added in future with dedicated library
      
      for (const file of images) {
        try {
          // Check file format
          const extension = file.name.split('.').pop()?.toLowerCase() || '';
          if (!supportedFormats.includes(extension)) {
            errorFiles.push({
              name: file.name,
              reason: `非対応形式（.${extension.toUpperCase()}）`,
              size: file.size
            });
            console.warn(`[Dropzone] Unsupported format: ${file.name} (.${extension})`);
            continue;
          }
          
          // Check file size (limit: 50MB)
          const maxSize = 50 * 1024 * 1024; // 50MB
          if (file.size > maxSize) {
            errorFiles.push({
              name: file.name,
              reason: `ファイルサイズが大きすぎます（${(file.size / 1024 / 1024).toFixed(1)}MB > 50MB）`,
              size: file.size
            });
            console.warn(`[Dropzone] File too large: ${file.name} (${file.size} bytes)`);
            continue;
          }
          
          console.log(`[Dropzone] Processing image: ${file.name} (${extension}, ${(file.size / 1024).toFixed(1)}KB)`);
          const bitmap = await createImageBitmap(file);
          
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            errorFiles.push({
              name: file.name,
              reason: 'Canvas描画エラー',
              size: file.size
            });
            continue;
          }
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
          
        } catch (error) {
          // Handle createImageBitmap and other processing errors
          console.error(`[Dropzone] Error processing ${file.name}:`, error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          errorFiles.push({
            name: file.name,
            reason: `処理エラー: ${errorMessage.includes('createImageBitmap') ? '画像形式の読み込みに失敗' : errorMessage}`,
            size: file.size
          });
        }
      }
      
      // Display error summary if there are any errors
      if (errorFiles.length > 0) {
        const errorSummary = errorFiles.map(ef => 
          `• ${ef.name}: ${ef.reason}`
        ).join('\n');
        
        const totalErrors = errorFiles.length;
        const processedCount = images.length - totalErrors;
        
        console.warn(`[Dropzone] ${totalErrors} files could not be processed:`, errorFiles);
        
        // Show error dialog with detailed information
        const showDetailedErrors = confirm(
          `⚠️ 処理できないファイルが ${totalErrors} 個見つかりました。\n` +
          `正常処理: ${processedCount} 個\n\n` +
          `詳細なエラー情報を確認しますか？\n` +
          `（キャンセルしても処理可能なファイルは続行されます）`
        );
        
        if (showDetailedErrors) {
          alert(`📋 エラーファイル詳細:\n\n${errorSummary}\n\n` +
                `💡 対応方法:\n` +
                `• TIF/TIFFファイル → JPG/PNGに変換してください\n` +
                `• 大きすぎるファイル → 画像を圧縮してください\n` +
                `• その他 → ファイルが破損していないか確認してください`);
        }
        
        // Update status to show error count
        setStatus(`処理完了 (成功: ${processedCount}, エラー: ${totalErrors})`);
      }

      // Trigger folder-level compose for all profiles (variations)
      console.log('[Dropzone] Checking composeMany conditions:', {
        batchMode: batchMode.current,
        currentProfiles: currentProfiles?.length,
        profilesAll: profilesAll?.length,
        groupsMapSize: groupsMap.size
      });
      
      // Check if we should execute batch processing
      const hasAutoSave = (window as any).autoSaveHandle !== undefined;
      const shouldExecuteBatch = batchMode.current && currentProfiles && currentProfiles.length > 0 && groupsMap.size > 0;
      
      console.log('[Dropzone] Batch execution check:', {
        batchMode: batchMode.current,
        hasProfiles: currentProfiles && currentProfiles.length > 0,
        hasGroups: groupsMap.size > 0,
        hasAutoSave: hasAutoSave,
        shouldExecute: shouldExecuteBatch
      });
      
      if (shouldExecuteBatch) {
        const groups = Array.from(groupsMap.entries()).map(([name, data]) => ({ 
          name, 
          images: data.images, 
          filenames: data.filenames 
        }));
        
        // 画像データを保存（設定変更時の再処理用）
        setSavedGroups(groups);
        console.log('[Dropzone] Saved groups for re-processing:', groups.length);
        
        console.log('[Dropzone] Sending composeMany:', groups.length, 'groups', currentProfiles?.length || 0, 'profiles');
        console.log('[Dropzone] Groups:', groups.map(g => ({ name: g.name, imageCount: g.images.length })));
        console.log('[Dropzone] Sending layouts to worker:', currentLayouts);
        
        // Send batch data to App.tsx for retention (direct to main thread, not worker)
        window.dispatchEvent(new CustomEvent('composeManyRequest', {
          detail: { 
            groups, 
            profiles: currentProfiles, 
            layouts: currentLayouts || undefined 
          }
        }));
        
        // Check for large batches and warn user
        const totalImages = groups.reduce((sum, group) => sum + group.images.length, 0);
        if (totalImages > 12) {
          const proceed = confirm(`⚠️ 大量ファイル処理警告\n\n` +
                                `処理ファイル数: ${totalImages}枚\n` +
                                `メモリ不足の可能性があります。\n\n` +
                                `続行しますか？\n` +
                                `（推奨: 10枚以下に分けて処理）`);
          if (!proceed) {
            setStatus('処理がキャンセルされました');
            return;
          }
        }
        
        // Use original composeMany processing
        try {
          worker.postMessage({ 
            type: 'composeMany', 
            payload: { groups, profiles: currentProfiles || [], layouts: currentLayouts },
            source: 'batch'
          });
        } catch (error) {
          console.error('[Dropzone] Failed to send composeMany:', error);
          setStatus(`処理エラー: ${error instanceof Error ? error.message : String(error)}`);
          alert(`⚠️ 処理エラー\n\n${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        console.warn('[Dropzone] Not sending composeMany - conditions not met:', {
          batchMode: batchMode.current,
          profilesCount: currentProfiles?.length || 0,
          groupsCount: groupsMap.size,
          hasAutoSave: hasAutoSave
        });
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
        <p style={{ margin: 0, color: isReprocessing ? '#1976d2' : 'inherit' }}>
          {isDragActive ? 'ここにドロップ' : status}
          {isReprocessing && ' 🔄'}
        </p>
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
