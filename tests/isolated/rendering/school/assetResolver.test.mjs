/**
 * The file-backed asset resolver.
 *
 * Production shipped `createDocumentPdfRenderer({})` with no resolver at all,
 * so the one worksheet with an `asset` block could never be printed: the
 * default resolver throws, `IssueDocument` recorded `failed`, and the child got
 * a slip blaming the printer. This is the resolver that closes that, and these
 * are the properties it has to hold — a curriculum ref is hand-written YAML,
 * so it is untrusted input.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileAssetResolver, svgDimensions } from '#adapters/school/documents/FilesystemSchoolAssetResolver.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { UnresolvedAssetError } from '#rendering/school/documents/measure.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const STRIPS = '<svg viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="24"/></svg>';

let root;
let outside;

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-assets-'));
  root = path.join(tmp, 'assets');
  fs.mkdirSync(path.join(root, 'school', 'math'), { recursive: true });
  fs.writeFileSync(path.join(root, 'school', 'math', 'fraction-strips.svg'), STRIPS);
  // A file the resolver must never be able to reach by way of a crafted ref.
  outside = path.join(tmp, 'secret.svg');
  fs.writeFileSync(outside, '<svg viewBox="0 0 1 1"><!-- a token --></svg>');
});

afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

const resolver = () => createFileAssetResolver({ rootDir: root, logger: silent });

describe('createFileAssetResolver', () => {
  it('resolves a ref to the SVG under the asset root', () => {
    const resolved = resolver()('school/math/fraction-strips');
    expect(resolved.svg).toContain('<svg');
    expect(resolved).toMatchObject({ widthPt: 400, heightPt: 120 });
  });

  it('returns null for an asset that is not there, rather than a blank', () => {
    expect(resolver()('school/math/nope')).toBeNull();
  });

  it('returns null for a file that is not an SVG', () => {
    fs.writeFileSync(path.join(root, 'school', 'math', 'notes.svg'), 'this is not markup');
    expect(resolver()('school/math/notes')).toBeNull();
  });

  it.each([
    ['parent traversal', '../secret'],
    ['deep traversal', 'school/../../secret'],
    ['absolute', '/etc/passwd'],
    ['a dot segment', 'school/./math/fraction-strips'],
    ['uppercase', 'School/Math/Strips'],
    ['a space', 'school/math/frac strips'],
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
  ])('refuses %s', (_label, ref) => {
    expect(resolver()(ref)).toBeNull();
  });

  it('cannot read a file outside the root even when one exists there', () => {
    expect(fs.existsSync(outside)).toBe(true);
    const resolved = resolver()('../secret');
    expect(resolved).toBeNull();
  });

  it('reads each asset once — a reprint must not re-parse the diagram', () => {
    const resolve = resolver();
    const first = resolve('school/math/fraction-strips');
    fs.rmSync(path.join(root, 'school', 'math', 'fraction-strips.svg'));
    expect(resolve('school/math/fraction-strips')).toBe(first);
  });

  it('caches a miss too, so a broken ref is not a filesystem hit per reprint', () => {
    const resolve = resolver();
    expect(resolve('school/math/later')).toBeNull();
    fs.writeFileSync(path.join(root, 'school', 'math', 'later.svg'), STRIPS);
    expect(resolve('school/math/later')).toBeNull();
  });

  it('needs a root — a resolver pointed nowhere is a silent blank waiting to happen', () => {
    expect(() => createFileAssetResolver({})).toThrow(/rootDir/);
  });
});

describe('svgDimensions', () => {
  it('prefers the viewBox, which is the coordinate system the paths are in', () => {
    expect(svgDimensions('<svg width="999" height="999" viewBox="0 0 400 120">'))
      .toEqual({ widthPt: 400, heightPt: 120 });
  });

  it('reads comma-separated and negative-origin viewBoxes', () => {
    expect(svgDimensions('<svg viewBox="-10,-10,200,50">')).toEqual({ widthPt: 200, heightPt: 50 });
  });

  it('falls back to width/height attributes', () => {
    expect(svgDimensions('<svg width="300pt" height="90pt">')).toEqual({ widthPt: 300, heightPt: 90 });
  });

  it('falls back to a sane box rather than zero when nothing is readable', () => {
    const { widthPt, heightPt } = svgDimensions('<svg width="100%" height="100%">');
    expect(widthPt).toBeGreaterThan(0);
    expect(heightPt).toBeGreaterThan(0);
  });

  it('ignores a degenerate viewBox instead of scaling by zero', () => {
    const { widthPt, heightPt } = svgDimensions('<svg viewBox="0 0 0 0">');
    expect(widthPt).toBeGreaterThan(0);
    expect(heightPt).toBeGreaterThan(0);
  });
});

describe('wired into the renderer', () => {
  it('PRINTS the worksheet that has an asset block', async () => {
    const renderer = createDocumentPdfRenderer({ resolveAsset: resolver() });
    const { pdf, pageCount } = await renderer.render({
      id: 'with-asset',
      title: 'With A Picture',
      seed: 1,
      variant: 0,
      target: ['letter'],
      blocks: [{ type: 'asset', ref: 'school/math/fraction-strips', alt: 'Fraction strips.' }],
    });
    expect(pageCount).toBe(1);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('still refuses a sheet whose picture is missing', async () => {
    const renderer = createDocumentPdfRenderer({ resolveAsset: resolver() });
    await expect(renderer.render({
      id: 'broken', seed: 1, variant: 0, target: ['letter'],
      blocks: [{ type: 'asset', ref: 'school/math/gone', alt: 'Nothing.' }],
    })).rejects.toThrow(UnresolvedAssetError);
  });
});
