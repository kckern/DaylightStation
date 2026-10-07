import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkylineGliderCourseCatalog } from './SkylineGliderCourseCatalog.mjs';
import { validateCourse as validateFrontendCourse } from '../../../../frontend/src/modules/Fitness/lib/skylineGlider/courseModel.js';
import { createFlightState, stepFlight } from '../../../../frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.js';
import { terrainBounds } from '../../../../frontend/src/modules/Fitness/lib/skylineGlider/flightGeometry.js';

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
    expect(course).toMatchObject({ id: 'mountain-pass', version: 3, schema: 'skyline-glider-course/v1', duration_s: 300 });
    expect(course.motion).toMatchObject({
      filter_s: 0.25, response_s: 0.6, max_climb_rate: 0.3, max_descent_rate: 0.3,
      slow_signal_grace_s: 5, inferred_slowdown_s: 0.5,
    });
    const maneuvers = course.segments.filter((segment) => ['lower-terrain', 'upper-terrain', 'corridor'].includes(segment.type));
    expect(maneuvers).toEqual([
      expect.objectContaining({ type: 'lower-terrain', start_s: 15, end_s: 55, top: 0.55 }),
      expect.objectContaining({ type: 'lower-terrain', start_s: 88, end_s: 120, top: 0.48 }),
      expect.objectContaining({ type: 'upper-terrain', start_s: 132, end_s: 145, bottom: 0.43 }),
      expect.objectContaining({ type: 'lower-terrain', start_s: 170, end_s: 200, top: 0.45 }),
      expect.objectContaining({ type: 'corridor', start_s: 210, end_s: 220, ceiling: 0.22, floor: 0.64 }),
      expect.objectContaining({ type: 'lower-terrain', start_s: 238, end_s: 278, top: 0.44 }),
    ]);
    const checkpoints = course.segments.filter((segment) => segment.type === 'checkpoint');
    expect(checkpoints).toEqual([
      expect.objectContaining({ start_s: 75, restart_altitude: 0.5 }),
      expect.objectContaining({ start_s: 150, restart_altitude: 0.5 }),
      expect.objectContaining({ start_s: 225, restart_altitude: 0.5 }),
    ]);
    for (const checkpoint of checkpoints) {
      const next = maneuvers.find((segment) => segment.start_s > checkpoint.start_s);
      expect(next.start_s - checkpoint.start_s - 0.8, checkpoint.id).toBeGreaterThanOrEqual(12);
    }
    expect(course.segments.find((segment) => segment.type === 'finish').start_s).toBe(300);
    expect(course.segments.flatMap((segment) => segment.collectibles || []).map((item) => item.at_s))
      .toEqual([30, 48, 100, 115, 138, 183, 215, 252, 272]);
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

  it('lets a steady 75 RPM fitness effort finish without a crash', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[0]).course;
    let state = createFlightState(course, { calibration: { lowRpm: 15, highRpm: 100 } });
    for (let frame = 0; frame < 20_000 && state.phase === 'playing'; frame += 1) {
      state = stepFlight(state, { rpm: 75, connected: true, transportStalled: false, ts: frame + 1 }, 1 / 60, course);
    }

    expect(state.phase).toBe('completed');
    expect(state.restarts).toBe(0);
    expect(state.collisions).toBeLessThanOrEqual(1);
  });

  it('keeps every shipped obstacle navigable with cadence-only altitude control', () => {
    const course = new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[0];
    const calibration = { lowRpm: 30, highRpm: 100 };
    const physical = course.segments.filter((segment) => ['lower-terrain', 'upper-terrain', 'corridor'].includes(segment.type));
    const safeAltitude = (segment) => {
      if (segment.type === 'lower-terrain') return .22;
      if (segment.type === 'upper-terrain') return .74;
      return (segment.ceiling + segment.floor) / 2;
    };
    const rpmFor = (altitude) => calibration.lowRpm + ((.78 - altitude) / .6) * (calibration.highRpm - calibration.lowRpm);
    let state = createFlightState(course, { calibration });
    let firstCollision = null;
    for (let frame = 0; frame < course.duration_s * 60 + 60 && state.phase === 'playing'; frame += 1) {
      const lookAhead = state.courseTime + 5;
      const overlapping = physical.filter((segment) => segment.start_s <= state.courseTime + .8 && segment.end_s >= state.courseTime - .67);
      const upcoming = physical.find((segment) => segment.start_s > state.courseTime + .8 && segment.start_s <= lookAhead);
      let altitude = upcoming ? safeAltitude(upcoming) : overlapping[0] ? safeAltitude(overlapping[0]) : .5;
      if (overlapping.length) {
        const playable = overlapping.map(terrainBounds).reduce((bounds, item) => ({
          top: Math.max(bounds.top, item.top + .035), bottom: Math.min(bounds.bottom, item.bottom - .035),
        }), { top: .18, bottom: .78 });
        altitude = Math.min(playable.bottom, Math.max(playable.top, altitude));
      }
      const previousCollisions = state.collisions;
      state = stepFlight(state, { rpm: rpmFor(altitude), connected: true, transportStalled: false, ts: frame + 1 }, 1 / 60, course);
      if (!firstCollision && state.collisions > previousCollisions) firstCollision = { courseTime: state.courseTime, altitude: state.altitude, upcoming: upcoming?.id };
    }
    expect(state.phase, JSON.stringify({ courseTime: state.courseTime, altitude: state.altitude, collisions: state.collisions, checkpoint: state.checkpoint })).toBe('completed');
    expect(state.collisions, JSON.stringify(firstCollision)).toBe(0);
    expect(state.restarts).toBe(0);
    expect(state.checkpoint.id).toBe('checkpoint-three');
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
