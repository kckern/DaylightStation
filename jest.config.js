module.exports = {
  testMatch: ['**/backend/**/*.test.mjs'],
  transform: {
    '^.+\\.[tj]s$': 'babel-jest',
  },
  // .mjs is already treated as ESM by Node; no need for extensionsToTreatAsEsm
};
