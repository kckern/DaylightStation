import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkylineGliderCourseCatalog } from "./SkylineGliderCourseCatalog.mjs";
import { resolveAct } from "./skylineGlider/resolveAct.mjs";
import { validateCourse as validateFrontendCourse } from "../../browser/lib/skylineGlider/courseModel.js";
import { createFlightState, stepFlight } from "../../browser/lib/skylineGlider/flightEngine.js";
import { terrainBounds } from "../../browser/lib/skylineGlider/flightGeometry.js";

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'glider-courses-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const configService = () => ({ getHouseholdPath: (relative) => path.join(root, relative) });

describe('SkylineGliderCourseCatalog', () => {
  it('always exposes the validated bundled Mountain Pass course', () => {
    const catalog = new SkylineGliderCourseCatalog({ configService: configService() });
    const courses = catalog.list('home');
    expect(courses.map((item) => item.id)).toEqual(['mountain-pass', 'cloud-ridge']);
    const course = courses[0];
    expect(course).toMatchObject({ id: 'mountain-pass', version: 4, act: 1, schema: 'skyline-glider-course/v1', duration_s: 300 });
    expect(course.zone).toMatchObject({ id: 'alpine', name: 'Alpine', asset_root: 'fitness/skyline-glider/alpine' });
    expect(course.zone.sounds.bell).toBe('fitness/skyline-glider/alpine/sounds/bell.mp3');
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

  it('lets a steady 75 RPM effort that eases off under the cloud shelf finish without a crash', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[0]).course;
    let state = createFlightState(course, { calibration: { lowRpm: 15, highRpm: 100 } });
    for (let frame = 0; frame < 20_000 && state.phase === 'playing'; frame += 1) {
      const rpm = state.courseTime > 127 && state.courseTime < 147 ? 52 : 75;
      state = stepFlight(state, { rpm, connected: true, transportStalled: false, ts: frame + 1 }, 1 / 60, course);
    }

    expect(state.phase).toBe('completed');
    expect(state.restarts).toBe(0);
    expect(state.collisions).toBe(0);
  });

  it('crashes a steady 75 RPM effort into the cloud shelf instead of letting it pass through', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[0]).course;
    let state = createFlightState(course, { calibration: { lowRpm: 15, highRpm: 100 } });
    for (let frame = 0; frame < 60 * 150 && state.phase === 'playing'; frame += 1) {
      state = stepFlight(state, { rpm: 75, connected: true, transportStalled: false, ts: frame + 1 }, 1 / 60, course);
    }

    expect(state.phase).toBe('crashed');
    expect(state.lastCollisionSegmentId).toBe('cloud-descent');
  });

  it('flies every bundled act cleanly with a cadence-only autopilot', () => {
    const catalog = new SkylineGliderCourseCatalog({ configService: configService() });
    for (const raw of catalog.list('home')) {
      const { course, valid, errors } = validateFrontendCourse(raw);
      expect(valid, `${raw.id}: ${errors}`).toBe(true);
      const calibration = { lowRpm: 30, highRpm: 100 };
      const rpmFor = (altitude) => calibration.lowRpm + ((.78 - altitude) / .6) * (calibration.highRpm - calibration.lowRpm);
      const bands = [
        ...course.segments.filter((segment) => terrainBounds(segment)).map((segment) => ({ start: segment.start_s, end: segment.end_s ?? segment.start_s, ...terrainBounds(segment) })),
        ...course.entities.filter((entity) => entity.class !== 'scenery').map((entity) => ({ start: entity.at_s - entity.width_s / 2, end: entity.at_s + entity.width_s / 2, top: 0, bottom: entity.altitude - entity.height })),
      ];
      let state = createFlightState(course, { calibration });
      for (let frame = 0; frame < course.duration_s * 60 + 60 && state.phase === 'playing'; frame += 1) {
        const from = state.courseTime - .67 - 1.5;
        const to = state.courseTime + .8 + 2.5;
        const band = bands.filter((item) => item.start <= to && item.end >= from)
          .reduce((acc, item) => ({ top: Math.max(acc.top, item.top + .07), bottom: Math.min(acc.bottom, item.bottom - .07) }), { top: .18, bottom: .78 });
        const target = Math.min(band.bottom, Math.max(band.top, .5));
        state = stepFlight(state, { rpm: rpmFor(target), connected: true, transportStalled: false, ts: frame + 1 }, 1 / 60, course);
      }
      expect(state.phase, `${raw.id} at ${state.courseTime}`).toBe('completed');
      expect(state.collisions, raw.id).toBe(0);
      expect(state.restarts, raw.id).toBe(0);
    }
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
    const acts = catalog.list('home');
    expect(acts.map((course) => course.id)).toEqual(['mountain-pass', 'cloud-ridge', 'ridge-run']);
    expect(acts.at(-1)).toMatchObject({ act: null, zone: { id: 'alpine' } });
    expect(warnings).toHaveLength(2);
  });

  it('resolves household zones, act overrides, entity classes and world order', () => {
    const base = path.join(root, 'fitness/skyline-glider');
    fs.mkdirSync(path.join(base, 'zones'), { recursive: true });
    fs.mkdirSync(path.join(base, 'courses'), { recursive: true });
    fs.writeFileSync(path.join(base, 'world.yml'), 'zones: [space, alpine]\n');
    fs.writeFileSync(path.join(base, 'zones/space.yml'), [
      'schema: skyline-glider-zone/v1', 'id: space', 'name: Deep Space', 'asset_root: fitness/skyline-glider/space', 'pixel_art: true',
      'layers:', '  - { id: sky, kind: image, src: stars.png, parallax: 0.05, fallback: alpine-sky }',
      'sprites: { sheet: sprites.png, frames: sprites.json }',
      'entities:', '  asteroid: { class: solid, frame: rock, width_s: 0.6, height: 0.1 }',
      'sounds: { bell: ping.mp3, music: /shared/theme.mp3 }',
    ].join('\n'));
    fs.writeFileSync(path.join(base, 'courses/orbit.yml'), [
      'schema: skyline-glider-course/v1', 'id: orbit', 'version: 1', 'zone: space', 'act: 1', 'name: Orbit', 'duration_s: 30',
      'overrides: { layers: { sky: { src: nebula.png } } }',
      'segments:', '  - { id: open, type: open, start_s: 0, end_s: 30 }', '  - { id: finish, type: finish, start_s: 30 }',
      'entities:', '  - { entity: asteroid, at_s: 10, altitude: 0.7 }',
    ].join('\n'));
    fs.writeFileSync(path.join(base, 'courses/bad-entity.yml'), [
      'schema: skyline-glider-course/v1', 'id: bad-entity', 'version: 1', 'zone: space', 'name: Bad', 'duration_s: 30',
      'segments:', '  - { id: finish, type: finish, start_s: 30 }', 'entities:', '  - { entity: comet, at_s: 10, altitude: 0.7 }',
    ].join('\n'));
    const warnings = [];
    const catalog = new SkylineGliderCourseCatalog({ configService: configService(), logger: { warn: (event, data) => warnings.push({ event, data }) } });

    const acts = catalog.list('home');
    expect(acts.map((act) => act.id)).toEqual(['orbit', 'mountain-pass', 'cloud-ridge']);
    expect(acts[0].zone).toMatchObject({
      id: 'space', pixel_art: true,
      layers: [{ id: 'sky', kind: 'image', src: 'fitness/skyline-glider/space/nebula.png', fallback: 'alpine-sky' }],
      sprites: { sheet: 'fitness/skyline-glider/space/sprites.png', frames: 'fitness/skyline-glider/space/sprites.json' },
      sounds: { bell: 'fitness/skyline-glider/space/ping.mp3', music: 'shared/theme.mp3' },
    });
    expect(acts[0].entities).toEqual([{ id: 'asteroid-1', entity: 'asteroid', class: 'solid', frame: 'rock', at_s: 10, altitude: 0.7, width_s: 0.6, height: 0.1 }]);
    expect(warnings.map((item) => item.data.file)).toEqual(['bad-entity.yml']);
    expect(catalog.world('home')).toEqual({ zones: [
      { id: 'space', name: 'Deep Space', acts: [{ id: 'orbit', name: 'Orbit', act: 1 }] },
      { id: 'alpine', name: 'Alpine', acts: [{ id: 'mountain-pass', name: 'Mountain Pass', act: 1 }, { id: 'cloud-ridge', name: 'Cloud Ridge', act: 2 }] },
    ] });
  });

  it('carries vulnerable_to and the zone weapons slot through resolution', () => {
    const zone = { schema: 'skyline-glider-zone/v1', id: 'z', asset_root: 'fitness/skyline-glider/z', entities: { rock: { class: 'solid', width_s: 0.8, height: 0.12, vulnerable_to: ['bomb'] } }, weapons: { laser: { frame: 'laser-0' }, bomb: 'not-an-object' } };
    const act = { id: 'a', zone: 'z', entities: [{ entity: 'rock', at_s: 4, altitude: 0.78 }, { entity: 'rock', at_s: 9, altitude: 0.78, vulnerable_to: [] }] };
    const resolved = resolveAct(act, new Map([['z', zone]]));
    expect(resolved.entities.map((entity) => entity.vulnerable_to)).toEqual([['bomb'], []]);
    expect(resolved.zone.weapons).toEqual({ laser: { frame: 'laser-0' } });
  });
});
