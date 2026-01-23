import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

// Read ports from system config (SSOT)
function getPortsFromConfig(env) {
  // Support both DAYLIGHT_DATA_PATH (explicit) and DAYLIGHT_BASE_PATH (+ /data)
  const dataPath = env.DAYLIGHT_DATA_PATH || (env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : null);
  const envName = env.DAYLIGHT_ENV;

  const defaults = { backend: 3111, frontend: 5173 };

  if (!dataPath || !envName) {
    console.warn('[vite] DAYLIGHT_DATA_PATH/DAYLIGHT_BASE_PATH or DAYLIGHT_ENV not set, using default ports');
    return defaults;
  }

  const localConfigPath = path.join(dataPath, 'system', `system-local.${envName}.yml`);
  if (fs.existsSync(localConfigPath)) {
    const config = yaml.load(fs.readFileSync(localConfigPath, 'utf8'));
    const backendPort = config.server?.port || defaults.backend;
    const frontendPort = config.vite?.port || defaults.frontend;
    console.log(`[vite] Ports from ${envName} config - backend: ${backendPort}, frontend: ${frontendPort}`);
    return { backend: backendPort, frontend: frontendPort };
  }

  return defaults;
}

// https://vitejs.dev/config/
// Note: vite-plugin-terminal removed - caused "Failed to fetch" cascades due to
// race condition at startup. Frontend console output is already visible in dev.log
// via consoleInterceptor + DaylightLogger anyway.
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
        '@': path.resolve(__dirname, 'public'), // Pointing @ to the public folder
      }
    },
    server: {
      host: env.VITE_HOST || 'localhost',
      port: ports.frontend,
      watch: {
        usePolling: env.CHOKIDAR_USEPOLLING === 'true',
        interval: 500
      },
      proxy: {
        // Proxy API and media requests to backend
        // Note: /api covers /api/v1/proxy/plex/* for Plex thumbnail proxying
        '/api': `http://localhost:${ports.backend}`,
        '/harvest': `http://localhost:${ports.backend}`,
        '/home': `http://localhost:${ports.backend}`,
        '/print': `http://localhost:${ports.backend}`,
        '/media': `http://localhost:${ports.backend}`,
        '/data': `http://localhost:${ports.backend}`,
        '/ws': {
          target: `ws://localhost:${ports.backend}`,
          ws: true
        }
      }
    }
  };
})
