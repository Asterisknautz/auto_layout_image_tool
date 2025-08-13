import { useState, useCallback, useMemo, useRef } from 'react'
import './App.css'
import Dropzone from './components/Dropzone';
import CanvasEditor, { type ComposePayload } from './components/CanvasEditor';
import OutputPanel from './components/OutputPanel';
import { ProfilesProvider } from './context/ProfilesContext';
import LayoutSettings from './components/LayoutSettings';
import ParameterExportStats from './components/ParameterExportStats';
import DebugControls from './components/DebugControls';
import Toast from './components/Toast';
import { parameterExporter } from './utils/parameterExport';
import { debugController } from './utils/debugMode';

function App() {
  const [showUsage, setShowUsage] = useState(false)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [bbox, setBBox] = useState<[number, number, number, number] | null>(null)
  const [composePayload, setComposePayload] = useState<ComposePayload | undefined>(undefined)
  const [showLayoutSettings, setShowLayoutSettings] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)
  
  // Toast notification state
  const [toastMessage, setToastMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  
  // For parameter tracking
  const initialBBoxRef = useRef<[number, number, number, number] | null>(null)
  const currentProfileRef = useRef<string>('')

  // Shared worker for detect/compose across components
  const worker = useMemo(() => new Worker(new URL('./worker/core.ts', import.meta.url), { type: 'module' }), [])

  const handleDetected = useCallback((img: ImageBitmap, b: [number, number, number, number]) => {
    setImage(img)
    setBBox(b)
    setComposePayload(undefined)
    setIsBatchMode(false)
    // Store initial bbox for parameter tracking
    initialBBoxRef.current = [...b] as [number, number, number, number]
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
    
    // Export parameter changes for learning purposes
    if (image && initialBBoxRef.current && currentProfileRef.current) {
      parameterExporter.exportEditEvent(
        { width: image.width, height: image.height },
        initialBBoxRef.current,
        payload.bbox,
        currentProfileRef.current
      );
    }
  }, [image])
  
  const handleProfileChange = useCallback((profileName: string) => {
    currentProfileRef.current = profileName
  }, [])

  // Handle bbox update when "反映を保存" is clicked
  const handleSaveChanges = useCallback((newBBox: [number, number, number, number]) => {
    setBBox(newBBox)
    debugController.log('App', 'Updated bbox from CanvasEditor:', newBBox)
  }, [])

  // Show toast notification
  const showToastNotification = useCallback((message: string) => {
    setToastMessage(message)
    setShowToast(true)
  }, [])

  const hideToast = useCallback(() => {
    setShowToast(false)
  }, [])

  return (
    <ProfilesProvider>
      <h1>画像処理ツール</h1>
      <button className="usage-button" onClick={() => setShowUsage((v) => !v)}>
        使い方
      </button>
      <button className="usage-button" onClick={() => setShowLayoutSettings((v) => !v)} style={{ marginLeft: 8 }}>
        設定・レイアウト
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
          <li>自動的に全プロファイル（PC用、モバイル用、SNS用）で一括処理されます。</li>
          <li>サブフォルダ別にグループ化され、それぞれ1枚の合成画像が作成されます。</li>
          <li>出力形式やレイアウトパターンは「設定・レイアウト」タブで変更できます。</li>
        </ol>

        <h3>保存方法</h3>
        <p><strong>方法1: _outputフォルダに自動保存（推奨）</strong></p>
        <ol>
          <li>右側の「出力フォルダを選択」ボタンをクリックして画像フォルダを選択</li>
          <li>「自動保存」にチェックを入れる</li>
          <li>選択したフォルダ内に「_output」サブフォルダが自動作成されます</li>
          <li>処理された画像が_outputフォルダに自動保存されます</li>
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
        <p>出力例: <code>item1_pc.jpg</code>, <code>item1_mobile.jpg</code>, <code>item1_sns.jpg</code></p>
      </div>
      {showLayoutSettings && (
        <div style={{ marginTop: 16 }}>
          <LayoutSettings />
          <DebugControls />
          {debugController.shouldShowParameterTracking() && (
            <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 4 }}>
              <h4 style={{ margin: '0 0 8px 0' }}>パラメーター追跡 (学習用)</h4>
              <ParameterExportStats />
            </div>
          )}
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
            <OutputPanel 
              worker={worker} 
              payload={composePayload} 
              onProfileChange={handleProfileChange}
              onShowToast={showToastNotification}
              onSaveChanges={handleSaveChanges}
            />
          </div>
        </div>
      )}
      {isBatchMode && (
        <div style={{ marginTop: 16 }}>
          <h3>バッチ処理結果</h3>
          <OutputPanel 
            worker={worker} 
            payload={undefined} 
            onProfileChange={handleProfileChange}
            onShowToast={showToastNotification}
            onSaveChanges={handleSaveChanges}
          />
        </div>
      )}
      
      <Toast 
        message={toastMessage}
        show={showToast}
        onHide={hideToast}
        type="success"
      />
    </ProfilesProvider>
  )
}

export default App
