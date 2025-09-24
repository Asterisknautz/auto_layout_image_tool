import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import './App.css'
import Dropzone from './components/Dropzone';
import CanvasEditor, { type ComposePayload } from './components/CanvasEditor';
import OutputPanel from './components/OutputPanel';
import { ProfilesProvider, useProfiles } from './context/ProfilesContext';
import LayoutSettings from './components/LayoutSettings';
import ParameterExportStats from './components/ParameterExportStats';
import DebugControls from './components/DebugControls';
import Toast from './components/Toast';
import { parameterExporter } from './utils/parameterExport';
import { debugController } from './utils/debugMode';
import { outputRootManager, type OutputRootChangeDetail } from './utils/outputRootManager';
import type { ComposeGroup, LayoutsConfig, ProfileDef } from './worker/core';

// Internal component with access to ProfilesContext
interface BatchDataRecord {
  groups: ComposeGroup[];
  profiles: ProfileDef[];
  layouts: LayoutsConfig;
}

function AppContent() {
  const [showUsage, setShowUsage] = useState(false)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [bbox, setBBox] = useState<[number, number, number, number] | null>(null)
  const [composePayload, setComposePayload] = useState<ComposePayload | undefined>(undefined)
  const [showLayoutSettings, setShowLayoutSettings] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)

  const [outputRootStatus, setOutputRootStatus] = useState<{ ready: boolean; hasRoot: boolean; dirName: string }>({
    ready: false,
    hasRoot: false,
    dirName: ''
  })
  
  // Batch processing data retention
  const [batchData, setBatchData] = useState<BatchDataRecord | null>(null)
  
  // Toast notification state
  const [toastMessage, setToastMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  
  // For parameter tracking
  const initialBBoxRef = useRef<[number, number, number, number] | null>(null)
  const currentProfileRef = useRef<string>('')

  // Access profiles context for auto-reprocessing
  const { config } = useProfiles()

  useEffect(() => {
    let cancelled = false

    const updateStatus = (hasRoot: boolean, dirName: string) => {
      if (cancelled) return
      setOutputRootStatus({ ready: true, hasRoot, dirName })
    }

    void (async () => {
      try {
        const hasRoot = await outputRootManager.hasOutputRoot()
        const info = outputRootManager.getOutputRootInfo()
        updateStatus(hasRoot, info.name || '')
      } catch {
        updateStatus(false, '')
      }
    })()

    const handleOutputRootChange = (event: Event) => {
      const detail = (event as CustomEvent<OutputRootChangeDetail>).detail
      updateStatus(detail.hasRoot, detail.name)
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('outputRootChange', handleOutputRootChange)
    }

    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('outputRootChange', handleOutputRootChange)
      }
    }
  }, [])

  useEffect(() => {
    const profileKeys = Object.keys(config.profiles || {}).filter((key) => key !== 'default')
    if (!currentProfileRef.current && profileKeys.length > 0) {
      currentProfileRef.current = profileKeys[0]
    } else if (!currentProfileRef.current) {
      const allKeys = Object.keys(config.profiles || {})
      if (allKeys.length > 0) {
        currentProfileRef.current = allKeys[0]
      }
    }
  }, [config.profiles])

  // Shared worker for detect/compose across components
  const worker = useMemo(() => new Worker(new URL('./worker/core.ts', import.meta.url), { type: 'module' }), [])
  
  // Worker message handler for auto-save
  useEffect(() => {
    const handleWorkerMessage = async (e: MessageEvent) => {
      const { type, error } = e.data
      
      if (type === 'error') {
        console.error('[App] Worker error:', error);
        setToastMessage(`処理エラー: ${error}`)
        setShowToast(true)
        return;
      }
      
      // 単一画像モードでのcompose結果は無視（ファイル出力不要）
      if (type === 'compose' && !isBatchMode) {
        console.log('[App] Ignoring compose result in single image mode - no file output needed')
        debugController.log('App', 'Ignoring compose result in single image mode')
        return;
      }
      
      // Note: composeManyRequest is now handled via CustomEvent listener
      
      // Handle composeMany results
      if (type === 'composeMany') {
        const { outputs, source } = e.data as {
          outputs?: Array<unknown>;
          source?: string;
        }
        console.log('[App] Received composeMany result:', {
          source: source || 'unknown',
          outputCount: Array.isArray(outputs) ? outputs.length : 0
        })

        // Show notification for manual batch reprocessing
        if (source === 'manualSave') {
          const outputCount = Array.isArray(outputs) ? outputs.length : 0
          setToastMessage(`調整された抽出範囲でレイアウト画像を再生成しました（${outputCount}個）`)
          setShowToast(true)
        }
      }
    }
    
    worker.addEventListener('message', handleWorkerMessage)
    return () => worker.removeEventListener('message', handleWorkerMessage)
  }, [worker, isBatchMode])

  // Listen for batch data from Dropzone
  useEffect(() => {
    const handleBatchDataEvent = (event: CustomEvent<BatchDataRecord>) => {
      const { groups, profiles, layouts } = event.detail
      console.log('[App] Storing batch data for reprocessing:', {
        groupCount: groups?.length,
        profileCount: profiles?.length,
        hasGroups: !!groups,
        hasProfiles: !!profiles,
        hasLayouts: !!layouts
      })
      const data: BatchDataRecord = { groups, profiles, layouts }
      setBatchData(data)
      if (profiles.length > 0) {
        const firstProfile = profiles[0]
        if (firstProfile.tag) {
          currentProfileRef.current = firstProfile.tag
        }
      }
      console.log('[App] Batch data stored successfully')
    }

    window.addEventListener('composeManyRequest', handleBatchDataEvent as EventListener)
    return () => window.removeEventListener('composeManyRequest', handleBatchDataEvent as EventListener)
  }, [])

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

  // Auto-reprocessing disabled in single image mode

  // Get current profile sizes for CanvasEditor
  const currentProfileKey = currentProfileRef.current
  const currentSizes =
    currentProfileKey && config.profiles
      ? config.profiles[currentProfileKey]?.sizes ?? []
      : []

  const handleEditorChange = useCallback((payload: ComposePayload) => {
    // 単一画像モードではファイル出力が不要なため、composePayloadの更新も不要
    console.log('[App] Editor change detected in single image mode - no compose payload update needed')
    
    // Export parameter changes for learning purposes only
    if (image && initialBBoxRef.current && currentProfileRef.current) {
      parameterExporter.exportEditEvent(
        { width: image.width, height: image.height },
        initialBBoxRef.current,
        payload.bbox,
        currentProfileRef.current
      );
    }
  }, [image])
  
  // Handle bbox update when "反映を保存" is clicked
  const handleSaveChanges = useCallback((newBBox: [number, number, number, number]) => {
    console.log('[App] handleSaveChanges called with bbox:', newBBox);
    setBBox(newBBox)
    debugController.log('App', 'Updated bbox from CanvasEditor:', newBBox)
    
    // Generate images for all profiles with the updated bbox
    if (image && config.profiles) {
      console.log('[App] Generating images for all profiles with updated bbox:', newBBox);
      console.log('[App] Available profiles:', Object.keys(config.profiles));
      debugController.log('App', 'Generating images for all profiles with updated bbox:', newBBox)
      debugController.log('App', 'Available profiles:', Object.keys(config.profiles))
      
      // Skip single image processing - we only want batch reprocessing
      console.log('[App] Skipping single image processing, proceeding to batch reprocessing only');
      
      // Trigger batch processing instead of single image compose
      // This should regenerate the layout-composed images with updated bbox
      console.log('[App] Triggering batch reprocessing with updated bbox');
      
      console.log('[App] Checking batch data:', {
        hasBatchData: !!batchData,
        groupCount: batchData?.groups?.length || 0,
        profileCount: batchData?.profiles?.length || 0
      })
      
      if (batchData && batchData.groups && batchData.groups.length > 0) {
        console.log('[App] Batch reprocessing requested, but extraction range changes require re-detection');
        
        // Save the adjusted bbox for future use
        localStorage.setItem('imagetool.adjustedBbox', JSON.stringify(newBBox));
        console.log('[App] Saved adjusted bbox to localStorage:', newBBox);
        
        const message = '抽出範囲を保存しました。調整を反映するにはフォルダを再度ドロップしてください。';
        console.log('[App] Setting toast message:', message);
        setToastMessage(message);
        setShowToast(true);
        console.log('[App] Toast should be showing now');
        
        // TODO: In the future, implement re-detection with custom bbox
        // For now, users need to re-drop the folder to apply the changes
      } else {
        console.warn('[App] No batch data available for reprocessing');
        setToastMessage('バッチデータが見つかりません。フォルダを再度ドロップしてください。')
        setShowToast(true)
      }
      
      debugController.log('App', 'Sent compose request for all profiles to worker')
      
      // Show notification
      setToastMessage('調整内容を保存し、全プロファイル用の画像を生成中...')
      setShowToast(true)
    }
  }, [image, config.profiles, batchData])

  // Show toast notification
  const showToastNotification = useCallback((message: string) => {
    setToastMessage(message)
    setShowToast(true)
  }, [])

  const hideToast = useCallback(() => {
    setShowToast(false)
  }, [])

  return (
    <>
      {outputRootStatus.ready && !outputRootStatus.hasRoot && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            border: '1px solid #ff9800',
            backgroundColor: '#fff8e1',
            borderRadius: 8,
            color: '#5d4037',
            lineHeight: 1.6
          }}
        >
          <strong style={{ display: 'block', marginBottom: 8 }}>📁 まず保存先を設定してください</strong>
          <p style={{ margin: '0 0 12px 0', fontSize: 14 }}>
            「設定・レイアウト」の「保存先設定」から出力先フォルダを選択すると、ここがデフォルトの保存先となり生成されたファイルが自動で書き出されます。
          </p>
          <button
            type="button"
            onClick={() => setShowLayoutSettings(true)}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderRadius: 4,
              backgroundColor: '#ff9800',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            保存先を設定する
          </button>
        </div>
      )}
      {outputRootStatus.ready && outputRootStatus.hasRoot && outputRootStatus.dirName && (
        <div
          style={{
            marginBottom: 16,
            padding: '8px 12px',
            borderRadius: 6,
            backgroundColor: '#f1f8e9',
            border: '1px solid #c5e1a5',
            fontSize: 13,
            color: '#33691e'
          }}
        >
          📁 現在の保存先: <strong>{outputRootStatus.dirName}</strong>
        </div>
      )}
      <h1>画像処理ツール</h1>
      <button className="usage-button" onClick={() => setShowUsage((v) => !v)}>
        使い方
      </button>
      <button className="usage-button" onClick={() => setShowLayoutSettings((v) => !v)} style={{ marginLeft: 8 }}>
        設定・レイアウト
      </button>
      <div className={`usage-accordion${showUsage ? ' open' : ''}`}>
        <section className="usage-section">
          <h2>目的</h2>
          <p className="usage-note">
            商品画像フォルダをドラッグ＆ドロップするだけで、プロファイル（PC / モバイル / SNS）ごとのレイアウト画像を自動生成し、指定フォルダの <code>_output</code> に書き出します。
          </p>
        </section>

        <section className="usage-section">
          <h2>使い方</h2>
          <ol>
            <li>画像をまとめたフォルダをドロップエリアへドラッグ＆ドロップします。</li>
            <li>Canvas Editor で必要に応じて抽出範囲を調整します。</li>
            <li>設定変更は「設定・レイアウト」タブで行い、変更後は同じフォルダを再度ドロップして再処理します。</li>
          </ol>
        </section>

        <section className="usage-section">
          <h2>保存方法</h2>
          <ol>
            <li>OutputPanel の「出力先フォルダを選択」で保存先を指定します（元フォルダを選ぶのが推奨）。</li>
            <li>「自動保存」をオンにすると、指定フォルダ直下に <code>_output</code> フォルダが自動生成され、ファイルが順次保存されます。</li>
            <li>抽出範囲を変更した場合は、同じフォルダを再ドロップし <code>_output</code> を更新してください。</li>
          </ol>
          <p>出力例: <code>products/item1/photo1.jpg</code> → <code>item1_pc.jpg</code>, <code>item1_mobile.jpg</code>, <code>item1_sns.jpg</code></p>
        </section>

        <section className="usage-section">
          <h2>注意事項</h2>
          <div className="usage-warning">
            <strong>重要:</strong> 抽出範囲を調整しただけでは書き出し結果に反映されません。同じフォルダをもう一度ドロップし、再検出と再書き出しを行ってください。
          </div>
          <ul>
            <li>単一画像をドロップした場合はプレビューのみで、書き出しは行われません。</li>
            <li>File System Access API に対応したブラウザ（Chrome / Edge など）での利用を想定しています。</li>
          </ul>
        </section>
      </div>
      <div className={`usage-accordion${showLayoutSettings ? ' open' : ''}`}>
        <section className="usage-section">
          <h2>設定・レイアウト</h2>
          <p className="usage-note">
            プロファイルのサイズ・フォーマットや、レイアウトパターンの調整はここで行います。変更後はフォルダを再ドロップして再処理してください。
          </p>
          <LayoutSettings />
          <DebugControls />
          {debugController.shouldShowParameterTracking() && (
            <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 4 }}>
              <h4 style={{ margin: '0 0 8px 0' }}>パラメーター追跡 (学習用)</h4>
              <ParameterExportStats />
            </div>
          )}
        </section>
      </div>
      <Dropzone worker={worker} onDetected={handleDetected} onBatchMode={handleBatchMode} />
      {image && bbox && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16, marginTop: 16 }}>
          <div>
            <CanvasEditor
              image={image}
              initialBBox={bbox}
              sizes={currentSizes}
              onChange={handleEditorChange}
              onSave={handleSaveChanges}
              onReset={() => {
                setBBox(initialBBoxRef.current || bbox);
                debugController.log('App', 'Canvas Editor reset to initial bbox:', initialBBoxRef.current);
              }}
            />
          </div>
          <div>
            <OutputPanel
              worker={worker}
              payload={composePayload}
              onShowToast={showToastNotification}
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
            onShowToast={showToastNotification}
          />
        </div>
      )}
      
      <Toast 
        message={toastMessage}
        show={showToast}
        onHide={hideToast}
        type="success"
      />
    </>
  )
}

