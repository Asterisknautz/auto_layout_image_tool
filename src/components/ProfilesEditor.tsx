import { useEffect, useState } from 'react';
import { useProfiles, type ProfilesConfig } from '../context/ProfilesContext';

export default function ProfilesEditor() {
  const { config, setConfig, reset } = useProfiles();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const extractErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

  useEffect(() => {
    setText(JSON.stringify(config, null, 2));
  }, [config]);

  const onSave = () => {
    try {
      const json = JSON.parse(text) as ProfilesConfig;
      // shallow validate
      if (!json || typeof json !== 'object' || !json.profiles || typeof json.profiles !== 'object') {
        throw new Error('profiles キーを含むJSONが必要です');
      }
      setConfig(json, true);
      setError(null);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    }
  };

  const onReset = () => {
    reset();
    // keep current display; user can refresh or reload via provider next mount
  };

  const onExport = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'output_profiles.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const onImport = async (file: File) => {
    try {
      const txt = await file.text();
      setText(txt);
      setError(null);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    }
  };

  return (
    <div style={{ border: '1px solid #ddd', padding: 12 }}>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onSave}>保存（ローカル上書き）</button>
        <button onClick={onReset}>既定に戻す</button>
        <button onClick={onExport}>エクスポート</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          インポート
          <input type="file" accept="application/json" onChange={(e) => e.target.files && onImport(e.target.files[0])} />
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      />
      {error && <div style={{ color: 'crimson', marginTop: 6 }}>Error: {error}</div>}
      <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
        プロファイル編集はローカルに保存され、ページ読み込み時に適用されます（公開ファイルは変更されません）。
      </div>
    </div>
  );
}
