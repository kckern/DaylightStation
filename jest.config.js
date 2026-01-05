module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': 'babel-jest',
  },
  // Transform ESM packages from node_modules
  transformIgnorePatterns: [
    '/node_modules/(?!(zod)/)',
  ],
  // Match tests in new /tests/ structure AND existing backend tests (for migration)
  testMatch: [
    '**/tests/unit/**/*.test.mjs',
    '**/tests/assembly/**/*.test.mjs',
    '**/tests/integration/**/*.test.mjs',
    '**/tests/smoke/**/*.test.mjs',
    '**/tests/live/**/*.test.mjs',
    '**/backend/**/*.test.mjs'  // Keep existing tests working during migration
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/runtime/'  // Playwright handles these
  ],
  // Setup file to initialize test environment (process.env.path.data, etc.)
  setupFilesAfterEnv: ['<rootDir>/backend/chatbots/jest.setup.mjs'],
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
