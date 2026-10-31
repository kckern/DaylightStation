import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockCtx;
let apiFetch;
let worldFetch;
const { mockLog } = vi.hoisted(() => ({
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() },
}));
const gateMocks = vi.hoisted(() => ({
  localDev: true,
  entitlement: { items: [] },
  registerAdmin: vi.fn(),
  clearUnlock: vi.fn(),
}));
vi.mock("../../context/FitnessContext.jsx", () => ({ useFitnessContext: () => mockCtx }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));
vi.mock('@/lib/kioskEnv.js', () => ({
  isLocalDevHost: () => gateMocks.localDev,
  isKioskEnv: () => !gateMocks.localDev,
}));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => {
    if (gateMocks.entitlement instanceof Error) throw gateMocks.entitlement;
    return gateMocks.entitlement;
  }),
  DaylightMediaPath: (path) => path,
  DaylightImagePath: (path) => path,
}));
vi.mock("../../identity/useIdentity.js", () => ({
  useIdentity: () => ({
    registerAdmin: gateMocks.registerAdmin,
    clearUnlock: gateMocks.clearUnlock,
    unlockState: 'idle',
    unlockedUser: null,
  }),
}));
import SkylineGlider from "./SkylineGlider.jsx";
import { FlightScene, RpmGauge } from "./SkylineGlider.jsx";

const course = { schema: 'skyline-glider-course/v1', id: 'mountain-pass', version: 1, name: 'Mountain Pass', description: 'A five minute alpine flight.', duration_s: 300, motion: { filter_s: .75, deadband_rpm: 2, response_s: 1.5, max_climb_rate: .3, max_descent_rate: .22, coast_s: 1, disconnect_grace_s: .75 }, rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 }, segments: [
  { id: 'open', type: 'open', start_s: 0, end_s: 300 },
  { id: 'bells', type: 'collectible-path', start_s: 2, end_s: 10, collectibles: [{ id: 'bell', at_s: 7, altitude: .5 }] },
  { id: 'hill', type: 'lower-terrain', start_s: 5, end_s: 12, top: .62 },
  { id: 'ceiling', type: 'upper-terrain', start_s: 13, end_s: 18, bottom: .38 },
  { id: 'tunnel', type: 'corridor', start_s: 19, end_s: 26, ceiling: .28, floor: .66 },
  { id: 'finish', type: 'finish', start_s: 300 },
] };

const flightState = {
  courseTime: 8,
  altitude: .5,
  targetAltitude: .35,
  rawRpm: 64,
  filteredRpm: 60,
  verticalRate: -.2,
  calibration: { lowRpm: 30, highRpm: 100 },
  invincibleRemaining: 1,
  phase: 'playing',
};

const skylineEntitlement = (decision = 'denied', basisState = 'unsatisfied', riderId = 'dad') => ({
  items: [{
    capabilityId: 'fitness.skyline-glider', gateId: 'school.day-complete', decision, basisState,
    degraded: false, subject: { kind: 'learner', id: riderId },
    period: { kind: 'interval', id: 'school-day:2026-10-07', startsAt: 0, endsAt: Date.now() + 86_400_000 },
    validFrom: 0, validUntil: Date.now() + 86_400_000,
  }],
});

beforeEach(() => {
  localStorage.clear();
  mockLog.info.mockClear();
  mockLog.debug.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
  mockLog.sampled.mockClear();
  gateMocks.localDev = true;
  gateMocks.entitlement = { items: [] };
  gateMocks.registerAdmin.mockReset();
  gateMocks.registerAdmin.mockResolvedValue({ matched: false, reason: 'denied' });
  gateMocks.clearUnlock.mockReset();
  const appListeners = new Map();
  mockCtx = { equipment: [{ id: 'bike', name: 'Bike', cadence: 7, rpm: { min: 30, max: 100 } }], fitnessSessionInstance: { sessionId: 'fs-test', treasureBox: { awardBonus: vi.fn() }, getEquipmentRider: () => 'dad', getEquipmentCadence: () => ({ rpm: 60, connected: true, ts: Date.now() + 1 }) }, getDisplayName: () => ({ displayName: 'Dad', source: 'userProfile', preferredGroupLabel: false }), getUserByName: () => ({ id: 'dad', schoolLearner: true }), subscribeToAppEvent: (type, callback) => { appListeners.set(type, callback); return () => appListeners.delete(type); }, __emitAppEvent: (type, payload) => appListeners.get(type)?.({ type, payload, timestamp: Date.now() }), setGovernanceSuspended: vi.fn() };
  // World-map reads go to their own mock so run-save assertions keep exact call order.
  apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [course] }) }));
  worldFetch = vi.fn(async () => ({ ok: true, json: async () => ({ zones: [{ id: 'alpine', name: 'Alpine', acts: [{ id: 'mountain-pass', name: 'Mountain Pass', act: 1, status: 'open' }] }], next: 'mountain-pass' }) }));
  global.fetch = vi.fn((url, options) => (String(url).includes('/skyline-glider/world') ? worldFetch(url, options) : apiFetch(url, options)));
});

