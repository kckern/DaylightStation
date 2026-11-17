import { tmpdir } from 'node:os';
import path from 'node:path';
import base from '../../../_infrastructure/config/vitest.config.mjs';
export default { ...base, cacheDir: path.join(tmpdir(), 'daylight-school-style-gallery-vite'), optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] } };
