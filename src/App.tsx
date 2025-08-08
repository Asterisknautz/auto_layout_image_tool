import { useState, useCallback } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import Dropzone from './components/Dropzone';
import CanvasEditor, { type ComposePayload } from './components/CanvasEditor';
import OutputPanel from './components/OutputPanel';

function App() {
  const [count, setCount] = useState(0)
  const [showUsage, setShowUsage] = useState(false)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [bbox, setBBox] = useState<[number, number, number, number] | null>(null)
  const [composePayload, setComposePayload] = useState<ComposePayload | undefined>(undefined)

  const handleDetected = useCallback((img: ImageBitmap, b: [number, number, number, number]) => {
    setImage(img)
    setBBox(b)
    setComposePayload(undefined)
  }, [])

  return (
    <>
      <button className="usage-button" onClick={() => setShowUsage((v) => !v)}>
        使い方
      </button>
      <div className={`usage-accordion${showUsage ? ' open' : ''}`}>
        <h2>使い方</h2>
        <p>PNG や JPEG 形式の画像ファイルを1枚用意してください。</p>
        <ol>
          <li>中央のドロップエリアに画像をドラッグ＆ドロップするか、クリックして選択します。</li>
          <li>選択された画像はブラウザ上で解析され、結果が表示されます。</li>
        </ol>
        <p>特別なフォルダ構造やファイル名の制限はありません。ローカルに保存した画像をそのまま使用できます。</p>
      </div>
      <Dropzone onDetected={handleDetected} />
      {image && bbox && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16, marginTop: 16 }}>
          <div>
            <CanvasEditor
              image={image}
              initialBBox={bbox}
              sizes={[]}
              onChange={(payload) => setComposePayload(payload)}
            />
          </div>
          <div>
            <OutputPanel payload={composePayload} />
          </div>
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
    </>
  )
}

export default App
