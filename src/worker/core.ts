import type { Prediction } from './yolo';
import type { ResizeSpec } from './opencv';
import type { PsdLayer } from './psd';

import { init as initYolo, detect as detectYolo } from './yolo';
import { cropAndResize } from './opencv';
import { createPsd } from './psd';

// Canvas-based fallback for when OpenCV fails
async function cropAndResizeWithCanvas(
  image: ImageBitmap, 
  bbox: [number, number, number, number], 
  sizes: ResizeSpec[]
): Promise<Record<string, ImageBitmap>> {
  const [x, y, w, h] = bbox;
  const results: Record<string, ImageBitmap> = {};
  
  console.log('[Canvas Fallback] Processing', sizes.length, 'target sizes');
  
  for (const size of sizes) {
    const { name, width, height } = size;
    console.log('[Canvas Fallback] Creating', name, 'at', width + 'x' + height);
    
    // Create canvas for cropping and resizing
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2D context');
    
    // Fill background with white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    
    // Calculate scaling to fit the cropped area into target size
    const scaleX = width / w;
    const scaleY = height / h;
    const scale = Math.min(scaleX, scaleY);
    
    const scaledWidth = w * scale;
    const scaledHeight = h * scale;
    
    // Center the image
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;
    
    // Draw the cropped and scaled image
    ctx.drawImage(
      image,
      x, y, w, h, // Source crop area
      offsetX, offsetY, scaledWidth, scaledHeight // Destination area
    );
    
    // Convert to ImageBitmap
    const bitmap = await createImageBitmap(canvas);
    results[name] = bitmap;
    console.log('[Canvas Fallback] Created bitmap for', name);
  }
  
  console.log('[Canvas Fallback] Final results:', Object.keys(results));
  
  return results;
}

interface InitMessage {
  type: 'init';
}

interface DetectMessage {
  type: 'detect';
  payload: { fileId: string; imageData: ImageData };
}

interface ComposePayload {
  image: ImageBitmap;
  bbox: [number, number, number, number];
  sizes: ResizeSpec[];
  exportPsd?: boolean;
}

interface ComposeMessage {
  type: 'compose';
  payload: ComposePayload;
  source?: string;
}

// ---- ComposeMany (folder layout) ----
export type LayoutOrientation = 'vertical' | 'horizontal' | 'square';

export interface LayoutPatternConfig {
  rows: number[];
}

export interface LayoutDefinition {
  gutter?: number;
  bg_color?: string;
  patterns?: Record<string, LayoutPatternConfig>;
}

export type LayoutsConfig = Partial<Record<LayoutOrientation, LayoutDefinition>>;

export interface ComposeGroup {
  name: string; // group output base name
  images: ImageBitmap[];
  filenames?: string[]; // original filenames for PSD layer names
}

export interface ProfileDef {
  tag: string;
  size: string;
  formats?: string[];
  displayName?: string;
  fileBase?: string;
}

interface ComposeManyMessage {
  type: 'composeMany';
  payload: {
    groups: ComposeGroup[];
    profiles: ProfileDef[];
    layouts?: LayoutsConfig;
  };
  source?: string;
}

type Message = InitMessage | DetectMessage | ComposeMessage | ComposeManyMessage;

type OffscreenCanvasConvertible = OffscreenCanvas & {
  convertToBlob?: (options?: ImageEncodeOptions) => Promise<Blob>;
  transferToImageBitmap?: () => ImageBitmap;
};

async function renderOffscreenToImageBitmap(canvas: OffscreenCanvas): Promise<ImageBitmap> {
  const convertible = canvas as OffscreenCanvasConvertible;
  if (typeof convertible.transferToImageBitmap === 'function') {
    return convertible.transferToImageBitmap();
  }
  if (typeof convertible.convertToBlob === 'function') {
    const blob = await convertible.convertToBlob();
    return createImageBitmap(blob);
  }
  throw new Error('OffscreenCanvas cannot be converted to ImageBitmap in this environment');
}

