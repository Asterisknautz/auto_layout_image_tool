import { writePsd, initializeCanvas } from 'ag-psd';

export interface PsdLayer {
  /** layer name */
  name: string;
  /** bitmap for the layer image */
  image: ImageBitmap;
  /** top offset in the document */
  top?: number;
  /** left offset in the document */
  left?: number;
}

/**
 * Generate PSD Blob from layers. Layers are arranged in the given order
 * (first item is top-most layer).
 *
 * The PSD is only generated when `exportPsd` is `true`. When it is
 * `false`, the function resolves to `null`.
 */
// Initialize ag-psd canvas for Web Worker environment
let canvasInitialized = false;

function initializeCanvasIfNeeded() {
  if (!canvasInitialized) {
    // Initialize canvas for Web Worker environment
    initializeCanvas((width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height);
      return canvas as any;
    });
    canvasInitialized = true;
  }
}

export async function createPsd(
  width: number,
  height: number,
  layers: PsdLayer[],
  exportPsd = false
): Promise<Blob | null> {
  if (!exportPsd) return null;
  
  // Initialize canvas for thumbnail generation
  initializeCanvasIfNeeded();

  // Create a transparent base layer to prevent first layer from becoming background
  const baseCanvas = new OffscreenCanvas(width, height);
  const baseCtx = baseCanvas.getContext('2d')!;
  baseCtx.clearRect(0, 0, width, height); // Transparent canvas
  
  const children = [
    // Add invisible base layer first
    {
      name: 'Base',
      top: 0,
      left: 0,
      canvas: baseCanvas as unknown as HTMLCanvasElement,
      opacity: 0, // Invisible
      visible: false
    },
    // Then add all actual layers
    ...layers.map((layer) => {
      const offscreen = bitmapToCanvas(layer.image);
      const canvasEl = offscreen as unknown as HTMLCanvasElement;
      return {
        name: layer.name,
        top: layer.top ?? 0,
        left: layer.left ?? 0,
        canvas: canvasEl,
        // All actual layers are normal layers
        opacity: 255,
        visible: true
      };
    })
  ];

  // Create composite image for thumbnail
  const compositeCanvas = new OffscreenCanvas(width, height);
  const compositeCtx = compositeCanvas.getContext('2d')!;
  
  // Fill with white background
  compositeCtx.fillStyle = '#FFFFFF';
  compositeCtx.fillRect(0, 0, width, height);
  
  // Draw all layers to create composite preview
  for (const layer of layers) {
    compositeCtx.drawImage(
      layer.image, 
      layer.left ?? 0, 
      layer.top ?? 0
    );
  }
  
  const buffer = writePsd({ 
    width, 
    height, 
    children,
    // Add composite image for thumbnail generation
    canvas: compositeCanvas as unknown as HTMLCanvasElement
  }, { generateThumbnail: true });
  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}

function bitmapToCanvas(bitmap: ImageBitmap): OffscreenCanvas {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}
