/* eslint-disable react-refresh/only-export-components -- context file exports types alongside provider */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type PadOption = 'white' | 'transparent' | [number, number, number];

export interface SizeDef { name: string; width: number; height: number; pad?: PadOption }
export interface OutputProfile {
  sizes: SizeDef[];
  exportPsd?: boolean;
  formats?: string[];
  displayName: string;
  fileBase: string;
  groupByFormat?: boolean;
}

export interface LayoutsConfig {
  vertical?: { gutter?: number; bg_color?: string; patterns?: Record<string, { rows: number[] }> };
  horizontal?: { gutter?: number; bg_color?: string; patterns?: Record<string, { rows: number[] }> };
  square?: { gutter?: number; bg_color?: string; patterns?: Record<string, { rows: number[] }> };
}

export interface ProfilesConfig {
  profiles: Record<string, OutputProfile>;
  layouts?: LayoutsConfig;
}

const DEFAULT_CONFIG: ProfilesConfig = {
  profiles: {
    default: {
      sizes: [
        { name: 'thumb', width: 64, height: 64 },
        { name: 'preview', width: 128, height: 128 },
      ],
      displayName: 'Default',
      fileBase: 'default',
      groupByFormat: false,
    },
  },
};

const ORIENTATION_KEYS = ['vertical', 'horizontal', 'square'] as const;
type OrientationKey = typeof ORIENTATION_KEYS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPadOption(value: unknown): value is PadOption {
  if (value === 'white' || value === 'transparent') return true;
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

function coerceSizes(value: unknown): SizeDef[] | null {
  if (!Array.isArray(value)) return null;
  const sizes: SizeDef[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.width !== 'number' || typeof item.height !== 'number') {
      return null;
    }
    const name = typeof item.name === 'string' ? item.name : `${item.width}x${item.height}`;
    const pad = isPadOption(item.pad) ? item.pad : undefined;
    sizes.push({ name, width: item.width, height: item.height, pad });
  }
  return sizes;
}

function sanitizeFileBase(base: string, fallback: string): string {
  const trimmed = base.trim();
  if (!trimmed) {
    return fallback;
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return sanitized || fallback;
}

function coerceOutputProfile(key: string, value: unknown): OutputProfile | null {
  if (!isRecord(value)) return null;
  const sizes = coerceSizes(value.sizes);
  if (!sizes) return null;
  const exportPsd = typeof value.exportPsd === 'boolean' ? value.exportPsd : undefined;
  const formats = Array.isArray(value.formats)
    ? value.formats.filter((format): format is string => typeof format === 'string')
    : undefined;
  const fallbackDisplayName = key.toUpperCase();
  const displayName =
    typeof value.displayName === 'string' && value.displayName.trim().length
      ? value.displayName.trim()
      : fallbackDisplayName;
  const fileBase =
    typeof value.fileBase === 'string' && value.fileBase.trim().length
      ? sanitizeFileBase(value.fileBase, key)
      : sanitizeFileBase(key, key);
  const groupByFormat = typeof value.groupByFormat === 'boolean' ? value.groupByFormat : false;
  return { sizes, exportPsd, formats, displayName, fileBase, groupByFormat };
}

function coercePatterns(value: unknown): Record<string, { rows: number[] }> | undefined {
  if (!isRecord(value)) return undefined;
  const patterns: Record<string, { rows: number[] }> = {};
  for (const [key, patternValue] of Object.entries(value)) {
    if (isRecord(patternValue) && Array.isArray(patternValue.rows) && patternValue.rows.every((n) => typeof n === 'number')) {
      patterns[key] = { rows: [...patternValue.rows] };
    }
  }
  return Object.keys(patterns).length > 0 ? patterns : undefined;
}

function coerceLayoutsConfig(value: unknown): LayoutsConfig | undefined {
  if (!isRecord(value)) return undefined;
  const layouts: LayoutsConfig = {};
  for (const key of ORIENTATION_KEYS) {
    const entry = value[key];
    if (isRecord(entry)) {
      const definition: LayoutsConfig[OrientationKey] = {
        gutter: typeof entry.gutter === 'number' ? entry.gutter : undefined,
        bg_color: typeof entry.bg_color === 'string' ? entry.bg_color : undefined,
        patterns: coercePatterns(entry.patterns),
      };
      layouts[key] = definition;
    }
  }
  return Object.keys(layouts).length > 0 ? layouts : undefined;
}

function normalize(raw: unknown): ProfilesConfig {
  if (!isRecord(raw)) return DEFAULT_CONFIG;

  const rawLayouts = 'layouts' in raw ? coerceLayoutsConfig(raw.layouts) : undefined;
  const rawProfilesSource = 'profiles' in raw && isRecord(raw.profiles) ? raw.profiles : raw;

  const normalizedProfiles: Record<string, OutputProfile> = {};
  if (isRecord(rawProfilesSource)) {
    for (const [key, value] of Object.entries(rawProfilesSource)) {
      const profile = coerceOutputProfile(key, value);
      if (profile) {
        normalizedProfiles[key] = profile;
      }
    }
  }

  return {
    profiles: Object.keys(normalizedProfiles).length ? normalizedProfiles : DEFAULT_CONFIG.profiles,
    layouts: rawLayouts,
  };
}

const STORAGE_KEY = 'imagetool.profiles.override';

interface Ctx {
  config: ProfilesConfig;
  setConfig: (c: ProfilesConfig, persist?: boolean) => void;
  reset: () => void;
}

const ProfilesContext = createContext<Ctx | null>(null);

export function ProfilesProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<ProfilesConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    (async () => {
      // load base from file
      try {
        const base = import.meta.env.BASE_URL ?? '/';
        const res = await fetch(`${base}output_profiles.json`);
        if (res.ok) {
          const json = await res.json();
          console.log('[ProfilesContext] Loaded from file:', json);
          const normalized = normalize(json);
          console.log('[ProfilesContext] Normalized config:', normalized);
          setConfigState(normalized);
        }
      } catch (error) {
        console.warn('[ProfilesContext] Failed to load default configuration:', error);
      }
      // apply override if any
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const json = JSON.parse(raw);
          console.log('[ProfilesContext] Applying override:', json);
          const normalizedOverride = normalize(json);
          console.log('[ProfilesContext] Normalized override:', normalizedOverride);
          
          // Check if override has the expected profiles
          const overrideKeys = Object.keys(normalizedOverride.profiles);
          console.log('[ProfilesContext] Override profile keys:', overrideKeys);
          
          if (overrideKeys.includes('default') && !overrideKeys.includes('pc')) {
            console.log('[ProfilesContext] WARNING: Override contains old profiles, clearing it...');
            localStorage.removeItem(STORAGE_KEY);
            // Keep the file-based config
          } else {
            setConfigState(normalizedOverride);
          }
        }
      } catch (error) {
        console.warn('[ProfilesContext] Failed to apply profile override:', error);
      }
    })();
  }, []);

  const api = useMemo<Ctx>(() => ({
    config,
    setConfig: (c: ProfilesConfig, persist = true) => {
      setConfigState(c);
      if (persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    },
    reset: () => {
      localStorage.removeItem(STORAGE_KEY);
      // reload base file on next refresh; keep current in-memory until next fetch
    },
  }), [config]);

  return <ProfilesContext.Provider value={api}>{children}</ProfilesContext.Provider>;
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext);
  if (!ctx) throw new Error('useProfiles must be used within ProfilesProvider');
  return ctx;
}
