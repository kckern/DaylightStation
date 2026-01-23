import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

// Read backend port from system config (SSOT)
function getBackendPort(env) {
  const dataPath = env.DAYLIGHT_DATA_PATH;
  const envName = env.DAYLIGHT_ENV;

  if (!dataPath || !envName) {
    console.warn('[vite] DAYLIGHT_DATA_PATH or DAYLIGHT_ENV not set, using default port 3111');
    return 3111;
  }

  const localConfigPath = path.join(dataPath, 'system', `system-local.${envName}.yml`);
  if (fs.existsSync(localConfigPath)) {
    const config = yaml.load(fs.readFileSync(localConfigPath, 'utf8'));
    const port = config.BACKEND_PORT || config.PORT || 3111;
    console.log(`[vite] Backend port from ${envName} config: ${port}`);
    return port;
  }

  return 3111;
}

// https://vitejs.dev/config/
// Note: vite-plugin-terminal removed - caused "Failed to fetch" cascades due to
// race condition at startup. Frontend console output is already visible in dev.log
// via consoleInterceptor + DaylightLogger anyway.
export default defineConfig(({ command, mode }) => {
  // Load env from root .env (one level up from frontend/)
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const BACKEND_PORT = getBackendPort(env);

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
        '@': path.resolve(__dirname, 'public'), // Pointing @ to the public folder
      }
    },
    server: {
      host: env.VITE_HOST || 'localhost',
      watch: {
        usePolling: env.CHOKIDAR_USEPOLLING === 'true',
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
  };
})
