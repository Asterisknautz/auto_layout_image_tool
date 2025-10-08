import React, { useState, useEffect } from 'react';
import { useProfiles } from '../context/ProfilesContext';
import type { OutputProfile as ProfileConfig, LayoutsConfig } from '../context/ProfilesContext';
import { debugController } from '../utils/debugMode';

type ProfilesMap = Record<string, ProfileConfig>;

type NewProfileFormState = {
  displayName: string;
  fileBase: string;
  width: string;
  height: string;
  formats: {
    jpg: boolean;
    png: boolean;
    psd: boolean;
  };
};

interface LayoutSettingsProps {
  onSettingsChange?: (settings: { profiles: ProfilesMap; layouts: LayoutsConfig }) => void;
}

const LayoutSettings: React.FC<LayoutSettingsProps> = ({ onSettingsChange }) => {
  const { config, setConfig } = useProfiles();
  const [profiles, setProfiles] = useState<ProfilesMap>({});
  const [layouts, setLayouts] = useState<LayoutsConfig>({});
  const [selectedProfile, setSelectedProfile] = useState<string>('pc');
  const [selectedFormats, setSelectedFormats] = useState<string[]>(['jpg']);
  const [groupByFormatEnabled, setGroupByFormatEnabled] = useState<boolean>(false);
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);
  const [newProfileError, setNewProfileError] = useState<string | null>(null);
  const [newProfileForm, setNewProfileForm] = useState<NewProfileFormState>({
    displayName: '',
    fileBase: '',
    width: '780',
    height: '780',
    formats: { jpg: true, png: false, psd: false },
  });
  
  // Load current settings from context
  useEffect(() => {
    if (config.profiles) {
      console.log('[LayoutSettings] Loading config:', config);
      setProfiles(config.profiles);
      setLayouts(config.layouts ?? {});
      
      // Only set initial profile if no profile is currently selected
      if (!selectedProfile || !config.profiles[selectedProfile]) {
        const firstProfile = Object.keys(config.profiles)[0];
        if (firstProfile) {
          setSelectedProfile(firstProfile);
          const profile = config.profiles[firstProfile];
          setSelectedFormats(profile?.formats || ['jpg']);
          setGroupByFormatEnabled(Boolean(profile?.groupByFormat));
          console.log('[LayoutSettings] Set initial profile:', firstProfile, 'formats:', profile?.formats);
        }
      } else {
        // Update formats for current profile without changing selection
        const currentProfile = config.profiles[selectedProfile];
        if (currentProfile) {
          if (currentProfile.formats) {
            setSelectedFormats(currentProfile.formats);
            console.log('[LayoutSettings] Updated formats for current profile:', selectedProfile, 'formats:', currentProfile.formats);
          }
          setGroupByFormatEnabled(Boolean(currentProfile.groupByFormat));
        }
      }
      console.log('[LayoutSettings] Loaded settings from context - profiles:', Object.keys(config.profiles), 'layouts:', Object.keys(config.layouts || {}));
    }
  }, [config, selectedProfile]);

  const handleFormatChange = (format: string, checked: boolean) => {
    console.log('[LayoutSettings] Format change:', { format, checked, currentFormats: selectedFormats });
    
    const newFormats = checked 
      ? [...selectedFormats, format]
      : selectedFormats.filter(f => f !== format);
    
    console.log('[LayoutSettings] New formats:', newFormats);
    
    setSelectedFormats(newFormats);
    
    // Update profile formats
    const updatedProfiles = {
      ...profiles,
      [selectedProfile]: {
        ...profiles[selectedProfile],
        formats: newFormats
      }
    };
    
    setProfiles(updatedProfiles);
    
    // Update context with new configuration
    const newConfig = { profiles: updatedProfiles, layouts };
    console.log('[LayoutSettings] Updating context with new config:', newConfig);
    setConfig(newConfig, true);
    onSettingsChange?.(newConfig);
  };

  const handleGroupByFormatChange = (checked: boolean) => {
    setGroupByFormatEnabled(checked);
    const updatedProfiles = {
      ...profiles,
      [selectedProfile]: {
        ...profiles[selectedProfile],
        groupByFormat: checked,
      },
    };
    setProfiles(updatedProfiles);
    const newConfig = { profiles: updatedProfiles, layouts };
    setConfig(newConfig, true);
    onSettingsChange?.(newConfig);
  };

  const handleProfileChange = (profileKey: string) => {
    console.log('[LayoutSettings] Profile change triggered:', { 
      from: selectedProfile, 
      to: profileKey,
      currentFormats: selectedFormats 
    });
    
    setSelectedProfile(profileKey);
    const profile = profiles[profileKey];
    const newFormats = profile?.formats || ['jpg'];
    setSelectedFormats(newFormats);
    setGroupByFormatEnabled(Boolean(profile?.groupByFormat));
    
    console.log('[LayoutSettings] Profile changed to:', profileKey, 'Layout type will be:', getLayoutTypeForProfile(profileKey), 'new formats:', newFormats);
  };

  const getLayoutTypeForProfile = (profileKey: string) => {
    const profileSize = profiles[profileKey]?.sizes[0];
    if (!profileSize) return 'square';
    const { width, height } = profileSize;
    return height > width ? 'vertical' : width > height ? 'horizontal' : 'square';
  };

  const handleLayoutPatternChange = (imageCount: string, newPattern: number[]) => {
    const profileSize = profiles[selectedProfile]?.sizes[0];
    if (!profileSize) return;
    
    const { width, height } = profileSize;
    const layoutType = height > width ? 'vertical' : width > height ? 'horizontal' : 'square';
    
    const layoutKey = layoutType as keyof LayoutsConfig;
    const updatedLayouts: LayoutsConfig = {
      ...layouts,
      [layoutKey]: {
        ...(layouts[layoutKey] ?? {}),
        patterns: {
          ...(layouts[layoutKey]?.patterns ?? {}),
          [imageCount]: { rows: newPattern },
        },
      },
    };
    
    setLayouts(updatedLayouts);
    
    // Update context with new configuration
    const newConfig = { profiles, layouts: updatedLayouts };
    setConfig(newConfig, true);
    onSettingsChange?.(newConfig);
    
    console.log('[LayoutSettings] Updated layout pattern:', { imageCount, newPattern, layoutType });
  };

  const sanitizeIdentifier = (value: string, fallback: string) => {
    const trimmed = (value ?? '').trim();
    const source = trimmed.length ? trimmed : fallback;
    const sanitized = source.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    if (sanitized.length) return sanitized;
    const fallbackSanitized = fallback.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    return fallbackSanitized || 'profile';
  };

  const generateUniqueProfileKey = (base: string) => {
    let candidate = base;
    let counter = 1;
    while (candidate in profiles) {
      candidate = `${base}_${counter++}`;
    }
    return candidate;
  };

  const generateUniqueFileBase = (base: string) => {
    const used = new Set(Object.values(profiles).map((p) => p.fileBase));
    let candidate = base;
    let counter = 1;
    while (used.has(candidate)) {
      candidate = `${base}_${counter++}`;
    }
    return candidate;
  };

  const openAddProfileModal = () => {
    const referenceSize = profiles[selectedProfile]?.sizes?.[0];
    setNewProfileForm({
      displayName: '',
      fileBase: '',
      width: String(referenceSize?.width ?? 780),
      height: String(referenceSize?.height ?? 780),
      formats: { jpg: true, png: false, psd: false },
    });
    setNewProfileError(null);
    setIsAddProfileModalOpen(true);
  };

  const closeAddProfileModal = () => {
    setIsAddProfileModalOpen(false);
    setNewProfileError(null);
  };

  const handleNewProfileFieldChange = (field: 'displayName' | 'fileBase' | 'width' | 'height', value: string) => {
    setNewProfileForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNewProfileFormatToggle = (format: keyof NewProfileFormState['formats'], checked: boolean) => {
    setNewProfileForm((prev) => ({
      ...prev,
      formats: {
        ...prev.formats,
        [format]: checked,
      },
    }));
  };

  const handleAddProfileSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = newProfileForm.displayName.trim();
    if (!displayName) {
      setNewProfileError('表示名を入力してください');
      return;
    }

    const widthValue = Number(newProfileForm.width);
    const heightValue = Number(newProfileForm.height);
    if (!Number.isFinite(widthValue) || widthValue < 50 || widthValue > 4000) {
      setNewProfileError('幅は 50〜4000 の範囲で入力してください');
      return;
    }
    if (!Number.isFinite(heightValue) || heightValue < 50 || heightValue > 4000) {
      setNewProfileError('高さは 50〜4000 の範囲で入力してください');
      return;
    }

    const selectedFormatEntries = Object.entries(newProfileForm.formats).filter(([, checked]) => checked) as Array<
      [keyof NewProfileFormState['formats'], boolean]
    >;
    if (selectedFormatEntries.length === 0) {
      setNewProfileError('少なくとも1つの出力形式を選択してください');
      return;
    }
    const formats = selectedFormatEntries.map(([format]) => format);

    const sanitizedFileBaseBase = sanitizeIdentifier(newProfileForm.fileBase, displayName);
    const uniqueFileBase = generateUniqueFileBase(sanitizedFileBaseBase);
    const profileKeyBase = sanitizeIdentifier(displayName, 'profile');
    const profileKey = generateUniqueProfileKey(profileKeyBase);

    const width = Math.round(widthValue);
    const height = Math.round(heightValue);

    const newProfile: ProfileConfig = {
      sizes: [{ name: 'main', width, height }],
      formats,
      exportPsd: formats.includes('psd'),
      displayName,
      fileBase: uniqueFileBase,
      groupByFormat: false,
    };

    const updatedProfiles = {
      ...profiles,
      [profileKey]: newProfile,
    };

    setProfiles(updatedProfiles);
    const newConfig = { profiles: updatedProfiles, layouts };
    setConfig(newConfig, true);
    onSettingsChange?.(newConfig);
    setSelectedProfile(profileKey);
    setSelectedFormats(formats);
    setGroupByFormatEnabled(false);
    setNewProfileForm({
      displayName: '',
      fileBase: '',
      width: '780',
      height: '780',
      formats: { jpg: true, png: false, psd: false },
    });
    setIsAddProfileModalOpen(false);
    setNewProfileError(null);
  };

  const handleDeleteProfile = () => {
    if (Object.keys(profiles).length <= 1) {
      alert('少なくとも1つのプロファイルが必要です。');
      return;
    }

    const targetDisplayName = profiles[selectedProfile]?.displayName ?? selectedProfile;
    if (!confirm(`プロファイル「${targetDisplayName}」を削除しますか？`)) {
      return;
    }

    const updatedProfiles = { ...profiles };
    delete updatedProfiles[selectedProfile];

    const remainingKeys = Object.keys(updatedProfiles);
    const nextKey = remainingKeys[0];

    setProfiles(updatedProfiles);
    const newConfig = { profiles: updatedProfiles, layouts };
    setConfig(newConfig, true);
    onSettingsChange?.(newConfig);

    if (nextKey) {
      setSelectedProfile(nextKey);
      const nextProfile = updatedProfiles[nextKey];
      setSelectedFormats(nextProfile?.formats || ['jpg']);
      setGroupByFormatEnabled(Boolean(nextProfile?.groupByFormat));
    }
  };

  const renderLayoutPreview = (pattern: number[], imageCount: number) => {
    const totalCells = pattern.reduce((sum, cols) => sum + cols, 0);
    const cellsUsed = Math.min(totalCells, imageCount);
    
    return (
      <div className="layout-preview" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '2px',
        border: '1px solid #ddd',
        padding: '8px',
        borderRadius: '4px',
        minWidth: '100px',
        minHeight: '80px'
      }}>
        {pattern.map((cols, rowIndex) => (
          <div key={rowIndex} style={{ 
            display: 'flex', 
            gap: '2px',
            height: `${100/pattern.length}%`
          }}>
            {Array.from({ length: cols }, (_, colIndex) => {
              const cellIndex = pattern.slice(0, rowIndex).reduce((sum, c) => sum + c, 0) + colIndex;
              const isUsed = cellIndex < cellsUsed;
              return (
                <div
                  key={colIndex}
                  style={{
                    flex: 1,
                    backgroundColor: isUsed ? '#e3f2fd' : '#f5f5f5',
                    border: '1px solid #ccc',
                    minHeight: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    color: isUsed ? '#1976d2' : '#999'
                  }}
                >
                  {isUsed ? cellIndex + 1 : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const generatePatternOptions = (imageCount: number) => {
    const options = [];
    
    // 1行に全て並べる（横並び）
    options.push({ 
      name: `横並び (${imageCount}列)`, 
      pattern: [imageCount] 
    });
    
    // 1列に全て並べる（縦並び）
    if (imageCount > 1) {
      options.push({ 
        name: `縦並び (${imageCount}行)`, 
        pattern: Array(imageCount).fill(1) 
      });
    }
    
    // 2列パターン
    if (imageCount >= 2) {
      const rows2 = Math.ceil(imageCount / 2);
      const pattern2 = [];
      for (let i = 0; i < rows2; i++) {
        const remaining = imageCount - i * 2;
        pattern2.push(Math.min(2, remaining));
      }
      if (pattern2.length > 1 && pattern2[pattern2.length - 1] < 2) {
        options.push({ 
          name: `2列レイアウト`, 
          pattern: pattern2 
        });
      }
    }
    
    // 3列パターン
    if (imageCount >= 3) {
      const rows3 = Math.ceil(imageCount / 3);
      const pattern3 = [];
      for (let i = 0; i < rows3; i++) {
        const remaining = imageCount - i * 3;
        pattern3.push(Math.min(3, remaining));
      }
      if (pattern3.length > 1 || imageCount > 3) {
        options.push({ 
          name: `3列レイアウト`, 
          pattern: pattern3 
        });
      }
    }
    
    // 2x2 グリッド（4枚以上）
    if (imageCount === 4) {
      options.push({ 
        name: `2×2グリッド`, 
        pattern: [2, 2] 
      });
    }
    
    // ピラミッド型（5-6枚）
    if (imageCount === 5) {
      options.push({ 
        name: `ピラミッド型`, 
        pattern: [2, 3] 
      });
    }
    
    if (imageCount === 6) {
      options.push({ 
        name: `3×2グリッド`, 
        pattern: [3, 3] 
      });
      options.push({ 
        name: `2×3グリッド`, 
        pattern: [2, 2, 2] 
      });
    }
    
    return options;
  };

  const getLayoutType = () => {
    const profileSize = profiles[selectedProfile]?.sizes[0];
    if (!profileSize) return 'square';
    
    const { width, height } = profileSize;
    return height > width ? 'vertical' : width > height ? 'horizontal' : 'square';
  };

  const currentLayoutType = getLayoutType();
  const currentLayout = layouts[currentLayoutType] ?? {};
  const currentProfile = profiles[selectedProfile];
  const currentDisplayName = currentProfile?.displayName ?? selectedProfile.toUpperCase();
  const currentFileBase = currentProfile?.fileBase ?? selectedProfile;

  return (
    <div style={{ padding: '20px', maxWidth: '800px' }}>
      <h2>⚙️ 出力設定・レイアウト</h2>

      {/* Profile Selection */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3 style={{ margin: 0 }}>出力プロファイル</h3>
          <button
            type="button"
            onClick={openAddProfileModal}
            style={{
              padding: '6px 12px',
              border: '1px solid #007bff',
              borderRadius: '4px',
              backgroundColor: '#007bff',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            ＋ プロファイル追加
          </button>
        </div>
        {debugController.shouldShowProfileDebugInfo() && (
          <>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px', backgroundColor: '#E3F2FD', padding: '8px', borderRadius: '4px', fontFamily: 'monospace' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#1976D2' }}>
                🐛 Layout Settings Debug Info
              </div>
              - Profiles count: {Object.keys(profiles).length}<br/>
              - Profile keys: [{Object.keys(profiles).join(', ')}]<br/>
              - Selected: {selectedProfile}<br/>
              - Config exists: {config ? 'Yes' : 'No'}<br/>
              - Config.profiles exists: {config.profiles ? 'Yes' : 'No'}<br/>
              - Layouts count: {Object.keys(layouts).length}<br/>
              - LocalStorage override: {localStorage.getItem('imagetool.profiles.override') ? 'EXISTS' : 'NONE'}<br/>
              - Selected profile size: {profiles[selectedProfile]?.sizes[0] ? `${profiles[selectedProfile].sizes[0].width}x${profiles[selectedProfile].sizes[0].height}` : 'N/A'}
            </div>
            <div style={{ marginBottom: '10px' }}>
              <button
                onClick={() => {
                  // Clear both override keys to be safe
                  localStorage.removeItem('imagetool.profiles.override');
                  localStorage.removeItem('imagetool.layoutSettings');
                  debugController.log('LayoutSettings', 'Cleared all localStorage overrides');
                  window.location.reload();
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#ff6b6b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                🗑️ Clear All Overrides & Reload
              </button>
              
              <button
                onClick={() => window.clearCache?.()}
                style={{
                  marginLeft: '10px',
                  padding: '4px 8px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
                title="ブラウザキャッシュと保存された設定をクリアします"
              >
                💾 Clear Cache
              </button>
              
              <button
                onClick={() => window.resetApp?.()}
                style={{
                  marginLeft: '10px',
                  padding: '4px 8px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
                title="全ての設定をリセットしてページをリロードします"
              >
                🔄 Reset App
              </button>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          {Object.keys(profiles).length === 0 ? (
            <div style={{ padding: '10px', border: '2px solid orange', backgroundColor: '#fff3cd' }}>
              ⚠️ プロファイルが読み込まれていません。ProfilesContextからのデータ取得に問題がある可能性があります。
            </div>
          ) : (
            Object.keys(profiles).map(profileKey => {
            const profile = profiles[profileKey];
            const size = profile.sizes[0];
            const layoutType = size ? (size.height > size.width ? 'vertical' : size.width > size.height ? 'horizontal' : 'square') : 'square';
            const profileDisplayName = profile?.displayName ?? profileKey.toUpperCase();
            const profileFileBase = profile?.fileBase ?? profileKey;
            return (
              <button
                key={profileKey}
                onClick={() => handleProfileChange(profileKey)}
                style={{
                  padding: '10px 15px',
                  border: selectedProfile === profileKey ? '2px solid #1976d2' : '1px solid #ddd',
                  borderRadius: '4px',
                  background: selectedProfile === profileKey ? '#e3f2fd' : 'white',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{profileDisplayName}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {size ? `${size.width}×${size.height}` : ''}
                </div>
                <div style={{ fontSize: '10px', color: '#888' }}>
                  {layoutType}
                </div>
                <div style={{ fontSize: '9px', color: '#999', marginTop: 4 }}>
                  ファイル名: {profileFileBase}
                </div>
              </button>
            );
          })
          )}
        </div>
      </div>

      {/* Profile Size Editing */}
      {selectedProfile && profiles[selectedProfile] && (
        <div style={{ marginBottom: '20px', padding: '16px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>📐 {currentDisplayName} ({selectedProfile.toUpperCase()}) 設定</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', maxWidth: '480px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
                表示名:
              </label>
              <input
                type="text"
                value={currentDisplayName}
                onChange={(e) => {
                  const inputValue = e.target.value;
                  const trimmed = inputValue.trim();
                  const displayNameToStore = trimmed.length ? trimmed : selectedProfile.toUpperCase();
                  const updatedProfiles = {
                    ...profiles,
                    [selectedProfile]: {
                      ...profiles[selectedProfile],
                      displayName: displayNameToStore
                    }
                  };
                  setProfiles(updatedProfiles);
                  const newConfig = { profiles: updatedProfiles, layouts };
                  setConfig(newConfig, true);
                  onSettingsChange?.(newConfig);
                }}
                placeholder="例: PC, Mobile"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
                出力ファイル名（サフィックス）:
              </label>
              <input
                type="text"
                value={currentFileBase}
                onChange={(e) => {
                  const input = e.target.value;
                  const sanitized = input.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
                  const newFileBase = sanitized || selectedProfile;
                  const updatedProfiles = {
                    ...profiles,
                    [selectedProfile]: {
                      ...profiles[selectedProfile],
                      fileBase: newFileBase
                    }
                  };
                  setProfiles(updatedProfiles);
                  const newConfig = { profiles: updatedProfiles, layouts };
                  setConfig(newConfig, true);
                  onSettingsChange?.(newConfig);
                }}
                placeholder="例: pc, mobile"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
              <div style={{ fontSize: '11px', color: '#777', marginTop: '4px' }}>
                出力ファイルは <code>{'{group}'}</code>_<code>{currentFileBase}</code>.{`{拡張子}`} の形式になります。
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', maxWidth: '400px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
                幅 (px):
              </label>
              <input
                type="number"
                min="100"
                max="4000"
                value={profiles[selectedProfile]?.sizes[0]?.width || 780}
                onChange={(e) => {
                  const newWidth = parseInt(e.target.value) || 780;
                  const updatedProfiles = {
                    ...profiles,
                    [selectedProfile]: {
                      ...profiles[selectedProfile],
                      sizes: [{
                        name: 'main',
                        width: newWidth,
                        height: profiles[selectedProfile]?.sizes[0]?.height || 480
                      }]
                    }
                  };
                  setProfiles(updatedProfiles);
                  const newConfig = { profiles: updatedProfiles, layouts };
                  setConfig(newConfig, true);
                  onSettingsChange?.(newConfig);
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
                高さ (px):
              </label>
              <input
                type="number"
                min="100"
                max="4000"
                value={profiles[selectedProfile]?.sizes[0]?.height || 480}
                onChange={(e) => {
                  const newHeight = parseInt(e.target.value) || 480;
                  const updatedProfiles = {
                    ...profiles,
                    [selectedProfile]: {
                      ...profiles[selectedProfile],
                      sizes: [{
                        name: 'main',
                        width: profiles[selectedProfile]?.sizes[0]?.width || 780,
                        height: newHeight
                      }]
                    }
                  };
                  setProfiles(updatedProfiles);
                  const newConfig = { profiles: updatedProfiles, layouts };
                  setConfig(newConfig, true);
                  onSettingsChange?.(newConfig);
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '12px' }}>
            <strong>プレビュー:</strong> {profiles[selectedProfile]?.sizes[0]?.width || 780} × {profiles[selectedProfile]?.sizes[0]?.height || 480} px
            <br />
            <strong>レイアウトタイプ:</strong> {(() => {
              const size = profiles[selectedProfile]?.sizes[0];
              if (!size) return 'square';
              const { width, height } = size;
              return height > width ? 'vertical (縦長)' : width > height ? 'horizontal (横長)' : 'square (正方形)';
            })()}
          </div>
          <div style={{ marginTop: '12px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
              プリセットサイズ:
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { name: 'Instagram正方形', width: 1080, height: 1080 },
                { name: 'Instagram縦', width: 1080, height: 1350 },
                { name: 'Twitter横', width: 1200, height: 675 },
                { name: 'Facebook投稿', width: 1200, height: 630 },
                { name: 'YouTube썸네일', width: 1280, height: 720 },
                { name: 'A4横', width: 3508, height: 2480 },
                { name: 'HD横', width: 1920, height: 1080 },
                { name: 'PC横', width: 1366, height: 768 }
              ].map(preset => (
                <button
                  key={preset.name}
                  onClick={() => {
                    const updatedProfiles = {
                      ...profiles,
                      [selectedProfile]: {
                        ...profiles[selectedProfile],
                        sizes: [{
                          name: 'main',
                          width: preset.width,
                          height: preset.height
                        }]
                      }
                    };
                    setProfiles(updatedProfiles);
                    const newConfig = { profiles: updatedProfiles, layouts };
                    setConfig(newConfig, true);
                    onSettingsChange?.(newConfig);
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: '11px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#e9ecef'; }}
                  onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                  title={`${preset.width} × ${preset.height} px`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
            ※ サイズを変更すると、レイアウトパターンも自動的に適切なタイプ（縦長/横長/正方形）に切り替わります
          </div>
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '12px', color: '#666' }}>
              プロファイルキー: <code>{selectedProfile}</code>
            </div>
            <button
              type="button"
              onClick={handleDeleteProfile}
              disabled={Object.keys(profiles).length <= 1}
              style={{
                padding: '6px 12px',
                backgroundColor: Object.keys(profiles).length <= 1 ? '#d3d3d3' : '#dc3545',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: Object.keys(profiles).length <= 1 ? 'not-allowed' : 'pointer',
                fontSize: '13px'
              }}
            >
              このプロファイルを削除する
            </button>
          </div>
        </div>
      )}

      {/* Format Selection */}
      <div style={{ marginBottom: '20px' }}>
        <h3>出力形式</h3>
        {debugController.shouldShowProfileDebugInfo() && (
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px', backgroundColor: '#e8f5e8', padding: '5px' }}>
            Debug: 現在選択中の形式 = [{selectedFormats.join(', ')}]
          </div>
        )}
        {selectedFormats.length === 0 && (
          <div style={{ 
            padding: '8px', 
            marginBottom: '10px', 
            backgroundColor: '#fff3cd', 
            border: '1px solid #ffc107', 
            borderRadius: '4px',
            fontSize: '14px',
            color: '#856404'
          }}>
            ⚠️ 出力形式が選択されていません。このプロファイルは出力されません。
          </div>
        )}
        <div style={{ display: 'flex', gap: '15px' }}>
          {['jpg', 'png', 'psd'].map(format => (
            <label key={format} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <input
                type="checkbox"
                checked={selectedFormats.includes(format)}
                onChange={(e) => handleFormatChange(format, e.target.checked)}
              />
              <span>{format.toUpperCase()}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={groupByFormatEnabled}
              onChange={(e) => handleGroupByFormatChange(e.target.checked)}
            />
            <span>拡張子ごとにフォルダへ保存</span>
          </label>
          <div style={{ fontSize: '11px', color: '#666', marginLeft: '22px', marginTop: '4px' }}>
            有効にすると JPG/PNG/PSD などの拡張子ごとにサブフォルダ（例: <code>jpg/</code>）を作成して保存します。
          </div>
        </div>
      </div>

      {/* Layout Patterns */}
      <div style={{ marginBottom: '20px' }}>
        <h3>レイアウトパターン ({currentLayoutType}) - {selectedProfile.toUpperCase()}用</h3>
        <div style={{ marginBottom: '10px', fontSize: '14px', color: '#666' }}>
          プロファイル「{selectedProfile}」({profiles[selectedProfile]?.sizes[0]?.width}×{profiles[selectedProfile]?.sizes[0]?.height})のレイアウトパターンを編集中
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
          {[1, 2, 3, 4, 5, 6].map(imageCount => {
            const patternOptions = generatePatternOptions(imageCount);
            const currentPattern = currentLayout.patterns?.[String(imageCount)]?.rows || [];
            
            // If no pattern exists, use the first generated option as fallback
            const effectivePattern = currentPattern.length > 0 ? currentPattern : patternOptions[0]?.pattern || [];
            const currentPatternStr = effectivePattern.join(',');
            
            return (
              <div key={imageCount} style={{ 
                border: '1px solid #ddd', 
                borderRadius: '8px', 
                padding: '15px' 
              }}>
                <h4 style={{ margin: '0 0 10px 0' }}>{imageCount}枚</h4>
                {renderLayoutPreview(effectivePattern, imageCount)}
                
                {/* Pattern Selection */}
                <div style={{ marginTop: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '5px', display: 'block' }}>
                    パターンを選択:
                  </label>
                  <select
                    value={currentPatternStr}
                    onChange={(e) => {
                      const selectedPattern = e.target.value.split(',').map(Number);
                      handleLayoutPatternChange(String(imageCount), selectedPattern);
                    }}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '12px',
                      border: '1px solid #ccc',
                      borderRadius: '3px'
                    }}
                  >
                    {patternOptions.map((option, idx) => (
                      <option key={idx} value={option.pattern.join(',')}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#888' }}>
                  配列: [{effectivePattern.join(', ')}]
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            const config = { profiles, layouts };
            const json = JSON.stringify(config, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'layout_settings.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          📤 設定をエクスポート
        </button>
        
        <label
          style={{
            padding: '8px 16px',
            backgroundColor: '#2e7d32',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          📥 設定をインポート
          <input
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                try {
                  const text = await file.text();
                  const importedConfig = JSON.parse(text);
                  
                  if (importedConfig.profiles && importedConfig.layouts) {
                    setProfiles(importedConfig.profiles);
                    setLayouts(importedConfig.layouts);
                    
                    // Update context
                    setConfig(importedConfig, true);
                    onSettingsChange?.(importedConfig);
                    
                    // Reset profile selection
                    const firstProfile = Object.keys(importedConfig.profiles)[0];
                    if (firstProfile) {
                      setSelectedProfile(firstProfile);
                      setSelectedFormats(importedConfig.profiles[firstProfile]?.formats || ['jpg']);
                    }
                    
                    alert('設定をインポートしました！');
                  } else {
                    alert('無効な設定ファイルです。');
                  }
                } catch {
                  alert('設定ファイルの読み込みに失敗しました。');
                }
              }
              // Reset input
              e.target.value = '';
            }}
          />
        </label>
        
        <button
          onClick={async () => {
            if (confirm('デフォルト設定に戻しますか？（カスタム設定は失われます）')) {
              // Reset context to defaults
              try {
                const base = import.meta.env.BASE_URL ?? '/';
                const res = await fetch(`${base}output_profiles.json`);
                if (res.ok) {
                  const data = await res.json();
                  const resetConfig = { profiles: data.profiles || {}, layouts: data.layouts || {} };
                  
                  // Reset context (this will also clear localStorage)
                  setConfig(resetConfig, false);
                  
                  // Update local state
                  setProfiles(resetConfig.profiles);
                  setLayouts(resetConfig.layouts);
                  
                  const firstProfile = Object.keys(resetConfig.profiles)[0];
                  if (firstProfile) {
                    setSelectedProfile(firstProfile);
                    setSelectedFormats(resetConfig.profiles[firstProfile]?.formats || ['jpg']);
                  }
                  
                  onSettingsChange?.(resetConfig);
                  console.log('[LayoutSettings] Reset to default settings');
                }
              } catch (error) {
                console.error('Failed to reset settings:', error);
              }
            }
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          デフォルトに戻す
        </button>
      </div>

      {/* Current Settings Summary */}
      <div style={{ 
        marginTop: '20px', 
        padding: '15px', 
        backgroundColor: '#f8f9fa', 
        borderRadius: '4px' 
      }}>
        <h4>現在の設定概要</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
          {Object.keys(profiles).map(profileKey => {
            const profile = profiles[profileKey];
            const size = profile.sizes[0];
            const layoutType = size ? (size.height > size.width ? 'vertical' : size.width > size.height ? 'horizontal' : 'square') : 'square';
            const isSelected = profileKey === selectedProfile;
            
            return (
              <div key={profileKey} style={{
                padding: '10px',
                border: isSelected ? '2px solid #1976d2' : '1px solid #ddd',
                borderRadius: '6px',
                backgroundColor: isSelected ? '#e3f2fd' : 'white'
              }}>
                <h5 style={{ margin: '0 0 8px 0', color: isSelected ? '#1976d2' : '#333' }}>
                  {profileKey.toUpperCase()} {isSelected ? '(編集中)' : ''}
                </h5>
                <p style={{ margin: '4px 0', fontSize: '12px' }}>
                  <strong>サイズ:</strong> {size ? `${size.width}×${size.height}` : 'N/A'}
                </p>
                <p style={{ margin: '4px 0', fontSize: '12px' }}>
                  <strong>レイアウト:</strong> {layoutType}
                </p>
                <p style={{ margin: '4px 0', fontSize: '12px' }}>
                  <strong>形式:</strong> {profile?.formats && profile.formats.length > 0 ? profile.formats.join(', ') : '未選択'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {isAddProfileModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}
        >
          <div
            style={{
              width: 'min(520px, 100%)',
              backgroundColor: '#ffffff',
              borderRadius: 12,
              boxShadow: '0 24px 48px rgba(15, 23, 42, 0.35)',
              padding: '24px 28px',
              position: 'relative'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>新しいプロファイルを追加</h3>
            <p style={{ fontSize: 13, color: '#475569', marginTop: 0, marginBottom: 16 }}>
              表示名・出力ファイル名・画像サイズ・初期出力形式を設定してください。
            </p>
            {newProfileError && (
              <div
                style={{
                  marginBottom: 16,
                  padding: '10px 12px',
                  borderRadius: 6,
                  backgroundColor: '#fff4e5',
                  border: '1px solid #ffa726',
                  color: '#7c4a03',
                  fontSize: 13
                }}
              >
                {newProfileError}
              </div>
            )}
            <form onSubmit={handleAddProfileSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>表示名</span>
                  <input
                    type="text"
                    value={newProfileForm.displayName}
                    onChange={(e) => handleNewProfileFieldChange('displayName', e.target.value)}
                    placeholder="例: EC PC用"
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                    autoFocus
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>出力ファイル名（サフィックス）</span>
                  <input
                    type="text"
                    value={newProfileForm.fileBase}
                    onChange={(e) => handleNewProfileFieldChange('fileBase', e.target.value)}
                    placeholder="例: pc"
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    英数字・<code>-</code>・<code>_</code> 以外は自動で置き換えられます。
                  </span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>幅 (px)</span>
                  <input
                    type="number"
                    min={50}
                    max={4000}
                    value={newProfileForm.width}
                    onChange={(e) => handleNewProfileFieldChange('width', e.target.value)}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>高さ (px)</span>
                  <input
                    type="number"
                    min={50}
                    max={4000}
                    value={newProfileForm.height}
                    onChange={(e) => handleNewProfileFieldChange('height', e.target.value)}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                </label>
              </div>

              <div>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>初期出力形式</span>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(['jpg', 'png', 'psd'] as Array<keyof NewProfileFormState['formats']>).map((format) => (
                    <label key={format} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={newProfileForm.formats[format]}
                        onChange={(e) => handleNewProfileFormatToggle(format, e.target.checked)}
                      />
                      <span>{format.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                  最低でも1つは選択してください。必要であれば後から変更できます。
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  onClick={closeAddProfileModal}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: '#0f62fe',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  プロファイルを追加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayoutSettings;
