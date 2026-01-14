import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Ensure path is imported

// Backend port for dev proxy - in production, frontend is served from same origin
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || 3112;

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
      '/api': `http://localhost:${BACKEND_PORT}`,
      '/harvest': `http://localhost:${BACKEND_PORT}`,
      '/home': `http://localhost:${BACKEND_PORT}`,
      '/print': `http://localhost:${BACKEND_PORT}`,
      '/plex_proxy': `http://localhost:${BACKEND_PORT}`,
      '/media': `http://localhost:${BACKEND_PORT}`,
      '/data': `http://localhost:${BACKEND_PORT}`,
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true
      }
    }
  }
}))
