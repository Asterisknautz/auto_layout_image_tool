import type { Prediction } from './yolo';
import type { ResizeSpec } from './opencv';
import type { PsdLayer } from './psd';

import { init as initYolo, detect as detectYolo } from './yolo';
import { cropAndResize } from './opencv';
import { createPsd } from './psd';

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
}

// ---- ComposeMany (folder layout) ----
export interface LayoutsConfig {
  vertical?: { gutter?: number; bg_color?: string; patterns?: Record<string, { rows: number[] }> };
  horizontal?: { gutter?: number; bg_color?: string; patterns?: Record<string, { rows: number[] }> };
  square?: { gutter?: number; bg_color?: string; patterns?: Record<string, { rows: number[] }> };
}

export interface ComposeGroup {
  name: string; // group output base name
  images: ImageBitmap[];
}

export interface ProfileDef { tag: string; size: string }

interface ComposeManyMessage {
  type: 'composeMany';
  payload: {
    groups: ComposeGroup[];
    profiles: ProfileDef[];
    layouts?: LayoutsConfig;
  };
}

type Message = InitMessage | DetectMessage | ComposeMessage | ComposeManyMessage;

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
      const crops = await cropAndResize(image, bbox, sizes);
      postMessage({ type: 'progress', step: 'opencv' });

      const layers: PsdLayer[] = Object.entries(crops).map(([name, img]) => ({
        name,
        image: img,
      }));

      postMessage({ type: 'progress', step: 'compose' });

      const psd = await createPsd(image.width, image.height, layers, exportPsd);

      postMessage({ type: 'progress', step: 'psd' });
      postMessage({ type: 'compose', images: crops, psd });
      break;
    }

    case 'composeMany': {
      const { groups, profiles, layouts } = msg.payload;
      console.log('[Worker] Starting composeMany:', groups.length, 'groups', profiles.length, 'profiles');
      const outputs: { filename: string; image: ImageBitmap }[] = [];
      for (const group of groups) {
        for (const prof of profiles) {
          const [tw, th] = prof.size.split('x').map((v) => parseInt(v, 10));
          const orient = th > tw ? 'vertical' : tw > th ? 'horizontal' : 'square';
          const layoutCfg = (layouts && (layouts as any)[orient]) || { gutter: 0, bg_color: '#FFFFFF', patterns: {} };
          const pat = layoutCfg.patterns?.[String(group.images.length)];
          console.log(`[Worker] ${group.name}_${prof.tag}: ${tw}x${th} → ${orient}, ${group.images.length} images → pattern:`, pat?.rows);
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
              const img = group.images[idx++];
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
              
              // Update X position for next cell
              currentX += cellW + gutter;
            }
            y += rowH + gutter;
          }
          const composed = await (canvas as any).convertToBlob?.()
            .then((b: Blob) => createImageBitmap(b))
            .catch(async () => {
              // fallback path
              const fallbackCanvas = document.createElement('canvas');
              fallbackCanvas.width = tw; fallbackCanvas.height = th;
              const fctx = fallbackCanvas.getContext('2d')!;
              fctx.drawImage(canvas as any, 0, 0);
              const blob: Blob = await new Promise((resolve) => fallbackCanvas.toBlob((bb) => resolve(bb!), 'image/png'));
              return createImageBitmap(blob);
            });
          outputs.push({ filename: `${group.name}_${prof.tag}.jpg`, image: composed });
        }
      }
      console.log('[Worker] Sending composeMany result:', outputs.length, 'outputs');
      postMessage({ type: 'composeMany', outputs });
      break;
    }
  }
};