async function convertOffscreenToBlob(canvas: OffscreenCanvas, options?: ImageEncodeOptions): Promise<Blob | null> {
  const convertible = canvas as OffscreenCanvasConvertible;
  if (typeof convertible.convertToBlob === 'function') {
    return convertible.convertToBlob(options);
  }
  if (typeof convertible.transferToImageBitmap === 'function') {
    const bitmap = convertible.transferToImageBitmap();
    const fallbackCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    fallbackCanvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const fallbackConvertible = fallbackCanvas as OffscreenCanvasConvertible;
    if (typeof fallbackConvertible.convertToBlob === 'function') {
      return fallbackConvertible.convertToBlob(options);
    }
  }
  return null;
}

self.onmessage = async (e: MessageEvent<Message>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      await initYolo();
      postMessage({ type: 'progress', step: 'init' });
      break;

    case 'detect': {
      const { fileId, imageData } = msg.payload;
      try {
        const predictions: Prediction[] = await detectYolo(imageData);
        postMessage({ type: 'progress', step: 'detect', fileId });
        postMessage({ type: 'detect', fileId, predictions });
      } catch (e) {
        // Guard: never crash worker
        postMessage({ type: 'progress', step: 'detect', fileId });
        postMessage({ type: 'detect', fileId, predictions: [] as Prediction[] });
        console.warn('[worker] detect failed:', e);
      }
      break;
    }

    case 'compose': {
      const { image, bbox, sizes, exportPsd } = msg.payload;
      const source = msg.source;
      console.log('[Worker] Processing compose request with source:', source);
      console.log('[Worker] Image size:', image.width, 'x', image.height);
      console.log('[Worker] Bbox:', bbox);
      console.log('[Worker] Target sizes:', sizes);
      
      try {
        // Try OpenCV first, fallback to Canvas API if it fails
        let crops: Record<string, ImageBitmap>;
        try {
          crops = await cropAndResize(image, bbox, sizes);
          postMessage({ type: 'progress', step: 'opencv' });
        } catch (opencvError: unknown) {
          const message = opencvError instanceof Error ? opencvError.message : String(opencvError);
          console.log('[Worker] OpenCV failed, using Canvas fallback:', message);
          crops = await cropAndResizeWithCanvas(image, bbox, sizes);
          postMessage({ type: 'progress', step: 'canvas-fallback' });
        }

        const layers: PsdLayer[] = Object.entries(crops).map(([name, img]) => ({
          name,
          image: img,
        }));

        postMessage({ type: 'progress', step: 'compose' });

        const psd = await createPsd(image.width, image.height, layers, exportPsd);

        postMessage({ type: 'progress', step: 'psd' });
        console.log('[Worker] Sending compose result with', Object.keys(crops).length, 'images');
        postMessage({ type: 'compose', images: crops, psd, source });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Worker] Compose failed:', message);
        postMessage({ type: 'error', error: message, source });
      }
      break;
    }

    case 'composeMany': {
      const { groups, profiles, layouts } = msg.payload;
      const source = msg.source;
      console.log('[Worker] Starting composeMany:', groups.length, 'groups', profiles.length, 'profiles', 'source:', source);
      const outputs: { filename: string; image: ImageBitmap; psd?: Blob; png?: Blob; formats?: string[] }[] = [];
      for (const group of groups) {
        for (const prof of profiles) {
          const profileLabel = prof.displayName ?? prof.tag;
          const fileBase =
            prof.fileBase && prof.fileBase.trim().length ? prof.fileBase.trim() : prof.tag;
          const [tw, th] = prof.size.split('x').map((v) => parseInt(v, 10));
          const orient: LayoutOrientation = th > tw ? 'vertical' : tw > th ? 'horizontal' : 'square';
          const layoutCfg: LayoutDefinition = layouts?.[orient] ?? { gutter: 0, bg_color: '#FFFFFF', patterns: {} };
          const pat = layoutCfg.patterns?.[String(group.images.length)];
          console.log(
            `[Worker] ${group.name}_${fileBase} (${profileLabel}): ${tw}x${th} → ${orient}, ${group.images.length} images → pattern:`,
            pat?.rows
          );
          
          // Generate outputs for each requested format
          const formats = prof.formats || [];
          
          // Skip if no formats are selected
          if (formats.length === 0) {
            console.log(`[Worker] Skipping profile "${profileLabel}" - no formats selected`);
            continue;
          }
          let rows: number[];
          if (pat && Array.isArray(pat.rows)) {
            rows = pat.rows;
          } else {
            // fallback: near-square grid
            const n = group.images.length;
            const cols = Math.ceil(Math.sqrt(n));
            const rcount = Math.ceil(n / cols);
            rows = Array.from({ length: rcount }, (_, i) => (i < rcount - 1 ? cols : n - cols * (rcount - 1) || cols));
          }
          const gutter = layoutCfg.gutter ?? 0;
          const bg = layoutCfg.bg_color ?? '#FFFFFF';
          const canvas = new OffscreenCanvas(tw, th);
          const ctx = canvas.getContext('2d')!;
          // fill bg
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, tw, th);
          
          // For PSD generation, collect layer information
          const psdLayers: PsdLayer[] = [];
          
          // compute per-row height with proper distribution
          const totalGutterH = gutter * (rows.length - 1);
          const availableH = th - totalGutterH;
          let y = 0;
          let idx = 0;
          
          for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const rc = rows[rowIdx];
            const isLastRow = rowIdx === rows.length - 1;
            
            // Calculate row height - last row gets remainder to avoid gaps
            let rowH: number;
            if (isLastRow) {
              rowH = th - y; // Use all remaining space
            } else {
              rowH = Math.floor(availableH / rows.length);
            }
            
            // Calculate cell width with proper distribution
            const totalGutterW = gutter * (rc - 1);
            const availableW = tw - totalGutterW;
            const baseCellW = Math.floor(availableW / rc);
            let currentX = 0;
            
            for (let c = 0; c < rc; c++) {
              const img = group.images[idx];
              if (!img) break;
              
              const isLastCol = c === rc - 1;
              
              // Calculate cell width - last column gets remainder to avoid gaps
              let cellW: number;
              if (isLastCol) {
                cellW = tw - currentX; // Use all remaining width
              } else {
                cellW = baseCellW;
              }
              
              // ImageOps.fit() equivalent: crop and scale to fill the entire cell
              const cellAspect = cellW / rowH;
              const imgAspect = img.width / img.height;
              
              let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;
              
              // Crop the source image to match cell aspect ratio (center crop)
              if (imgAspect > cellAspect) {
                // Image is wider than cell - crop horizontally
                srcW = Math.round(img.height * cellAspect);
                srcX = Math.round((img.width - srcW) / 2);
              } else if (imgAspect < cellAspect) {
                // Image is taller than cell - crop vertically  
                srcH = Math.round(img.width / cellAspect);
                srcY = Math.round((img.height - srcH) / 2);
              }
              
              // Draw the cropped source to fill the entire cell
              ctx.drawImage(img, srcX, srcY, srcW, srcH, currentX, y, cellW, rowH);
              
              // Create individual image for PSD layer (cropped and resized)
              if (formats.includes('psd')) {
                const layerCanvas = new OffscreenCanvas(cellW, rowH);
                const layerCtx = layerCanvas.getContext('2d')!;
                layerCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, cellW, rowH);
                const layerBitmap = await renderOffscreenToImageBitmap(layerCanvas);
                
                const layerName = group.filenames?.[idx] || `Image_${idx + 1}`;
                psdLayers.push({
                  name: layerName,
                  image: layerBitmap,
                  left: currentX,
                  top: y
                });
              }
              
              // Update X position for next cell and increment image index
              currentX += cellW + gutter;
              idx++;
            }
            y += rowH + gutter;
          }
          const composed = await renderOffscreenToImageBitmap(canvas);
          
          let psdBlob: Blob | null = null;
          let pngBlob: Blob | null = null;
          
          // Generate PSD if requested
          if (formats.includes('psd') && psdLayers.length > 0) {
            psdBlob = await createPsd(tw, th, psdLayers, true);
          }
          
          // Generate PNG if requested
          if (formats.includes('png')) {
            const pngCanvas = new OffscreenCanvas(composed.width, composed.height);
            const pngCtx = pngCanvas.getContext('2d')!;
            pngCtx.drawImage(composed, 0, 0);
            pngBlob = await convertOffscreenToBlob(pngCanvas, { type: 'image/png' });
          }
          
          outputs.push({
            filename: `${group.name}_${fileBase}`, // Base filename without extension
            image: composed,
            psd: psdBlob || undefined,
            png: pngBlob || undefined,
            formats // Include requested formats for OutputPanel
          });
        }
      }
      console.log('[Worker] Sending composeMany result:', outputs.length, 'outputs');
      postMessage({ type: 'composeMany', outputs, source });
      break;
    }
  }
};
