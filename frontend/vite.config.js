import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Ensure path is imported

// Silence Dart Sass legacy JS API deprecation warnings during builds
process.env.SASS_SILENCE_DEPRECATIONS = process.env.SASS_SILENCE_DEPRECATIONS || 'legacy-js-api';

// Backend port for dev proxy - in production, frontend is served from same origin
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || 3112;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api']
      },
      sass: {
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api']
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'public'), // Pointing @ to the public folder
    }
  },
  server: {
    proxy: {
      // Proxy API and media requests to backend
      '/api': `http://localhost:${BACKEND_PORT}`,
      '/plex_proxy': `http://localhost:${BACKEND_PORT}`,
      '/media': `http://localhost:${BACKEND_PORT}`,
      '/data': `http://localhost:${BACKEND_PORT}`,
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true
      }
    }
  }
})
