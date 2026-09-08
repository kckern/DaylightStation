/** Exercise the original gate's files-only functions, never its test runner. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root, packet} from './census.mjs';

const names = ['scripts/gate-vitest.mjs', 'vitest.config.mjs',
  'tests/_infrastructure/harnesses/isolated.harness.mjs',
  'tests/preimplementation/application-modules/tooling/census.mjs',
  'tests/preimplementation/application-modules/tooling/run-discovery-roots.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const inputs = names.map(name => ({name, sha256: hash(fs.readFileSync(path.join(root, name)))}));
const source = fs.readFileSync(path.join(root, names[0]), 'utf8');
const start = source.indexOf('const ROOTS = ');
const end = source.indexOf('function runVitest(files) {');
assert.ok(start > 0 && end > start, 'reviewed files-only extraction bounds');
const original = source.slice(start, end);
const declaration = "const ROOTS = ['tests/unit', 'tests/isolated', 'backend', 'frontend'];";
assert.ok(original.startsWith(declaration), 're-review changed gate roots');
const candidate = original.replace(declaration,
  "const ROOTS = ['tests/unit', 'tests/isolated', 'backend', 'frontend', 'modules', 'capabilities', 'platform'];");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-discovery-roots-'));
const fixtures = {
  'backend/retained.test.mjs': "import {test} from 'vitest';",
  'modules/gratitude/moved.test.jsx': "import {test} from 'vitest';",
  'capabilities/household/moved.test.js': "test('global-owned', () => {});",
  'platform/server/moved.test.mjs': "import {test} from 'vitest';",
  'modules/gratitude/node.test.mjs': "import test from 'node:test';",
  'modules/gratitude/jest.test.mjs': "import {test} from '@jest/globals';",
  'modules/gratitude/tests/unit/suite/legacy.test.mjs': "test('jest-owned', () => {});",
  'modules/gratitude/tests/unit/suite/explicit.test.mjs': "import {test} from 'vitest';",
  'modules/.worktrees/copy/duplicate.test.mjs': "import {test} from 'vitest';",
  'modules/gratitude/ignored.case.mjs': "import {test} from 'vitest';",
};
for (const [name, body] of Object.entries(fixtures)) {
  fs.mkdirSync(path.dirname(path.join(temporary, name)), {recursive: true});
  fs.writeFileSync(path.join(temporary, name), body);
}
fs.symlinkSync('gratitude', path.join(temporary, 'modules/alias'));
const collect = code => Array.from(vm.runInNewContext(code + '\nvitestPopulation();', {
  ROOT: temporary, path, readdirSync: fs.readdirSync,
  existsSync: fs.existsSync, readFileSync: fs.readFileSync,
}, {timeout: 5000}));
const expected = ['backend/retained.test.mjs', 'capabilities/household/moved.test.js',
  'modules/gratitude/moved.test.jsx', 'modules/gratitude/tests/unit/suite/explicit.test.mjs',
  'platform/server/moved.test.mjs'].sort();
const baseline = collect(original);
assert.deepEqual(baseline, ['backend/retained.test.mjs']);
const proposed = collect(candidate);
assert.deepEqual(proposed, expected);
const missingRoot = collect(candidate.replace(", 'platform'", ''));
assert.throws(() => assert.deepEqual(missingRoot, expected), assert.AssertionError);
assert.deepEqual(missingRoot, expected.filter(name => !name.startsWith('platform/')));
const restored = collect(candidate);
assert.deepEqual(restored, expected);
for (const input of inputs) assert.equal(hash(fs.readFileSync(path.join(root, input.name))), input.sha256);
const capturedAt = new Date().toISOString();
const file = 'discovery-roots-' + capturedAt.replaceAll(':', '-') + '.json';
const report = {schema: 'daylight.preimplementation.discovery-roots/v1',
  pack: 'discovery-roots', capturedAt, node: process.version, exitCode: 0,
  signal: null, stderr: '', inputBase: 'repository root', inputs,
  baseline, proposed, missingRoot, restored, expected,
  extractedSourceSha256: hash(original), candidateSourceSha256: hash(candidate),
  fixtureFiles: Object.entries(fixtures).map(([name, body]) => ({name, sha256: hash(body)})),
  limits: ['Original files-only functions extracted by checked bounds; whole gate not invoked',
    'Synthetic filenames and bodies only; no assertions from product suites executed',
    'Negative control is exact population comparison, not the whole gate regression reporter',
    'No native resolver, downstream Vitest collection or installed package proof'],
};
fs.writeFileSync(path.join(packet, 'evidence', file), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({evidence: 'evidence/' + file,
  baseline: baseline.length, candidate: proposed.length, missingRoot: missingRoot.length,
  restored: restored.length, passed: true}) + '\n');
