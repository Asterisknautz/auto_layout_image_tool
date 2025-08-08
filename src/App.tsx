import { useState, useCallback, useMemo } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import Dropzone from './components/Dropzone';
import CanvasEditor, { type ComposePayload } from './components/CanvasEditor';
import OutputPanel from './components/OutputPanel';
import { ProfilesProvider } from './context/ProfilesContext';
import ProfilesEditor from './components/ProfilesEditor';

function App() {
  const [count, setCount] = useState(0)
  const [showUsage, setShowUsage] = useState(false)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [bbox, setBBox] = useState<[number, number, number, number] | null>(null)
  const [composePayload, setComposePayload] = useState<ComposePayload | undefined>(undefined)
  const [showProfiles, setShowProfiles] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)

  // Shared worker for detect/compose across components
  const worker = useMemo(() => new Worker(new URL('./worker/core.ts', import.meta.url), { type: 'module' }), [])

  const handleDetected = useCallback((img: ImageBitmap, b: [number, number, number, number]) => {
    setImage(img)
    setBBox(b)
    setComposePayload(undefined)
    setIsBatchMode(false)
  }, [])

  const handleBatchMode = useCallback((isBatch: boolean) => {
    setIsBatchMode(isBatch)
    if (isBatch) {
      setImage(null)
      setBBox(null)
      setComposePayload(undefined)
    }
  }, [])

  const emptySizes = useMemo(() => [], [])
  const handleEditorChange = useCallback((payload: ComposePayload) => {
    setComposePayload(payload)
  }, [])

  return (
    <ProfilesProvider>
      <button className="usage-button" onClick={() => setShowUsage((v) => !v)}>
        使い方
      </button>
      <button className="usage-button" onClick={() => setShowProfiles((v) => !v)} style={{ marginLeft: 8 }}>
        設定
      </button>
      <div className={`usage-accordion${showUsage ? ' open' : ''}`}>
        <h2>使い方</h2>
        
        <h3>単一画像の処理</h3>
        <ol>
          <li>中央のドロップエリアに画像をドラッグ＆ドロップするか、クリックして選択します。</li>
          <li>選択された画像はブラウザ上で解析され、結果が表示されます。</li>
          <li>右側のOutputPanelでプロファイルを選択し、「Run」ボタンで処理を実行します。</li>
        </ol>

        <h3>フォルダ一括処理（推奨）</h3>
        <ol>
          <li>複数の画像が入ったフォルダ全体をドロップエリアにドラッグ＆ドロップします。</li>
          <li>自動的に全プロファイル（default, web, print, psd）で一括処理されます。</li>
          <li>サブフォルダ別にグループ化され、それぞれ1枚の合成画像が作成されます。</li>
        </ol>

        <h3>保存方法</h3>
        <p><strong>方法1: フォルダに自動保存</strong></p>
        <ol>
          <li>右側の「出力フォルダを選択」ボタンをクリックして保存先を選択</li>
          <li>「自動保存」にチェックを入れる</li>
          <li>処理された画像が自動的に選択フォルダに保存されます</li>
        </ol>

        <p><strong>方法2: ZIP一括ダウンロード</strong></p>
        <ol>
          <li>「すべてZIPで保存」ボタンをクリック</li>
          <li>outputs.zipがダウンロードされます</li>
        </ol>

        <p><strong>方法3: 個別ダウンロード</strong></p>
        <p>処理完了後に表示される各ファイルのリンクをクリックしてダウンロード</p>

        <h3>出力ファイル名の例</h3>
        <p>フォルダ構造: <code>images/item1/photo1.jpg</code>, <code>images/item2/photo2.jpg</code></p>
        <p>出力例: <code>item1_web.jpg</code>, <code>item2_web.jpg</code>, <code>images_web.jpg</code></p>
      </div>
      {showProfiles && (
        <div style={{ marginTop: 16 }}>
          <ProfilesEditor />
        </div>
      )}
      <Dropzone worker={worker} onDetected={handleDetected} onBatchMode={handleBatchMode} />
      {image && bbox && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16, marginTop: 16 }}>
          <div>
            <CanvasEditor
              image={image}
              initialBBox={bbox}
              sizes={emptySizes}
              onChange={handleEditorChange}
            />
          </div>
          <div>
            <OutputPanel worker={worker} payload={composePayload} />
          </div>
        </div>
      )}
      {isBatchMode && (
        <div style={{ marginTop: 16 }}>
          <h3>バッチ処理結果</h3>
          <OutputPanel worker={worker} payload={undefined} />
        </div>
      )}
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </ProfilesProvider>
  )
}

export default App
