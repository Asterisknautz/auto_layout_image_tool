import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // No base path for Vercel deployment
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
        mode: 'development'
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
  },
  assetsInclude: ['**/*.onnx', '**/*.wasm'],
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: ['..']
    }
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', 'opencv.js']
  }
});
