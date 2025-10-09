import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { ProfilesConfig } from '../context/ProfilesContext';

let buildComposeProfiles: typeof import('../components/Dropzone').buildComposeProfiles;

beforeAll(async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });

  vi.stubGlobal(
    'window',
    {
      location: { search: '' },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as Window & typeof globalThis
  );

  const module = await import('../components/Dropzone');
  buildComposeProfiles = module.buildComposeProfiles;
});

describe('Dropzone composeMany profile preparation', () => {
  it('marks every profile with groupByFormat=true when formats exist', () => {
    const config: ProfilesConfig = {
      profiles: {
        mobile: {
          sizes: [{ name: 'mobile', width: 400, height: 400 }],
          formats: ['jpg', 'png'],
          displayName: 'モバイル ',
          fileBase: ' mobile ',
        },
        pc: {
          sizes: [{ name: 'pc', width: 800, height: 600 }],
          formats: ['psd'],
          displayName: 'PC',
          fileBase: 'pc_output',
        },
      },
    };

    const profiles = buildComposeProfiles(config);

    expect(profiles).toHaveLength(2);
    for (const prof of profiles) {
      expect(prof.groupByFormat).toBe(true);
    }
    expect(profiles[0].size).toBe('400x400');
    expect(profiles[0].fileBase).toBe('mobile');
  });

  it('skips profiles without formats and the default-only configuration', () => {
    const configWithNoFormats: ProfilesConfig = {
      profiles: {
        blank: {
          sizes: [{ name: 'blank', width: 100, height: 100 }],
          formats: [],
        },
      },
    };

    expect(buildComposeProfiles(configWithNoFormats)).toEqual([]);

    const defaultOnly: ProfilesConfig = {
      profiles: {
        default: {
          sizes: [{ name: 'default', width: 120, height: 120 }],
          formats: ['jpg'],
          displayName: 'Default',
          fileBase: 'default',
        },
      },
    };

    expect(buildComposeProfiles(defaultOnly)).toEqual([]);
  });
});
