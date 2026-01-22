module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?[tj]s$': 'babel-jest',
  },
  // Path aliases - use these instead of relative paths!
  moduleNameMapper: {
    '^@backend/(.*)$': '<rootDir>/backend/$1',
    '^@frontend/(.*)$': '<rootDir>/frontend/src/$1',
    '^@extensions/(.*)$': '<rootDir>/_extensions/$1',
    '^@fixtures/(.*)$': '<rootDir>/tests/_fixtures/$1',
    '^@testlib/(.*)$': '<rootDir>/tests/lib/$1',
  },
  // Transform ESM packages from node_modules
  transformIgnorePatterns: [
    '/node_modules/(?!(zod)/)',
  ],
  // Match tests in /tests/ structure
  testMatch: [
    '**/tests/unit/**/*.test.mjs',
    '**/tests/integration/**/*.test.mjs',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/runtime/',           // Playwright handles these
    '/tests/integration/external/', // External API tests require credentials - run explicitly
    '/tests/_archive/',          // Archived tests
    '/\\.worktrees/',            // Ignore worktree fixtures/duplicates
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
