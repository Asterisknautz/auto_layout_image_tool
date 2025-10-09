import { describe, it, expect } from 'vitest';
import { __test__ } from '../context/ProfilesContext';

const { sanitizeFileBase, normalize } = __test__;

describe('ProfilesContext normalization', () => {
  it('sanitizes fileBase and preserves fallback when empty', () => {
    expect(sanitizeFileBase(' main banner ', 'fallback')).toBe('main_banner');
    expect(sanitizeFileBase('   ', 'fallback')).toBe('fallback');
    expect(sanitizeFileBase('あいう', 'fallback')).toBe('_');
  });

  it('forces groupByFormat to true even when source is false', () => {
    const config = normalize({
      profiles: {
        mobile: {
          sizes: [{ name: 'mobile', width: 320, height: 320 }],
          formats: ['jpg'],
          displayName: 'モバイル',
          fileBase: 'mobile',
          groupByFormat: false,
        },
      },
    });

    expect(config.profiles.mobile.groupByFormat).toBe(true);
  });

  it('falls back to default profile when data is invalid', () => {
    const config = normalize({
      profiles: {
        broken: {
          sizes: [{ width: 'invalid' }],
        },
      },
    });

    expect(Object.keys(config.profiles)).toContain('default');
  });

  it('sanitizes fileBase derived from profile key when missing', () => {
    const config = normalize({
      profiles: {
        'Promo Banner': {
          sizes: [{ name: 'promo', width: 640, height: 640 }],
          formats: ['png'],
          fileBase: '',
        },
      },
    });

    expect(config.profiles['Promo Banner'].fileBase).toBe('Promo_Banner');
  });
});
