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

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/output_profiles.json');
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
    </div>
  );
}
