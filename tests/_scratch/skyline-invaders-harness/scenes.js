// Fixture game states for the Skyline Invaders harness. Built on the engine's
// own createGameState so the shape cannot drift from the real one.
import { createGameState } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/engine.js';
import { THREATS } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/threats.js';
import { SHOT_TIERS } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/tiers.js';
import { EMPTY_EFFECTS } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/invadersEffects.js';

const level = { id: 'invaders-1-2', duration_s: 90, cannons: 1, pass: { kills: 30, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] };
let id = 1;
const threat = (type, x, y, over = {}) => ({ id: id++, type, x, y, originX: x, hp: THREATS[type].hp, age: 0, phase: 0, dir: 1, bombIn: 2, ...over });
const shot = (tier, x, y, vx = 0) => ({ id: id++, volley: 1, x, y, vx, tier, damage: SHOT_TIERS[tier].damage, halfWidth: SHOT_TIERS[tier].halfWidth, armsUp: false });
const TIER = (tier, trusted = true) => ({ tier, zoneId: trusted ? 'zone' : null, trusted });

const sky = () => [
  threat('bomber', 250, 90, { hp: 2 }), threat('bomber', 760, 90),
  threat('bomb', 250, 190), threat('bomb', 760, 330),
  threat('meteor', 120, 150), threat('meteor', 430, 260), threat('meteor', 880, 410), threat('meteor', 610, 120),
  threat('drone', 330, 330), threat('drone', 680, 230), threat('drone', 930, 180),
  threat('pod', 520, 180, { hp: 1 }), threat('pod', 160, 380), threat('pod', 820, 280),
];
const base = (hp, down = []) => ({ hp, maxHp: 100, buildings: Array.from({ length: 10 }, (_, i) => !down.includes(i)) });
const round = (over = {}) => ({ ...createGameState(level, { seed: 1 }), time: 37.4, kills: 17, score: 2340, combo: 4, threats: sky(), ...over });
const make = (over = {}) => ({
  level, aim: 0.46, twin: false, tier: TIER('big'), partner: { riderId: 'kid' }, shooterName: 'Shooter',
  aimStatus: { lost: false, mode: 'pose' }, effects: EMPTY_EFFECTS, ...over,
});
const tierScene = (tier) => () => make({
  tier: TIER(tier), aim: 0.42,
  state: round({
    base: base(80, [3, 7]), boost: { meter: 0.5, next: 1, used: 1, active: null },
    shots: tier === 'spread'
      ? [shot('spread', 430, 300, -150), shot('spread', 470, 300), shot('spread', 510, 300, 150), shot('spread', 470, 120)]
      : [shot(tier, 470, 330), shot(tier, 470, 140)],
  }),
});

export const SCENES = {
  // Everything at once: every threat type, every shot tier in flight, a nuke
  // mid-blast, a damaged skyline, a half-full boost meter, pops.
  battle: () => make({
    tier: TIER('nuke'), aim: 0.565,
    state: round({
      base: base(70, [2, 3, 8]), boost: { meter: 0.5, next: 1, used: 1, active: null },
      shots: [shot('small', 210, 430), shot('big', 330, 250), shot('spread', 700, 380, -150), shot('spread', 740, 380), shot('spread', 780, 380, 150), shot('nuke', 557, 400)],
      blasts: [{ id: 900, x: 600, y: 210, radius: 160, ttl: 0.27 }],
    }),
    effects: { ...EMPTY_EFFECTS, pops: [
      { key: 'a', kind: 'kill', x: 610, y: 136, points: 28, threat: 'meteor' },
      { key: 'b', kind: 'kill', x: 690, y: 240, points: 42, threat: 'drone' },
      { key: 'c', kind: 'hit', x: 250, y: 100 },
      { key: 'd', kind: 'impact', x: 310 },
    ] },
  }),
  'tier-small': tierScene('small'),
  'tier-big': tierScene('big'),
  'tier-spread': tierScene('spread'),
  'tier-nuke': tierScene('nuke'),
  'nuke-start': () => make({ tier: TIER('nuke'), aim: 0.5, state: round({ blasts: [{ id: 900, x: 500, y: 250, radius: 160, ttl: 0.47 }], boost: { meter: 0.2, next: 0, used: 0, active: null } }), effects: { ...EMPTY_EFFECTS, shakeKey: 1, shakeKind: 'nuke' } }),
  'nuke-late': () => make({ tier: TIER('nuke'), aim: 0.5, state: round({ blasts: [{ id: 900, x: 500, y: 250, radius: 160, ttl: 0.1 }], boost: { meter: 0.2, next: 0, used: 0, active: null } }) }),
  shield: () => make({ state: round({ base: base(60, [1, 4, 5, 9]), boost: { meter: 0, next: 2, used: 2, active: { kind: 'shield', remaining: 5.3 } } }), effects: { ...EMPTY_EFFECTS, banner: { key: 'b', text: 'Shield' } } }),
  twin: () => make({ twin: true, aim: 0.3, tier: TIER('spread'), state: round({ boost: { meter: 0, next: 3, used: 3, active: { kind: 'twin', remaining: 2.4 } }, shots: [shot('spread', 280, 300, -150), shot('spread', 324, 300), shot('spread', 368, 300, 150), shot('spread', 632, 300, -150), shot('spread', 676, 300), shot('spread', 720, 300, 150)] }) }),
  rapid: () => make({ aim: 0.7, tier: TIER('small'), state: round({ boost: { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 7.1 } }, shots: [0, 1, 2].map((i) => shot('small', 676, 460 - i * 190)) }) }),
  'pose-lost': () => make({ tier: TIER('small', false), aimStatus: { lost: true, mode: 'pose' }, partner: null, state: round({ combo: 0, base: base(100) }) }),
  manual: () => make({ tier: TIER('small', false), aimStatus: { lost: false, mode: 'manual' }, state: round({ combo: 0, boost: { meter: 0.85, next: 0, used: 0, active: null } }) }),
  'last-seconds': () => make({ tier: TIER('big'), state: round({ time: 83.2, kills: 31, score: 12480, combo: 12, base: base(20, [0, 1, 2, 3, 5, 6, 8, 9]), boost: { meter: 0.1, next: 2, used: 2, active: null } }) }),
  start: () => make({ tier: TIER('small'), partner: null, state: { ...createGameState(level, { seed: 1 }), time: 0.5 } }),
};
