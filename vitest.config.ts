import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.{test,spec}.{ts,tsx}'], // ← src/test/ 配下を拾う
    environment: 'node',  // JSDOM が要るなら 'jsdom'
    globals: true
  }
});
