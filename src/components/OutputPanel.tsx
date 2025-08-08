import { useEffect, useMemo, useRef, useState } from 'react';
import { makeZip } from '../utils/zip';
import type { ComposePayload } from './CanvasEditor';
import type { ResizeSpec } from '../worker/opencv';
import { useProfiles } from '../context/ProfilesContext';

interface OutputProfile {
  sizes: ResizeSpec[];
  exportPsd?: boolean;
}

type OutputProfiles = Record<string, OutputProfile>;

interface OutputPanelProps {
  worker?: Worker;
  payload?: ComposePayload;
}

export default function OutputPanel({ worker, payload }: OutputPanelProps) {
  const { config } = useProfiles();
  const profiles = config.profiles as unknown as OutputProfiles;
  const [selected, setSelected] = useState<string>('');

  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>([]);
  const filesForZip = useRef<{ name: string; blob: Blob }[]>([]);
  const dirHandleRef = useRef<any | null>(null);
  const [autoSave, setAutoSave] = useState(false);
  const [dirName, setDirName] = useState('');

  useEffect(() => {
    const keys = Object.keys(profiles || {});
    if (keys.length && !selected) setSelected(keys[0]);
  }, [profiles, selected]);

  const pickDirectory = async () => {
    try {
      const picker: any = (window as any).showDirectoryPicker;
      if (!picker) {
        alert('このブラウザはフォルダ保存に対応していません（ZIP保存をご利用ください）');
        return;
      }
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      dirHandleRef.current = handle;
      setDirName(handle.name || '');
      setAutoSave(true);
    } catch (e) {
      // cancelled
    }
  };

  async function writeFile(filename: string, blob: Blob) {
    const handle = dirHandleRef.current;
    if (!handle) return false;
    try {
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const stream = await fileHandle.createWritable();
      await stream.write(blob);
      await stream.close();
      return true;
    } catch (e) {
      console.warn('Failed to save', filename, e);
      return false;
    }
  }

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
          if (autoSave && dirHandleRef.current) {
            await writeFile(`${name}.png`, blob);
          } else {
            const url = URL.createObjectURL(blob);
            entries.push({ name, url });
            filesForZip.current.push({ name: `${name}.png`, blob });
          }
        }
        const psd: Blob | null = data.psd || null;
        if (psd) {
          if (autoSave && dirHandleRef.current) {
            await writeFile('document.psd', psd);
          } else {
            entries.push({ name: 'document.psd', url: URL.createObjectURL(psd) });
            filesForZip.current.push({ name: 'document.psd', blob: psd });
          }
        }
        if (entries.length) setDownloads(entries);
      } else if (data?.type === 'composeMany') {
        const entries: { name: string; url: string }[] = [];
        const outs: Array<{ filename: string; image: ImageBitmap }> = data.outputs || [];
        for (const o of outs) {
          const canvas = new OffscreenCanvas(o.image.width, o.image.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(o.image, 0, 0);
          const blob = await (canvas as any).convertToBlob?.() || (await new Promise<Blob>((resolve) => {
            const c = document.createElement('canvas');
            c.width = o.image.width; c.height = o.image.height;
            const cx = c.getContext('2d')!; cx.drawImage(o.image, 0, 0);
            c.toBlob((b) => resolve(b!), 'image/jpeg');
          }));
          if (autoSave && dirHandleRef.current) {
            await writeFile(o.filename, blob);
          } else {
            const url = URL.createObjectURL(blob);
            entries.push({ name: o.filename, url });
            filesForZip.current.push({ name: o.filename, blob });
          }
        }
        if (entries.length) setDownloads((prev) => [...prev, ...entries]);
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker, autoSave]);

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

  const handleZipAll = async () => {
    if (filesForZip.current.length === 0) return;
    // convert blobs to Uint8Array and build zip
    const items = await Promise.all(
      filesForZip.current.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))
    );
    const zipBlob = await makeZip(items);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'outputs.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={pickDirectory}>出力フォルダを選択</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} disabled={!dirHandleRef.current} />
          自動保存
        </label>
        {dirName && <span style={{ fontSize: 12, color: '#555' }}>{dirName}</span>}
      </div>
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {Object.keys(profiles).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <button onClick={handleRun}>Run</button>
      <button onClick={handleZipAll} disabled={filesForZip.current.length === 0} style={{ marginLeft: 8 }}>すべてZIPで保存</button>
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
