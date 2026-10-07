import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkylineGliderCourseCatalog } from './SkylineGliderCourseCatalog.mjs';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'glider-courses-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const configService = () => ({ getHouseholdPath: (relative) => path.join(root, relative) });

describe('SkylineGliderCourseCatalog', () => {
  it('always exposes the validated bundled Mountain Pass course', () => {
    const catalog = new SkylineGliderCourseCatalog({ configService: configService() });
    const courses = catalog.list('home');
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ id: 'mountain-pass', schema: 'skyline-glider-course/v1', duration_s: 300 });
    expect(courses[0].segments.some((segment) => segment.type === 'finish')).toBe(true);
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
