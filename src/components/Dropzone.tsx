import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface DetectedHandler {
  (image: ImageBitmap, bbox: [number, number, number, number]): void;
}
import { useDropzone } from 'react-dropzone';

/**
 * Dropzone component that accepts a single image file and sends it to the worker
 * for object detection.
 */
export default function Dropzone({ onDetected }: { onDetected?: DetectedHandler }) {
  // create worker once
  const worker = useMemo(
    () => new Worker(new URL('../worker/core.ts', import.meta.url), { type: 'module' }),
    []
  );

  const [status, setStatus] = useState<string>('画像をドロップしてください');
  const [predCount, setPredCount] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data: any = e.data;
      if (data?.type === 'detect') {
        const preds = (data.predictions || []) as Array<{ bbox: [number, number, number, number] }>;
        setPredCount(preds.length);
        setStatus('検出が完了しました');
        // choose best bbox (max area) or fallback to center square
        if (lastBitmapRef.current) {
          let bbox: [number, number, number, number];
          if (preds.length > 0) {
            const best = preds
              .map((p) => ({ p, a: p.bbox[2] * p.bbox[3] }))
              .sort((a, b) => b.a - a.a)[0].p.bbox;
            bbox = best as [number, number, number, number];
          } else {
            const w = lastBitmapRef.current.width;
            const h = lastBitmapRef.current.height;
            const side = Math.min(w, h) * 0.8;
            bbox = [Math.floor((w - side) / 2), Math.floor((h - side) / 2), Math.floor(side), Math.floor(side)];
          }

          // draw bbox overlay on preview canvas
          const preview = canvasRef.current;
          if (preview) {
            const pctx = preview.getContext('2d');
            if (pctx) {
              pctx.clearRect(0, 0, preview.width, preview.height);
              pctx.drawImage(lastBitmapRef.current, 0, 0);
              pctx.save();
              pctx.lineWidth = Math.max(2, Math.min(preview.width, preview.height) * 0.004);
              pctx.strokeStyle = 'rgba(255,0,0,0.9)';
              pctx.setLineDash([8, 6]);
              pctx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
              pctx.restore();
            }
          }

          onDetected?.(lastBitmapRef.current, bbox);
        }
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker]);

  const lastBitmapRef = useRef<ImageBitmap | null>(null);
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      const bitmap = await createImageBitmap(file);
      lastBitmapRef.current = bitmap;

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const fileId = crypto.randomUUID();
      // preview to inline canvas
      const preview = canvasRef.current;
      if (preview) {
        preview.width = bitmap.width;
        preview.height = bitmap.height;
        const pctx = preview.getContext('2d');
        if (pctx) {
          pctx.clearRect(0, 0, preview.width, preview.height);
          pctx.drawImage(bitmap, 0, 0);
        }
      }
      setPredCount(null);
      setStatus('検出中...');
      worker.postMessage({ type: 'detect', payload: { fileId, imageData } });
    },
    [worker]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div>
      <div
        {...getRootProps()}
        style={{ border: '2px dashed #888', padding: '16px', textAlign: 'center', cursor: 'pointer' }}
      >
        <input {...getInputProps()} />
        <p style={{ margin: 0 }}>{isDragActive ? 'ここにドロップ' : status}</p>
      </div>
      <div style={{ marginTop: 12 }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', display: 'block' }} />
        {predCount !== null && (
          <p style={{ fontSize: 12, color: '#444' }}>検出数: {predCount}</p>
        )}
      </div>
    </div>
  );
}
