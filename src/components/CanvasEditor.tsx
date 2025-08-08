import { useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import type { Canvas as FabricCanvas } from 'fabric';
import type { ResizeSpec } from '../worker/opencv';

export interface ComposePayload {
  image: ImageBitmap;
  bbox: [number, number, number, number];
  sizes: ResizeSpec[];
  exportPsd?: boolean;
}

interface CanvasEditorProps {
  image: ImageBitmap;
  initialBBox: [number, number, number, number];
  sizes: ResizeSpec[];
  exportPsd?: boolean;
  onChange?: (payload: ComposePayload) => void;
}

export default function CanvasEditor({
  image,
  initialBBox,
  sizes,
  exportPsd,
  onChange,
}: CanvasEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const imageRef = useRef<ImageBitmap | null>(null);

  const fitToContainer = useCallback(() => {
    const fabricCanvas = fabricRef.current;
    const img = imageRef.current;
    const wrapper = wrapperRef.current;
    if (!fabricCanvas || !img || !wrapper) return;
    const maxW = wrapper.clientWidth || img.width;
    const maxH = Math.max(200, window.innerHeight - 240);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const viewW = Math.round(img.width * scale);
    const viewH = Math.round(img.height * scale);
    fabricCanvas.setWidth(viewW);
    fabricCanvas.setHeight(viewH);
    fabricCanvas.setZoom(scale);
    fabricCanvas.requestRenderAll();
  }, []);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    // convert ImageBitmap to DataURL for fabric background image
    const tmp = document.createElement('canvas');
    tmp.width = image.width;
    tmp.height = image.height;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    const dataUrl = tmp.toDataURL();

    const fabricCanvas: FabricCanvas = new fabric.Canvas(canvasElement, {
      selection: false,
    });
    fabricRef.current = fabricCanvas;
    imageRef.current = image;

    function loadImage(img: HTMLImageElement) {
      const bgImage = new fabric.Image(img);
      fabricCanvas.backgroundImage = bgImage;
      fabricCanvas.renderAll();
      // Fit to container width/height with zoom so object coords remain in image pixels
      fitToContainer();

      const rect = new fabric.Rect({
        left: initialBBox[0],
        top: initialBBox[1],
        width: initialBBox[2],
        height: initialBBox[3],
        fill: 'rgba(0,0,0,0)',
        stroke: 'red',
        strokeWidth: 2,
        cornerColor: 'blue',
        cornerSize: 8,
        transparentCorners: false,
        hasBorders: true,
        lockRotation: true,
      });

      fabricCanvas.add(rect);
      fabricCanvas.setActiveObject(rect);
      fabricCanvas.renderAll();

      const report = () => {
        const obj = rect;
        const payload: ComposePayload = {
          image,
          bbox: [
            obj.left || 0,
            obj.top || 0,
            (obj.width || 0) * (obj.scaleX || 1),
            (obj.height || 0) * (obj.scaleY || 1),
          ],
          sizes,
          exportPsd,
        };
        onChange?.(payload);
      };

      rect.on('modified', report);
      rect.on('moving', report);
      rect.on('scaling', report);

      report();
    }

    fabric.util.loadImage(dataUrl).then(loadImage);

    const onResize = () => fitToContainer();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      fabricCanvas.dispose();
      fabricRef.current = null;
      imageRef.current = null;
    };
  }, [image, initialBBox, sizes, exportPsd, onChange, fitToContainer]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  );
}
