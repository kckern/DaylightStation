// Fixture game states for the Skyline Invaders harness. Built on the engine's
// own createGameState so the shape cannot drift from the real one.
import { createGameState } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/engine.js';
import { THREATS } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/threats.js';
import { SHOT_TIERS } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/tiers.js';
import { laneAim, laneX } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/lanes.js';
import { EMPTY_EFFECTS } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/invadersEffects.js';

const level = { id: 'invaders-1-2', duration_s: 90, cannons: 1, pass: { kills: 30, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] };
let id = 1;
const threat = (type, x, y, over = {}) => ({ id: id++, type, x, y, originX: x, hp: THREATS[type].hp, age: 0, phase: 0, dir: 1, bombIn: 2, ...over });
const shot = (tier, x, y, vx = 0) => ({ id: id++, volley: 1, x, y, vx, tier, damage: SHOT_TIERS[tier].damage, halfWidth: SHOT_TIERS[tier].halfWidth, armsUp: false });
const weapon = (lvl, meter = 0.4) => ({ level: lvl, meter, idleS: 0, peak: lvl });
// Threats sit on lane centres, as the engine spawns them.
const sky = () => [
  threat('bomber', laneX(1), 90, { hp: 2 }), threat('bomber', laneX(6), 90),
  threat('bomb', laneX(1), 190), threat('bomb', laneX(6), 330),
  threat('meteor', laneX(0), 150), threat('meteor', laneX(3), 260), threat('meteor', laneX(7), 410), threat('meteor', laneX(5), 120),
  threat('drone', laneX(2), 330), threat('drone', laneX(5), 230), threat('drone', laneX(7), 180),
  threat('pod', laneX(4), 180, { hp: 1 }), threat('pod', laneX(1), 380), threat('pod', laneX(6), 280),
];
const base = (hp, down = []) => ({ hp, maxHp: 100, buildings: Array.from({ length: 10 }, (_, i) => !down.includes(i)) });
const round = (over = {}) => ({ ...createGameState(level, { seed: 1 }), time: 37.4, kills: 17, score: 2340, combo: 4, fuel: 3.2, weapon: weapon(1), threats: sky(), ...over });
const make = (over = {}) => ({
  level, aim: laneAim(3), twin: false, gesture: 'wiper', partner: { riderId: 'kid' },
  aimStatus: { lost: false, mode: 'pose' }, effects: EMPTY_EFFECTS, ...over,
});
const column = (lane, tier, ys) => (tier === 'spread'
  ? ys.flatMap((y) => [shot('spread', laneX(lane) - (520 - y) / 6, y, -150), shot('spread', laneX(lane), y), shot('spread', laneX(lane) + (520 - y) / 6, y, 150)])
  : tier === 'double' ? ys.flatMap((y) => [shot('double', laneX(lane) - 14, y), shot('double', laneX(lane) + 14, y)])
    : ys.map((y) => shot('small', laneX(lane), y)));
const weaponScene = (lvl, tier, over = {}) => () => make({
  aim: laneAim(3),
  state: round({ base: base(80, [3, 7]), weapon: weapon(lvl), boost: { meter: 0.5, next: 1, used: 1, active: null }, shots: column(3, tier, [460, 235]), ...over }),
});

export const SCENES = {
  // Everything at once: every threat type, the stream in flight, a bomb
  // mid-blast, a damaged skyline, a half-full boost meter, pops.
  battle: () => make({
    aim: laneAim(4),
    state: round({
      base: base(70, [2, 3, 8]), weapon: weapon(2, 0.15), boost: { meter: 0.5, next: 1, used: 1, active: null },
      shots: column(4, 'spread', [470, 300]),
      blasts: [{ id: 900, x: laneX(5), y: 210, radius: 160, ttl: 0.27 }],
    }),
    effects: { ...EMPTY_EFFECTS, pops: [
      { key: 'a', kind: 'kill', x: laneX(5), y: 136, points: 28, threat: 'meteor' },
      { key: 'b', kind: 'kill', x: laneX(5) + 80, y: 240, points: 42, threat: 'drone' },
      { key: 'c', kind: 'hit', x: laneX(1), y: 100 },
      { key: 'd', kind: 'impact', x: laneX(2) },
    ] },
  }),
  'weapon-single': weaponScene(0, 'small'),
  'weapon-double': weaponScene(1, 'double'),
  'weapon-spread': weaponScene(2, 'spread'),
  'bomb-ready': weaponScene(2, 'spread', { weapon: weapon(2, 1) }),
  'out-of-fuel': weaponScene(1, 'double', { fuel: 0, shots: [] }),
  'bomb-start': () => make({ state: round({ weapon: weapon(2, 0.05), blasts: [{ id: 900, x: laneX(3), y: 250, radius: 160, ttl: 0.47 }], boost: { meter: 0.2, next: 0, used: 0, active: null } }), effects: { ...EMPTY_EFFECTS, shakeKey: 1, shakeKind: 'bomb' } }),
  'bomb-late': () => make({ state: round({ weapon: weapon(2, 0.05), blasts: [{ id: 900, x: laneX(3), y: 250, radius: 160, ttl: 0.1 }], boost: { meter: 0.2, next: 0, used: 0, active: null } }) }),
  'edge-lane-left': () => make({ aim: laneAim(0), state: round({ shots: column(0, 'double', [400]) }) }),
  'edge-lane-right': () => make({ aim: laneAim(7), state: round({ shots: column(7, 'double', [480, 300]) }) }),
  shield: () => make({ state: round({ base: base(60, [1, 4, 5, 9]), boost: { meter: 0, next: 2, used: 2, active: { kind: 'shield', remaining: 5.3 } } }), effects: { ...EMPTY_EFFECTS, banner: { key: 'b', text: 'Shield' } } }),
  twin: () => make({ twin: true, aim: laneAim(2), state: round({ weapon: weapon(2), boost: { meter: 0, next: 3, used: 3, active: { kind: 'twin', remaining: 2.4 } }, shots: [...column(2, 'spread', [300]), ...column(5, 'spread', [300])] }) }),
  rapid: () => make({ aim: laneAim(5), state: round({ weapon: weapon(0), fuel: 0, boost: { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 7.1 } }, shots: column(5, 'small', [460, 350, 240, 130]) }) }),
  'pose-lost': () => make({ aimStatus: { lost: true, mode: 'pose' }, partner: null, state: round({ combo: 0, base: base(100) }) }),
  'camera-off': () => make({ aimStatus: { lost: true, mode: 'manual' }, poseStatus: { state: 'camera-denied' }, state: round({ combo: 0, boost: { meter: 0.85, next: 0, used: 0, active: null } }) }),
  'last-seconds': () => make({ state: round({ time: 83.2, kills: 31, score: 12480, combo: 12, base: base(20, [0, 1, 2, 3, 5, 6, 8, 9]), boost: { meter: 0.1, next: 2, used: 2, active: null } }) }),
  start: () => make({ partner: null, state: { ...createGameState(level, { seed: 1 }), time: 0.5 } }),
};
