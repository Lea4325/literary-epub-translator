import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Literary EPUB Translator',
        short_name: 'LitTrans',
        description: 'Client-side EPUB translator powered by Gemini AI',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  // GitHub Pages repo adı dinamik olabileceği için './' (relative path) kullanıyoruz.
  // Eğer custom domain kullanacaksanız '/' yapabilirsiniz.
  base: './', 
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});