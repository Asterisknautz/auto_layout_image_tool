// Helper functions for cropping and resizing images using OpenCV.js
// The module is loaded dynamically on first use to keep initial bundle small.

export type PadOption = 'white' | 'transparent' | [number, number, number];

export interface ResizeSpec {
  name: string;
  width: number;
  height: number;
  pad?: PadOption;
}

let cv: any;
let cvReady: Promise<void> | null = null;

async function init() {
  if (!cvReady) {
    cvReady = new Promise<void>(async (resolve, reject) => {
      try {
        console.log('[OpenCV] Starting initialization...');
        
        // Try a different approach: wait for the cv object to be set globally
        let timeoutId: any;
        let pollId: any;
        
        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          if (pollId) clearInterval(pollId);
        };
        
        const success = () => {
          cleanup();
          console.log('[OpenCV] Successfully initialized!');
          resolve();
        };
        
        const failure = (err: Error) => {
          cleanup();
          console.error('[OpenCV] Initialization failed:', err);
          reject(err);
        };
        
        // Set timeout
        timeoutId = setTimeout(() => {
          failure(new Error('OpenCV initialization timeout after 15 seconds'));
        }, 15000);
        
        // CRITICAL: Set up Module BEFORE importing opencv.js
        (self as any).Module = {
          onRuntimeInitialized: () => {
            console.log('[OpenCV] onRuntimeInitialized callback');
            
            // Try different ways to access cv
            if ((self as any).cv) {
              cv = (self as any).cv;
              console.log('[OpenCV] Found cv on global scope');
              success();
              return;
            }
            
            if ((self as any).Module && (self as any).Module.matFromImageData) {
              cv = (self as any).Module;
              console.log('[OpenCV] Found cv functions on Module');
              success();
              return;
            }
            
            // If we still don't have it, start polling
            let pollAttempts = 0;
            pollId = setInterval(() => {
              pollAttempts++;
              console.log(`[OpenCV] Polling for cv functions... (${pollAttempts}/100)`);
              
              if (pollAttempts > 100) {
                failure(new Error('Polling timeout - cv functions not found'));
                return;
              }
              
              const module = (self as any).Module;
              if (module && module.matFromImageData) {
                cv = module;
                console.log('[OpenCV] Found cv functions via polling!');
                success();
              }
            }, 100);
          },
          onAbort: (err: any) => {
            failure(new Error(`OpenCV runtime aborted: ${err}`));
          }
        };
        
        console.log('[OpenCV] Module object set up, now importing opencv.js...');
        
        // Import the module
        const mod = await import('opencv.js');
        console.log('[OpenCV] Module imported, keys:', Object.keys(mod).sort());
        
        // Check if cv is available on the imported module
        if ((mod as any).cv) {
          cv = (mod as any).cv;
          console.log('[OpenCV] Found cv on imported module');
          success();
          return;
        }
        
        // Check if cv is available on default export
        if (mod.default && typeof mod.default === 'object') {
          if ((mod.default as any).matFromImageData) {
            cv = mod.default;
            console.log('[OpenCV] Found cv on default export');
            success();
            return;
          }
        }
        
        // Check if the imported module itself has CV functions
        if ((mod as any).matFromImageData) {
          cv = mod;
          console.log('[OpenCV] Found cv functions directly on imported module');
          success();
          return;
        }
        
        console.log('[OpenCV] Waiting for runtime initialization...');
        
      } catch (e) {
        console.error('[OpenCV] Initialization error:', e);
        reject(e);
      }
    });
  }
  return cvReady;
}

function padToScalar(pad: PadOption | undefined): any {
  if (!cv) throw new Error('OpenCV has not been initialised');
  if (Array.isArray(pad)) {
    const [r, g, b] = pad;
    return new cv.Scalar(r, g, b, 255);
  }
  switch (pad) {
    case 'white':
      return new cv.Scalar(255, 255, 255, 255);
    case 'transparent':
      return new cv.Scalar(0, 0, 0, 0);
    default:
      return new cv.Scalar(0, 0, 0, 0);
  }
}

export async function cropAndResize(
  img: ImageBitmap,
  bbox: [number, number, number, number],
  sizes: ResizeSpec[]
): Promise<Record<string, ImageBitmap>> {
  await init();

  const [x, y, w, h] = bbox.map(Math.round) as [number, number, number, number];

  // draw ImageBitmap to canvas to get ImageData
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const srcData = ctx.getImageData(0, 0, img.width, img.height);

  const srcMat = cv.matFromImageData(srcData);
  const rect = new cv.Rect(x, y, w, h);
  const cropMat = srcMat.roi(rect);

  const results: Record<string, ImageBitmap> = {};

  for (const spec of sizes) {
    const { name, width: tw, height: th, pad } = spec;
    const scale = Math.min(tw / cropMat.cols, th / cropMat.rows);
    const newW = Math.round(cropMat.cols * scale);
    const newH = Math.round(cropMat.rows * scale);

    const resized = new cv.Mat();
    cv.resize(cropMat, resized, new cv.Size(newW, newH), 0, 0, cv.INTER_AREA);

    const out = new cv.Mat(th, tw, cv.CV_8UC4);
    out.setTo(padToScalar(pad));
    const roi = out.roi(new cv.Rect(Math.floor((tw - newW) / 2), Math.floor((th - newH) / 2), newW, newH));
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

