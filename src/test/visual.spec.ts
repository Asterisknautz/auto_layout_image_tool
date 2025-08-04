// src/test/visual.spec.ts
import { describe, test, expect } from 'vitest';

// 将来 Playwright で画像比較を書く予定なら
// まずはスキップしておく方法 ①
describe.skip('visual regression', () => {
  test('placeholder', () => {
    // Example snapshot comparison with a small allowed pixel difference
    const dummy = new Uint8Array([0]);
    expect(dummy).toMatchSnapshot({
      maxDiffPixels: 1,
      maxDiffPixelRatio: 0.01
    });
  });
});

// あるいは簡単なダミーを通す方法 ②
// describe('visual regression', () => {
//   test('placeholder', () => {
//     expect(true).toBe(true);
//   });
// });
