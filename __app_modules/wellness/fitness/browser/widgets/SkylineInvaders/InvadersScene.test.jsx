import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvadersScene, { BUILDING_SIZE, buildingX, cannonArt, skyStars, threatArt } from './InvadersScene.jsx';
import { createGameState } from '../../lib/skylineInvaders/engine.js';
import { LANES, LANE_WIDTH, laneAim, laneX } from '../../lib/skylineInvaders/lanes.js';
import { FIELD, THREATS, aimToX } from '../../lib/skylineInvaders/threats.js';
import { INVADER_SPRITES } from '../../lib/skylineInvaders/sprites.js';

const level = { id: 'invaders-test', duration_s: 60, cannons: 1, pass: { kills: 1, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] };
const state = (over = {}) => ({ ...createGameState(level, { seed: 1 }), ...over });
const threat = (type, x, y, id = 1) => ({ id, type, x, y, originX: x, hp: THREATS[type].hp, age: 0, phase: 0, dir: 1, bombIn: 9 });
const q = (container, selector) => [...container.querySelectorAll(selector)];
const scene = (props = {}) => render(<InvadersScene state={state()} level={level} aim={0.5} {...props} />).container;

describe('InvadersScene', () => {
  it('draws the scene in 1000 x 600 units', () => {
    const svg = scene().querySelector('svg.skyline-invaders__scene');
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 600');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('places each threat sprite on its hitbox', () => {
    const container = scene({ state: state({ threats: [threat('meteor', 500, 200)] }) });
    const sprite = container.querySelector('[data-threat="meteor"] svg');
    expect(Number(sprite.getAttribute('x'))).toBe(500 - THREATS.meteor.width / 2);
    expect(Number(sprite.getAttribute('y'))).toBe(200 - THREATS.meteor.height / 2);
    expect(Number(sprite.getAttribute('width'))).toBe(THREATS.meteor.width);
    expect(Number(sprite.getAttribute('height'))).toBe(THREATS.meteor.height);
  });

  it('animates between the two frames', () => {
    expect(threatArt('drone', 0).grid).toBe(INVADER_SPRITES.drone.frames[0]);
    expect(threatArt('drone', 0.6).grid).toBe(INVADER_SPRITES.drone.frames[1]);
  });

  it('falls back to the meteor for a threat type it has no art for', () => {
    expect(threatArt('saucer', 0).grid).toBe(INVADER_SPRITES.meteor.frames[0]);
    expect(cannonArt().grid).toBe(INVADER_SPRITES.cannon.frames[0]);
  });

  it('shows damage on a threat that has lost hit points', () => {
    const hurt = { ...threat('bomber', 500, 90), hp: 1 };
    const container = scene({ state: state({ threats: [hurt, threat('bomber', 300, 90, 2)] }) });
    const [damaged, whole] = q(container, '[data-threat="bomber"]');
    expect(damaged.getAttribute('data-hp')).toBe('1');
    expect(damaged.classList.contains('is-hurt')).toBe(true);
    expect(whole.classList.contains('is-hurt')).toBe(false);
  });

  it('gives a threat that takes more than one hit a pip per hit point, lit for those left', () => {
    const hurt = { ...threat('bomber', 500, 90), hp: 1 };
    const container = scene({ state: state({ threats: [hurt, threat('meteor', 200, 200, 2)] }) });
    expect(q(container, '[data-threat="bomber"] [data-pip]').map((n) => n.getAttribute('data-pip'))).toEqual(['on', 'off', 'off', 'off']);
    expect(q(container, '[data-threat="meteor"] [data-pip]')).toHaveLength(0);
  });

  it('draws the cannon at the aim, and a mirrored one during a twin boost', () => {
    const xs = (container) => q(container, '[data-cannon]').map((n) => Number(n.getAttribute('data-x')));
    expect(xs(scene({ aim: 0.25 }))).toEqual([aimToX(0.25)]);
    expect(xs(scene({ aim: 0.25, twin: true }))).toEqual([aimToX(0.25), aimToX(0.75)]);
    expect(q(scene({ level: { ...level, cannons: 2 }, aim: [0.2, 0.8] }), '[data-cannon]')).toHaveLength(2);
    expect(q(scene({ aim: [0.2, 0.8] }), '[data-cannon]')).toHaveLength(1);
  });

  it('stands the cannon on its lane with a style transform, drawn around its own origin', () => {
    const cannon = scene({ aim: laneAim(2) }).querySelector('[data-cannon]');
    expect(cannon.style.transform).toBe(`translate(${laneX(2)}px, 0px)`);
    expect(cannon.getAttribute('data-lane')).toBe('2');
    const sprite = cannon.querySelector('svg.skyline-invaders__cannon-body');
    expect(Number(sprite.getAttribute('x'))).toBe(-22);
    expect(Number(sprite.getAttribute('y')) + Number(sprite.getAttribute('height'))).toBe(FIELD.groundY);
  });

  it('lights the full height of the cannon lane, one column per cannon', () => {
    const container = scene({ aim: laneAim(5) });
    const columns = q(container, '[data-column]');
    expect(columns.map((n) => n.getAttribute('data-lane'))).toEqual(['5']);
    const column = columns[0].querySelector('.skyline-invaders__column');
    expect(Number(column.getAttribute('x'))).toBeCloseTo(laneX(5) - LANE_WIDTH / 2);
    expect(Number(column.getAttribute('width'))).toBeCloseTo(LANE_WIDTH);
    expect(Number(column.getAttribute('y'))).toBe(0);
    expect(Number(column.getAttribute('height'))).toBe(FIELD.groundY);
    expect(q(container, '.skyline-invaders__lane-tick')).toHaveLength(LANES + 1);
    expect(q(scene({ aim: laneAim(1), twin: true }), '[data-column]').map((n) => n.getAttribute('data-lane'))).toEqual(['1', '6']);
  });

  it('marks the threat the next shot will meet: the lowest one in the cannon column', () => {
    const threats = [threat('meteor', laneX(3), 120, 1), threat('meteor', laneX(3), 330, 2), threat('drone', laneX(6), 400, 3)];
    const container = scene({ aim: laneAim(3), state: state({ threats }) });
    expect(q(container, '[data-target]').map((n) => n.getAttribute('data-target'))).toEqual(['2']);
    expect(q(scene({ aim: laneAim(0), state: state({ threats }) }), '[data-target]')).toHaveLength(0);
  });

  it('draws the fuel under the cannon, and flags an empty tank', () => {
    const half = scene({ state: state({ fuel: 2.5 }) }).querySelector('[data-fuel-bar]');
    const track = Number(half.querySelector('.skyline-invaders__fuel-track').getAttribute('width'));
    expect(Number(half.querySelector('.skyline-invaders__fuel-fill').getAttribute('width'))).toBeCloseTo(track / 2);
    expect(half.getAttribute('data-empty')).toBe('false');
    expect(scene({ state: state({ fuel: 0 }) }).querySelector('[data-fuel-bar]').getAttribute('data-empty')).toBe('true');
  });

  it('behind a menu it is a backdrop: no lit lane, no target mark, no fuel bar', () => {
    const container = scene({ live: false, state: state({ threats: [threat('meteor', 500, 300)] }) });
    expect(q(container, '[data-column], [data-target], [data-fuel-bar]')).toHaveLength(0);
    expect(q(container, '[data-cannon]')).toHaveLength(1);
  });

  it('draws the practice targets for the controls intro, lit and ticked as they are reached', () => {
    const targets = [{ id: 'left', lanes: [0], lit: true, reached: false }, { id: 'centre', lanes: [3, 4], lit: false, reached: true }, { id: 'right', lanes: [7], lit: false, reached: false }];
    const container = scene({ targets });
    const drawn = q(container, '[data-practice-target]');
    expect(drawn.map((n) => [n.getAttribute('data-practice-target'), n.getAttribute('data-lit'), n.getAttribute('data-reached')])).toEqual([['left', 'true', 'false'], ['centre', 'false', 'true'], ['right', 'false', 'false']]);
    expect(Number(drawn[0].querySelector('circle').getAttribute('cx'))).toBeCloseTo(laneX(0));
    expect(Number(drawn[1].querySelector('circle').getAttribute('cx'))).toBeCloseTo((laneX(3) + laneX(4)) / 2);
    expect(drawn[1].querySelector('.skyline-invaders__practice-tick')).not.toBeNull();
    expect(q(container, '[data-fuel-bar]')).toHaveLength(0);      // nothing is fired in a tryout
  });

  // The scene is 5:3 on a 16:9 screen. The sky and street run on past the field
  // so the side bars are part of the picture.
  it('draws the backdrop wider than the field', () => {
    const sky = scene().querySelector('.skyline-invaders__sky');
    expect(Number(sky.getAttribute('x'))).toBeLessThanOrEqual(-200);
    expect(Number(sky.getAttribute('x')) + Number(sky.getAttribute('width'))).toBeGreaterThanOrEqual(FIELD.width + 200);
  });

  it('colours the cannon by the weapon in hand, and by the bomb once one is ready', () => {
    expect(scene().querySelector('[data-cannon]').getAttribute('data-tier')).toBe('small');
    expect(scene({ state: state({ weapon: { level: 1, meter: 0, idleS: 0, peak: 1 } }) }).querySelector('[data-cannon]').getAttribute('data-tier')).toBe('double');
    const ready = scene({ state: state({ weapon: { level: 2, meter: 1, idleS: 0, peak: 2 } }) }).querySelector('[data-cannon]');
    expect(ready.getAttribute('data-tier')).toBe('bomb');
    expect(ready.classList.contains('is-bomb-ready')).toBe(true);
  });

  it('knocks out buildings the engine marked as hit', () => {
    const base = { hp: 80, maxHp: 100, buildings: [true, false, true, true, false, true, true, true, true, true] };
    const container = scene({ state: state({ base }) });
    expect(q(container, '[data-building="standing"]')).toHaveLength(8);
    expect(q(container, '[data-building="rubble"]')).toHaveLength(2);
    expect(q(container, '[data-building="rubble"] .skyline-invaders__windows')).toHaveLength(0);
  });

  it('stands ten buildings on the ground, evenly across the cannon range', () => {
    const container = scene();
    const sprites = q(container, '[data-building] > svg:first-child');
    expect(sprites).toHaveLength(10);
    // Lit windows are a second sprite over each standing building.
    expect(q(container, '[data-building="standing"] > svg.skyline-invaders__windows')).toHaveLength(10);
    expect(sprites.map((n) => Number(n.getAttribute('x')) + BUILDING_SIZE.width / 2)).toEqual(Array.from({ length: 10 }, (_, i) => buildingX(i, 10)));
    expect(buildingX(0, 10)).toBe(FIELD.marginX + 44);
    expect(buildingX(9, 10)).toBe(FIELD.width - FIELD.marginX - 44);
    for (const n of sprites) expect(Number(n.getAttribute('y')) + BUILDING_SIZE.height).toBe(FIELD.groundY);
  });

  it('draws shots by tier, blasts by radius, and the shield', () => {
    const shots = [{ id: 1, x: 500, y: 300, tier: 'double', halfWidth: 16 }, { id: 2, x: 600, y: 300, tier: 'spread', halfWidth: 6 }];
    const blasts = [{ id: 3, x: 400, y: 200, radius: 160, ttl: 0.4 }];
    const boost = { meter: 0, next: 2, used: 2, active: { kind: 'shield', remaining: 5 } };
    const container = scene({ state: state({ shots, blasts, boost }) });
    expect(q(container, '[data-shot]').map((n) => n.getAttribute('data-shot'))).toEqual(['double', 'spread']);
    const big = container.querySelector('[data-shot="double"]');
    expect(Number(big.getAttribute('width'))).toBe(32);
    expect(Number(big.getAttribute('x'))).toBe(500 - 16);
    expect(container.querySelector('[data-blast]').getAttribute('r')).toBe('160');
    expect(Number(container.querySelector('[data-blast]').getAttribute('opacity'))).toBeCloseTo(0.8);
    expect(container.querySelector('[data-shield]')).not.toBeNull();
    expect(FIELD.groundY).toBe(540);
  });

  it('draws no shield without a shield boost', () => {
    const boost = { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 5 } };
    expect(scene({ state: state({ boost }) }).querySelector('[data-shield]')).toBeNull();
  });

  it('keeps the stars where they are from frame to frame', () => {
    expect(skyStars()).toEqual(skyStars());
    expect(skyStars().length).toBeGreaterThan(30);
    for (const star of skyStars()) expect(star.y).toBeLessThan(FIELD.groundY - 120);
  });

  it('draws effect pops: points for a kill, and a shake that restarts on each new key', () => {
    const effects = { pops: [{ key: 'k1', kind: 'kill', x: 300, y: 200, points: 22, threat: 'drone' }, { key: 'k2', kind: 'impact', x: 500, y: 540 }], shakeKey: 3, shakeKind: 'bomb', banner: null };
    const container = scene({ effects });
    expect(container.querySelector('[data-pop="kill"] text').textContent).toBe('+22');
    expect(container.querySelector('[data-pop="impact"]')).not.toBeNull();
    const stage = container.querySelector('[data-shake]');
    expect(stage.getAttribute('data-shake')).toBe('bomb-b');
    expect(scene({ effects: { ...effects, shakeKey: 4 } }).querySelector('[data-shake]').getAttribute('data-shake')).toBe('bomb-a');
    expect(scene().querySelector('[data-shake]').getAttribute('data-shake')).toBe('none');
  });
});
