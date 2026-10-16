import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5099',
        changeOrigin: true
      },
      '/hubs': {
        target: 'http://localhost:5099',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: '../BenchRestoration.Api/wwwroot',
    emptyOutDir: true
  }
})
