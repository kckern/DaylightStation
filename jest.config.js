module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?[tj]s$': 'babel-jest',
  },
  // Path aliases - use # prefix (matches package.json imports field)
  // This ensures Jest and Node resolve the same paths
  moduleNameMapper: {
    '^#system/(.*)$': '<rootDir>/backend/src/0_system/$1',
    '^#domains/(.*)$': '<rootDir>/backend/src/1_domains/$1',
    '^#adapters/(.*)$': '<rootDir>/backend/src/2_adapters/$1',
    '^#apps/(.*)$': '<rootDir>/backend/src/3_applications/$1',
    '^#api/(.*)$': '<rootDir>/backend/src/4_api/$1',
    '^#backend/(.*)$': '<rootDir>/backend/$1',
    '^#frontend/(.*)$': '<rootDir>/frontend/src/$1',
    '^#extensions/(.*)$': '<rootDir>/_extensions/$1',
    '^#fixtures/(.*)$': '<rootDir>/tests/_fixtures/$1',
    '^#testlib/(.*)$': '<rootDir>/tests/lib/$1',
  },
  // Transform ESM packages from node_modules that use import.meta or ESM syntax
  transformIgnorePatterns: [
    '/node_modules/(?!(zod|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|music-metadata|strtok3|peek-readable|token-types)/)',
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
