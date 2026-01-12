module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': 'babel-jest',
  },
  // Transform ESM packages from node_modules
  transformIgnorePatterns: [
    '/node_modules/(?!(zod)/)',
  ],
  // Match tests in new /tests/ structure only
  testMatch: [
    '**/tests/unit/**/*.test.mjs',
    '**/tests/assembly/**/*.test.mjs',
    '**/tests/integration/**/*.test.mjs',
    '**/tests/smoke/**/*.test.mjs',
    '**/tests/live/**/*.test.mjs'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/runtime/', // Playwright handles these
    '/tests/live/',    // Live tests require actual credentials - run explicitly
    '/tests/smoke/',   // Smoke tests require running services - run explicitly
    '/\\.worktrees/',  // Ignore worktree fixtures/duplicates
    '/tests/unit/voice-memo/' // Requires React/JSX transform - TODO: move to frontend test suite
  ],
  // Coverage configuration
  collectCoverageFrom: [
    'backend/lib/**/*.{js,mjs}',
    'backend/routers/**/*.{js,mjs}',
    'frontend/src/**/*.{js,jsx,mjs}',
    '!**/*.test.{js,mjs}',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html'],
  moduleFileExtensions: ['js', 'mjs', 'json', 'node']
};
