import { useState, useEffect } from 'react';
import { debugController, type DebugConfig } from '../utils/debugMode';

export default function DebugControls() {
  const [config, setConfig] = useState<DebugConfig>(debugController.getConfig());
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const unsubscribe = debugController.subscribe((newConfig) => {
      setConfig(newConfig);
    });

    return unsubscribe;
  }, []);

  const handleMainToggle = (enabled: boolean) => {
    debugController.updateConfig({ enabled });
  };

  const handleFeatureToggle = (feature: keyof DebugConfig, value: boolean) => {
    debugController.updateConfig({ [feature]: value });
  };

  const handleQuickActions = (action: 'enableAll' | 'disableAll' | 'reset') => {
    switch (action) {
      case 'enableAll':
        debugController.enableAll();
        break;
      case 'disableAll':
        debugController.disableAll();
        break;
      case 'reset':
        debugController.disableAll();
        break;
    }
  };

  if (!config.enabled && !showDetails) {
    return (
      <div style={{ marginTop: 16, padding: 12, border: '1px dashed #ccc', borderRadius: 4, backgroundColor: '#f9f9f9' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#666' }}>開発者向け機能</span>
          <button
            onClick={() => handleMainToggle(true)}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            デバッグモード有効化
          </button>
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            設定
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, padding: 12, border: '1px solid #2196F3', borderRadius: 4, backgroundColor: '#E3F2FD' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <h4 style={{ margin: 0, color: '#1976D2' }}>🐛 デバッグモード</h4>
        <button
          onClick={() => handleMainToggle(!config.enabled)}
          style={{ 
            fontSize: 11, 
            padding: '2px 6px',
            backgroundColor: config.enabled ? '#f44336' : '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: 2
          }}
        >
          {config.enabled ? 'OFF' : 'ON'}
        </button>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          {showDetails ? '簡単表示' : '詳細設定'}
        </button>
      </div>

      {config.enabled && (
        <div style={{ fontSize: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>有効な機能:</strong>
            <span style={{ marginLeft: 8, color: '#666' }}>
              {[
                config.showProfileDebugInfo && 'プロファイル詳細',
                config.showConsoleVerbose && 'コンソール詳細',
                config.showParameterTracking && 'パラメーター追跡',
                config.showPerformanceMetrics && 'パフォーマンス',
                config.showWorkerMessages && 'ワーカーメッセージ'
              ].filter(Boolean).join(', ') || 'なし'}
            </span>
          </div>

          {showDetails && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={config.showProfileDebugInfo}
                    onChange={(e) => handleFeatureToggle('showProfileDebugInfo', e.target.checked)}
                    disabled={!config.enabled}
                  />
                  プロファイル Debug Info 表示
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={config.showConsoleVerbose}
                    onChange={(e) => handleFeatureToggle('showConsoleVerbose', e.target.checked)}
                    disabled={!config.enabled}
                  />
                  コンソール詳細ログ
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={config.showParameterTracking}
                    onChange={(e) => handleFeatureToggle('showParameterTracking', e.target.checked)}
                    disabled={!config.enabled}
                  />
                  パラメーター追跡表示
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={config.showPerformanceMetrics}
                    onChange={(e) => handleFeatureToggle('showPerformanceMetrics', e.target.checked)}
                    disabled={!config.enabled}
                  />
                  パフォーマンス測定
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={config.showWorkerMessages}
                    onChange={(e) => handleFeatureToggle('showWorkerMessages', e.target.checked)}
                    disabled={!config.enabled}
                  />
                  ワーカーメッセージ表示
                </label>
              </div>

              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                <button
                  onClick={() => handleQuickActions('enableAll')}
                  style={{ fontSize: 11, padding: '2px 6px', backgroundColor: '#4caf50', color: 'white', border: 'none', borderRadius: 2 }}
                >
                  すべて有効
                </button>
                <button
                  onClick={() => handleQuickActions('disableAll')}
                  style={{ fontSize: 11, padding: '2px 6px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: 2 }}
                >
                  すべて無効
                </button>
                <button
                  onClick={() => handleQuickActions('reset')}
                  style={{ fontSize: 11, padding: '2px 6px' }}
                >
                  リセット
                </button>
              </div>

              <div style={{ fontSize: 11, color: '#666', marginTop: 8, padding: 8, backgroundColor: '#fff', borderRadius: 2 }}>
                <strong>URL パラメーター:</strong><br />
                <code>?debug=true</code> - デバッグモード有効<br />
                <code>?debug-profiles=true</code> - プロファイル詳細表示<br />
                <code>?debug-verbose=true</code> - コンソール詳細ログ<br />
                <strong>ブラウザコンソール:</strong><br />
                <code>toggleDebug()</code>, <code>enableAllDebug()</code>, <code>disableAllDebug()</code>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}