import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in development too, so the strict session cookie behaves as in production.
    proxy: { '/api': 'http://localhost:4000' },
  },
})
