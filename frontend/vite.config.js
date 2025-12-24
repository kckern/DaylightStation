import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import terminal from 'vite-plugin-terminal'
import path from 'path' // Ensure path is imported

// Backend port for dev proxy - in production, frontend is served from same origin
const BACKEND_PORT = process.env.VITE_BACKEND_PORT || 3112;

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    command === 'serve' && terminal({
      console: 'terminal',  // Pipe console.log/warn/error to terminal
      output: ['terminal', 'console']  // Show in both places
    })
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
    proxy: {
      // Proxy API and media requests to backend
      '/api': `http://localhost:${BACKEND_PORT}`,
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
