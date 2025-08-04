// Helper functions for cropping and resizing images using OpenCV.js
// The module is loaded dynamically on first use to keep initial bundle small.

export type PadOption = 'white' | 'transparent' | [number, number, number];

export interface ResizeSpec {
  name: string;
  width: number;
  height: number;
  pad?: PadOption;
}

let cv: any | null = null;
let cvReady: Promise<void> | null = null;

async function init() {
  if (!cvReady) {
    cvReady = new Promise<void>(async (resolve) => {
      // dynamic import of opencv.js
      const mod: any = await import('opencv.js');
      // wait for WASM runtime to be ready
      mod.onRuntimeInitialized = () => {
        cv = mod;
        resolve();
      };
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

