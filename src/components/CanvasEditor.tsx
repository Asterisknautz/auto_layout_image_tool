import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
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

    const fabricCanvas = new fabric.Canvas(canvasElement, {
      selection: false,
    });
    fabricCanvas.setWidth(image.width);
    fabricCanvas.setHeight(image.height);

    fabric.Image.fromURL(dataUrl, (img) => {
      fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas));

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
    });

    return () => {
      fabricCanvas.dispose();
    };
  }, [image, initialBBox, sizes, exportPsd, onChange]);

  return <canvas ref={canvasRef} />;
}

