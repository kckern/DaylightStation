import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkylineGliderCourseCatalog } from './SkylineGliderCourseCatalog.mjs';
import { validateCourse as validateFrontendCourse } from '../../../../frontend/src/modules/Fitness/lib/skylineGlider/courseModel.js';
import { createFlightState, stepFlight } from '../../../../frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.js';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'glider-courses-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const configService = () => ({ getHouseholdPath: (relative) => path.join(root, relative) });

describe('SkylineGliderCourseCatalog', () => {
  it('always exposes the validated bundled Mountain Pass course', () => {
    const catalog = new SkylineGliderCourseCatalog({ configService: configService() });
    const courses = catalog.list('home');
    expect(courses).toHaveLength(1);
    const course = courses[0];
    expect(course).toMatchObject({ id: 'mountain-pass', version: 2, schema: 'skyline-glider-course/v1', duration_s: 300 });
    expect(course.motion).toMatchObject({ filter_s: 0.25, response_s: 0.6 });
    const maneuvers = course.segments.filter((segment) => ['lower-terrain', 'upper-terrain', 'corridor'].includes(segment.type));
    expect(maneuvers[0].start_s).toBe(10);
    expect(maneuvers.filter((segment) => segment.type === 'lower-terrain')).toHaveLength(6);
    expect(maneuvers.filter((segment) => segment.type === 'upper-terrain')).toHaveLength(6);
    expect(maneuvers.filter((segment) => segment.type === 'corridor')).toHaveLength(5);
    expect(maneuvers.slice(1).every((segment, index) => segment.start_s - maneuvers[index].start_s <= 18)).toBe(true);
    expect(course.segments.filter((segment) => segment.type === 'checkpoint').map((segment) => segment.start_s)).toEqual([75, 150, 225]);
    expect(course.segments.find((segment) => segment.type === 'finish').start_s).toBe(300);
    expect(course.segments.flatMap((segment) => segment.collectibles || [])).toHaveLength(6);
    const validated = validateFrontendCourse(course);
    expect(validated).toMatchObject({ valid: true, errors: [] });
    for (const checkpoint of validated.course.segments.filter((segment) => segment.type === 'checkpoint')) {
      const initial = createFlightState(validated.course, {
        calibration: { lowRpm: 30, highRpm: 100 }, courseTime: checkpoint.start_s,
      });
      const afterRecovery = stepFlight(initial, { rpm: 100, connected: true, transportStalled: false }, 1 / 60, validated.course);
      expect(afterRecovery.lives, checkpoint.id).toBe(3);
    }
  });

  it('adds valid household overrides but ignores malformed and unreachable ones', () => {
    const dir = path.join(root, 'fitness/skyline-glider/courses');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'valid.yml'), `schema: skyline-glider-course/v1\nid: ridge-run\nversion: 1\nname: Ridge Run\nduration_s: 30\nmotion: { max_climb_rate: 0.3, max_descent_rate: 0.22 }\nsegments:\n  - { id: open, type: open, start_s: 0, end_s: 30 }\n  - { id: finish, type: finish, start_s: 30 }\n`);
    fs.writeFileSync(path.join(dir, 'broken.yml'), 'not: a-course\n');
    fs.writeFileSync(path.join(dir, 'impossible.yml'), `schema: skyline-glider-course/v1\nid: impossible\nversion: 1\nname: Nope\nduration_s: 30\nmotion: { max_climb_rate: 0.3, max_descent_rate: 0.22 }\nsegments:\n  - { id: wall, type: corridor, start_s: 0, end_s: 29, ceiling: 0.2, floor: 0.21 }\n  - { id: finish, type: finish, start_s: 30 }\n`);
    const warnings = [];
    const catalog = new SkylineGliderCourseCatalog({ configService: configService(), logger: { warn: (event, data) => warnings.push({ event, data }) } });
    expect(catalog.list('home').map((course) => course.id)).toEqual(['mountain-pass', 'ridge-run']);
    expect(warnings).toHaveLength(2);
  });
});
