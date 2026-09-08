/** Same probes in both layouts, separate native processes, real native calls. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const e = JSON.parse(fs.readFileSync(path.join(root, 'expectation.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Change CWD before importing any product source. Nothing can inherit its asset root from CWD.
process.chdir(path.join(root, 'unrelated-cwd'));
const publicModules = await Promise.all(e.entries.map(f => import(f.entry)));
const privateModules = await Promise.all(e.entries.map(f => import(pathToFileURL(path.join(root, f.target)).href)));
const { initCanvas } = publicModules[0], layout = publicModules[1], { wrapText } = publicModules[2];
const canvasRequire = createRequire(pathToFileURL(path.join(root, e.entries[0].target)));
const canvasEntry = canvasRequire.resolve('canvas'), native = canvasRequire('canvas');
const originalRegister = native.registerFont;
const trace = [];
// Instrument the CJS export before CanvasFactory's first lazy ESM import, always delegating.
native.registerFont = (file, options) => {
  const record = { file, options, succeeded: false }; trace.push(record);
  const result = originalRegister(file, options); record.succeeded = true; return result;
};
const fonts = [
  { file: 'roboto-condensed/RobotoCondensed-Regular.ttf', family: 'PRE Roboto' },
  { file: 'roboto-condensed/RobotoCondensed-SemiBold.ttf', family: 'PRE Roboto Semi', weight: '600' },
  { file: 'atkinson-hyperlegible/AtkinsonHyperlegible-Regular.ttf', family: 'PRE Atkinson' },
  { file: 'atkinson-hyperlegible/AtkinsonHyperlegible-Bold.ttf', family: 'PRE Atkinson Bold', weight: '700' },
  { file: 'atkinson-hyperlegible/AtkinsonHyperlegible-Italic.ttf', family: 'PRE Atkinson Italic' },
  { file: 'atkinson-hyperlegible/AtkinsonHyperlegible-BoldItalic.ttf', family: 'PRE Atkinson BoldItalic' },
  { file: 'kongtext/kongtext.ttf', family: 'PRE Kong' },
];
const defaults = { width: 240, height: 150, fontFile: fonts[0].file, fontFamily: fonts[0].family,
  extraFonts: [null, { file: '', family: 'Ignored' }, { file: fonts[0].file }, ...fonts.slice(1)] };
const expectedTrace = (fontRoot, selected = fonts) => selected.map(({ file, family, weight }) => ({ file: fontRoot + '/' + file, options: { family, ...(weight ? { weight } : {}) }, succeeded: true }));
function png(result) {
  assert.equal(result.canvas.width, 240); assert.equal(result.canvas.height, 150);
  assert.equal(result.ctx.textBaseline, 'top');
  assert.deepEqual([...result.canvas.toBuffer('image/png').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
const results = [];
async function check(id, work) {
  try { results.push({ id, passed: true, observation: await work() ?? null }); }
  catch (error) { results.push({ id, passed: false, error: error.message }); }
}
try {
  await check('REND-EXPORTS', () => {
    for (let i = 0; i < e.entries.length; i++) assert.deepEqual(Object.keys(publicModules[i]).sort(), [...e.entries[i].names].sort());
    return e.entries.map(f => ({ entry: f.entry, names: f.names }));
  });
  await check('REND-BINDINGS', () => {
    for (let i = 0; i < e.entries.length; i++) for (const name of e.entries[i].names) assert.strictEqual(publicModules[i][name], privateModules[i][name], name + ': duplicate implementation');
  });
  await check('REND-NATIVE', async () => {
    assert.equal(fs.realpathSync(canvasEntry), e.canvasEntry); assert.equal(native.version, '3.1.0');
    const result = await initCanvas({ width: 240, height: 150 });
    assert.strictEqual(result.createNodeCanvas, native.createCanvas); assert.ok(result.canvas instanceof native.Canvas); png(result);
    assert.throws(() => createRequire(path.join(root, 'package.json')).resolve('canvas'), { code: 'MODULE_NOT_FOUND' });
    return { version: native.version, cairo: native.cairoVersion, pango: native.pangoVersion, factoryIdentity: true, noRootFallback: true };
  });
  await check('REND-FONT-ROOT', () => {
    // Baseline has no public locator: derive the existing source-relative authority independently.
    const fontRoot = e.variant === 'baseline'
      ? fileURLToPath(new URL('../../../assets/fonts', pathToFileURL(path.join(root, e.entries[0].target))))
      : publicModules[3].bundledFontDirectory;
    assert.equal(fontRoot, e.fontRoot); assert.ok(path.isAbsolute(fontRoot)); assert.notEqual(fontRoot, process.cwd());
    return { root: path.relative(root, fontRoot), cwdIndependent: true };
  });
  await check('REND-ASSETS', () => {
    const inventory = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(f => {
      assert.ok(!f.isSymbolicLink()); const name = path.join(directory, f.name);
      return f.isDirectory() ? inventory(name) : [path.relative(e.fontRoot, name)];
    });
    assert.deepEqual(inventory(e.fontRoot).sort(), e.assets.map(f => f.relative).sort());
    for (const f of e.assets) {
      const name = path.join(e.fontRoot, f.relative), stat = fs.statSync(name);
      assert.equal(sha(fs.readFileSync(name)), f.sha256); assert.equal(stat.size, f.bytes); assert.equal(stat.mode & 0o777, 0o644);
    }
    return { fonts: 7, notices: 2 };
  });
  await check('REND-DEFAULT-FONTS', async () => {
    for (const value of [undefined, null, '', false, 0]) {
      trace.length = 0; const result = await initCanvas({ ...defaults, fontDir: value }); png(result);
      assert.deepEqual(trace, expectedTrace(e.fontRoot));
    }
    return { falseyVariants: 5, registeredFacesPerVariant: 7, primaryThenExtras: true };
  });
  await check('REND-OVERRIDE', async () => {
    trace.length = 0;
    const result = await initCanvas({ ...defaults, fontDir: e.overrideRoot, extraFonts: [] }); png(result);
    assert.deepEqual(trace, expectedTrace(e.overrideRoot, [fonts[0]]));
    return { explicitDirectoryHonored: true };
  });
  await check('REND-OPTIONAL-FONTS', async () => {
    trace.length = 0;
    const result = await initCanvas({ ...defaults, fontDir: e.overrideRoot, fontFile: 'missing-primary.ttf',
      extraFonts: [null, { file: 'missing-extra.ttf', family: 'Missing' }, fonts[0]] }); png(result);
    assert.deepEqual(trace.map(t => ({ ...t, file: path.relative(e.overrideRoot, t.file) })), [
      { file: 'missing-primary.ttf', options: { family: fonts[0].family }, succeeded: false },
      { file: 'missing-extra.ttf', options: { family: 'Missing' }, succeeded: false },
      { file: fonts[0].file, options: { family: fonts[0].family }, succeeded: true },
    ]);
    trace.length = 0;
    png(await initCanvas({ ...defaults, fontDir: path.join(root, 'absent-override'), extraFonts: [] }));
    assert.deepEqual(trace, [{ file: path.join(root, 'absent-override', fonts[0].file), options: { family: fonts[0].family }, succeeded: false }]);
    return { failuresRemainBestEffort: true, laterFaceStillRegisters: true };
  });
  await check('REND-DRAWING', async () => {
    const { canvas, ctx, createNodeCanvas } = await initCanvas(defaults);
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 240, 150);
    const metrics = fonts.map(({ family }, i) => {
      ctx.font = `13px "${family}"`; ctx.fillStyle = '#172d43'; const text = 'MIDI Gratitude 012345';
      const width = ctx.measureText(text).width; assert.ok(Number.isFinite(width) && width > 0);
      const lines = wrapText(ctx, text, 110); ctx.fillText(text, 12, 8 + i * 17);
      return { family, width, lines };
    });
    layout.drawDivider(ctx, 134, 240, { color: '#b53149' }); layout.drawBorder(ctx, 240, 150);
    layout.roundRect(ctx, 180, 80, 40, 30, 4); ctx.fillStyle = '#21a876'; ctx.fill();
    const source = createNodeCanvas(20, 10), sctx = source.getContext('2d');
    sctx.fillStyle = '#ed702a'; sctx.fillRect(0, 0, 10, 10); sctx.fillStyle = '#163078'; sctx.fillRect(10, 0, 10, 10);
    layout.drawCover(ctx, source, 188, 115, 20, 16);
    const pixels = ctx.getImageData(0, 0, 240, 150).data;
    const rotated = layout.flipCanvas(createNodeCanvas, canvas, 240, 150).getContext('2d').getImageData(0, 0, 240, 150).data;
    for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 4; channel++) assert.equal(rotated[i + channel], pixels[pixels.length - 4 - i + channel]);
    png({ canvas, ctx });
    return { metrics, pixelSha256: sha(pixels), rotatedSha256: sha(rotated), pngSha256: sha(canvas.toBuffer('image/png')), width: 240, height: 150 };
  });
  await check('REND-PURE-HELPERS', () => {
    const calls = [], ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: (_, name, value) => { calls.push([name, value]); return true; } });
    layout.drawDivider(ctx, 5, 100); layout.drawBorder(ctx, 100, 60);
    const img = { width: 200, height: 100 }; layout.drawCover(ctx, img, 4, 6, 50, 50);
    assert.deepEqual(calls, [['fillStyle', '#000000'], ['fillRect', 10, 5, 80, 2], ['strokeStyle', '#000000'], ['lineWidth', 3], ['strokeRect', 10, 10, 80, 40], ['drawImage', img, 50, 0, 100, 100, 4, 6, 50, 50]]);
    assert.deepEqual([undefined, null, 0, 59.6, 3600, -1, NaN].map(layout.formatDuration), ['--', '--', '0m', '1m', '1h 0m', '-1m', 'NaNm']);
    const measure = { measureText: text => ({ width: text.length * 10 }) };
    assert.deepEqual(wrapText(measure, '  one two   three ', 70), ['one two', 'three']);
    assert.deepEqual(wrapText(measure, undefined, 10), []); assert.deepEqual(wrapText(measure, 'longword', 10), ['longword']);
    return { drawCalls: calls.length, durationInputs: 7, wrapInputs: 3 };
  });
} finally { native.registerFont = originalRegister; native.deregisterAllFonts(); }
assert.deepEqual(results.map(r => r.id), e.probeIds);
const failedIds = results.filter(r => !r.passed).map(r => r.id);
process.stdout.write(JSON.stringify({ passed: failedIds.length === 0, count: results.length, failedIds, results }) + '\n');
if (failedIds.length) process.exitCode = 1;