describe('SkylineGlider', () => {
  it('renders actual course geometry scrolling past a right-facing pitched glider', () => {
    const { container } = render(<FlightScene state={flightState} course={course} />);

    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-facing', 'right');
    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-front-seconds', '0.8');
    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-rear-seconds', '0.67');
    expect(screen.getByTestId('skyline-glider-craft').getAttribute('transform')).toContain('translate(240 ');
    expect(screen.getByTestId('skyline-glider-craft').getAttribute('transform')).toContain('rotate(-');
    expect(screen.getByTestId('course-segment-hill')).toHaveAttribute('data-type', 'lower-terrain');
    expect(screen.getByTestId('course-segment-ceiling')).toHaveAttribute('data-type', 'upper-terrain');
    expect(screen.getByTestId('course-segment-tunnel')).toHaveAttribute('data-type', 'corridor');
    expect(container.querySelectorAll('.skyline-glider__parallax')).toHaveLength(3);
    expect(screen.getByTestId('skyline-glider-collision-effect')).toBeTruthy();
  });

  it('removes a collected bell from the course scene', () => {
    render(<FlightScene state={{ ...flightState, collectedIds: ['bell'] }} course={course} />);

    expect(screen.queryByTestId('course-collectible-bell')).toBeNull();
  });

  it('shows a vertical calibrated RPM gauge whose chevron mirrors craft altitude', () => {
    render(<RpmGauge state={{ ...flightState, altitude: 0.18, targetAltitude: 0.78 }} />);

    const gauge = screen.getByRole('meter', { name: /cadence altitude/i });
    expect(gauge).toHaveAttribute('aria-valuemin', '30');
    expect(gauge).toHaveAttribute('aria-valuemax', '100');
    expect(gauge).toHaveAttribute('aria-valuenow', '64');
    expect(screen.getByTestId('rpm-chevron')).toHaveAttribute('data-altitude', '0.18');
    expect(screen.getByTestId('rpm-chevron')).toHaveStyle({ top: '0%' });
    expect(screen.getByTestId('rpm-target')).toHaveStyle({ top: '100%' });
    expect(screen.getByText('64')).toBeTruthy();
  });

});

