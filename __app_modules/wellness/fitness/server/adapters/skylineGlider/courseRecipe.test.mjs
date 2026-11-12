import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildCourseFromRecipe, RECIPE_STYLES, validateRecipe } from './courseRecipe.mjs';
import { resolveAct } from './resolveAct.mjs';
import { validateCourse } from '../../../browser/lib/skylineGlider/courseModel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const alpine = YAML.parse(fs.readFileSync(path.join(here, 'zones/alpine.yml'), 'utf8'));
const recipe = (extra) => ({ schema: 'skyline-glider-recipe/v1', id: 'test-course', zone: 'alpine', duration_s: 240, ...extra });
const check = (act) => validateCourse(resolveAct(act, new Map([['alpine', alpine]])));

describe('course recipes', () => {
  it('rejects malformed recipes', () => {
    expect(validateRecipe(recipe({ style: 'jumpy', difficulty: 'brutal', duration_s: 20 }))).toEqual([
      `style must be one of ${Object.keys(RECIPE_STYLES).join(', ')}`,
      'difficulty must be one of easy, medium, hard',
      'duration_s must be 90 to 900',
    ]);
  });

  it('builds a valid, reachable course for every style, difficulty and many seeds', () => {
    const failures = [];
    for (const style of Object.keys(RECIPE_STYLES)) for (const difficulty of ['easy', 'medium', 'hard']) for (let seed = 1; seed <= 8; seed += 1) {
      const result = check(buildCourseFromRecipe(recipe({ style, difficulty, seed })));
      if (!result.valid) failures.push(`${style}/${difficulty}/${seed}: ${result.errors.join('; ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('is deterministic for a seed and leans toward its style', () => {
    expect(buildCourseFromRecipe(recipe({ style: 'targets', seed: 4 }))).toEqual(buildCourseFromRecipe(recipe({ style: 'targets', seed: 4 })));
    const count = (act, kind) => (act.entities ?? []).filter((entity) => entity.entity === kind).length;
    const bellsOf = (act) => act.segments.filter((segment) => segment.type === 'collectible-path').flatMap((segment) => segment.collectibles).length;
    const hillsOf = (act) => act.segments.filter((segment) => segment.profile).length;
    const targets = buildCourseFromRecipe(recipe({ style: 'targets', seed: 2 }));
    const bells = buildCourseFromRecipe(recipe({ style: 'bells', seed: 2 }));
    const hills = buildCourseFromRecipe(recipe({ style: 'hills', seed: 2 }));
    expect(count(targets, 'target')).toBeGreaterThan(count(bells, 'target'));
    expect(targets.rules.weapons.enabled).toBe(true);
    expect(bells.rules.weapons.enabled).toBe(false);
    expect(bellsOf(bells)).toBeGreaterThan(bellsOf(targets));
    expect(hillsOf(hills)).toBeGreaterThan(hillsOf(targets));
  });

  it('finishes at the duration and keeps checkpoints off terrain', () => {
    const act = buildCourseFromRecipe(recipe({ style: 'hills', difficulty: 'hard', seed: 5, duration_s: 300 }));
    expect(act.segments.at(-1)).toEqual({ id: 'test-course-finish', type: 'finish', start_s: 300 });
    const terrain = act.segments.filter((segment) => segment.type === 'lower-terrain');
    for (const checkpoint of act.segments.filter((segment) => segment.type === 'checkpoint')) {
      expect(terrain.some((segment) => checkpoint.start_s > segment.start_s - 2 && checkpoint.start_s < segment.end_s + 2)).toBe(false);
    }
    expect(act.generated_from).toEqual({ recipe: 'test-course', style: 'hills', difficulty: 'hard', seed: 5 });
  });
});
