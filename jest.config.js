module.exports = {
  testMatch: ['**/backend/**/*.test.mjs'],
  transform: {
    '^.+\\.[tj]s$': 'babel-jest',
  },
  // Transform ESM packages from node_modules
  transformIgnorePatterns: [
    '/node_modules/(?!(zod)/)',
  ],
  // Setup file to initialize test environment (process.env.path.data, etc.)
  setupFilesAfterEnv: ['<rootDir>/backend/chatbots/jest.setup.mjs'],
  // .mjs is already treated as ESM by Node; no need for extensionsToTreatAsEsm
};
