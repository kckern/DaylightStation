/** Source-only rendering impact census and bounded original-suite execution specification. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { root, packet, emit } from './census.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const inventoryNames = ['dependency-ledger.json', 'source-ledger.json', 'test-population.json', 'rendering-boundary.json', 'combined-boundary-review.json'];
const [dependencies, ledger, population, rendering, combined] = inventoryNames.map(read);
const known = new Map(ledger.files.map(f => [f.path, f]));
const require = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'));
const { parse } = require('@babel/parser');
const selected = [
  { path: 'backend/src/1_rendering/fitness/TimelapseFrameRenderer.test.mjs', runner: 'node', runtimeScope: 'backend', expected: 2, reason: 'Real composite JPEG and missing player buffer; synthetic images/descriptors, no camera/provider/device' },
  { path: 'tests/isolated/rendering/pianoaudio/pianoRollImage.test.mjs', runner: 'vitest', runtimeScope: 'root', expected: 4, reason: 'Real PNG layout/title/empty/dense cases; in-memory note records and no MIDI device' },
  { path: 'tests/unit/rendering/eink/stub-widgets.test.mjs', runner: 'vitest', runtimeScope: 'root', expected: 5, reason: 'Real layout/widget/gray/RGB PNGs; fixed supplied instant and empty data; no acquisition or panel controller' },
  { path: 'backend/src/1_rendering/school/documents/workbookTheme.test.mjs', runner: 'vitest', runtimeScope: 'backend', expected: 12, reason: 'Theme and nine source-shipped asset authority; real pdfkit measurement document, no PDF file/output device' },
];
const roots = rendering.editedFiles.filter(f => f.path.startsWith('backend/') && f.path.endsWith('.mjs') && !f.path.includes('.test.')).map(f => f.path);
assert.equal(roots.length, 14);
const witnesses = new Map(roots.map(file => [file, []])), queue = [...roots];
for (let i = 0; i < queue.length; i++) for (const e of dependencies.edges.filter(e => e.target === queue[i])) if (!witnesses.has(e.from)) {
  witnesses.set(e.from, [e.id, ...witnesses.get(e.target)]); queue.push(e.from);
}
const isRendering = file => file.startsWith('backend/src/1_rendering/') || /tests\/(?:isolated|unit)\/rendering\//.test(file);
const prior = ['tests/unit/rendering/lib/TextRenderer.test.mjs', 'tests/unit/rendering/lib/LayoutHelpers.test.mjs'];
const affected = population.files.filter(f => witnesses.has(f.path)).map(f => ({
  path: f.path, sha256: known.get(f.path).sha256, inventoryRunner: f.runner,
  renderingSuite: isRendering(f.path), edgeWitness: witnesses.get(f.path),
  disposition: selected.some(s => s.path === f.path) ? 'selected for separate original consumer experiment'
    : prior.includes(f.path) ? 'original ten cases covered by separate rendering-identity receipt'
    : isRendering(f.path) ? 'remaining rendering suite; inspect effects/fixtures/runner before execution'
    : 'transitive application/API/composition/CLI/operator test; broad impact does not prove runtime loading or coverage',
}));
assert.equal(affected.length, 84); assert.equal(affected.filter(f => f.renderingSuite).length, 25);
const included = new Set([...selected.map(f => f.path), ...rendering.files.map(f => f.path)]), pending = [...included];
for (let i = 0; i < pending.length; i++) for (const e of dependencies.edges.filter(e => e.from === pending[i] && known.has(e.target))) if (!included.has(e.target)) { included.add(e.target); pending.push(e.target); }
assert.equal(included.size, 48);
const projected = [];
for (const file of [...included].sort()) {
  const source = fs.readFileSync(path.join(root, file), 'utf8'); assert.equal(hash(source), known.get(file).sha256);
  const edits = rendering.edits.filter(e => e.path === file), parsed = parse(source, { sourceType: 'module' });
  let text = source, last = source.length;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    assert.ok(e.end <= last); assert.equal(text.slice(e.start, e.end), e.before);
    text = text.slice(0, e.start) + e.after + text.slice(e.end); last = e.start;
  }
  parse(text, { sourceType: 'module' });
  const joint = combined.files.find(f => f.path === file);
  if (edits.length) { assert.equal(joint.sourceSha256, hash(source)); assert.equal(joint.plannedSha256, hash(text)); }
  projected.push({ path: file, destination: rendering.files.find(f => f.path === file)?.destination || file, originalSha256: hash(source), proposedSha256: hash(text), edits,
    otherPendingSpecifications: joint?.specifications.filter(n => n !== 'rendering-boundary.json') || [],
    topLevelForms: parsed.program.body.map(n => ({ type: n.type, line: n.loc.start.line })),
  });
}
assert.equal(projected.reduce((n, f) => n + f.edits.length, 0), 20);
const externalEdges = dependencies.edges.filter(e => included.has(e.from) && !known.has(e.target));
assert.ok(externalEdges.every(e => e.kind === 'builtin' || e.kind === 'package' && ['canvas', 'mathjax-full', 'pdfkit', 'vitest'].includes(e.package.name)), 'Unreviewed external/computed target');
const suites = selected.map(s => {
  const text = fs.readFileSync(path.join(root, s.path), 'utf8'), nodes = parse(text, { sourceType: 'module' }).program.body;
  const cases = [];
  function visit(body, ancestors = []) {
    for (const n of body) {
      if (n.type !== 'ExpressionStatement' || n.expression.type !== 'CallExpression') continue;
      const c = n.expression;
      if (c.callee.type !== 'Identifier' || !['it', 'test', 'describe'].includes(c.callee.name)) continue;
      assert.equal(c.arguments[0].type, 'StringLiteral'); const title = c.arguments[0].value;
      if (c.callee.name === 'describe') visit(c.arguments[1].body.body, [...ancestors, title]);
      else cases.push({ title, ancestorTitles: ancestors, fullName: [...ancestors, title].join(' ') });
    }
  }
  visit(nodes); assert.equal(cases.length, s.expected);
  const firstSuite = nodes.find(n => n.type === 'ExpressionStatement' && ['describe', 'test'].includes(n.expression.callee?.name));
  const edits = projected.find(f => f.path === s.path).edits;
  assert.ok(edits.every(e => e.end <= firstSuite.start), 'Original case/helper body changed');
  return { ...s, cases, unchangedSuiteBodySha256: hash(text.slice(firstSuite.start)), suiteBodyStart: firstSuite.start };
});
const inputs = [...new Set([...included, ...affected.map(f => f.path), 'package.json', 'backend/package.json'])].sort().map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
const toolchainNames = [require.resolve('@babel/parser'), require.resolve('@babel/parser/package.json'), ...['node_modules/vitest/package.json', 'backend/node_modules/vitest/package.json', 'backend/node_modules/canvas/package.json', 'node_modules/pdfkit/package.json', 'node_modules/mathjax-full/package.json'].map(f => path.join(process.env.PRE_TOOLCHAIN_ROOT, f))];
const report = {
  schema: 'daylight.preimplementation.rendering-consumers/v1', baseline: rendering.baseline, status: 'source-reviewed; experiment results are separate receipts',
  impactRoots: roots, affected, suites, files: projected, externalEdges,
  packageScope: { rootImports: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).imports, backendImports: JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'))).imports,
    rootVitest: '4.1.10', backendVitest: '4.0.18', backendCanvas: '3.1.0', pdfkit: '0.18.0', mathjax: '3.2.2',
    strategy: 'Separate original runner scopes; retain old import maps for unmoved consumers, exact public entries for moved helpers; no candidate source aliases or resolver loader' },
  limits: ['Conservative reverse reachability includes comments-only edited modules and test/mock imports; 84 files are impact candidates, not 84 executed suites or confirmed controller activations',
    '25 rendering suites include two prior primitive suites and four selected consumers; nineteen other renderers and fifty-nine transitive non-rendering suites retain explicit remaining-work dispositions',
    '48-file disposable fragment exercises only rendering-boundary moves and its 20 exact edits. Other proposed utility/package/owner changes remain unapplied and are recorded per file; not a full candidate',
    'Four suites have 23 reviewed literal case titles; source declaration counts that include describe calls are not execution counts',
    'Fonts/notices copied from the protected nine-asset ledger; no private records, media, providers, cameras, MIDI, panels, printers, controller or live server permitted',
    'Original tests characterize assertions, not complete output parity or negative sensitivity. Remaining PDF/Timelapse lifecycle, private caller enforcement, full package/lock/build and Linux gates stay open'],
  inputs, inventoryInputs: inventoryNames.map(name => ({ name, sha256: hash(fs.readFileSync(path.join(packet, name))) })),
  toolchainInputs: toolchainNames.map(f => ({ name: path.relative(process.env.PRE_TOOLCHAIN_ROOT, f), sha256: hash(fs.readFileSync(f)) })),
  toolHash: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
};
emit('rendering-consumer-review.json', report);
process.stdout.write(JSON.stringify({ affectedSuites: affected.length, rendererSuites: affected.filter(f => f.renderingSuite).length, selectedSuites: suites.length, originalCases: suites.reduce((n, s) => n + s.expected, 0), sourceFiles: projected.length, edits: 20, otherPending: projected.filter(f => f.otherPendingSpecifications.length).map(f => ({ path: f.path, specifications: f.otherPendingSpecifications })) }) + '\n');