// Main App component wrapped with ProfilesProvider
function App() {
  return (
    <ProfilesProvider>
      <AppShell />
    </ProfilesProvider>
  )
}

export default App

function AppShell() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const shouldFetchBuildInfo = import.meta.env.DEV

  useEffect(() => {
    if (!shouldFetchBuildInfo) {
      return
    }
    let cancelled = false
    fetch('/build-info.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        const data = (await response.json()) as BuildInfo
        return data
      })
      .then((info) => {
        if (!cancelled) {
          setBuildInfo(info)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBuildInfo(null)
        }
      })
    return () => {
      cancelled = true
    }
    return () => {
      cancelled = true
    }
  }, [shouldFetchBuildInfo])

  return (
    <div>
      <header className="app-header">
        <h1>商品画像バッチ処理ツール</h1>
        {shouldFetchBuildInfo && <BuildInfoBanner info={buildInfo} />}
      </header>
      <AppContent />
    </div>
  )
}

interface BuildInfo {
  commit: string
  branch: string
  status: string
  builtAt: string
}

function BuildInfoBanner({ info }: { info: BuildInfo | null }) {
  if (!info) {
    return null
  }
  return (
    <div className="build-info">
      <span>build {info.commit} ({formatTimestamp(info.builtAt)})</span>
      <span className="build-info__branch">branch: {info.branch}</span>
      {info.status && info.status !== 'clean' && (
        <span className="build-info__status">status: {info.status}</span>
      )}
    </div>
  )
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
