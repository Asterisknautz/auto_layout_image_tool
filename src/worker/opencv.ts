// Helper functions for cropping and resizing images using OpenCV.js
// The module is loaded dynamically on first use to keep initial bundle small.

import type cvType from 'opencv.js';

export type PadOption = 'white' | 'transparent' | [number, number, number];

export interface ResizeSpec {
  name: string;
  width: number;
  height: number;
  pad?: PadOption;
}

type CvInterface = typeof cvType;
type CvScalar = InstanceType<CvInterface['Scalar']>;
type OpenCvModule = Partial<CvInterface> & {
  onRuntimeInitialized?: () => void;
  onAbort?: (err: unknown) => void;
  matFromImageData?: CvInterface['matFromImageData'];
};

interface OpenCvGlobal extends ServiceWorkerGlobalScope {
  Module?: OpenCvModule;
  cv?: CvInterface;
}

const globalScope = self as unknown as OpenCvGlobal;

let cv: CvInterface | null = null;
let cvReady: Promise<void> | null = null;

async function init() {
  if (!cvReady) {
    cvReady = new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let pollId: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        if (pollId !== undefined) {
          clearInterval(pollId);
          pollId = undefined;
        }
      };

      const success = () => {
        cleanup();
        console.log('[OpenCV] Successfully initialized!');
        resolve();
      };

      const failure = (err: unknown) => {
        cleanup();
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[OpenCV] Initialization failed:', error);
        reject(error);
      };

      console.log('[OpenCV] Starting initialization...');

      timeoutId = setTimeout(() => {
        failure(new Error('OpenCV initialization timeout after 15 seconds'));
      }, 15000);

      globalScope.Module = {
        onRuntimeInitialized: () => {
          console.log('[OpenCV] onRuntimeInitialized callback');

          if (globalScope.cv) {
            cv = globalScope.cv;
            console.log('[OpenCV] Found cv on global scope');
            success();
            return;
          }

          const moduleCandidate = globalScope.Module;
          if (moduleCandidate && moduleCandidate.matFromImageData) {
            cv = moduleCandidate as CvInterface;
            console.log('[OpenCV] Found cv functions on Module');
            success();
            return;
          }

          let pollAttempts = 0;
          pollId = setInterval(() => {
            pollAttempts++;
            console.log(`[OpenCV] Polling for cv functions... (${pollAttempts}/100)`);

            if (pollAttempts > 100) {
              failure(new Error('Polling timeout - cv functions not found'));
              return;
            }

            const module = globalScope.Module;
            if (module && module.matFromImageData) {
              cv = module as CvInterface;
              console.log('[OpenCV] Found cv functions via polling!');
              success();
            }
          }, 100);
        },
        onAbort: (err: unknown) => {
          failure(new Error(`OpenCV runtime aborted: ${err instanceof Error ? err.message : String(err)}`));
        }
      };

      const loadModule = async () => {
        try {
          console.log('[OpenCV] Module object set up, now importing opencv.js...');
          const mod = await import('opencv.js');
          const candidate = mod.default ?? (mod as Partial<CvInterface>);

          if (candidate && 'matFromImageData' in candidate) {
            cv = candidate as CvInterface;
            globalScope.cv = cv;
            console.log('[OpenCV] Imported cv instance from module');
            success();
            return;
          }

          console.log('[OpenCV] Waiting for runtime initialization...');
        } catch (e) {
          failure(e);
        }
      };

      void loadModule();
    });
  }
  return cvReady;
}

function padToScalar(pad: PadOption | undefined): CvScalar {
  const cvInstance = cv;
  if (!cvInstance) throw new Error('OpenCV has not been initialised');
  if (Array.isArray(pad)) {
    const [r, g, b] = pad;
    return new cvInstance.Scalar(r, g, b, 255);
  }
  switch (pad) {
    case 'white':
      return new cvInstance.Scalar(255, 255, 255, 255);
    case 'transparent':
      return new cvInstance.Scalar(0, 0, 0, 0);
    default:
      return new cvInstance.Scalar(0, 0, 0, 0);
  }
}

export async function cropAndResize(
  img: ImageBitmap,
  bbox: [number, number, number, number],
  sizes: ResizeSpec[]
): Promise<Record<string, ImageBitmap>> {
  await init();
  const cvInstance = cv;
  if (!cvInstance) {
    throw new Error('OpenCV has not been initialised');
  }

  const [x, y, w, h] = bbox.map(Math.round) as [number, number, number, number];

  // draw ImageBitmap to canvas to get ImageData
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const srcData = ctx.getImageData(0, 0, img.width, img.height);

  const srcMat = cvInstance.matFromImageData(srcData);
  const rect = new cvInstance.Rect(x, y, w, h);
  const cropMat = srcMat.roi(rect);

  const results: Record<string, ImageBitmap> = {};

  for (const spec of sizes) {
    const { name, width: tw, height: th, pad } = spec;
    const scale = Math.min(tw / cropMat.cols, th / cropMat.rows);
    const newW = Math.round(cropMat.cols * scale);
    const newH = Math.round(cropMat.rows * scale);

    const resized = new cvInstance.Mat();
    cvInstance.resize(cropMat, resized, new cvInstance.Size(newW, newH), 0, 0, cvInstance.INTER_AREA);

    const out = new cvInstance.Mat(th, tw, cvInstance.CV_8UC4);
    out.setTo(padToScalar(pad));
    const roi = out.roi(new cvInstance.Rect(Math.floor((tw - newW) / 2), Math.floor((th - newH) / 2), newW, newH));
    resized.copyTo(roi);
    roi.delete();

    const imageData = new ImageData(new Uint8ClampedArray(out.data), tw, th);
    results[name] = await createImageBitmap(imageData);

    resized.delete();
    out.delete();
  }

  cropMat.delete();
  srcMat.delete();

  return results;
}
