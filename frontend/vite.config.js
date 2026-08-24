import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { resolvePorts } from './vite.ports.mjs'

// Read app port from system config (SSOT)
// Vite runs on app.port, proxies to backend on app.port + 1
function getPortsFromConfig(env) {
  const dataPath = env.DAYLIGHT_DATA_PATH || (env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : null);
  const envName = env.DAYLIGHT_ENV;

  const result = resolvePorts({ dataPath, envName });

  if (result.usedDefault) {
    console.warn('[vite] DAYLIGHT_DATA_PATH/DAYLIGHT_BASE_PATH or DAYLIGHT_ENV not set, using default port');
  } else {
    console.log(`[vite] ${envName}: app port ${result.app}, backend port ${result.backend}`);
  }

  return { app: result.app, backend: result.backend };
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env from root .env (one level up from frontend/)
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const ports = getPortsFromConfig(env);

  return {
    plugins: [
      react()
    ],
    test: {
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./src/test-setup.js'],
    },
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
        '@': path.resolve(__dirname, 'src'),
        '@shared-contracts': path.resolve(__dirname, '../shared/contracts'),
        '@shared-music': path.resolve(__dirname, '../shared/music'),
        '@shared-gaming': path.resolve(__dirname, '../shared/gaming'),
        '@shared-presentation': path.resolve(__dirname, '../shared/presentation/scenes'),
        '@shared-interaction': path.resolve(__dirname, '../shared/interaction'),
      }
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      host: env.VITE_HOST || '0.0.0.0',
      port: ports.app,
      watch: {
        usePolling: env.CHOKIDAR_USEPOLLING === 'true',
        interval: 500
      },
      proxy: {
        // Proxy API and media requests to backend (running on app.port + 1)
        // Note: /api covers /api/v1/proxy/plex/* for Plex thumbnail proxying
        '/api': `http://localhost:${ports.backend}`,
        '/ws': {
          target: `ws://localhost:${ports.backend}`,
          ws: true
        },
        // Legacy backends, to be deprecated
        '/harvest': `http://localhost:${ports.backend}`,
        '/home': `http://localhost:${ports.backend}`,
        '/print': `http://localhost:${ports.backend}`,
        '/data': `http://localhost:${ports.backend}`,
      }
    }
  };
})
