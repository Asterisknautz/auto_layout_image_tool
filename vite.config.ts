import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/imagetool/',
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',   // ← 変更
      registerType: 'autoUpdate', // 任意: 新 SW を自動適用
      includeAssets: ['favicon.svg'],
      workbox: {
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024
      },
      manifest: {
        name: 'Image Crop & Layout',
        short_name: 'ImgTool',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#3f83f8',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  worker: {
    format: 'es'
  }
});