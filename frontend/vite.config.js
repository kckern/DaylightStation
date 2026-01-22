import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Ensure path is imported

// Backend port for dev proxy - VITE_BACKEND_PORT set by npm scripts in dev
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || 3111;

// https://vitejs.dev/config/
// Note: vite-plugin-terminal removed - caused "Failed to fetch" cascades due to
// race condition at startup. Frontend console output is already visible in dev.log
// via consoleInterceptor + DaylightLogger anyway.
export default defineConfig(({ command }) => ({
  plugins: [
    react()
  ],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api', 'import']
      },
      sass: {
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api', 'import']
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'public'), // Pointing @ to the public folder
    }
  },
  server: {
    host: process.env.VITE_HOST || 'localhost',
    watch: {
      usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
      interval: 500
    },
    proxy: {
      // Proxy API and media requests to backend
      // Note: /api covers /api/v1/proxy/plex/* for Plex thumbnail proxying
      '/api': `http://localhost:${BACKEND_PORT}`,
      '/harvest': `http://localhost:${BACKEND_PORT}`,
      '/home': `http://localhost:${BACKEND_PORT}`,
      '/print': `http://localhost:${BACKEND_PORT}`,
      '/media': `http://localhost:${BACKEND_PORT}`,
      '/data': `http://localhost:${BACKEND_PORT}`,
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true
      }
    }
  }
}))
