import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Ensure path is imported

// Silence Dart Sass legacy JS API deprecation warnings during builds
process.env.SASS_SILENCE_DEPRECATIONS = process.env.SASS_SILENCE_DEPRECATIONS || 'legacy-js-api';

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
  }
})
