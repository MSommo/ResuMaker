import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The FastAPI backend (backend/) serves /api. Proxying keeps the browser same-origin: no CORS, and cookies/headers stay simple.
// Addresses come from the environment (the Makefile and docker-compose.hot.yml set them); the defaults suit a bare `npm run dev`.
const env = process.env
const api = { '/api': { target: env.API_URL ?? `http://${env.APP_HOST ?? 'localhost'}:${env.API_PORT ?? 8100}` } }
const port = Number(env.DEV_WEB_PORT ?? 5173)
// The API container loads this server as http://web:5173 (Vite rejects unknown Host headers by default); APP_HOST is how you open it.
const allowedHosts = [...new Set(['localhost', 'web', env.APP_HOST, ...(env.VITE_ALLOWED_HOSTS ?? '').split(',')].map((h) => h?.trim()).filter((h): h is string => !!h))]

export default defineConfig({
  plugins: [react()],
  // strictPort: the backend renders PDFs by loading this URL (FRONTEND_URL), so it must not silently move.
  server: { port, strictPort: true, allowedHosts, proxy: api },
  preview: { port: 4173, strictPort: true, proxy: api },
})
