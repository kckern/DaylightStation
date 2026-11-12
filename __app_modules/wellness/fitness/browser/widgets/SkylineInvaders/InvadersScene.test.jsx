import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvadersScene, { BUILDING_SIZE, buildingX, cannonArt, skyStars, threatArt } from './InvadersScene.jsx';
import { createGameState } from '../../lib/skylineInvaders/engine.js';
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

  // Pose arrives at about 13 fps. The cannon is moved by a CSS transform so the
  // stylesheet can glide it between pose frames; an x attribute would snap.
  it('moves the cannon with a style transform, drawn around its own origin', () => {
    const cannon = scene({ aim: 0.25 }).querySelector('[data-cannon]');
    expect(cannon.style.transform).toBe(`translate(${aimToX(0.25)}px, 0px)`);
    const sprite = cannon.querySelector('svg.skyline-invaders__cannon-body');
    expect(Number(sprite.getAttribute('x'))).toBe(-22);
    expect(Number(sprite.getAttribute('y')) + Number(sprite.getAttribute('height'))).toBe(FIELD.groundY);
    expect(cannon.querySelector('.skyline-invaders__cannon-marker')).not.toBeNull();
  });

  // The scene is 5:3 on a 16:9 screen. The sky and street run on past the field
  // so the side bars are part of the picture.
  it('draws the backdrop wider than the field', () => {
    const sky = scene().querySelector('.skyline-invaders__sky');
    expect(Number(sky.getAttribute('x'))).toBeLessThanOrEqual(-200);
    expect(Number(sky.getAttribute('x')) + Number(sky.getAttribute('width'))).toBeGreaterThanOrEqual(FIELD.width + 200);
  });

  it('draws an aim line from each muzzle, coloured by the shot tier', () => {
    const container = scene({ aim: 0.25, tier: 'nuke' });
    expect(q(container, '[data-cannon] [data-aim-line]')).toHaveLength(1);
    expect(container.querySelector('[data-cannon]').getAttribute('data-tier')).toBe('nuke');
    expect(scene().querySelector('[data-cannon]').getAttribute('data-tier')).toBe('small');
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
    const shots = [{ id: 1, x: 500, y: 300, tier: 'big', halfWidth: 16 }, { id: 2, x: 600, y: 300, tier: 'nuke', halfWidth: 10 }];
    const blasts = [{ id: 3, x: 400, y: 200, radius: 160, ttl: 0.4 }];
    const boost = { meter: 0, next: 2, used: 2, active: { kind: 'shield', remaining: 5 } };
    const container = scene({ state: state({ shots, blasts, boost }) });
    expect(q(container, '[data-shot]').map((n) => n.getAttribute('data-shot'))).toEqual(['big', 'nuke']);
    const big = container.querySelector('[data-shot="big"]');
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
    const effects = { pops: [{ key: 'k1', kind: 'kill', x: 300, y: 200, points: 22, threat: 'drone' }, { key: 'k2', kind: 'impact', x: 500, y: 540 }], shakeKey: 3, shakeKind: 'nuke', banner: null };
    const container = scene({ effects });
    expect(container.querySelector('[data-pop="kill"] text').textContent).toBe('+22');
    expect(container.querySelector('[data-pop="impact"]')).not.toBeNull();
    const stage = container.querySelector('[data-shake]');
    expect(stage.getAttribute('data-shake')).toBe('nuke-b');
    expect(scene({ effects: { ...effects, shakeKey: 4 } }).querySelector('[data-shake]').getAttribute('data-shake')).toBe('nuke-a');
    expect(scene().querySelector('[data-shake]').getAttribute('data-shake')).toBe('none');
  });
});
