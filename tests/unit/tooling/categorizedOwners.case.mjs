import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditOwnerBoundaries } from '../../../scripts/audit-owner-boundaries.mjs';
import { destinationServerPath, isDestinationServerFile } from '../../../scripts/audit-server-layout.mjs';

function audit(sources, publicEntries = new Set()) {
  const projectRoot = '/tmp/categorized-owner-test';
  const files = new Map(Object.entries(sources).map(([file, source]) => [join(projectRoot, file), source]));
  return auditOwnerBoundaries([...files.keys()], {
    projectRoot, imports: {}, backendImports: {}, publicEntries,
    browserAliases: new Map(), sourceInventory: new Set(files.keys()),
    readFile: (file) => files.get(file),
  });
}

test('apps in one category retain separate private boundaries', () => {
  const findings = audit({
    '__app_modules/learning/school/browser/Consumer.js': "import '../../piano/browser/Private.js';",
    '__app_modules/learning/piano/browser/Private.js': 'export const value = 1;',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].reason, 'cross-owner import targets a private implementation');
});

test('private app files remain protected outside the existing runtime facets', () => {
  for (const suffix of ['private.mjs', 'future-surface/private.mjs']) {
    const target = `__app_modules/learning/school/${suffix}`;
    const findings = audit({
      'frontend/src/Consumer.js': `import '../../${target}';`,
      [target]: 'export const value = 1;',
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].reason, 'cross-owner import targets a private implementation');
  }
});

test('public imports between apps in one category still detect cycles', () => {
  const school = '__app_modules/learning/school/browser/public.js';
  const piano = '__app_modules/learning/piano/browser/public.js';
  const findings = audit({
    [school]: "import '../../piano/browser/public.js';",
    [piano]: "import '../../school/browser/public.js';",
  }, new Set([school, piano]));
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].cycleOwners, ['__app_modules/learning/piano', '__app_modules/learning/school']);
});

test('categorized server files retain their application layer and owner', () => {
  const file = '__app_modules/learning/school/server/domain/Item.mjs';
  assert.equal(isDestinationServerFile(file), true);
  assert.deepEqual(destinationServerPath(file), {
    tree: '__app_modules', owner: 'school', layer: 'domain', suffix: 'Item.mjs',
  });
});

test('fitness CLI still resolves the checkout root after categorization', async () => {
  const { projectRoot } = await import('../../../__app_modules/wellness/fitness/cli/lib/context.mjs');
  assert.equal(projectRoot, resolve(fileURLToPath(new URL('../../../', import.meta.url))));
});
