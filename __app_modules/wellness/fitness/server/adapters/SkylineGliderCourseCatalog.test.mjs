import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkylineGliderCourseCatalog } from "./SkylineGliderCourseCatalog.mjs";
import { resolveAct } from "./skylineGlider/resolveAct.mjs";
import { validateCourse as validateFrontendCourse, resolveCalibration } from "../../browser/lib/skylineGlider/courseModel.js";
import { createFlightState, stepFlight, retryFlightCheckpoint } from "../../browser/lib/skylineGlider/flightEngine.js";
import { terrainBounds } from "../../browser/lib/skylineGlider/flightGeometry.js";

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'glider-courses-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const configService = () => ({ getHouseholdPath: (relative) => path.join(root, relative) });

describe('SkylineGliderCourseCatalog', () => {
  it('ships distinct accessible introductory and combat acts', () => {
    const acts = new SkylineGliderCourseCatalog({ configService: configService() }).list('home');
    expect(acts.map(a => a.id)).toEqual(['mountain-pass', 'cloud-ridge']);
    const [first, second] = acts;
    expect(first).toMatchObject({ version: 6, duration_s: 300, rpm: { min: 30, max: 130 }, rules: { assist_terrain: true, weapons: { enabled: false } } });
    expect(first.segments.filter(s => terrainBounds(s) && s.start_s < 60)).toEqual([]);
    expect(first.entities).toEqual([]);
    expect(first.segments.some(s => s.type === 'lava')).toBe(false);
    expect(first.segments.filter(s => s.type === 'lower-terrain').every(s => s.profile?.length >= 3)).toBe(true);
    expect(second).toMatchObject({ version: 6, duration_s: 240 });
    expect(second.entities.filter(e=>e.vulnerable_to?.includes('missile')).every(e=>e.at_s>100&&e.required_weapon!=='bomb')).toBe(true);
    expect(second.entities.some(e=>e.vulnerable_to?.includes('missile'))).toBe(true);
    expect(second.rules.boost).toMatchObject({enabled:true,offset_s:2.8,duration_s:1.6,recharge_s:8});
    expect(second.rules.boost.speed).toBeUndefined();
    expect(second.entities.filter(e=>e.entity==='target').every(e=>e.role==='shoot')).toBe(true);
    // Bombs go down, onto ground targets — never into a wall ahead.
    const bombable = second.entities.filter(e=>e.vulnerable_to?.includes('bomb') && e.entity!=='target');
    expect(bombable.length).toBeGreaterThan(0);
    expect(bombable.every(e=>e.role==='bomb' && e.altitude>=.9)).toBe(true);
    expect(second.entities.some(e=>e.entity==='bombwall')).toBe(false);
    // Missiles break the cracked wall; gates are steel with a gap, one of them a shutter.
    expect(second.entities.filter(e=>e.entity==='crackwall').every(e=>e.required_weapon==='missile'&&e.role==='missile')).toBe(true);
    expect(second.entities.filter(e=>e.group).every(e=>e.vulnerable_to?.length===0)).toBe(true);
    expect(second.entities.some(e=>e.piece==='shutter'&&e.closes_at_s<e.at_s)).toBe(true);
    expect(second.zone.palette.theme).not.toBe(first.zone.palette.theme);
    expect(second.segments.filter(s => s.type === 'lava').every(s => s.start_s >= 60)).toBe(true);
    for (const act of acts) expect(validateFrontendCourse(act).errors).toEqual([]);
  });

  it('lets slow pedaling beginners complete all of act one without crashing', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[0]).course;
    for (const rpm of [1, 15, 30, 60, 130]) {
      const state = stepFlight(createFlightState(course, { calibration: resolveCalibration({}, course) }), { rpm, connected: true }, course.duration_s, course);
      expect(state.phase, `rpm=${rpm}`).toBe('completed');
      expect(state.collisions, `rpm=${rpm}`).toBe(0);
      expect(state.restarts).toBe(0);
      if (rpm === 15) expect(state.collectedIds.length).toBeGreaterThan(0);
    }
  });

  // A scripted rider: low and slow by default, an easy 45 rpm through each
  // gate's gap (it sits low enough for gentle pedaling), climbing over each tower, a bomb on everything below, a missile at the cracked wall
  // and a boost as each shutter starts to close.
  const autopilot = (course, { missiles = true } = {}) => {
    const fired = new Set();
    const gaps = course.entities.filter(e => e.piece === 'top');
    const towers = course.entities.filter(e => e.entity === 'tower');
    const bombs = course.entities.filter(e => e.role === 'bomb');
    const walls = course.entities.filter(e => e.required_weapon === 'missile');
    const shutters = course.entities.filter(e => e.closes_at_s != null);
    const once = (key, when) => (when && !fired.has(key) ? (fired.add(key), true) : false);
    return (state) => {
      const at = state.courseTime, camera = at - (state.boostOffset || 0);
      const near = (e) => at >= e.at_s - 6 && at <= e.at_s + 2;
      const actions = [
        ...bombs.filter(e => once(e.id, at >= e.at_s - .25)).map(() => 'bomb'),
        ...(missiles ? walls.filter(e => once(e.id, at >= e.at_s - 6)).map(() => 'missile') : []),
        ...shutters.filter(e => once(e.id, camera >= e.closes_at_s - 1.5)).map(() => 'boost'),
      ];
      return { rpm: towers.some(near) ? 77 : gaps.some(near) ? 45 : 15, connected: true, weaponPower: 1, actions };
    };
  };

  it('lets a basic-power rider clear the obstacle course: bombs below, a missile wall, gaps and a shutter', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[1]).course;
    const pilot = autopilot(course);
    let state = createFlightState(course, { calibration: resolveCalibration({}, course) });
    for (let frame = 0; frame < course.duration_s * 60 + 60 && state.phase === 'playing'; frame++) state = stepFlight(state, pilot(state), 1 / 60, course);
    expect(state.phase, JSON.stringify({ time: state.courseTime, cause: state.crashCause, entity: state.lastCollisionEntityId })).toBe('completed');
    expect(state.collisions).toBe(0);
    for (const e of course.entities.filter(e => e.role === 'bomb')) expect(state.destroyedBy[e.id], e.id).toBe('bomb');
    for (const e of course.entities.filter(e => e.required_weapon === 'missile')) expect(state.destroyedBy[e.id], e.id).toBe('missile');
    for (const e of course.entities.filter(e => e.group)) expect(state.destroyedIds).not.toContain(e.id);
  });

  it('crashes a rider who wastes their missiles before the cracked wall, then refills them on retry', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[1]).course;
    const wall = course.entities.find(e => e.required_weapon === 'missile');
    const checkpoint = course.segments.filter(s => s.type === 'checkpoint' && s.start_s < wall.at_s).at(-1);
    const pilot = autopilot(course, { missiles: false });
    let state = createFlightState(course, { calibration: resolveCalibration({}, course), courseTime: checkpoint.start_s - .02 });
    state = stepFlight(state, { rpm: 15, connected: true }, .1, course);
    // Fired at an empty sky, each missile flies off the edge of the screen.
    for (let n = 0; n < course.rules.weapons.missiles; n++) state = stepFlight(state, { rpm: 15, connected: true, actions: ['missile'] }, 1, course);
    expect(state.missilesLeft).toBe(0);
    while (state.phase === 'playing' && state.courseTime < wall.at_s + 1) state = stepFlight(state, pilot(state), 1 / 60, course);
    expect(state.phase).toBe('crashed');
    expect(state.lastCollisionEntityId).toBe(wall.id);
    state = retryFlightCheckpoint(state, course);
    expect(state.restarts).toBe(1);
    expect(state.missilesLeft).toBe(course.rules.weapons.missiles);
    expect(state.destroyedIds).not.toContain(wall.id);
  });

  it('shuts the gate on a rider who does not boost', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[1]).course;
    const shutter = course.entities.find(e => e.closes_at_s != null);
    const pilot = autopilot(course);
    let state = createFlightState(course, { calibration: resolveCalibration({}, course), courseTime: shutter.at_s - 10 });
    while (state.phase === 'playing' && state.courseTime < shutter.at_s + 2) {
      const input = pilot(state);
      state = stepFlight(state, { ...input, actions: input.actions.filter(a => a !== 'boost') }, 1 / 60, course);
    }
    expect(state.phase).toBe('crashed');
    expect(state.lastCollisionEntityId).toBe(shutter.id);
  });

  it('keeps slow pedaling safe over lava but makes a genuine stop crash', () => {
    const course = validateFrontendCourse(new SkylineGliderCourseCatalog({ configService: configService() }).list('home')[1]).course;
    const lava = course.segments.find(s => s.type === 'lava');
    expect(lava).toBeTruthy();
    let state = createFlightState(course, { calibration: resolveCalibration({}, course), courseTime: lava.start_s + 2 });
    state = stepFlight(state, { rpm: 1, connected: true }, 5, course);
    expect(state.collisions).toBe(0);
    state = stepFlight(state, { rpm: 0, connected: true }, 1 / 60, course);
    expect(state.stalled).toBe(true);
    state = stepFlight(state, { rpm: 130, connected: true }, .5, course);
    expect(state.phase).toBe('crashed');
    expect(state.crashCause).toBe('stall');
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

  it('resolves a gate into steel posts around its gap, plus a shutter when it closes', () => {
    const zones = new Map([['alpine', { id: 'alpine', entities: { gate: { class: 'solid', role: 'avoid', draw: 'gate', width_s: 0.8, gap: 0.24, vulnerable_to: [] } } }]]);
    const act = { id: 'g', zone: 'alpine', entities: [
      { id: 'open-gate', entity: 'gate', at_s: 10, gap_altitude: 0.5 },
      { id: 'shut-gate', entity: 'gate', at_s: 20, gap_altitude: 0.4, gap: 0.3, closes_at_s: 18 },
    ] };
    const pieces = resolveAct(act, zones).entities;
    expect(pieces.map((e) => e.id)).toEqual(['open-gate-top', 'open-gate-bottom', 'shut-gate-top', 'shut-gate-bottom', 'shut-gate-shutter']);
    const [top, bottom] = pieces;
    expect(top).toMatchObject({ group: 'open-gate', piece: 'top', class: 'solid', vulnerable_to: [] });
    expect(top.altitude - top.height).toBeCloseTo(0);
    expect(top.altitude).toBeCloseTo(0.38);
    expect(bottom.altitude).toBe(1);
    expect(bottom.altitude - bottom.height).toBeCloseTo(0.62);
    expect(pieces.at(-1)).toMatchObject({ piece: 'shutter', closes_at_s: 18, height: 0.3 });
    expect(pieces.at(-1).altitude).toBeCloseTo(0.55);
    expect(top.closes_at_s).toBeUndefined();
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
