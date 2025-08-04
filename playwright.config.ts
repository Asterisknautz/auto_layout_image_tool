import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'pnpm run dev',
    reuseExistingServer: !process.env.CI,
  },
});
