/** Rendering/public-font ownership proposal; protected source is read, never evaluated. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { root, packet, emit } from './census.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const { parse } = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const inventoryNames = ['source-ledger.json', 'dependency-ledger.json', 'boundary-review.json', 'owner-boundaries.json', 'resource-review.json'];
const [ledger, graph, foundation, owners, resources] = inventoryNames.map(n => JSON.parse(fs.readFileSync(path.join(packet, n))));
const prefix = 'backend/src/1_rendering/lib/', retired = prefix + 'index.mjs';
const selected = ['CanvasFactory.mjs', 'LayoutHelpers.mjs', 'TextRenderer.mjs'].map(n => prefix + n);
const inputs = new Map(), texts = new Map(), edits = [], dispositions = [];
function source(file) {
  if (!texts.has(file)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(sha(text), ledger.files.find(f => f.path === file)?.sha256, 'Changed source: ' + file);
    inputs.set(file, { path: file, sha256: sha(text) }); texts.set(file, text);
  }
  return texts.get(file);
}
const destination = file => owners.moves.find(m => m.old === file)?.new || foundation.files.find(f => f.path === file)?.proposedPath || file;
function add(file, before, after, kind) {
  const text = source(file); assert.equal(text.split(before).length, 2, 'Ambiguous/missing anchor: ' + file + ':' + before);
  const start = text.indexOf(before), end = start + before.length;
  const edit = { id: 'RENDER-' + sha(file + ':' + start).slice(0, 16), path: file, destination: destination(file), line: text.slice(0, start).split('\n').length, start, end, before, after, kind };
  edits.push(edit); return edit;
}
const meta = { owner: 'platform', category: 'platform', runtime: 'server', layer: 'rendering', context: null, rank: null };
const fontEntry = '@daylight/platform/server/system/assets/bundled-fonts';
const fontTarget = 'platform/server/system/assets/bundledFonts.mjs';
const fontSource = "import { fileURLToPath } from 'node:url';\n\n// Source-shipped assets only; caller-supplied runtime font directories stay separate.\nexport const bundledFontDirectory = fileURLToPath(new URL('../../assets/fonts', import.meta.url));\n";
const fontModule = { ...meta, layer: 'system', path: fontTarget, sourceText: fontSource, sha256: sha(fontSource), names: ['bundledFontDirectory'], reason: 'Three existing runtime consumers and two original test fixtures need one source-shipped font authority without cross-owner private paths; no datastore, registration or new application port.' };
const facades = [
  { suffix: 'rendering/canvas-factory', target: destination(selected[0]), names: ['initCanvas'], layer: 'rendering' },
  { suffix: 'rendering/layout-helpers', target: destination(selected[1]), names: ['drawDivider', 'drawBorder', 'roundRect', 'drawCover', 'flipCanvas', 'formatDuration'], layer: 'rendering' },
  { suffix: 'rendering/text-renderer', target: destination(selected[2]), names: ['wrapText'], layer: 'rendering' },
  { suffix: 'system/assets/bundled-fonts', target: fontTarget, names: ['bundledFontDirectory'], layer: 'system' },
].map(f => {
  const privateEntry = '@daylight-internal/platform--server/' + f.suffix;
  const sourceText = `export { ${f.names.join(', ')} } from '${privateEntry}';\n`;
  return { ...meta, layer: f.layer, entry: '@daylight/platform/server/' + f.suffix, privateEntry, path: 'platform/public/server/' + f.suffix + '.mjs', target: f.target, names: f.names, sourceText, sha256: sha(sourceText) };
});
const incoming = graph.edges.filter(e => selected.includes(e.target));
assert.equal(incoming.length, 17);
assert.equal(graph.edges.filter(e => e.target === retired).length, 0);
for (const edge of incoming) {
  if (edge.from === retired) {
    dispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'Gated retirement of zero-caller aggregate; no forwarding shim' }); continue;
  }
  assert.equal(edge.syntax, 'ImportDeclaration');
  const facade = facades.find(f => f.target === destination(edge.target)); assert.ok(facade);
  const declaration = parse(source(edge.from), { sourceType: 'module' }).program.body.find(n => n.type === 'ImportDeclaration' && n.source.value === edge.specifier);
  assert.ok(declaration); assert.equal('EDGE-' + sha(edge.from + ':' + declaration.start + ':' + edge.specifier).slice(0, 16), edge.id);
  for (const spec of declaration.specifiers) { assert.equal(spec.type, 'ImportSpecifier'); assert.ok(facade.names.includes(spec.imported.name)); }
  const edit = add(edge.from, edge.specifier, facade.entry, 'Exact static import literal; original bindings and assertions unchanged');
  dispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, editId: edit.id, publicEntry: facade.entry, names: declaration.specifiers.map(s => s.imported.name), action: 'Public rendering entry; ownership does not grant application/API access' });
}
assert.equal(edits.length, 14);
const fontConsumers = [
  { path: selected[0], oldImport: "import { fileURLToPath } from 'node:url';", old: "fileURLToPath(new URL('../../../assets/fonts', import.meta.url))", replacement: 'bundledFontDirectory', scope: 'private same-owner rendering-to-system', sourceRoot: 'backend/assets/fonts', override: 'fontDir || DEFAULT_FONT_DIR; falsey overrides still fall back' },
  { path: 'backend/src/1_rendering/fitness/TimelapseFrameRenderer.mjs', oldImport: "import { fileURLToPath } from 'node:url';", old: "fileURLToPath(new URL('../../../assets/fonts/roboto-condensed', import.meta.url))", replacement: '`${bundledFontDirectory}/roboto-condensed`', scope: 'public rendering-to-system', sourceRoot: 'backend/assets/fonts/roboto-condensed', override: 'Truthy fontDir gets /roboto-condensed appended; otherwise bundled subdirectory; current registration retry/flag semantics unchanged' },
  { path: 'backend/src/1_rendering/school/documents/measure.mjs', oldImport: "import { fileURLToPath } from 'node:url';", old: "fileURLToPath(new URL('../../../../assets/fonts', import.meta.url))", replacement: 'bundledFontDirectory', scope: 'public rendering-to-system', sourceRoot: 'backend/assets/fonts', override: 'Default parameter only when undefined; explicit null and empty string remain distinct, no new truthy fallback' },
  { path: 'backend/src/1_rendering/school/documents/workbookTheme.test.mjs', oldImport: "import { fileURLToPath } from 'node:url';", old: "fileURLToPath(new URL('../../../../assets/fonts', import.meta.url))", replacement: 'bundledFontDirectory', scope: 'public test asset fixture', sourceRoot: 'backend/assets/fonts', override: 'Preserve all original theme/license/font assertions and fs/path test usage' },
  { path: 'tests/unit/rendering/eink/stub-widgets.test.mjs', oldImport: "import path from 'node:path';", old: "path.resolve('backend/assets/fonts')", replacement: 'bundledFontDirectory', scope: 'public test asset fixture', sourceRoot: 'backend/assets/fonts', override: 'Only test fixture path authority changes; same layout/output assertions, no production CWD behavior change' },
].map(c => {
  const text = source(c.path), name = c.oldImport.includes('fileURLToPath') ? 'fileURLToPath' : 'path';
  // No other references rely on the replaced import in these five inspected files.
  const uses = [...text.matchAll(new RegExp('\\b' + name + '\\b', 'g'))];
  if (name === 'fileURLToPath') assert.equal(uses.length, 2);
  else assert.equal(uses.length, 3); // import local, node:path token, path.resolve
  const specifier = c.path === selected[0] ? '../system/assets/bundledFonts.mjs' : fontEntry;
  const importEdit = add(c.path, c.oldImport, `import { bundledFontDirectory } from '${specifier}';`, 'Use canonical source-asset authority; no fs, config or renderer import');
  const rootEdit = add(c.path, c.old, c.replacement, 'Replace only source-shipped font root, retain caller override branch/default');
  return { ...c, destination: destination(c.path), entry: specifier, editIds: [importEdit.id, rootEdit.id], candidateRoot: c.sourceRoot.replace('backend/assets/fonts', 'platform/server/assets/fonts') };
});
// Current-path guide references change spelling only; historical plans remain history.
for (const file of selected) add(file, '1_rendering/lib/' + path.basename(file, '.mjs'), destination(file).replace(/\.mjs$/, ''), 'JSDoc module path only');
for (const file of [selected[0], 'backend/src/1_rendering/school/documents/documentPdfTheme.mjs', 'backend/src/1_rendering/school/documents/workbookTheme.mjs', 'backend/src/1_rendering/school/documents/documentReceiptTheme.mjs', 'frontend/src/modules/School/School.scss', 'docs/runbooks/fitness-session-timelapse.md']) {
  add(file, 'backend/assets/fonts', 'platform/server/assets/fonts', 'Source/runbook font or license location only; no font name, license text or behavior change');
}
const guidelines = 'docs/reference/core/layers-of-abstraction/rendering-layer-guidelines.md';
for (const [before, after] of [
  ['extract it to `1_rendering/lib/`', 'extract it to `platform/server/rendering/`'],
  ['| `1_rendering/lib/` | Shared primitives', '| `platform/server/rendering/` | Shared primitives'],
  ['└── 1_rendering/lib/ (internal)', '└── platform/server/rendering/ (shared primitives)'],
  ['// 1_rendering/lib/CanvasFactory.mjs', '// platform/server/rendering/CanvasFactory.mjs'],
  ['Extract to `1_rendering/lib/TextRenderer`', 'Extract to `platform/server/rendering/TextRenderer`'],
]) add(guidelines, before, after, 'Physical shared-primitive path spelling only; all layer/port/presentation rules remain binding');
for (const file of selected) add('docs/reference/core/ddd-file-map.md', 'lib/' + path.basename(file), destination(file), 'Shared primitive file map path only');
const editedFiles = [...new Set(edits.map(e => e.path))].sort().map(file => {
  const original = source(file); let text = original, last = original.length;
  for (const e of edits.filter(e => e.path === file).sort((a, b) => b.start - a.start)) {
    assert.ok(e.end <= last); assert.equal(text.slice(e.start, e.end), e.before);
    text = text.slice(0, e.start) + e.after + text.slice(e.end); last = e.start;
  }
  if (/\.(mjs|js)$/.test(file)) parse(text, { sourceType: 'module' });
  return { path: file, destination: destination(file), sourceSha256: sha(original), proposedSha256: sha(text) };
});
const scan = { protected: 0, regularText: 0, binary: 0, symlinks: 0 }, references = [];
const pattern = /(?:CanvasFactory|TextRenderer|LayoutHelpers)\.mjs|(?:#rendering|(?:backend\/src\/)?1_rendering)\/lib(?:\/index\.mjs)?|(?:backend\/)?assets\/fonts/g;
for (const f of ledger.files.filter(f => f.protected)) {
  scan.protected++;
  if (f.mode === '120000') { scan.symlinks++; continue; }
  const bytes = fs.readFileSync(path.join(root, f.path)); assert.equal(sha(bytes), f.sha256);
  let text; try { if (bytes.includes(0) && !/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(f.path)) throw new Error('binary'); text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { scan.binary++; continue; }
  scan.regularText++;
  for (const m of text.matchAll(pattern)) {
    source(f.path); const start = m.index, end = start + m[0].length;
    const edit = edits.find(e => e.path === f.path && e.start <= start && e.end >= end);
    let disposition;
    if (edit) disposition = 'exact planned import/root/module/guide spelling edit';
    else if (f.path === retired) disposition = 'gated zero-caller aggregate retirement';
    else if (f.path.startsWith('docs/_') || f.path.startsWith('docs/roadmap/')) disposition = 'retained historical plan/audit source layout';
    else if (f.path === guidelines) disposition = 'retained illustrative filename/type naming; no path dependency or layer exemption';
    else if (f.path.endsWith('/documentReceiptTheme.mjs')) disposition = 'retained historical SemiBold availability comment; no runtime path';
    assert.ok(disposition, 'Unreviewed rendering reference: ' + f.path + ':' + text.slice(0, start).split('\n').length);
    references.push({ id: 'RENDERREF-' + sha(f.path + ':' + start).slice(0, 16), path: f.path, start, end, line: text.slice(0, start).split('\n').length, token: m[0], disposition, ...(edit ? { editId: edit.id } : {}) });
  }
}
assert.equal(references.length, 123); assert.equal(new Set(references.map(r => r.path)).size, 29);
const assetMoves = resources.fontAssets.map(f => {
  const bytes = fs.readFileSync(path.join(root, f.path)); assert.equal(sha(bytes), f.sha256);
  inputs.set(f.path, { path: f.path, sha256: f.sha256 });
  return { path: f.path, destination: f.candidate, sha256: f.sha256, mode: f.mode, bytes: f.bytes, owner: 'platform', role: /\.ttf$/.test(f.path) ? 'bundled font' : 'bundled notice', action: 'One canonical asset; preserve bytes/mode and all supplied notices' };
});
assert.equal(assetMoves.length, 9); assert.equal(assetMoves.filter(f => f.role === 'bundled font').length, 7);
const files = selected.map(file => ({ ...meta, path: file, destination: destination(file), sha256: sha(source(file)), action: 'Move one implementation; only enumerated module/root/import spellings change' }));
const newFiles = [fontModule, ...facades];
for (const f of newFiles) { parse(f.sourceText, { sourceType: 'module' }); assert.equal(fs.existsSync(path.join(root, f.path)), false); }
const backendManifest = JSON.parse(source('backend/package.json')), rootManifest = JSON.parse(source('package.json'));
const backendLock = JSON.parse(source('backend/package-lock.json')), rootLock = JSON.parse(source('package-lock.json'));
const toolchainInputs = ['node_modules/canvas/package.json', 'backend/node_modules/canvas/package.json'].map(name => {
  const bytes = fs.readFileSync(path.join(process.env.PRE_TOOLCHAIN_ROOT, name));
  return { name, sha256: sha(bytes), version: JSON.parse(bytes).version };
});
const assetProofs = fontConsumers.map(c => ({ path: c.path, candidateRoot: c.candidateRoot, relativePrivateReachRemoved: c.scope.startsWith('public'), override: c.override }));
assert.equal(new URL('../../assets/fonts', 'file:///fixture/' + fontTarget).pathname, '/fixture/platform/server/assets/fonts');
assert.equal(new URL('../../../assets/fonts', 'file:///fixture/' + files[0].destination).pathname, '/fixture/assets/fonts');
emit('rendering-boundary.json', {
  schema: 'daylight.preimplementation.rendering-boundary/v1', baseline: ledger.baseline,
  status: 'Selected three rendering bodies, one source-font authority and exact consumer edits; original-suite/native/build/font proofs remain separate',
  files, facades, newFiles, assetMoves, fontConsumers, assetProofs, edges: dispositions, edits, editedFiles, scan, references,
  retirement: { path: retired, sha256: sha(source(retired)), incomingSourceEdges: 0, removedOutgoingEdges: graph.edges.filter(e => e.from === retired).map(e => e.id), action: 'Retire this single unused aggregate only after full reference and candidate gates; no old-path shim' },
  packageFragments: { public: { exports: Object.fromEntries(facades.map(f => [f.entry.replace('@daylight/platform', '.'), './' + f.path.replace('platform/public/', '')])), dependencies: { '@daylight-internal/platform--server': '0.0.0' } }, server: { exports: Object.fromEntries(facades.map(f => [f.privateEntry.replace('@daylight-internal/platform--server', '.'), './' + f.target.replace('platform/server/', '')])), dependencies: { canvas: backendManifest.dependencies.canvas } } },
  assetDecision: { authority: 'platform/server/assets/fonts', publicEntry: fontEntry, name: 'bundledFontDirectory', supersedes: 'Three conditional private-root literal substitutions in resource-review.json; consumers use the public system entry instead. Two original test fixture paths additionally move.', semantics: 'Absolute native directory string, no trailing separator, module-relative not CWD; source-shipped assets only. No registration, file reads/writes, config singleton or public wildcard asset loader.', notices: 'Preserve seven fonts and two supplied notices byte-for-byte. Missing Roboto notice/provenance remains an open distribution gate; do not invent or fetch a license as a migration side effect.', retention: 'Runtime media/config font roots and frontend public/converted font bytes are separate authorities and remain in place.' },
  layerRules: ['Rendering helpers remain rendering, not universally importable system utilities. D2 applications consume their presentation ports; no concrete renderer import is legalized.', 'bundledFontDirectory is a system source-resource locator, not a datastore or new application port. D3/D5/D7/D10 remain binding; no fs API is exported and none is added outside system.', 'Gratitude/Fitness/School/Piano/eink renderers retain product ownership; shared drawing functions have no product data selection or workflow policy.', 'formatDuration remains existing presentation formatting; do not conflate it with D4 pure clock helpers or change negative/nonfinite/rounding behavior.'],
  behaviorConstraints: ['initCanvas dynamically imports canvas, registers primary then each extra face independently before canvas creation, suppresses registration failures, sets top text baseline, returns original canvas/context/factory bindings; no new cache or error policy.', 'Canvas registration is process-global. Preserve backend native module identity across moved/retained callers; passing PNG magic alone cannot detect silently lost fonts.', 'Timelapse registers three Roboto names inside one try; missing bundled Bold keeps its flag false after earlier registration effects. Do not add a font, reorder or fix retry behavior.', 'PDF defaults apply only to undefined; its registrations and measurement geometry must keep exact font bytes, theme aliases and original golden assertions.', 'wrapText, draw/transform order, caller style mutation, crop/rotation and duration edge cases remain byte-identical except module comments. No new canvas port or product-specific shared renderer.'],
  dependencyGate: { declaredBackendCanvas: backendManifest.dependencies.canvas, declaredRootCanvas: rootManifest.dependencies.canvas, lockedBackendCanvas: backendLock.packages['node_modules/canvas'].version, lockedRootCanvas: rootLock.packages['node_modules/canvas'].version, installedBackendCanvas: toolchainInputs[1].version, installedRootCanvas: toolchainInputs[0].version, next: 'Installed backend 3.1.0, backend locked 3.2.3 and root installed/locked 3.2.1 are three distinct identities; both manifests declare ^3.2.1. Reconcile original lock/range/native scope in disposable install/build proof; neither root fallback nor pinning old bytes silently resolves this discrepancy. No install performed.' },
  acceptance: ['Freeze original LayoutHelpers/TextRenderer suites (five cases each); original before/after assertions and exact populations, no assertion rewrite.', 'Run original affected School workbook/theme/PDF/receipt, Fitness receipt/timelapse, Piano image and eink widget suites through separately safe runners; enumerate indirect consumers, do not equate fourteen import edits with fourteen tests.', 'Native candidate verifies nine font/notice hashes, public/private helper identity, backend canvas instance and font metrics/goldens; missing/wrong asset roots must fail font-specific oracles even when PNG still renders.', 'Source-font locator resolves from relocated source and unrelated CWD; runtime overrides and undefined/null/empty differences retain distinct behavior; no protected source change is authorized.', 'Actual semantic checks reject application/API renderer imports and cross-owner private asset/source paths; full manifests/locks/package contents/Linux image and original frontend font URLs remain required.'],
  inputs: [...inputs.values()], toolchainInputs, inventoryInputs: inventoryNames.map(name => ({ name, sha256: sha(fs.readFileSync(path.join(packet, name))) })), toolHash: sha(fs.readFileSync(new URL(import.meta.url))),
  limits: ['Read-only source/specification proof; no application/test/manifest/font file changed and no source executed.', '123 selected literal references are classified, not exhaustive computed/untracked external reference certification. No full font licensing opinion or distribution approval.', 'This specification includes one planned new system locator and four facades, not new product behavior or permission to move remaining renderers.'],
});
process.stdout.write(JSON.stringify({ files: files.length, facades: facades.length, newFiles: newFiles.length, publicRenderingNames: 8, publicAssetNames: 1, sourceEdges: incoming.length, importEdits: 14, fontConsumers: fontConsumers.length, edits: edits.length, editedFiles: editedFiles.length, references: references.length, referenceFiles: 29, assets: assetMoves.length, retiredIncoming: 0, scan }) + '\n');
