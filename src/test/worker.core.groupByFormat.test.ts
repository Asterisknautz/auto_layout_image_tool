import { describe, it, expect, beforeAll, vi } from 'vitest';

let normalizeProfileForCompose: typeof import('../worker/core').normalizeProfileForCompose;

beforeAll(async () => {
  if (typeof self === 'undefined') {
    vi.stubGlobal('self', {
      onmessage: null,
      postMessage: vi.fn(),
    });
  } else {
    Object.assign(self, {
      onmessage: null,
      postMessage: vi.fn(),
    });
  }

  const workerModule = await import('../worker/core');
  normalizeProfileForCompose = workerModule.normalizeProfileForCompose;
});

describe('worker/core normalizeProfileForCompose', () => {
  it('forces groupByFormat=true when profile requests grouping', () => {
    const result = normalizeProfileForCompose({
      tag: 'mobile',
      size: '400x400',
      formats: ['jpg', 'png'],
      displayName: 'Mobile',
      fileBase: ' mobile ',
      groupByFormat: true,
    });

    expect(result.groupByFormat).toBe(true);
    expect(result.fileBase).toBe('mobile');
    expect(result.displayName).toBe('Mobile');
    expect(result.formats).toEqual(['jpg', 'png']);
  });

  it('trims display name and falls back to tag when absent', () => {
    const result = normalizeProfileForCompose({
      tag: 'pc',
      size: '800x600',
      formats: ['psd', '', '  '],
    });

    expect(result.displayName).toBe('PC');
    expect(result.fileBase).toBe('pc');
    expect(result.formats).toEqual(['psd']);
    expect(result.groupByFormat).toBe(false);
  });
});
