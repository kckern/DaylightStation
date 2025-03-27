import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Ensure path is imported

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'public'), // Pointing @ to the public folder
    }
  }
})
