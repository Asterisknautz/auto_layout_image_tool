import { beforeAll, describe, expect, it, vi } from 'vitest';

let calculateCoverPlacement: typeof import('../worker/core').calculateCoverPlacement;

beforeAll(async () => {
  if (typeof self === 'undefined') {
    vi.stubGlobal('self', {
      onmessage: null,
      postMessage: vi.fn()
    });
  } else {
    Object.assign(self, {
      onmessage: null,
      postMessage: vi.fn()
    });
  }

  const workerModule = await import('../worker/core');
  calculateCoverPlacement = workerModule.calculateCoverPlacement;
});

describe('calculateCoverPlacement', () => {
  it('centers wide images and applies horizontal mask offset', () => {
    const result = calculateCoverPlacement(1200, 800, 100, 50, 400, 300);

    expect(result.scaledWidth).toBe(450);
    expect(result.scaledHeight).toBe(300);
    expect(result.drawLeft).toBe(75);
    expect(result.drawTop).toBe(50);
    expect(result.maskOffsetX).toBe(25);
    expect(result.maskOffsetY).toBe(0);
    expect(result.maskWidth).toBe(400);
    expect(result.maskHeight).toBe(300);
  });

  it('centers tall images and applies vertical mask offset', () => {
    const result = calculateCoverPlacement(800, 1600, 0, 0, 400, 300);

    expect(result.scaledWidth).toBe(400);
    expect(result.scaledHeight).toBe(800);
    expect(result.drawLeft).toBe(0);
    expect(result.drawTop).toBe(-250);
    expect(result.maskOffsetX).toBe(0);
    expect(result.maskOffsetY).toBe(250);
    expect(result.maskWidth).toBe(400);
    expect(result.maskHeight).toBe(300);
  });
});
