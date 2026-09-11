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

/**
 * A token that changes once per BUILD, injected into index.html as __BUILD_ID__.
 *
 * It exists because of the reverse proxy, not because of the browser. NPM has
 * asset caching on and it stores 502s: anything requested at a STABLE url while
 * the container is down — which is every deploy, for ~45s — is cached as a 502
 * under that url's key and served to everyone until the entry is evicted. On
 * 2026-09-11 `/favicon.ico` was served a cached 502 **1294 times** and `/sw.js`
 * had been dead long enough that the service worker had never once registered.
 *
 * Vite's own bundles are immune by construction — `index-BRX-JNUg.js` gets a new
 * key every build, so a poisoned one is simply never asked for again. This gives
 * the same immunity to the handful of assets that ship under a stable name. A
 * fixed `?v=1` would NOT do: that key would just be poisoned in its turn.
 *
 * The commit hash when the build has one, otherwise the build timestamp — the
 * Dockerfile's COMMIT_HASH arg is declared after `npm run build`, and moving it
 * earlier would bust the frontend layer cache on every commit. The timestamp is
 * enough: what matters is only that it differs from the last build.
 */
function buildId(env) {
  const commit = env.COMMIT_HASH || env.GIT_COMMIT || '';
  return (commit ? commit.slice(0, 12) : Date.now().toString(36));
}

/**
 * Replace __BUILD_ID__ in index.html. Runs in dev too, so the placeholder never
 * reaches a browser verbatim.
 *
 * NOT `%BUILD_ID%`, which is the shape Vite uses for its own env substitution:
 * `vite:build-html` runs `decodeURI` over every href/src it parses, `%BU` is
 * not a valid percent-escape, and the build dies with a bare "URI malformed"
 * that names no attribute. A token made of URI-safe characters cannot trip it.
 *
 * `enforce: 'pre'` so the substitution lands before that URL parsing, and Vite
 * only ever sees the finished url.
 */
function buildIdHtmlPlugin(id) {
  return {
    name: 'daylight-build-id',
    enforce: 'pre',
    transformIndexHtml(html) {
      return html.replaceAll('__BUILD_ID__', id);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from root .env (one level up from frontend/)
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const ports = getPortsFromConfig(env);

  return {
    plugins: [
      react(),
      buildIdHtmlPlugin(buildId(env)),
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
        '@gaming': path.resolve(__dirname, 'src/modules/Gaming'),
        '@gaming-ui': path.resolve(__dirname, 'src/modules/Gaming/platform/ui'),
        '@shared-contracts': path.resolve(__dirname, '../shared/contracts'),
        '@shared-music': path.resolve(__dirname, '../shared/music'),
        '@shared-gaming': path.resolve(__dirname, '../shared/gaming'),
        '@shared-interaction': path.resolve(__dirname, '../shared/interaction'),
        '@shared-presentation': path.resolve(__dirname, '../shared/presentation/scenes'),
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
