import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendNodeModules = path.resolve(__dirname, 'frontend/node_modules');

// Load React plugin from frontend's node_modules (it's not installed at the root).
const { default: react } = await import(path.join(frontendNodeModules, '@vitejs/plugin-react/dist/index.mjs'));

export default {
  // React plugin enables automatic JSX runtime so test files don't need `import React`.
  plugins: [react()],
  resolve: {
    alias: {
      '#frontend': path.resolve(__dirname, 'frontend/src'),
      '@shared-contracts': path.resolve(__dirname, 'shared/contracts'),
      '@testing-library/react': path.join(frontendNodeModules, '@testing-library/react'),
      '@testing-library/jest-dom': path.join(frontendNodeModules, '@testing-library/jest-dom'),
      '@mantine/core': path.join(frontendNodeModules, '@mantine/core'),
      'react': path.join(frontendNodeModules, 'react'),
      'react-dom': path.join(frontendNodeModules, 'react-dom'),
    },
  },
  test: {
    globals: true,
    environment: path.resolve(__dirname, 'tests/_infrastructure/frontend-env.mjs'),
    // Loads @testing-library/jest-dom matchers so `expect(el).toBeInTheDocument()` works.
    setupFiles: [path.resolve(__dirname, 'frontend/src/test-setup.js')],
  },
};
