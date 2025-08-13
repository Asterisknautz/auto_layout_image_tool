import { useState } from 'react';
import { parameterExporter, configureParameterExporter } from '../utils/parameterExport';

export default function ParameterExportStats() {
  const [showDetails, setShowDetails] = useState(false);
  const [stats, setStats] = useState(parameterExporter.getEventsSummary());
  const [config, setConfig] = useState({ enableLocalStorage: true, enableGA4: false });

  const refreshStats = () => {
    setStats(parameterExporter.getEventsSummary());
  };

  const clearData = () => {
    if (confirm('保存されたパラメーター追跡データをすべて削除しますか？')) {
      parameterExporter.clearStoredEvents();
      refreshStats();
    }
  };

  const handleConfigChange = (key: 'enableLocalStorage' | 'enableGA4', value: boolean) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    configureParameterExporter(newConfig);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12 }}>
          編集履歴: {stats.totalEvents}件 ({stats.sessionCount}セッション)
        </span>
        <button 
          onClick={() => setShowDetails(!showDetails)}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          {showDetails ? '非表示' : '詳細'}
        </button>
        <button 
          onClick={refreshStats}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          更新
        </button>
        <button 
          onClick={clearData}
          style={{ fontSize: 11, padding: '2px 6px', color: '#d73027' }}
          disabled={stats.totalEvents === 0}
        >
          削除
        </button>
      </div>

      {showDetails && (
        <div style={{ fontSize: 12, color: '#666' }}>
          <div style={{ marginBottom: 8 }}>
            <strong>設定:</strong>
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input
                type="checkbox"
                checked={config.enableLocalStorage}
                onChange={(e) => handleConfigChange('enableLocalStorage', e.target.checked)}
              />
              {' '}Local Storage に保存
            </label>
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input
                type="checkbox"
                checked={config.enableGA4}
                onChange={(e) => handleConfigChange('enableGA4', e.target.checked)}
              />
              {' '}GA4 に送信 (利用可能な場合)
            </label>
          </div>

          {stats.totalEvents > 0 && (
            <>
              <div style={{ marginBottom: 8 }}>
                <strong>調整タイプ:</strong>
                <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                  {Object.entries(stats.adjustmentTypes).map(([type, count]) => (
                    <li key={type}>{type}: {count}回</li>
                  ))}
                </ul>
              </div>

              <div style={{ marginBottom: 8 }}>
                <strong>プロファイル使用状況:</strong>
                <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                  {Object.entries(stats.profileUsage).map(([profile, count]) => (
                    <li key={profile}>{profile}: {count}回</li>
                  ))}
                </ul>
              </div>

              <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
                このデータは画像処理アルゴリズムの改善や、
                ユーザビリティの向上のために収集されています。
                個人を特定する情報は含まれません。
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}