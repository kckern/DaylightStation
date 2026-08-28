// registerLessonSurround.test.jsx — the BOUNDARY. School registers INTO the
// surround registry; the Surround tree gains nothing and knows nothing about
// School. That direction is the architectural point of this task, so it is
// asserted rather than assumed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { getSurroundRegistry, resetSurroundRegistry } from '../../../Surround/registry.js';
import { registerLessonSurroundModules, LESSON_SURROUND_MODULES } from './registerLessonSurround.js';
import CheckpointMap from './CheckpointMap.jsx';
import LessonScore from './LessonScore.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const surroundDir = path.resolve(__dirname, '../../../Surround');

it('registers both modules under the names a definition authors', () => {
  const registry = getSurroundRegistry();
  expect(registry.get('checkpoint-map')).toBe(CheckpointMap);
  expect(registry.get('lesson-score')).toBe(LessonScore);
});

it('declares the slots each module was cut for', () => {
  const registry = getSurroundRegistry();
  expect(registry.getMeta('checkpoint-map').regions).toContain('bottom');
  expect(registry.getMeta('lesson-score').regions).toContain('top');
});

/**
 * `resetSurroundRegistry()` drops the singleton — several Surround specs do it.
 * A registration that only ever happened at import time would be gone for the
 * rest of that file, so the registrar is a callable function AND a side effect,
 * exactly as `builtins.js` is.
 */
it('can be re-run after the registry is reset', () => {
  resetSurroundRegistry();
  expect(getSurroundRegistry().has('checkpoint-map')).toBe(false);
  registerLessonSurroundModules();
  expect(getSurroundRegistry().get('checkpoint-map')).toBe(CheckpointMap);
  expect(getSurroundRegistry().get('lesson-score')).toBe(LessonScore);
});

it('names every module it registers', () => {
  expect([...LESSON_SURROUND_MODULES].sort()).toEqual(['checkpoint-map', 'lesson-score']);
});

describe('the dependency only points one way', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  ));

  it('leaves no School import anywhere in the Surround tree', () => {
    const offenders = walk(surroundDir)
      .filter((f) => /\.(jsx?|scss)$/.test(f))
      // BARE SIDE-EFFECT IMPORTS COUNT. `import './builtins.js';` is exactly how
      // the surround host pulls in its registrations, so it is exactly the shape
      // a wrong-way dependency would take — and a `from`-only pattern missed it
      // (found by mutation testing: a planted `import '../School/…'` survived).
      .filter((f) => /(?:from|@use|^\s*import)\s+["'][^"']*School/m.test(fs.readFileSync(f, 'utf8')))
      // Name the files, not the count — a directory walk that reports a number
      // hides which file moved (`reference_piano_glyph_guard_governed_trees`).
      .map((f) => path.relative(surroundDir, f));
    expect(offenders).toEqual([]);
  });

  it('keeps both lesson modules out of the Surround tree', () => {
    const stray = walk(surroundDir).filter((f) => /(CheckpointMap|LessonScore)/.test(path.basename(f)));
    expect(stray.map((f) => path.relative(surroundDir, f))).toEqual([]);
  });
});
