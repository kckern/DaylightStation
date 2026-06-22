// backend/tests/unit/domains/ambient/evaluateAmbientSchedule.test.mjs
import { evaluateAmbientSchedule } from '#domains/ambient/evaluateAmbientSchedule.mjs';

const WIN = {
  key: 'am', name: 'am', days: [1], startMin: 420, endMin: 540,
  preset: 'impressionism', device: 'livingroom-tv',
};
const now = (minutes) => ({ dateStr: '2026-06-22', dow: 1, minutes, iso: '2026-06-22T00:00:00Z' });
const freshState = () => ({ owned: null, handled: {} });

describe('evaluateAmbientSchedule', () => {
  it('loads the preset at start when the device is idle', () => {
    const { actions, state } = evaluateAmbientSchedule({
      windows: [WIN], now: now(420), state: freshState(),
      idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'load', key: 'am', device: 'livingroom-tv', display: 'art:impressionism', preset: 'impressionism' }]);
    expect(state.owned).toMatchObject({ key: 'am', device: 'livingroom-tv', preset: 'impressionism' });
    expect(state.handled['2026-06-22'].am.startHandled).toBe(true);
  });

  it('skips the window for the day when active at start (no ownership)', () => {
    const { actions, state } = evaluateAmbientSchedule({
      windows: [WIN], now: now(420), state: freshState(),
      idleByDevice: { 'livingroom-tv': false }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'skip', reason: 'active-content', key: 'am', device: 'livingroom-tv' }]);
    expect(state.owned).toBeNull();
    expect(state.handled['2026-06-22'].am.startHandled).toBe(true);
  });

  it('does not re-fire start once handled', () => {
    const state = { owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions } = evaluateAmbientSchedule({
      windows: [WIN], now: now(480), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([]);
  });

  it('powers off at end when ambient owns the session and the device is idle', () => {
    const state = { owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions, state: next } = evaluateAmbientSchedule({
      windows: [WIN], now: now(540), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'powerOff', key: 'am', device: 'livingroom-tv' }]);
    expect(next.owned).toBeNull();
    expect(next.handled['2026-06-22'].am.endHandled).toBe(true);
  });

  it('releases (no power off) at end when the user took over', () => {
    const state = { owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions, state: next } = evaluateAmbientSchedule({
      windows: [WIN], now: now(540), state, idleByDevice: { 'livingroom-tv': false }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'release', key: 'am', device: 'livingroom-tv', reason: 'active-at-end' }]);
    expect(next.owned).toBeNull();
  });

  it('does nothing at end when ambient does not own the session', () => {
    const state = { owned: null, handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions } = evaluateAmbientSchedule({
      windows: [WIN], now: now(540), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'none', key: 'am', device: 'livingroom-tv' }]);
  });

  it('on first tick after boot, marks a passed start handled WITHOUT acting', () => {
    const { actions, state } = evaluateAmbientSchedule({
      windows: [WIN], now: now(450), state: freshState(),
      idleByDevice: { 'livingroom-tv': true }, firstTick: true,
    });
    expect(actions).toEqual([{ type: 'skip', reason: 'boot-catchup', key: 'am', device: 'livingroom-tv' }]);
    expect(state.owned).toBeNull();
    expect(state.handled['2026-06-22'].am.startHandled).toBe(true);
  });

  it('ignores windows not scheduled for today', () => {
    const { actions } = evaluateAmbientSchedule({
      windows: [WIN], now: { dateStr: '2026-06-23', dow: 2, minutes: 420, iso: '' },
      state: freshState(), idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([]);
  });

  it('prunes handled state from previous days', () => {
    const state = { owned: null, handled: { '2026-06-21': { am: { startHandled: true, endHandled: true } } } };
    const { state: next } = evaluateAmbientSchedule({
      windows: [WIN], now: now(300), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(next.handled['2026-06-21']).toBeUndefined();
    expect(next.handled['2026-06-22']).toBeDefined();
  });
});
