/** Static declarations plus actual files-only receipts; no test evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const population = read('test-population.json');
const evidence = read('evidence-index.json');
const {parse} = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const observations = [];
for (const mode of ['jest-root', 'jest-backend', 'isolated', 'backend', 'legacy-unit']) {
  const indexed = evidence.latest['discovery-' + mode];
  if (!indexed?.fresh || indexed.exitCode !== 0) throw new Error('Missing fresh discovery: ' + mode);
  const run = read(indexed.file);
  const selected = new Set(run.files || []);
  observations.push({id: 'DISCOVERY-' + mode, mode, evidence: indexed.file,
    fileCount: run.fileCount, files: run.files, overrides: run.overrides,
    runnerOwnership: Object.fromEntries([...new Set(population.files.map(f => f.runner))].map(runner =>
      [runner, population.files.filter(f => selected.has(f.path) && f.runner === runner).length])),
    semantics: mode === 'legacy-unit' ? 'Exact proposed command only, not collection'
      : mode.startsWith('jest-') ? 'Actual Jest file collection; no assertions executed'
        : 'Actual harness-selected files; downstream runner collection not implied'});
}
const declarationCounts = {literal: 0, parameterized: 0, computedTitle: 0, skippedOrTodo: 0, loopDependent: 0};
function calleeParts(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    return [...calleeParts(node.object), node.property.name ?? node.property.value];
  if (node.type === 'CallExpression') return calleeParts(node.callee);
  return [];
}
for (const file of population.files) {
  const source = fs.readFileSync(path.join(root, file.path), 'utf8');
  const declarations = [];
  let ast;
  try { ast = parse(source, {sourceType: 'unambiguous', plugins: ['jsx',
    ...(/\.tsx?$/.test(file.path) ? ['typescript'] : []), 'decorators-legacy'], allowReturnOutsideFunction: true}); }
  catch (error) {
    file.caseExpansion = {state: 'parse-blocked', message: error.message,
      gapId: 'CASE-EXPANSION-' + file.source, owner: 'test-owner', nextAction: 'Review parser dialect before this file moves'};
    continue;
  }
  function walk(node, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, ancestors)); return; }
    if (node.type === 'CallExpression') {
      const parts = calleeParts(node.callee);
      const outerEach = node.callee.type === 'CallExpression' && parts.includes('each');
      const innerEach = node.callee.type === 'MemberExpression' && parts.at(-1) === 'each';
      if (['it', 'test', 'describe'].includes(parts[0]) && !innerEach) {
        const title = node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : null;
        const loops = ancestors.filter(n => ['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement'].includes(n.type));
        const table = outerEach ? node.callee.arguments[0] : null;
        const rowCount = table?.type === 'ArrayExpression' ? table.elements.length : null;
        const skipped = parts.some(p => ['skip', 'todo', 'skipIf', 'runIf'].includes(p));
        declarations.push({id: 'DECL-' + file.source + '-' + node.start, line: node.loc.start.line,
          type: parts[0] === 'describe' ? 'suite' : 'case', title, modifiers: parts.slice(1),
          parameterized: outerEach, literalTableRows: rowCount, enclosingLoops: loops.map(l => l.loc.start.line),
          skippedOrConditional: skipped,
          expansion: 'Not executed: count and runtime names require importing this test module',
          note: 'Static syntax is not a registered-case count; aliased APIs and callback iterations remain source-review gaps'});
        if (title !== null) declarationCounts.literal++;
        else declarationCounts.computedTitle++;
        if (outerEach) declarationCounts.parameterized++;
        if (skipped) declarationCounts.skippedOrTodo++;
        if (loops.length) declarationCounts.loopDependent++;
      }
    }
    for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) walk(value, [...ancestors, node]);
  }
  walk(ast.program);
  file.discoveryReceipts = observations.filter(o => o.files?.includes(file.path)).map(o => o.id);
  file.caseExpansion = {state: 'static-only; full module execution not authorized by discovery',
    gapId: 'CASE-EXPANSION-' + file.source, owner: 'test-owner', declarations,
    nextAction: 'Before owner migration: audit import/setup effects, then collect and run this file with synthetic ports under its correct runner'};
}
const commands = ['package.json', 'backend/package.json', 'frontend/package.json'].flatMap(manifest =>
  Object.entries(JSON.parse(fs.readFileSync(path.join(root, manifest))).scripts || {})
    .filter(([name]) => /test|^rt|audit|check/.test(name)).map(([name, expansion]) => ({
      id: 'COMMAND-' + manifest.replaceAll('/', '-') + '-' + name,
      manifest, name, expansion, execution: 'Source-inspected only unless linked to a discovery/test receipt',
      preservation: 'Keep name/working directory; fix any changed path in a separately approved tooling card'})));
const refused = [
  {id: 'DISCOVERY-REFUSED-INTEGRATED', source: 'tests/_infrastructure/harnesses/integrated.harness.mjs',
    reason: 'ensureHouseholdDemo runs before dryRun and may spawn the generator/write existing test infrastructure',
    futureAction: 'IMP-BASE.03: separate pure discovery from setup; do not run current main under preparation authority'},
  {id: 'DISCOVERY-REFUSED-LIVE', source: 'tests/_infrastructure/harnesses/live.harness.mjs',
    reason: 'Loads environment target and fetches backend health before dryRun; not files-only',
    futureAction: 'IMP-BASE.03: pure discovery entry without network/environment reads'},
  {id: 'DISCOVERY-REFUSED-PLAYWRIGHT', source: 'playwright.config.mjs',
    reason: 'Config evaluates getAppPort, and case collection imports modules whose top-level effects have not all been audited; webServer starts npm run dev and permits existing-server reuse in normal execution',
    futureAction: 'Per-owner effect audit and standalone synthetic browser configuration before case collection'},
  {id: 'DISCOVERY-REFUSED-NODE-ALL', source: 'frontend/package.json',
    reason: 'node --test is execution, not files-only listing; selected real Node cases already have their own isolated reports',
    futureAction: 'Per-owner explicit Node case lists and fail-closed execution, not importing the entire 161-file census'}
];
const findings = [
  {id: 'RUNNER-01', source: 'docs/ai-context/testing.md', actual: 'test:backend expands to isolated.harness with --only, not scripts/test-backend.mjs; that documented file is missing', repair: 'IMP-BASE.03'},
  {id: 'RUNNER-02', source: 'backend/jest.config.js', actual: 'Actual backend Jest selection is empty under current __tests__ / spec globs', repair: 'IMP-BASE.03'},
  {id: 'RUNNER-03', source: 'docs/ai-context/testing.md', actual: 'Documented @backend/@frontend aliases and old layer paths disagree with current # aliases/configs; private-data testDataService is unsuitable for preparation', repair: 'IMP-BASE.03'},
  {id: 'RUNNER-04', source: 'package.json', actual: 'smoke:yaml references absent scripts/smoke-yaml-contracts.mjs; npm test runs port-killing pretest', repair: 'IMP-BASE.03'},
  {id: 'RUNNER-05', source: 'jest.config.js', actual: 'Jest discovery is path-based and includes non-Jest import owners; selected-file count alone is not runnable-case coverage', repair: 'IMP-BASE.03'},
  {id: 'RUNNER-06', source: 'scripts/gate-vitest.mjs', actual: 'Ratchet tool executes tests and rewrites repository report; --update additionally changes failure baseline. Neither invoked in preparation', repair: 'IMP-BASE.03'},
  {id: 'RUNNER-07', source: 'vitest.config.mjs', actual: '65 symlink aliases plus five excluded canonical files are reconciled separately; preparation uses .case.mjs to avoid accidental default collection', repair: 'IMP-BASE.03'}
];
emit('runner-review.json', {schema: 'daylight.preimplementation.runner-review/v1', baseline: population.baseline,
  population: population.files.length, observations, declarationCounts, commands, refused, findings,
  limitations: ['No repository-wide assertion result or runtime parameter count is inferred from this inventory',
    'Safe files-only paths executed; unsafe setup and per-file case expansion have explicit source-attributed gaps',
    'Existing selected assertions retain their own evidence; no empty suite is accepted as passing coverage']});
population.runnerReview = {artifact: 'runner-review.json', observations: observations.map(o => ({id: o.id, fileCount: o.fileCount})), declarationCounts,
  refusedDiscoveryIds: refused.map(r => r.id), decision: 'Inventory reconciled; discovery gaps are not executable baseline passes'};
emit('test-population.json', population);
const safety = read('command-safety.json');
for (const mode of ['jest-root', 'jest-backend', 'isolated', 'backend', 'legacy-unit']) {
  const id = 'CMD-DISCOVERY-' + mode.toUpperCase();
  safety.commands = safety.commands.filter(c => c.id !== id);
  safety.commands.push({id,
    command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-discovery.mjs ' + mode,
    status: 'executed-after-source-review',
    imports: mode.startsWith('jest-') ? 'Inspected config plus installed Jest discovery; no test-body imports'
      : 'Inspected original harness and builtin-only base imports; exits at reviewed dry-run branch',
    filesystem: 'Read-only worktree and installed dependencies; task-temporary Jest cache only; sanitized evidence output',
    network: 'OS denied', process: 'fork denied',
    limitations: 'File selection or proposed command only; no assertion or native-worktree-install equivalence claim'});
}
emit('command-safety.json', safety);
process.stdout.write(JSON.stringify({files: population.files.length, observations: observations.map(o => ({mode: o.mode, count: o.fileCount})), declarationCounts}) + '\n');
