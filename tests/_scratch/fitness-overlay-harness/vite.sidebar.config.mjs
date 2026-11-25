// Sidebar harness config: the overlay harness config plus one alias. The rider
// list's hooks (useZoneProfiles) read the context through
// '../context.mjs', which the overlay config does not stub.
//   HARNESS_PORT=5199 node_modules/.bin/vite --config tests/_scratch/fitness-overlay-harness/vite.sidebar.config.mjs
//   then open /sidebar.html
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './vite.harness.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export default async (env = {}) => {
  const cfg = await base(env);
  cfg.resolve.alias = [
    { find: /^(\.\.\/)+context\.mjs$/, replacement: path.join(here, 'stubs/FitnessContext.jsx') },
    ...cfg.resolve.alias,
  ];
  cfg.optimizeDeps = { ...cfg.optimizeDeps, entries: [path.join(here, 'sidebar.html')] };
  return cfg;
};
