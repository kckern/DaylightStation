const path = require('node:path');

module.exports = {
  rootDir: path.resolve(__dirname, '../../..'),
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?[tj]s$': ['babel-jest', { configFile: path.join(__dirname, 'babel.config.cjs') }],
  },
  // Path aliases - use # prefix (matches package.json imports field)
  // This ensures Jest and Node resolve the same paths
  moduleNameMapper: {
    // jimp ships ESM with dynamic imports that break under Jest's VM transform;
    // point directly to its pre-built CJS dist so require() resolves cleanly.
    '^jimp$': '<rootDir>/node_modules/jimp/dist/commonjs/index.js',
    '^#system/(.*)$': '<rootDir>/__backend/src/0_system/$1',
    '^#domains/(.*)$': '<rootDir>/__backend/src/2_domains/$1',
    '^#adapters/(.*)$': '<rootDir>/__backend/src/1_adapters/$1',
    '^#rendering/(.*)$': '<rootDir>/__backend/src/1_rendering/$1',
    '^#apps/(.*)$': '<rootDir>/__backend/src/3_applications/$1',
    '^#api/(.*)$': '<rootDir>/__backend/src/4_api/$1',
    '^#backend/(.*)$': '<rootDir>/__backend/$1',
    '^#frontend/(.*)$': '<rootDir>/frontend/src/$1',
    '^@/(.*)$': '<rootDir>/frontend/src/$1',
    '^#extensions/(.*)$': '<rootDir>/_extensions/$1',
    '^#fixtures/(.*)$': '<rootDir>/tests/_fixtures/$1',
    '^#testlib/(.*)$': '<rootDir>/tests/_lib/$1',
    '^#harnesses/(.*)$': '<rootDir>/tests/_infrastructure/harnesses/$1',
  },
  // Transform ESM packages from node_modules that use import.meta or ESM syntax
  transformIgnorePatterns: [
    '/node_modules/(?!(zod|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|music-metadata|strtok3|peek-readable|token-types)/)',
  ],
  // Match tests in /tests/ structure
  testMatch: [
    '**/tests/unit/**/*.test.mjs',
    '**/tests/integration/**/*.test.mjs',
    '**/tests/isolated/**/*.test.mjs',
    '**/tests/integrated/**/*.test.mjs',
    '**/tests/live/**/*.test.mjs',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/_deleteme/',
    '/tests/runtime/',           // Playwright handles these
    '/tests/integration/external/', // External API tests require credentials - run explicitly
    '/tests/_archive/',          // Archived tests
    '<rootDir>/\\.worktrees/',   // Only ignore the main repo's .worktrees/, not tests within a worktree
    '<rootDir>/\\.claude/worktrees/', // Ignore Claude Code native worktrees (sibling checkouts would double-collect tests)
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/_deleteme/',
    '<rootDir>/\\.worktrees/',
    '<rootDir>/\\.claude/worktrees/',
  ],
  // Coverage configuration
  collectCoverageFrom: [
    '__backend/lib/**/*.{js,mjs}',
    '__backend/routers/**/*.{js,mjs}',
    'frontend/src/**/*.{js,jsx,mjs}',
    '!**/*.test.{js,mjs}',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html'],
  moduleFileExtensions: ['js', 'mjs', 'json', 'node']
};