describe('FlightScene zones', () => {
  const zoned = {
    ...course,
    zone: {
      id: 'space', name: 'Space', pixel_art: true,
      layers: [
        { id: 'stars', kind: 'image', src: 'z/stars.png', parallax: 0.1, fallback: 'alpine-sky' },
        { id: 'hills', kind: 'image', src: 'z/missing.png', parallax: 0.3, fallback: 'alpine-far' },
        { id: 'dust', kind: 'image', src: 'z/dust.png', parallax: 1.2, front: true, y: 0.9, height: 0.1 },
      ],
      terrain: { fill: 'z/rock.png' },
      craft: { frames: ['ship-1', 'ship-2'], fps: 10 },
      collectible: { frame: 'coin' },
      checkpoint: {}, finish: {}, sounds: {},
    },
    entities: [
      { id: 'tree-1', class: 'breakable', draw: 'pine', at_s: 9, altitude: 0.78, width_s: 0.5, height: 0.14 },
      { id: 'tree-2', class: 'breakable', draw: 'pine', at_s: 10, altitude: 0.78, width_s: 0.5, height: 0.14 },
      { id: 'rock-1', class: 'solid', frame: 'asteroid', at_s: 11, altitude: 0.7, width_s: 0.8, height: 0.12 },
    ],
  };
  const assets = {
    images: new Map([
      ['z/stars.png', { url: '/m/stars.png', width: 500, height: 600 }],
      ['z/dust.png', { url: '/m/dust.png', width: 200, height: 60 }],
      ['z/rock.png', { url: '/m/rock.png', width: 64, height: 64 }],
    ]),
    sheet: { url: '/m/sheet.png', width: 128, height: 64 },
    frames: { 'ship-1': { x: 0, y: 0, w: 32, h: 16 }, 'ship-2': { x: 32, y: 0, w: 32, h: 16 }, coin: { x: 64, y: 0, w: 16, h: 16 }, asteroid: { x: 80, y: 0, w: 32, h: 32 } },
    missing: [],
  };

  it('draws loaded image layers, preset fallbacks, sprites and surviving entities', () => {
    const { container } = render(<FlightScene state={{ ...flightState, collectedIds: [], destroyedIds: ['tree-2'] }} course={zoned} assets={assets}/>);
    const scene = container.querySelector('svg.skyline-glider__scene');
    expect(scene).toHaveClass('skyline-glider__scene--pixel');
    expect(scene).toHaveAttribute('data-zone', 'space');
    expect(container.querySelector('[data-layer="stars"] image')).toHaveAttribute('href', '/m/stars.png');
    expect(container.querySelector('.skyline-glider__parallax--far')).toBeTruthy();
    expect(scene.lastElementChild).toHaveAttribute('data-layer', 'dust');
    expect(container.querySelector('#glider-terrain-fill image')).toHaveAttribute('href', '/m/rock.png');
    expect(screen.getByTestId('course-segment-hill').querySelector('rect')).toHaveAttribute('fill', 'url(#glider-terrain-fill)');
    const craftSprite = screen.getByTestId('skyline-glider-craft').querySelector('svg');
    expect(craftSprite).toHaveAttribute('viewBox', '0 0 32 16');
    expect(screen.getByTestId('course-collectible-bell').querySelector('svg')).toHaveAttribute('viewBox', '64 0 16 16');
    expect(screen.getByTestId('course-entity-tree-1')).toHaveAttribute('data-class', 'breakable');
    expect(screen.queryByTestId('course-entity-tree-2')).toBeNull();
    expect(screen.getByTestId('course-entity-rock-1').querySelector('svg')).toHaveAttribute('viewBox', '80 0 32 32');
  });

  it('falls back to the alpine presets when nothing has loaded', () => {
    render(<FlightScene state={{ ...flightState, collectedIds: [] }} course={zoned}/>);
    expect(screen.getByTestId('skyline-glider-craft').querySelector('.skyline-glider__wing')).toBeTruthy();
    expect(screen.getByTestId('course-collectible-bell').querySelector('path')).toBeTruthy();
    expect(screen.getByTestId('course-entity-rock-1').querySelector('.skyline-glider__entity-box')).toBeTruthy();
  });
  it('draws lasers, bombs and blasts as SVG presets with a blast that fades by progress', () => {
    const state = { ...flightState, collectedIds: [], projectiles: [
      { id: 'laser-1', kind: 'laser', at_s: 10, origin_s: 9, altitude: 0.5 },
      { id: 'bomb-1', kind: 'bomb', at_s: 8, altitude: 0.6, fall: 0.2 },
    ], blasts: [{ id: 'bomb-0', at_s: 9, altitude: 0.7, remaining: 0.25 }] };
    const { container } = render(<FlightScene state={state} course={course}/>);
    expect(screen.getByTestId('skyline-glider-shot-laser-1')).toHaveAttribute('data-kind', 'laser');
    expect(screen.getByTestId('skyline-glider-shot-bomb-1').querySelector('.skyline-glider__bomb-body')).toBeTruthy();
    const blast = screen.getByTestId('skyline-glider-blast-bomb-0');
    expect(blast).toHaveAttribute('data-progress', '0.5');
    expect(container.querySelector('.skyline-glider__laser-core')).toBeTruthy();
  });

  it('uses weapon sprite frames when the zone names them', () => {
    const armedZone = { ...zoned, zone: { ...zoned.zone, weapons: { laser: { frame: 'coin' }, blast: { frames: ['ship-1', 'ship-2'] } } } };
    const state = { ...flightState, collectedIds: [], projectiles: [{ id: 'laser-1', kind: 'laser', at_s: 10, origin_s: 9, altitude: 0.5 }], blasts: [{ id: 'bomb-0', at_s: 9, altitude: 0.7, remaining: 0.1 }] };
    render(<FlightScene state={state} course={armedZone} assets={assets}/>);
    expect(screen.getByTestId('skyline-glider-shot-laser-1').querySelector('image')).toBeTruthy();
    // The laser sprite is pinned to its tip, whatever the frame's aspect ratio.
    expect(screen.getByTestId('skyline-glider-shot-laser-1').querySelector('svg')).toHaveAttribute('preserveAspectRatio', 'xMaxYMid meet');
    // remaining 0.1 of 0.5 s = progress 0.8, so the second of two frames.
    expect(screen.getByTestId('skyline-glider-blast-bomb-0').querySelector('svg')).toHaveAttribute('viewBox', '32 0 32 16');
  });
});

describe('accessible flight geometry', () => {
  it('renders the actual slope path and lava surface', () => {
    const slope = { id: 'slope', type: 'lower-terrain', start_s: 4, end_s: 12, top: .9, profile: [{ at_s: 4, altitude: .9 }, { at_s: 8, altitude: .5 }, { at_s: 12, altitude: .9 }] };
    const lava = { id: 'lava', type: 'lava', start_s: 12, end_s: 20, top: .9 };
    render(<FlightScene state={flightState} course={{ ...course, segments: [slope, lava] }} />);
    expect(screen.getByTestId('course-segment-slope').querySelector('path[data-slope]')).toBeTruthy();
    expect(screen.getByTestId('course-segment-lava').querySelector('[data-lava-surface]')).toBeTruthy();
  });
});

