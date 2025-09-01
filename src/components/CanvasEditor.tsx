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
  onSave?: (bbox: [number, number, number, number]) => void;
  onReset?: () => void;
}

export default function CanvasEditor({
  image,
  initialBBox,
  sizes,
  exportPsd,
  onChange,
  onSave,
  onReset,
}: CanvasEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const imageRef = useRef<ImageBitmap | null>(null);
  const currentBBoxRef = useRef<[number, number, number, number]>(initialBBox);
  const isInitializingRef = useRef<boolean>(true);

  // Save current bbox changes
  const handleSave = useCallback(() => {
    console.log('[CanvasEditor] Save button clicked');
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) {
      console.log('[CanvasEditor] No fabric canvas available');
      return;
    }

    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject && activeObject.type === 'rect') {
      const rect = activeObject as fabric.Rect;
      const newBbox: [number, number, number, number] = [
        rect.left || 0,
        rect.top || 0,
        (rect.width || 0) * (rect.scaleX || 1),
        (rect.height || 0) * (rect.scaleY || 1),
      ];
      currentBBoxRef.current = newBbox;
      
      console.log('[CanvasEditor] New bbox calculated:', newBbox);
      
      // Update the compose payload with new bbox to reflect in preview
      const payload: ComposePayload = {
        image,
        bbox: newBbox,
        sizes,
        exportPsd,
      };
      console.log('[CanvasEditor] Calling onChange with payload');
      onChange?.(payload);
      
      // Save the bbox changes
      console.log('[CanvasEditor] Calling onSave with bbox');
      onSave?.(newBbox);
    } else {
      console.log('[CanvasEditor] No active rect object found');
    }
  }, [image, sizes, exportPsd, onChange, onSave]);

  // Reset bbox to initial state
  const handleReset = useCallback(() => {
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) return;

    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject && activeObject.type === 'rect') {
      const rect = activeObject as fabric.Rect;
      rect.set({
        left: initialBBox[0],
        top: initialBBox[1],
        width: initialBBox[2],
        height: initialBBox[3],
        scaleX: 1,
        scaleY: 1,
      });
      fabricCanvas.renderAll();
      currentBBoxRef.current = [...initialBBox] as [number, number, number, number];
      
      // Trigger onChange to update the payload
      const payload: ComposePayload = {
        image,
        bbox: initialBBox,
        sizes,
        exportPsd,
      };
      onChange?.(payload);
    }
    onReset?.();
  }, [initialBBox, image, sizes, exportPsd, onChange, onReset]);

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

    // Reset initialization flag when new image is loaded
    isInitializingRef.current = true;
    console.log('[CanvasEditor] Starting initialization for new image');

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
        const newBbox: [number, number, number, number] = [
          obj.left || 0,
          obj.top || 0,
          (obj.width || 0) * (obj.scaleX || 1),
          (obj.height || 0) * (obj.scaleY || 1),
        ];
        currentBBoxRef.current = newBbox;
        
        // Skip onChange during initialization to prevent unwanted compose operations
        if (isInitializingRef.current) {
          console.log('[CanvasEditor] Skipping onChange during initialization');
          return;
        }
        
        const payload: ComposePayload = {
          image,
          bbox: newBbox,
          sizes,
          exportPsd,
        };
        onChange?.(payload);
      };

      rect.on('modified', report);
      rect.on('moving', report);
      rect.on('scaling', report);

      // Call report() during initialization (will be skipped due to isInitializingRef)
      report();
      
      // Mark initialization as complete after a short delay to ensure setup is done
      setTimeout(() => {
        console.log('[CanvasEditor] Initialization complete - enabling onChange');
        isInitializingRef.current = false;
      }, 100);
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
      {/* Control buttons */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: 8, 
        padding: '8px 12px', 
        backgroundColor: '#f8f9fa', 
        borderRadius: 4,
        border: '1px solid #dee2e6'
      }}>
        <div style={{ fontSize: 14, fontWeight: '500', color: '#495057' }}>
          商品抽出範囲の調整
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleReset}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#5a6268'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#6c757d'; }}
          >
            リセット
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#218838'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#28a745'; }}
          >
            保存
          </button>
        </div>
      </div>
      
      {/* Canvas */}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  );
}
