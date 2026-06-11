import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev we proxy API + media to the FastAPI backend so the frontend can use
// relative URLs (no CORS juggling). Override with VITE_API_BASE in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 (not localhost) so the proxy reaches an IPv4-bound backend.
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
})
