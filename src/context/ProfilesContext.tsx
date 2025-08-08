import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type PadOption = 'white' | 'transparent' | [number, number, number];

export interface SizeDef { name: string; width: number; height: number; pad?: PadOption }
export interface OutputProfile { sizes: SizeDef[]; exportPsd?: boolean }

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
    },
  },
};

function normalize(raw: any): ProfilesConfig {
  if (!raw) return DEFAULT_CONFIG;
  if (raw.profiles) {
    return { profiles: raw.profiles, layouts: raw.layouts } as ProfilesConfig;
  }
  const { layouts, ...rest } = raw;
  const profiles: Record<string, OutputProfile> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === 'object' && 'sizes' in (v as any)) {
      profiles[k] = v as OutputProfile;
    }
  }
  return { profiles: Object.keys(profiles).length ? profiles : DEFAULT_CONFIG.profiles, layouts };
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
        const base = (import.meta as any).env?.BASE_URL ?? '/';
        const res = await fetch(`${base}output_profiles.json`);
        if (res.ok) {
          const json = await res.json();
          console.log('[ProfilesContext] Loaded from file:', json);
          const normalized = normalize(json);
          console.log('[ProfilesContext] Normalized config:', normalized);
          setConfigState(normalized);
        }
      } catch {}
      // apply override if any
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const json = JSON.parse(raw);
          console.log('[ProfilesContext] Applying override:', json);
          setConfigState(normalize(json));
        }
      } catch {}
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

