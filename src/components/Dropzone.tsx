import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ResizeSpec } from '../worker/opencv';

export interface DetectedHandler {
  (image: ImageBitmap, bbox: [number, number, number, number]): void;
}

/**
 * Dropzone component that accepts a single image file and sends it to the worker
 * for object detection.
 */
type Props = { worker?: Worker; onDetected?: DetectedHandler };
export default function Dropzone({ worker: workerProp, onDetected }: Props) {
  // create or reuse worker
  const worker = useMemo(
    () => workerProp ?? new Worker(new URL('../worker/core.ts', import.meta.url), { type: 'module' }),
    [workerProp]
  );

  const [status, setStatus] = useState<string>('画像をドロップしてください');
  const [predCount, setPredCount] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  type GalleryItem = { url: string; label: string; bmp: ImageBitmap; bbox: [number, number, number, number]; group: string };
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [isBatchUI, setIsBatchUI] = useState<boolean>(false);

  const fileBitmaps = useRef(new Map<string, ImageBitmap>());
  const fileNames = useRef(new Map<string, string>());
  const batchMode = useRef(false);
  const totalRef = useRef(0);
  const doneRef = useRef(0);
  const [batchSizes, setBatchSizes] = useState<ResizeSpec[] | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data: any = e.data;
      if (data?.type === 'detect') {
        const preds = (data.predictions || []) as Array<{ bbox: [number, number, number, number] }>;
        setPredCount(preds.length);
        setStatus('検出が完了しました');
        const fileId = (data as any).fileId as string | undefined;
        const bmp = (fileId && fileBitmaps.current.get(fileId)) || lastBitmapRef.current;
        // choose best bbox (max area) or fallback to center square
        if (bmp) {
          let bbox: [number, number, number, number];
          if (preds.length > 0) {
            const best = preds
              .map((p) => ({ p, a: p.bbox[2] * p.bbox[3] }))
              .sort((a, b) => b.a - a.a)[0].p.bbox;
            bbox = best as [number, number, number, number];
          } else {
            const w = bmp.width;
            const h = bmp.height;
            const side = Math.min(w, h) * 0.8;
            bbox = [Math.floor((w - side) / 2), Math.floor((h - side) / 2), Math.floor(side), Math.floor(side)];
          }

          // draw bbox overlay on preview canvas (single mode)
          const preview = canvasRef.current;
          if (!batchMode.current && preview) {
            const pctx = preview.getContext('2d');
            if (pctx) {
              pctx.clearRect(0, 0, preview.width, preview.height);
              pctx.drawImage(bmp, 0, 0);
              pctx.save();
              pctx.lineWidth = Math.max(2, Math.min(preview.width, preview.height) * 0.004);
              pctx.strokeStyle = 'rgba(255,0,0,0.9)';
              pctx.setLineDash([8, 6]);
              pctx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
              pctx.restore();
            }
          }

          // add thumbnail to gallery (batch mode)
          if (batchMode.current) {
            const maxW = 200;
            const scale = Math.min(1, maxW / bmp.width);
            const tw = Math.round(bmp.width * scale);
            const th = Math.round(bmp.height * scale);
            const c = document.createElement('canvas');
            c.width = tw; c.height = th;
            const cx = c.getContext('2d')!;
            cx.drawImage(bmp, 0, 0, tw, th);
            cx.save();
            cx.strokeStyle = 'rgba(255,0,0,0.9)';
            cx.setLineDash([6, 4]);
            cx.lineWidth = Math.max(1, Math.min(tw, th) * 0.01);
            cx.strokeRect(bbox[0] * scale, bbox[1] * scale, bbox[2] * scale, bbox[3] * scale);
            cx.restore();
            (async () => {
              const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
              const url = URL.createObjectURL(blob);
              const fullPath = (fileId && (fileNames.current.get(fileId) || 'image')) || 'image';
              const group = fullPath.includes('/') ? fullPath.split('/')[0] : 'root';
              const label = fullPath;
              setGallery((prev) => [...prev, { url, label, bmp, bbox, group }]);
            })();
          }
          if (batchMode.current && batchSizes && fileId) {
            worker.postMessage({ type: 'compose', payload: { image: bmp, bbox, sizes: batchSizes, exportPsd: false } });
            doneRef.current += 1;
            setStatus(`処理中 ${doneRef.current}/${totalRef.current}`);
            fileBitmaps.current.delete(fileId);
          } else if (!batchMode.current) {
            onDetected?.(bmp, bbox);
          }
        }
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker, batchSizes, onDetected]);

  const lastBitmapRef = useRef<ImageBitmap | null>(null);
  const getFilesFromEvent = useCallback(async (event: any): Promise<File[]> => {
    const items = event?.dataTransfer?.items;
    if (items && items.length) {
      const traverseEntry = async (entry: any, path = ''): Promise<File[]> => {
        if (!entry) return [];
        if (entry.isFile) {
          const file: File = await new Promise((resolve) => entry.file(resolve));
          (file as any).path = path + entry.name;
          return [file];
        }
        if (entry.isDirectory) {
          const reader = entry.createReader();
          const entries: any[] = await new Promise((resolve) => reader.readEntries(resolve));
          const nested = await Promise.all(entries.map((e) => traverseEntry(e, path + entry.name + '/')));
          return nested.flat();
        }
        return [];
      };
      const entries = Array.from(items)
        .map((it: any) => (it as any).webkitGetAsEntry?.())
        .filter(Boolean);
      if (entries.length) {
        const all = await Promise.all(entries.map((e) => traverseEntry(e)));
        return all.flat();
      }
    }
    return (event?.dataTransfer?.files ? Array.from(event.dataTransfer.files) : []) as File[];
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      // filter images only
      const images = acceptedFiles.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(f.name));
      if (images.length === 0) return;
      batchMode.current = images.length > 1;
      totalRef.current = images.length;
      doneRef.current = 0;

      // Ensure preview canvas is ready with first image size
      const firstBitmap = await createImageBitmap(images[0]);
      lastBitmapRef.current = firstBitmap;
      const preview = canvasRef.current;
      if (preview) {
        preview.width = firstBitmap.width;
        preview.height = firstBitmap.height;
        const pctx = preview.getContext('2d');
        pctx?.drawImage(firstBitmap, 0, 0);
      }

      // In batch mode, load default profile sizes once
      if (batchMode.current && !batchSizes) {
        try {
          const base = (import.meta as any).env?.BASE_URL ?? '/';
          const res = await fetch(`${base}output_profiles.json`);
          if (res.ok) {
            const json = await res.json();
            const key = json.default ? 'default' : Object.keys(json)[0];
            const sizes = json[key]?.sizes as ResizeSpec[] | undefined;
            if (sizes && sizes.length) setBatchSizes(sizes);
          }
        } catch {}
      }

      setPredCount(null);
      setGallery([]);
      setIsBatchUI(batchMode.current);
      setStatus(batchMode.current ? `処理中 0/${images.length}` : '検出中...');

      // Process all images
      for (const file of images) {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const fileId = crypto.randomUUID();
        fileBitmaps.current.set(fileId, bitmap);
        fileNames.current.set(fileId, (file as any).path || file.name);
        worker.postMessage({ type: 'detect', payload: { fileId, imageData } });
      }
    },
    [worker, batchSizes]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, getFilesFromEvent, multiple: true });

  return (
    <div>
      <div
        {...getRootProps()}
        style={{ border: '2px dashed #888', padding: '16px', textAlign: 'center', cursor: 'pointer' }}
      >
        <input {...getInputProps({ webkitdirectory: true as any, directory: true as any, multiple: true })} />
        <p style={{ margin: 0 }}>{isDragActive ? 'ここにドロップ' : status}</p>
      </div>
      <div style={{ marginTop: 12 }}>
        {!isBatchUI && (
          <canvas ref={canvasRef} style={{ maxWidth: '100%', display: 'block' }} />
        )}
        {isBatchUI && gallery.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from(new Set(gallery.map((g) => g.group))).map((group) => (
              <div key={group}>
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#333' }}>{group}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {gallery.filter((g) => g.group === group).map((g, idx) => (
                    <button
                      key={g.url + idx}
                      onClick={() => onDetected?.(g.bmp, g.bbox)}
                      style={{ border: '1px solid #ddd', padding: 4, cursor: 'pointer', background: '#fff' }}
                      title="クリックで編集"
                    >
                      <img src={g.url} alt={g.label} style={{ width: '100%', display: 'block' }} />
                      <div style={{ fontSize: 12, color: '#555', marginTop: 4, wordBreak: 'break-all', textAlign: 'left' }}>{g.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {predCount !== null && (
          <p style={{ fontSize: 12, color: '#444' }}>検出数: {predCount}</p>
        )}
      </div>
    </div>
  );
}
