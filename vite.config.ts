import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The FastAPI backend (backend/) serves /api. Proxying keeps the browser same-origin: no CORS, and cookies/headers stay simple.
const api = { '/api': { target: process.env.API_URL ?? 'http://localhost:8100' } }

export default defineConfig({
  plugins: [react()],
  // strictPort: the backend renders PDFs by loading this URL (FRONTEND_URL), so it must not silently move.
  // allowedHosts: the API container loads this server as http://web:5173 (Vite rejects unknown Host headers by default).
  server: { port: 5173, strictPort: true, allowedHosts: ['localhost', 'web'], proxy: api },
  preview: { port: 4173, strictPort: true, proxy: api },
})
