// src/test/visual.spec.ts
import { describe, test, expect } from 'vitest';
import pixelmatch from 'pixelmatch';

// 将来 Playwright で画像比較を書く予定なら
// まずはスキップしておく方法 ①
describe.skip('visual regression', () => {
  test('placeholder', () => {
    const w = 10;
    const h = 10;
    const img1 = { data: new Uint8Array(w * h * 4) };
    const img2 = { data: new Uint8Array(w * h * 4) };
    const diffBuf = new Uint8Array(w * h * 4);
    const diff = pixelmatch(img1.data, img2.data, diffBuf, w, h);
    expect(diff).toBeLessThan(50);
  });
});

// あるいは簡単なダミーを通す方法 ②
// describe('visual regression', () => {
//   test('placeholder', () => {
//     expect(true).toBe(true);
//   });
// });
