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
      const outputs: { filename: string; image: ImageBitmap }[] = [];
      for (const group of groups) {
        for (const prof of profiles) {
          const [tw, th] = prof.size.split('x').map((v) => parseInt(v, 10));
          const orient = th > tw ? 'vertical' : tw > th ? 'horizontal' : 'square';
          const layoutCfg = (layouts && (layouts as any)[orient]) || { gutter: 0, bg_color: '#FFFFFF', patterns: {} };
          const pat = layoutCfg.patterns?.[String(group.images.length)];
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
          // compute per-row height equal share
          const rowH = Math.floor((th - gutter * (rows.length - 1)) / rows.length);
          let y = 0;
          let idx = 0;
          for (const rc of rows) {
            const cellW = Math.floor((tw - gutter * (rc - 1)) / rc);
            for (let c = 0; c < rc; c++) {
              const img = group.images[idx++];
              if (!img) break;
              const scale = Math.min(cellW / img.width, rowH / img.height);
              const w = Math.round(img.width * scale);
              const h = Math.round(img.height * scale);
              const x = c * (cellW + gutter) + Math.floor((cellW - w) / 2);
              const yy = y + Math.floor((rowH - h) / 2);
              ctx.drawImage(img, x, yy, w, h);
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
      postMessage({ type: 'composeMany', outputs });
      break;
    }
  }
};
