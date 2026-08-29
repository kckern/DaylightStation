import { describe, expect, it } from 'vitest';
import { auditEsmLinks } from '../../../scripts/audit-esm-links.mjs';

function fixture(files, imports = { '#apps/*': './src/3_applications/*' }) {
  const projectRoot = '/repo';
  const normalized = new Map(Object.entries(files).map(([file, source]) => [`${projectRoot}/${file}`, source]));
  return auditEsmLinks([...normalized.keys()].filter((file) => file.includes('/backend/src/')), {
    projectRoot,
    imports,
    fileExists: (file) => normalized.has(file),
    readFile: (file) => normalized.get(file),
  });
}

describe('audit-esm-links', () => {
  it('accepts existing relative and aliased named exports', () => {
    expect(fixture({
      'backend/src/consumer.mjs': "import value, { named } from './target.mjs'; export { policy } from '#apps/policy.mjs';",
      'backend/src/target.mjs': 'export default 1; export const named = 2;',
      'backend/src/3_applications/policy.mjs': 'export const policy = 3;',
    })).toEqual([]);
  });

  it('reports missing module targets', () => {
    expect(fixture({
      'backend/src/consumer.mjs': "import './missing.mjs';",
    })).toEqual([expect.objectContaining({ reason: 'module target does not exist' })]);
  });

  it('reports stale named imports', () => {
    expect(fixture({
      'backend/src/consumer.mjs': "import { removed } from './target.mjs';",
      'backend/src/target.mjs': 'export const current = true;',
    })).toEqual([expect.objectContaining({ reason: 'target does not export "removed"' })]);
  });

  it('reports stale names destructured from a dynamic import', () => {
    expect(fixture({
      'backend/src/consumer.mjs': "const { removed } = await import('./target.mjs');",
      'backend/src/target.mjs': 'export const current = true;',
    })).toEqual([expect.objectContaining({ reason: 'target does not export "removed"' })]);
  });

  it('follows export-star barrels', () => {
    expect(fixture({
      'backend/src/consumer.mjs': "import { nested } from './index.mjs';",
      'backend/src/index.mjs': "export * from './nested.mjs';",
      'backend/src/nested.mjs': 'export const nested = true;',
    })).toEqual([]);
  });

  it('reports unmapped package import aliases', () => {
    expect(fixture({
      'backend/src/consumer.mjs': "import '#unknown/value.mjs';",
    })).toEqual([expect.objectContaining({ reason: 'unmapped package import alias' })]);
  });
});
