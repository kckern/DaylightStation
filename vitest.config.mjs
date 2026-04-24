import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendNodeModules = path.resolve(__dirname, 'frontend/node_modules');

export default {
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
  },
};
