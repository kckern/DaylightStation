import base from '../../../_infrastructure/config/vitest.config.mjs';
export default { ...base, cacheDir: '/tmp/daylight-rewards-controls-vite', optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'] } };
