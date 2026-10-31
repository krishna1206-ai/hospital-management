import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Vercel deployments run on temporary demo data, and the sign-in page says so.
    'import.meta.env.VITE_DEMO': JSON.stringify(process.env.VERCEL ? '1' : ''),
  },
  server: {
    // Same-origin in development too, so the strict session cookie behaves as in production.
    proxy: { '/api': 'http://localhost:4000' },
  },
})
