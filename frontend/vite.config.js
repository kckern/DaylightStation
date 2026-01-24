import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

// Read app port from system config (SSOT)
// Vite runs on app.port, proxies to backend on app.port + 1
function getPortsFromConfig(env) {
  const dataPath = env.DAYLIGHT_DATA_PATH || (env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : null);
  const envName = env.DAYLIGHT_ENV;

  const defaultAppPort = 3111;

  if (!dataPath || !envName) {
    console.warn('[vite] DAYLIGHT_DATA_PATH/DAYLIGHT_BASE_PATH or DAYLIGHT_ENV not set, using default port');
    return { app: defaultAppPort, backend: defaultAppPort + 1 };
  }

  // Try environment-specific config first, fall back to base system.yml
  let config = null;
  const localConfigPath = path.join(dataPath, 'system', `system-local.${envName}.yml`);
  const baseConfigPath = path.join(dataPath, 'system', 'system.yml');

  if (fs.existsSync(localConfigPath)) {
    config = yaml.load(fs.readFileSync(localConfigPath, 'utf8'));
  } else if (fs.existsSync(baseConfigPath)) {
    config = yaml.load(fs.readFileSync(baseConfigPath, 'utf8'));
  }

  const appPort = config?.app?.port ?? defaultAppPort;
  const backendPort = appPort + 1;  // Backend always +1 in dev (Vite only runs in dev)

  console.log(`[vite] ${envName}: app port ${appPort}, backend port ${backendPort}`);
  return { app: appPort, backend: backendPort };
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
        '@': path.resolve(__dirname, 'public'),
      }
    },
    server: {
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
        '/media': `http://localhost:${ports.backend}`,
        '/data': `http://localhost:${ports.backend}`,
      }
    }
  };
})
