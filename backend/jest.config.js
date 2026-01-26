/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.mjs',
    '**/__tests__/**/*.test.js',
    '**/*.spec.mjs',
    '**/*.spec.js',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {},
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
};
