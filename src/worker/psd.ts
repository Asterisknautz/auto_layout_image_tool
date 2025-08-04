import { writePsd } from 'ag-psd';

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
export async function createPsd(
  width: number,
  height: number,
  layers: PsdLayer[],
  exportPsd = false
): Promise<Blob | null> {
  if (!exportPsd) return null;

  const children = layers.map((layer) => ({
    name: layer.name,
    top: layer.top ?? 0,
    left: layer.left ?? 0,
    canvas: bitmapToCanvas(layer.image),
  }));

  const buffer = writePsd({ width, height, children });
  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}

function bitmapToCanvas(bitmap: ImageBitmap): OffscreenCanvas {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}
