import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOST_LABELS, EMPTY_EFFECTS, INVADERS_LOG_NAMES, INVADERS_SOUND_SLOTS, MAX_POPS,
  buildInvadersEffectTable, invadersSoundUrls,
} from './invadersEffects.js';
import { SKYLINE_SOUND_SLOTS } from '../skylineGlider/skylineAudio.js';
import { createEffectDispatcher } from '../../../../../../__capabilities/gaming/browser/platform/realtime/index.js';

describe('Skyline Invaders effects', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // A stand-in for React state: setEffects takes an updater, like useState's setter.
  const setup = ({ audio = true } = {}) => {
    let effects = EMPTY_EFFECTS;
    const setEffects = vi.fn((update) => { effects = typeof update === 'function' ? update(effects) : update; });
    const timers = { current: new Set() };
    const played = [];
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const dispatcher = createEffectDispatcher({
      table: buildInvadersEffectTable({ setEffects, effectTimersRef: timers }),
      playCue: (cue) => { played.push(cue); return audio; },
      log, logNames: INVADERS_LOG_NAMES, correlation: () => ({ runId: 'r' }),
    });
    return { dispatcher, played, setEffects, log, timers, effects: () => effects };
  };
  const kill = (id, over = {}) => ({ type: 'threat.destroyed', data: { id, threat: 'drone', x: 300, y: 200, points: 22, by: 'small', ...over } });

  it('only uses sound slots the shared audio engine knows', () => {
    for (const slot of INVADERS_SOUND_SLOTS) expect(SKYLINE_SOUND_SLOTS).toContain(slot);
  });

  it('maps each engine event to its cue', () => {
    const { dispatcher, played } = setup();
    dispatcher.dispatch([
      { type: 'shot.fired', data: { tier: 'small' } }, { type: 'bomb.ready', data: {} },
      { type: 'threat.damaged', data: { id: 4, x: 1, y: 1 } }, kill(1),
      { type: 'base.hit', data: { damage: 10, x: 400, buildings: [3] } }, { type: 'base.hit', data: { damage: 0, shielded: true } },
      { type: 'boost.activated', data: { kind: 'shield' } }, { type: 'level.ended', data: {} },
      { type: 'volley.settled', data: {} }, { type: 'fuel.added', data: {} }, { type: 'threat.spawned', data: {} }, { type: 'boost.ended', data: { kind: 'shield' } },
    ], { time: 12 });
    expect(played).toEqual(['laser', 'missile', 'hit', 'target', 'hurt', 'deny', 'boost', 'finish']);
  });

  // A bomb is the round's big moment. It has to land as an event, so it
  // gets two cues at once (the boom and a longer low rumble under it), which no
  // other event in the game does.
  it('gives a bomb a boom and a rumble together, and the longest shake', () => {
    const { dispatcher, played, effects } = setup();
    dispatcher.dispatch([{ type: 'bomb', data: { x: 400, y: 200, radius: 160 } }], { time: 3 });
    expect(played).toEqual(['explosion', 'crash']);
    expect(effects()).toMatchObject({ shakeKey: 1, shakeKind: 'bomb' });
    vi.advanceTimersByTime(299);
    expect(effects().shakeKey).toBe(1);
    vi.advanceTimersByTime(1);
    expect(effects()).toMatchObject({ shakeKey: 0, shakeKind: null });
  });

  it('pops the points where a threat was destroyed, for 600 ms', () => {
    const { dispatcher, effects } = setup();
    dispatcher.dispatch([kill(7)], { time: 1 });
    expect(effects().pops).toEqual([{ key: 'kill-7-1', kind: 'kill', x: 300, y: 200, points: 22, threat: 'drone' }]);
    vi.advanceTimersByTime(599);
    expect(effects().pops).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(effects().pops).toEqual([]);
  });

  it('sparks where a threat was damaged but not destroyed', () => {
    const { dispatcher, effects } = setup();
    dispatcher.dispatch([{ type: 'threat.damaged', data: { id: 9, threat: 'bomber', x: 500, y: 90, hp: 3 } }], { time: 2 });
    expect(effects().pops).toEqual([{ key: 'hit-9-2', kind: 'hit', x: 500, y: 90 }]);
  });

  it('shakes for 200 ms and marks the ground when the base takes damage, but not behind a shield', () => {
    const { dispatcher, effects } = setup();
    dispatcher.dispatch([{ type: 'base.hit', data: { threat: 'meteor', x: 420, damage: 10, shielded: false, hp: 90, buildings: [4] } }], { time: 5 });
    expect(effects()).toMatchObject({ shakeKey: 1, shakeKind: 'hit' });
    expect(effects().pops).toEqual([{ key: 'impact-420-5', kind: 'impact', x: 420 }]);
    vi.advanceTimersByTime(200);
    expect(effects().shakeKey).toBe(0);

    const shielded = setup();
    shielded.dispatcher.dispatch([{ type: 'base.hit', data: { threat: 'meteor', x: 420, damage: 0, shielded: true, hp: 100, buildings: [] } }], { time: 5 });
    expect(shielded.effects()).toEqual(EMPTY_EFFECTS);
  });

  it('lets a second shake run its full time when an earlier one ends under it', () => {
    const { dispatcher, effects } = setup();
    dispatcher.dispatch([{ type: 'base.hit', data: { x: 1, damage: 10 } }], { time: 1 });
    vi.advanceTimersByTime(150);
    dispatcher.dispatch([{ type: 'bomb', data: {} }], { time: 1.15 });
    expect(effects()).toMatchObject({ shakeKey: 2, shakeKind: 'bomb' });
    vi.advanceTimersByTime(60);            // the first shake's timer has fired
    expect(effects()).toMatchObject({ shakeKey: 2, shakeKind: 'bomb' });
    vi.advanceTimersByTime(240);
    expect(effects().shakeKey).toBe(0);
  });

  it('shows the boost label as a banner for 1500 ms', () => {
    const { dispatcher, effects } = setup();
    dispatcher.dispatch([{ type: 'boost.activated', data: { kind: 'twin' } }], { time: 30 });
    expect(effects().banner).toEqual({ key: 'boost-twin-30', text: BOOST_LABELS.twin });
    expect(BOOST_LABELS).toEqual({ rapid: 'Rapid fire', shield: 'Shield', twin: 'Twin cannon' });
    vi.advanceTimersByTime(1500);
    expect(effects().banner).toBeNull();
  });

  it('never holds more pops than the scene should draw', () => {
    const { dispatcher, effects } = setup();
    dispatcher.dispatch(Array.from({ length: MAX_POPS + 10 }, (_, i) => kill(i + 1)), { time: 1 });
    expect(effects().pops).toHaveLength(MAX_POPS);
    expect(effects().pops.at(-1).key).toBe(`kill-${MAX_POPS + 10}-1`);
  });

  it('forgets each timer once it has fired', () => {
    const { dispatcher, timers } = setup();
    dispatcher.dispatch([kill(1), { type: 'bomb', data: {} }], { time: 1 });
    expect(timers.current.size).toBe(2);
    vi.advanceTimersByTime(600);
    expect(timers.current.size).toBe(0);
  });

  it('logs round events under skyline_invaders.*, but not the per-shot and per-threat ones', () => {
    const { dispatcher, log } = setup();
    dispatcher.dispatch([{ type: 'bomb', data: { x: 1 } }, { type: 'shot.fired', data: { tier: 'small' } }, kill(1)], { time: 1 });
    const names = log.info.mock.calls.map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining(['skyline_invaders.round.bomb', 'skyline_invaders.effect.executed']));
    expect(names.filter((name) => name.startsWith('skyline_invaders.round.'))).toEqual(['skyline_invaders.round.bomb']);
    expect(log.info).toHaveBeenCalledWith('skyline_invaders.round.bomb', expect.objectContaining({ runId: 'r', time: 1, x: 1 }));
  });

  it('logs a cue the audio engine could not play as skipped', () => {
    const { dispatcher, log } = setup({ audio: false });
    dispatcher.dispatch([{ type: 'level.ended', data: {} }], { time: 60 });
    expect(log.info).toHaveBeenCalledWith('skyline_invaders.effect.skipped', expect.objectContaining({ effectId: 'finish-cue' }));
  });

  it('builds media urls for every slot under the game folder', () => {
    const urls = invadersSoundUrls((path) => `/m/${path}`);
    expect(urls.laser).toBe('/m/fitness/skyline-invaders/sounds/laser.mp3');
    expect(Object.keys(urls)).toEqual([...INVADERS_SOUND_SLOTS]);
  });

  it('announces a weapon level gained and a bomb ready, and only sounds a level lost', () => {
    const { dispatcher, played, effects } = setup();
    dispatcher.dispatch([{ type: 'weapon.level', data: { level: 1, tier: 'double', reason: 'power' } }], { time: 5 });
    expect(effects().banner).toMatchObject({ text: 'Double shot!' });
    dispatcher.dispatch([{ type: 'bomb.ready', data: {} }], { time: 6 });
    expect(effects().banner).toMatchObject({ text: 'Bomb ready — STOMP!' });
    dispatcher.dispatch([{ type: 'weapon.level', data: { level: 0, tier: 'small', reason: 'idle' } }], { time: 7 });
    expect(effects().banner).toMatchObject({ text: 'Bomb ready — STOMP!' });
    expect(played).toEqual(['boost', 'missile', 'deny']);
  });
});
