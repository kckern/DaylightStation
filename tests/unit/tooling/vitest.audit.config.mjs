// Static tooling only: no frontend setup, product imports, or runtime fixtures.
export default {
  test: {
    environment: 'node',
    include: [
      'tests/unit/tooling/auditLayerImports.test.mjs',
      'tests/unit/tooling/auditDirectFsImports.test.mjs',
      'tests/unit/tooling/auditEsmLinks.test.mjs',
    ],
  },
};
