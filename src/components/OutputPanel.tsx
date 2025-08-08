import { useEffect, useMemo, useState } from 'react';
import type { ComposePayload } from './CanvasEditor';
import type { ResizeSpec } from '../worker/opencv';

interface OutputProfile {
  sizes: ResizeSpec[];
  exportPsd?: boolean;
}

type OutputProfiles = Record<string, OutputProfile>;

interface OutputPanelProps {
  payload?: ComposePayload;
}

export default function OutputPanel({ payload }: OutputPanelProps) {
  const [profiles, setProfiles] = useState<OutputProfiles>({});
  const [selected, setSelected] = useState<string>('');

  const worker = useMemo(
    () => new Worker(new URL('../worker/core.ts', import.meta.url), { type: 'module' }),
    []
  );

  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const base = import.meta.env.BASE_URL || '/';
        const res = await fetch(`${base}output_profiles.json`);
        if (!res.ok) return;
        const json = (await res.json()) as OutputProfiles;
        setProfiles(json);
        const keys = Object.keys(json);
        if (keys.length > 0) setSelected(keys[0]);
      } catch (err) {
        console.error('Failed to load output_profiles.json', err);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      const data: any = e.data;
      if (data?.type === 'compose') {
        const entries: { name: string; url: string }[] = [];
        const images: Record<string, ImageBitmap> = data.images || {};
        for (const [name, bmp] of Object.entries(images)) {
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bmp, 0, 0);
          const blob = await (canvas as any).convertToBlob?.() || (await new Promise<Blob>((resolve) => {
            // Fallback for environments without convertToBlob
            const c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height;
            const cx = c.getContext('2d')!; cx.drawImage(bmp, 0, 0);
            c.toBlob((b) => resolve(b!), 'image/png');
          }));
          const url = URL.createObjectURL(blob);
          entries.push({ name, url });
        }
        const psd: Blob | null = data.psd || null;
        if (psd) {
          entries.push({ name: 'document.psd', url: URL.createObjectURL(psd) });
        }
        setDownloads(entries);
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker]);

  const handleRun = () => {
    if (!payload) return;
    const profile = profiles[selected];
    if (!profile) return;
    const composePayload: ComposePayload = {
      ...payload,
      sizes: profile.sizes,
      exportPsd: profile.exportPsd ?? payload.exportPsd,
    };
    worker.postMessage({ type: 'compose', payload: composePayload });
  };

  return (
    <div>
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {Object.keys(profiles).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <button onClick={handleRun}>Run</button>
      {downloads.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {downloads.map((d) => (
            <div key={d.name}>
              <a href={d.url} download={d.name}>{d.name}</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
