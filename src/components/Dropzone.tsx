import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useDropzone } from 'react-dropzone';
import type { DropEvent } from 'react-dropzone';
import { useProfiles } from '../context/ProfilesContext';
import { debugController } from '../utils/debugMode';
import { outputRootManager } from '../utils/outputRootManager';
import type { ComposeGroup, LayoutsConfig, ProfileDef } from '../worker/core';
import type { ComposeManyRequestDetail, WorkerMessageEvent } from '../types/worker';
import type { AnyFileSystemEntry, DirectoryEntry, FileEntry, FileWithDirectory } from '../types/files';

const isFileEntry = (entry: AnyFileSystemEntry): entry is FileEntry => entry.isFile;
const isDirectoryEntry = (entry: AnyFileSystemEntry): entry is DirectoryEntry => entry.isDirectory;

const getProductCenterCrop = (width: number, height: number): [number, number, number, number] => {
  const minDim = Math.min(width, height);
  const cropSize = Math.floor(minDim * 0.8);
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const left = centerX - Math.floor(cropSize / 2);
  const top = centerY - Math.floor(cropSize / 2);

  console.log(
    '[Product Crop]',
    `Image: ${width}x${height}, Crop: ${cropSize}x${cropSize} at (${left},${top}) - 20% margin`
  );

  return [left, top, cropSize, cropSize];
};

