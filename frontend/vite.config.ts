import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// In dev we proxy API + media to the FastAPI backend so the frontend can use
// relative URLs (no CORS juggling). Override with VITE_API_BASE in production.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // The service worker is only built for production; it never runs under
      // `pnpm dev`, so the dev/hot-reload workflow is untouched.
      devOptions: { enabled: false },
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mirabook',
        short_name: 'Mirabook',
        description: 'Read books with a side-by-side AI translation.',
        theme_color: '#292524',
        background_color: '#e9e3d7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only. Never let the SW intercept backend calls
        // or media — those stay network-direct (online behaviour unchanged);
        // downloaded books are served from IndexedDB, not the SW cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/media/],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 (not localhost) so the proxy reaches an IPv4-bound backend.
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
  // `vite preview` (production build) uses its own proxy block.
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
})
