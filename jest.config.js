module.exports = {
  testMatch: ['**/backend/**/*.test.mjs'],
  transform: {
    '^.+\\.mjs$': 'babel-jest',
  },
  extensionsToTreatAsEsm: ['.mjs'],
};