const detectWhiteBackground = (imageData: ImageData): boolean => {
  const { data, width, height } = imageData;
  const sampleSize = 100;
  let whitePixels = 0;

  for (let i = 0; i < sampleSize; i++) {
    const topIdx = Math.floor(Math.random() * width) * 4;
    const bottomIdx = ((height - 1) * width + Math.floor(Math.random() * width)) * 4;
    const leftIdx = Math.floor(Math.random() * height) * width * 4;
    const rightIdx = (Math.floor(Math.random() * height) * width + (width - 1)) * 4;

    [topIdx, bottomIdx, leftIdx, rightIdx].forEach((idx) => {
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (r > 220 && g > 220 && b > 220) {
        whitePixels += 1;
      }
    });
  }

  const whitePercentage = (whitePixels / (sampleSize * 4)) * 100;
  const isWhite = whitePercentage > 70;
  console.log(
    '[Background Detection]',
    `White pixels: ${whitePixels}/${sampleSize * 4} (${whitePercentage.toFixed(1)}%) → ${isWhite ? 'WHITE' : 'NATURAL'}`
  );
  return isWhite;
};

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
type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: boolean;
  directory?: boolean;
};

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
  const [profilesAll, setProfilesAll] = useState<ProfileDef[]>([]);
  const [layoutsCfg, setLayoutsCfg] = useState<LayoutsConfig | null>(null);
  const topNameRef = useRef<string>('output');
  const { config } = useProfiles();
  
  // 画像データを永続化して設定変更時の再処理に使用
  const [savedGroups, setSavedGroups] = useState<ComposeGroup[]>([]);
  const [isReprocessing, setIsReprocessing] = useState(false);
  
  /*
  // Disabled: Complex chunk processing caused infinite loops and memory leaks
  // Simple warning system is used instead for large batches
  */

  // New output root based auto-save setup
  const setupAutoSaveIfNeeded = useCallback(async (
    files: File[],
    detectedFolderName?: string | null
  ): Promise<boolean> => {
    console.log('[DEBUG] setupAutoSaveIfNeeded called with:', { 
      filesCount: files.length, 
      detectedFolderName: detectedFolderName 
    });
    
    if (files.length === 0) {
      console.log('[DEBUG] No files, returning false');
      return false;
    }

    // Extract folder information from various sources
    const firstFile = files[0] as FileWithDirectory;
    const webkitRelativePath = firstFile.webkitRelativePath ?? '';
    const relativePath = webkitRelativePath || firstFile.path || firstFile.name;
    
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
    else if (firstFile.webkitRelativePath && firstFile.webkitRelativePath.includes('/')) {
      const pathParts = firstFile.webkitRelativePath.split('/');
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
        const { webkitRelativePath: filePath } = file as FileWithDirectory;
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
      webkitRelativePath: firstFile.webkitRelativePath,
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
          `  その中に各プロジェクトのフォルダが作られます\n\n` +
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
      window.autoSaveHandle = projectOutputHandle;
      
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
  }, []);
  
  // Debug: Log config changes
  useEffect(() => {
    console.log('[Dropzone] Config updated:', config);
    console.log('[Dropzone] Config profiles keys:', Object.keys(config.profiles || {}));
    
    // Debug each profile's formats
    if (config.profiles) {
      for (const [key, profile] of Object.entries(config.profiles)) {
        console.log(`[Dropzone] Profile "${key}" formats:`, profile?.formats);
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
            const formats = p?.formats ?? [];
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
    const handler: EventListener = (event) => {
      const message = event as WorkerMessageEvent;
      const payload = message.data;
      if (!payload) return;

      if (payload.type === 'detect') {
        const predictions = payload.predictions ?? [];
        setPredCount(predictions.length);
        setStatus('検出が完了しました');

        const bitmap = (payload.fileId ? fileBitmaps.current.get(payload.fileId) : null) ?? lastBitmapRef.current;
        if (!bitmap) {
          return;
        }

        let bbox: [number, number, number, number];
        const width = bitmap.width;
        const height = bitmap.height;
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }

        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const isWhiteBackground = detectWhiteBackground(imageData);
        const fileName = payload.fileId ? fileNames.current.get(payload.fileId) ?? 'unknown' : 'single-image';
        const totalArea = width * height;

        if (isWhiteBackground) {
          bbox = getProductCenterCrop(width, height);
          const [left, top, size] = bbox;
          const percentage = ((size * size) / totalArea * 100).toFixed(1);
          console.log('[Dropzone]', fileName, `White background detected, center crop: ${size}x${size} (${percentage}%) at (${left},${top})`);
        } else if (predictions.length > 0) {
          const minArea = Math.max(1000, totalArea * 0.02);
          const maxArea = Math.min(totalArea * 0.8, 200000);
          console.log('[Dropzone]', fileName, `Natural photo - Area constraints: min=${minArea.toLocaleString()} max=${maxArea.toLocaleString()}`);

          if (minArea > maxArea) {
            const side = Math.min(width, height) * 0.8;
            bbox = [Math.floor((width - side) / 2), Math.floor((height - side) / 2), Math.floor(side), Math.floor(side)];
            console.log('[Dropzone]', fileName, 'Image too large for constraints, using center square (80%)');
          } else {
            const minConfidence = 0.3;
            const validPredictions = predictions.filter((prediction) => {
              const area = prediction.bbox[2] * prediction.bbox[3];
              return area >= minArea && area <= maxArea && prediction.score >= minConfidence;
            });

            console.log('[Dropzone]', fileName, `Predictions: total=${predictions.length} valid=${validPredictions.length}`);

            if (validPredictions.length > 0) {
              const best = validPredictions.reduce((currentBest, candidate) => {
                const currentArea = currentBest.bbox[2] * currentBest.bbox[3];
                const candidateArea = candidate.bbox[2] * candidate.bbox[3];
                return candidateArea > currentArea ? candidate : currentBest;
              });
              bbox = best.bbox;
              const bboxArea = best.bbox[2] * best.bbox[3];
              const percentage = ((bboxArea / totalArea) * 100).toFixed(1);
              console.log('[Dropzone]', fileName,
                `Image: ${width}x${height} (${totalArea.toLocaleString()})`,
                `Selected bbox: area=${bboxArea.toLocaleString()} (${percentage}%)`,
                `confidence=${best.score.toFixed(3)}`
              );
            } else {
              const side = Math.min(width, height) * 0.8;
              bbox = [Math.floor((width - side) / 2), Math.floor((height - side) / 2), Math.floor(side), Math.floor(side)];
              console.log('[Dropzone]', fileName, 'All predictions outside area constraints, using center square (80%)');
            }
          }
        } else {
          const side = Math.min(width, height) * 0.8;
          bbox = [Math.floor((width - side) / 2), Math.floor((height - side) / 2), Math.floor(side), Math.floor(side)];
          console.log('[Dropzone]', fileName, 'No predictions, using center square (80%)');
        }

        const preview = canvasRef.current;
        if (!batchMode.current && preview) {
          const previewCtx = preview.getContext('2d');
          if (previewCtx) {
            previewCtx.clearRect(0, 0, preview.width, preview.height);
            previewCtx.drawImage(bitmap, 0, 0);
            previewCtx.save();
            previewCtx.lineWidth = Math.max(2, Math.min(preview.width, preview.height) * 0.004);
            previewCtx.strokeStyle = 'rgba(255,0,0,0.9)';
            previewCtx.setLineDash([8, 6]);
            previewCtx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
            previewCtx.restore();
          }
        }

        if (batchMode.current) {
          const maxPreviewWidth = 200;
          const scale = Math.min(1, maxPreviewWidth / bitmap.width);
          const previewWidth = Math.round(bitmap.width * scale);
          const previewHeight = Math.round(bitmap.height * scale);
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = previewWidth;
          thumbCanvas.height = previewHeight;
          const thumbCtx = thumbCanvas.getContext('2d');
          if (thumbCtx) {
            thumbCtx.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
            thumbCtx.save();
            thumbCtx.strokeStyle = 'rgba(255,0,0,0.9)';
            thumbCtx.setLineDash([6, 4]);
            thumbCtx.lineWidth = Math.max(1, Math.min(previewWidth, previewHeight) * 0.01);
            thumbCtx.strokeRect(bbox[0] * scale, bbox[1] * scale, bbox[2] * scale, bbox[3] * scale);
            thumbCtx.restore();

            (async () => {
              const blob = await new Promise<Blob | null>((resolve) => thumbCanvas.toBlob(resolve, 'image/png'));
              if (!blob) return;
              const url = URL.createObjectURL(blob);
              const fullPath = payload.fileId ? fileNames.current.get(payload.fileId) ?? 'image' : 'image';
              let group = topNameRef.current;
              const topPrefix = `${topNameRef.current}/`;
              const relativePath = fullPath.startsWith(topPrefix) ? fullPath.slice(topPrefix.length) : fullPath;
              if (relativePath.includes('/')) {
                group = relativePath.split('/')[0];
              }
              const label = fullPath;
              setGallery((prev) => [...prev, { url, label, bmp: bitmap, bbox, group }]);
            })();
          }
        }

        if (batchMode.current && payload.fileId) {
          console.log('[Dropzone] Batch mode - skipping individual compose processing for:', payload.fileId);
          doneRef.current += 1;
          setStatus(`処理中 ${doneRef.current}/${totalRef.current}`);
          fileBitmaps.current.delete(payload.fileId);
        } else if (!batchMode.current) {
          onDetected?.(bitmap, bbox);
        }
      } else if (payload.type === 'composeMany') {
        debugController.log('Dropzone', 'composeMany completed');
        debugController.log('Dropzone', 'Auto-save handle status after composeMany:', {
          hasGlobalHandle: window.autoSaveHandle != null,
          handleName: window.autoSaveHandle?.name
        });

        if (isReprocessing) {
          setIsReprocessing(false);
          setStatus('設定変更の適用が完了しました');
          setTimeout(() => {
            if (batchMode.current) {
              setStatus('処理完了');
            }
          }, 2000);
        }
      } else if (payload.type === 'error') {
        console.error('[Dropzone] Worker error:', payload.error);
        setStatus(`処理エラー: ${payload.error}`);
      }
    };

    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker, onDetected, isReprocessing]);

  const lastBitmapRef = useRef<ImageBitmap | null>(null);
  const getFilesFromEvent = useCallback(async (event?: DropEvent): Promise<File[]> => {
    if (!event) return [];

    const dataTransfer =
      typeof event === 'object' && event && 'dataTransfer' in event
        ? (event as DragEvent).dataTransfer
        : undefined;

    if (!dataTransfer?.items) {
      if (dataTransfer?.files) {
        return Array.from(dataTransfer.files);
      }
      return [];
    }

    const readEntriesOnce = (reader: FileSystemDirectoryReader): Promise<AnyFileSystemEntry[]> =>
      new Promise((resolve) => reader.readEntries((entries) => resolve(entries as AnyFileSystemEntry[])));

    const traverseEntry = async (entry: AnyFileSystemEntry, path = ''): Promise<File[]> => {
      if (isFileEntry(entry)) {
        return await new Promise((resolve) => {
          entry.file((file: File) => {
            const fileWithDirectory = file as FileWithDirectory;
            const relativePath = `${path}${entry.name}`;
            fileWithDirectory.path = relativePath;
            resolve([fileWithDirectory]);
          });
        });
      }

      if (isDirectoryEntry(entry)) {
        if (entry.name === '_output') {
          debugController.log('Dropzone', 'Skipping _output folder:', `${path}${entry.name}`);
          return [];
        }

        if (!path) {
          topNameRef.current = entry.name;
        }

        const reader = entry.createReader();
        const childEntries = await readEntriesOnce(reader);
        const nestedFiles = await Promise.all(
          childEntries.map((child) => traverseEntry(child, `${path}${entry.name}/`))
        );
        return nestedFiles.flat();
      }

      return [];
    };

    const entries = Array.from(dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is AnyFileSystemEntry => Boolean(entry));

    if (entries.length === 0) {
      return Array.from(dataTransfer.files);
    }

    const firstDirectory = entries.find((entry) => isDirectoryEntry(entry));
    if (firstDirectory) {
      topNameRef.current = firstDirectory.name;
    }

    const allFiles = await Promise.all(entries.map((entry) => traverseEntry(entry)));
    return allFiles.flat();
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[], _fileRejections: unknown[], event?: DropEvent) => {
      console.log('[DEBUG] onDrop called with files:', acceptedFiles.length);
      if (acceptedFiles.length === 0) return;
      
      // Get folder name from DataTransfer items if available
      let folderName: string | null = null;
      const dataTransfer =
        typeof event === 'object' && event && 'dataTransfer' in event
          ? (event as DragEvent).dataTransfer
          : undefined;

      if (dataTransfer?.items) {
        debugController.log('Dropzone', 'Analyzing DataTransfer items:', dataTransfer.items.length);
        for (let i = 0; i < dataTransfer.items.length; i++) {
          const item = dataTransfer.items[i];
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
        console.log('[Dropzone] Using profile for batch processing:', key);
        
        // Generate profiles from ALL profiles, excluding default
        const profs: ProfileDef[] = [];
        for (const k of validKeys.length > 0 ? validKeys : keys) {
          const p = json.profiles[k];
          if (p?.sizes && Array.isArray(p.sizes)) {
            // For composeMany, we use the first size from each profile
            const firstSize = p.sizes[0];
            if (firstSize) {
              const formats = p?.formats ?? [];
              const displayName =
                typeof p.displayName === 'string' && p.displayName.trim().length
                  ? p.displayName.trim()
                  : k.toUpperCase();
              const fileBase =
                typeof p.fileBase === 'string' && p.fileBase.trim().length
                  ? p.fileBase.trim()
                  : k;
              const groupByFormat = Boolean(p.groupByFormat);
              console.log(
                `[Dropzone] Profile "${k}" displayName="${displayName}" fileBase="${fileBase}" formats=`,
                formats,
                'groupByFormat=',
                groupByFormat
              );

              // Skip profiles with no formats selected
              if (formats.length === 0) {
                console.log(`[Dropzone] Skipping profile "${k}" - no formats selected`);
                continue;
              }

              profs.push({ 
                tag: k, 
                size: `${firstSize.width}x${firstSize.height}`,
                formats,
                displayName,
                fileBase,
                groupByFormat
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
          const fileWithDirectory = file as FileWithDirectory;
          const relativePath =
            fileWithDirectory.path ??
            fileWithDirectory.webkitRelativePath ??
            file.name;

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
          fileNames.current.set(fileId, relativePath);
          worker.postMessage({ type: 'detect', payload: { fileId, imageData } });
          
          // accumulate group
          const fullPath = relativePath;
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
      const hasAutoSave = window.autoSaveHandle != null;
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
        const composeEvent = new CustomEvent<ComposeManyRequestDetail>('composeManyRequest', {
          detail: {
            groups,
            profiles: currentProfiles,
            layouts: currentLayouts ?? undefined,
          },
        });
        window.dispatchEvent(composeEvent);
        
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
    [worker, config, profilesAll, layoutsCfg, onBatchMode, setupAutoSaveIfNeeded]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, getFilesFromEvent, multiple: true });
  const inputProps = getInputProps({ multiple: true } as DirectoryInputProps);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.setAttribute('multiple', '');
    inputRef.current.setAttribute('webkitdirectory', '');
    inputRef.current.setAttribute('directory', '');
  }, []);

  return (
    <div>
      <div
        {...getRootProps()}
        style={{ border: '2px dashed #888', padding: '16px', textAlign: 'center', cursor: 'pointer' }}
      >
        <input ref={inputRef} {...inputProps} />
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
