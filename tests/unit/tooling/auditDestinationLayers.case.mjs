import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { scanAstViolations, scanViolations, scanContent, scanDomainHierarchyViolations, analyzePortGovernance } from '../../../scripts/audit-layer-imports.mjs';
import { scanDirectFsImports } from '../../../scripts/audit-direct-fs-imports.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rules = (findings) => findings.map(({ rule }) => rule);
const put = (root, file, source) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), source);
};
const cli = (repo, script, ...args) => spawnSync(process.execPath, [join(project, 'scripts', script), ...args], { cwd: repo, encoding: 'utf8' });
function repository(t) {
  const repo = mkdtempSync(join(tmpdir(), 'destination-audits-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  mkdirSync(join(repo, '__backend/src'), { recursive: true });
  mkdirSync(join(repo, 'shared'));
  put(repo, 'scripts/audit-baseline.json', readFileSync(join(project, 'scripts/audit-baseline.json')));
  return repo;
}

for (const root of ['__app_modules/personal', '__capabilities']) {
  const server = `${root}/gratitude/server`;
  test(`${root}: fs policy covers all six layers and keeps legal controls`, () => {
    for (const layer of ['domain', 'application', 'adapters', 'api', 'rendering', 'composition']) {
      const file = `${server}/${layer}/Thing.mjs`;
      assert.deepEqual(scanDirectFsImports(file, "export * from 'node:fs/promises';"), [{ file, line: 1, specifier: 'node:fs/promises' }]);
      assert.deepEqual(scanDirectFsImports(file, "import path from 'node:path';"), []);
      assert.deepEqual(scanDirectFsImports(`${server}/${layer}/Thing.test.mjs`, "import fs from 'node:fs';"), []);
    }
    assert.deepEqual(scanDirectFsImports(`${root}/gratitude/browser/view.js`, "import fs from 'node:fs';"), []);
    assert.deepEqual(scanDirectFsImports('__backend/src/0_system/utils/FileIO.mjs', "import fs from 'node:fs';"), []);
  });
  test(`${root}: direct FS gate also covers unlayered server entries`, () => {
    for (const entry of ['public.mjs', 'print-gateway.mjs']) {
      const file = `${server}/${entry}`;
      assert.equal(scanDirectFsImports(file, "import fs from 'node:fs';").length, 1);
      assert.deepEqual(scanDirectFsImports(file, "export { create } from './composition/create.mjs';"), []);
    }
  });
  test(`${root}: relative application-to-adapter imports fail while domain imports pass`, () => {
    const file = `${server}/application/UseCase.mjs`;
    const findings = scanAstViolations(file, "const store = await import('../adapters/Store.mjs');");
    assert.ok(rules(findings).includes('apps-no-adapters'));
    assert.equal(findings[0].file, file);
    assert.deepEqual(scanAstViolations(file, "import { Item } from '../domain/Item.mjs';"), []);
    assert.ok(rules(scanViolations(file, "import fs from 'node:fs';")).includes('apps-no-fs'));
  });
  test(`${root}: domain entropy and clocks fail while injected clocks/randomness pass`, () => {
    const file = `${server}/domain/Item.mjs`;
    const findings = scanAstViolations(file, 'export function choose(rng = Math.random) { return Math.random() + Date.now() + new Date(); }');
    assert.equal(findings.filter(({ rule }) => rule === 'domains-nondeterminism').length, 2);
    assert.equal(findings.filter(({ rule }) => rule === 'domains-no-ambient-clock').length, 2);
    assert.deepEqual(scanAstViolations(file, 'export function choose(Date, rng, value) { return [new Date(), new Date(value), rng()]; }'), []);
  });
  test(`${root}: composition may wire layers but must reject runtime IO`, () => {
    const file = `${server}/composition/create.mjs`;
    assert.deepEqual(scanAstViolations(file, "import { Store } from '../adapters/Store.mjs'; import { UseCase } from '../application/UseCase.mjs';"), []);
    const findings = scanAstViolations(file, "import { spawn } from 'node:child_process'; import { save } from '#system/utils/FileIO.mjs'; await fetch('https://example.test');");
    assert.ok(rules(findings).includes('composition-no-direct-runtime-io'));
    assert.ok(rules(findings).includes('composition-no-fileio'));
    assert.ok(rules(findings).includes('composition-no-global-fetch'));
  });
  test(`${root}: API and rendering relative rules apply, and application globals are governed`, () => {
    assert.ok(rules(scanAstViolations(`${server}/api/router.mjs`, "export * from '../application/UseCase.mjs';")).includes('api-no-apps'));
    assert.ok(rules(scanAstViolations(`${server}/rendering/Card.mjs`, "import Store from '../adapters/Store.mjs';")).includes('rendering-no-adapters-apps'));
    const globals = rules(scanAstViolations(`${server}/application/UseCase.mjs`, 'fetch(url); process.env; setTimeout(run, 1);'));
    for (const rule of ['apps-no-global-fetch', 'apps-no-global-process', 'apps-no-global-timers']) assert.ok(globals.includes(rule));
    assert.deepEqual(scanAstViolations(`${server}/application/UseCase.mjs`, 'export function run(fetch, process, setTimeout) { fetch(url); process.env; setTimeout(run, 1); }'), []);
  });
  test(`${root}: content rules retain storage ownership and composition exclusions`, () => {
    assert.ok(rules(scanContent(`${server}/application/UseCase.mjs`, "const dir = 'household/gratitude'; const result = { success: false }; userDataService.read();")).includes('apps-success-false'));
    assert.ok(rules(scanContent(`${server}/application/UseCase.mjs`, "const dir = 'household/gratitude';")).includes('no-storage-paths'));
    assert.deepEqual(scanContent(`${server}/adapters/Store.mjs`, "const dir = 'household/gratitude';"), []);
    assert.deepEqual(scanContent(`${server}/composition/create.mjs`, "const dir = 'household/gratitude'; userDataService.read();"), []);
  });
  test(`${root}: adapter ports are legal and D7 still requires explicit extension`, () => {
    const port = `${server}/application/ports/IStore.mjs`;
    const adapter = `${server}/adapters/Store.mjs`;
    const contract = { file: port, content: 'export class IStore {}' };
    const wrong = "import { IStore } from '../application/ports/IStore.mjs'; export class Store {}";
    assert.deepEqual(scanAstViolations(adapter, wrong), []);
    assert.ok(rules(analyzePortGovernance([contract, { file: adapter, content: wrong }])).includes('adapters-port-not-extended'));
    assert.deepEqual(analyzePortGovernance([contract, { file: adapter, content: wrong.replace('class Store {}', 'class Store extends IStore {}') }]), []);
    assert.ok(rules(scanAstViolations(adapter, "import UseCase from '../application/UseCase.mjs';")).includes('adapters-no-app-internals'));
    assert.ok(rules(analyzePortGovernance([{ file: `${server}/adapters/ports/IStore.mjs`, content: 'export class IStore {}' }])).includes('ports-outside-applications'));
    assert.ok(rules(scanAstViolations(`${server}/domain/ports/IStore.mjs`, 'export class IStore {}')).includes('domains-no-application-ports'));
  });
  test(`${root}: known domain dependency hierarchy applies to relative destination targets`, () => {
    assert.equal(scanDomainHierarchyViolations(`${root}/content/server/domain/Item.mjs`, "import Item from '../../../gratitude/server/domain/Item.mjs';").length, 1);
    assert.deepEqual(scanDomainHierarchyViolations(`${server}/domain/Item.mjs`, "import Item from '../../../content/server/domain/Item.mjs';"), []);
  });
  for (const extension of ['js', 'cjs']) {
    test(`${root}: ${extension} legal port barrels match mjs behavior`, () => {
      assert.deepEqual(analyzePortGovernance([
        { file: `${server}/application/ports/IStore.${extension}`, content: 'export class IStore {}' },
        { file: `${server}/application/ports/index.${extension}`, content: `export { IStore } from './IStore.${extension}';` },
        { file: `${server}/adapters/Store.${extension}`, content: `import { IStore } from '../application/ports/index.${extension}'; export class Store extends IStore {}` },
      ]), []);
    });
    test(`${root}: ${extension} adapter ports require explicit extension`, () => {
      const port = `${server}/application/ports/IStore.${extension}`;
      const adapter = `${server}/adapters/Store.${extension}`;
      const contract = { file: port, content: 'export class IStore {}' };
      const wrong = `import { IStore } from '../application/ports/IStore.${extension}'; export class Store {}`;
      assert.ok(rules(analyzePortGovernance([contract, { file: adapter, content: wrong }])).includes('adapters-port-not-extended'));
      assert.deepEqual(analyzePortGovernance([contract, { file: adapter, content: wrong.replace('class Store {}', 'class Store extends IStore {}') }]), []);
    });
    test(`${root}: ${extension} ports outside application are rejected`, () => {
      assert.ok(rules(analyzePortGovernance([{ file: `${server}/adapters/ports/IStore.${extension}`, content: 'export class IStore {}' }])).includes('ports-outside-applications'));
      assert.deepEqual(analyzePortGovernance([
        { file: `${server}/application/ports/IStore.${extension}`, content: 'export class IStore {}' },
        { file: `${server}/adapters/Store.${extension}`, content: `import { IStore } from '../application/ports/IStore.${extension}'; export class Store extends IStore {}` },
      ]), []);
    });
  }
  test(`${root}: actual CLIs discover broken files, pass repairs, and reject staged broken bytes`, (t) => {
    const repo = repository(t);
    const file = `${server}/application/UseCase.mjs`;
    const broken = "import fs from 'node:fs'; import Store from '../adapters/Store.mjs';";
    const repaired = "import Item from '../domain/Item.mjs';";
    put(repo, file, broken);
    const domain = `${server}/domain/Item.mjs`;
    const composition = `${server}/composition/create.mjs`;
    const entry = `${server}/public.mjs`;
    put(repo, domain, 'export const sample = Math.random() + Date.now();');
    put(repo, composition, "import { spawn } from 'node:child_process'; await fetch('https://example.test');");
    put(repo, entry, "export * from 'node:fs';");
    for (const script of ['audit-layer-imports.mjs', 'audit-direct-fs-imports.mjs']) {
      const result = cli(repo, script);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      if (script === 'audit-direct-fs-imports.mjs') assert.ok(result.stderr.includes(entry));
    }
    const report = JSON.parse(cli(repo, 'audit-layer-imports.mjs', '--json').stdout);
    assert.equal(report.counts['apps-no-adapters'], 1);
    assert.equal(report.counts['domains-nondeterminism'], 1);
    assert.equal(report.counts['domains-no-ambient-clock'], 1);
    assert.equal(report.counts['composition-no-direct-runtime-io'], root.startsWith('__app_modules/') ? 2 : 1);
    assert.equal(report.counts['composition-no-global-fetch'], 1);
    assert.ok(report.findings.some((finding) => finding.file === file));
    execFileSync('git', ['add', '.'], { cwd: repo });
    put(repo, file, repaired);
    put(repo, domain, 'export const sample = (rng, now) => rng() + now();');
    put(repo, composition, "import Item from '../domain/Item.mjs';");
    put(repo, entry, "export * from './composition/create.mjs';");
    for (const script of ['audit-layer-imports.mjs', 'audit-direct-fs-imports.mjs']) {
      const working = cli(repo, script);
      assert.equal(working.status, 0, working.stdout + working.stderr);
      const staged = cli(repo, script, '--staged');
      assert.equal(staged.status, 1, staged.stdout + staged.stderr);
      if (script === 'audit-direct-fs-imports.mjs') assert.ok(staged.stderr.includes(entry));
    }
    const stagedReport = JSON.parse(cli(repo, 'audit-layer-imports.mjs', '--staged', '--json').stdout);
    assert.equal(stagedReport.counts['apps-no-adapters'], 1);
    assert.equal(stagedReport.counts['domains-nondeterminism'], 1);
    assert.equal(stagedReport.counts['composition-no-direct-runtime-io'], root.startsWith('__app_modules/') ? 2 : 1);
    execFileSync('git', ['add', file, domain, composition, entry], { cwd: repo });
    for (const script of ['audit-layer-imports.mjs', 'audit-direct-fs-imports.mjs']) {
      const staged = cli(repo, script, '--staged');
      assert.equal(staged.status, 0, staged.stdout + staged.stderr);
    }
  });
}

test('legacy-only repositories tolerate absent destination roots', (t) => {
  const repo = repository(t);
  for (const script of ['audit-layer-imports.mjs', 'audit-direct-fs-imports.mjs']) {
    const result = cli(repo, script);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('relative legacy sources cannot bypass layer rules by targeting a destination adapter', () => {
  assert.ok(rules(scanAstViolations('__backend/src/3_applications/gratitude/UseCase.mjs', "import Store from '../../../../__app_modules/personal/gratitude/server/adapters/Store.mjs';")).includes('apps-no-adapters'));
});

test('declared server entry layers reject domain to application public', () => {
  assert.ok(rules(scanAstViolations('__app_modules/learning/school/server/domain/Item.mjs', "import { HouseholdUserProjection } from '../../../../../__capabilities/household-identity/server/public.mjs';")).includes('domains-no-adapters'));
});
test('declared server entry layers reject rendering to composition public', () => {
  assert.ok(rules(scanAstViolations('__app_modules/learning/school/server/rendering/Card.mjs', "import { createPianoModule } from '../../../../__app_modules/learning/piano/server/composition.mjs';")).includes('rendering-no-adapters-apps'));
});
test('declared server entry layers apply source rules to the public files', () => {
  assert.ok(rules(scanAstViolations('__app_modules/personal/gratitude/server/public.mjs', "import { spawn } from 'node:child_process';")).includes('composition-no-direct-runtime-io'));
  assert.ok(rules(scanAstViolations('__capabilities/household-identity/server/public.mjs', "import fs from 'node:fs';")).includes('apps-no-fs'));
});
