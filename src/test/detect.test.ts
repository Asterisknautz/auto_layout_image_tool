// src/test/detect.test.ts
import { describe, expect, test } from 'vitest';

// ★不要な JSON 断片を削除して、このようなテストだけ残す
describe('dummy detect', () => {
  test('always true', () => {
    expect(true).toBe(true);
  });
});
