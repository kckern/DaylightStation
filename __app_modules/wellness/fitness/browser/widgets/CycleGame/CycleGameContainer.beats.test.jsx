import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// Race beats: the middle of a race has a shape. Halfway and minute splits name
// the gap to a solo rider's rival, the last minute (or last stretch) tightens
// the screen and lifts the music, and the last ten seconds of a time race beep
// and enlarge the clock.
//
// ── mocks (mirrors CycleGameContainer.parked.test.jsx) ────────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

let mockCtx;
vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => mockCtx
}));

vi.mock("../../nav/usePersistentVolume.js", () => ({
  usePersistentVolume: () => ({ volume: 1, muted: false, setVolume: vi.fn(), toggleMute: vi.fn() })
}));

import CycleGameContainer from "./CycleGameContainer.jsx";

const RACE_TICK_MS = 1000;
const GO_HOLD_MS = 800;
const START_COUNTDOWN_S = 3;

let rpmByBike;

// Every Audio the container makes, with the volume it was last given.
let audios;
class FakeAudio {
  constructor(src) { this.src = src; this.volume = 1; this.loop = false; audios.push(this); }
  play() { return Promise.resolve(); }
  pause() {}
}

function makeCtx(riders, cycleGameConfig = {}) {
  const vitals = {
    user_1: { name: 'User_1', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    user_2: { name: 'User_2', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' }
  };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1 },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 }
    ],
    zones: [
      { id: 'warm', distance_multiplier: 1.5, color: 'yellow' },
      { id: 'hot', distance_multiplier: 2, color: 'orange' }
    ],
    cycleGameConfig: {
      default_win_condition: 'distance',
      distance_goal_default_m: 3000,
      time_cap_default_s: 300,
      hrless_multiplier: 1.0,
      start_countdown_s: START_COUNTDOWN_S,
      staging_buffer_ms: 0,
      music_volume: 0.5,
      sounds: { countdown: '/sfx/beep.mp3', end: '/sfx/end.mp3', racing: { dir: '/music', tracks: 1 } },
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
      ...cycleGameConfig
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: (id) => ({ rpm: rpmByBike[id] ?? 90, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn()
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
function makeFetch() {
  return vi.fn((url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST') return json({});
    if (u.includes('/ladder')) return Promise.resolve({ ok: false, status: 404 });
    if (u.includes('/rival-pool')) return json({ entries: [] });
    return json({ dates: [] });
  });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const BEAT_VARIANTS = ['halfway', 'split', 'last-minute', 'last-stretch'];

describe('CycleGameContainer — race beats', () => {
  let nowMs;
  let seen; // every distinct toast shown, in order: { variant, text, elapsedS }

  beforeEach(() => {
    rpmByBike = {};
    audios = [];
    seen = [];
    vi.stubGlobal('Audio', FakeAudio);
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = makeFetch();
    window.sessionStorage.clear();
    vi.useFakeTimers();
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  const record = (view) => {
    const el = view.queryByTestId('cycle-event-toast');
    if (!el) return;
    const entry = { variant: el.dataset.variant, text: el.textContent, elapsedS: nowMs / 1000 };
    const last = seen[seen.length - 1];
    if (!last || last.variant !== entry.variant || last.text !== entry.text) seen.push(entry);
  };
  const start = async (view, type, tier) => {
    act(() => { fireEvent.click(view.getByTestId(`course-${type}`)); });
    act(() => { fireEvent.click(view.getByTestId(`tier-${tier}`)); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const anyway = view.queryByTestId('sensor-warning-start');
    if (anyway) act(() => { fireEvent.click(anyway); });
    // A lone rider's rival lookup answers on promises.
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    record(view);
  };
  // One race tick per act; `each(elapsedS)` runs after every tick.
  const ticksUntil = (view, elapsedS, each = () => {}) => {
    while (nowMs / 1000 < elapsedS && !view.queryByTestId('race-results')) {
      nowMs += RACE_TICK_MS;
      act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
      record(view);
      each(nowMs / 1000);
    }
  };
  const beatToastsSeen = () => seen.filter((t) => BEAT_VARIANTS.includes(t.variant));
  const clock = (view) => view.getByTestId('race-clock');
  const racingTrack = () => audios.find((a) => String(a.src).startsWith('/music/'));
  const beeps = () => audios.filter((a) => a.src === '/sfx/beep.mp3').length;

  it('a 180 s solo time race: one halfway toast with the gap to the rival, splits, the last minute, the final ten seconds', async () => {
    mockCtx = makeCtx({ cycle_ace: 'user_1' });
    const view = render(<CycleGameContainer />);
    await start(view, 'time', 'short'); // 180 s, against par (nobody has ridden it)
    expect(logsOf('info', 'cycle_game.config')[0].rivalKind).toBe('par');
    const beepsBeforeRace = beeps();

    ticksUntil(view, 119);
    expect(racingTrack().volume).toBeCloseTo(0.5);
    expect(view.getByTestId('cycle-race-screen').classList.contains('is-finale')).toBe(false);
    ticksUntil(view, 120);
    expect(view.getByTestId('cycle-event-toast').dataset.variant).toBe('last-minute');
    expect(view.getByTestId('cycle-event-toast').textContent).toContain('One minute left');
    // The finale: the screen tightens and the music lifts by 15% of master.
    expect(view.getByTestId('cycle-race-screen').classList.contains('is-finale')).toBe(true);
    expect(racingTrack().volume).toBeCloseTo(0.65);
    expect(logsOf('info', 'cycle_game.finale_started')).toHaveLength(1);

    ticksUntil(view, 169);
    expect(clock(view).classList.contains('is-final')).toBe(false);
    expect(beeps()).toBe(beepsBeforeRace);
    const finalClock = [];
    ticksUntil(view, 179, () => { finalClock.push(clock(view).classList.contains('is-final')); });
    expect(finalClock).toEqual(Array(10).fill(true));
    expect(beeps() - beepsBeforeRace).toBe(10); // 0:10 … 0:01
    ticksUntil(view, 185);
    expect(view.getByTestId('race-results')).toBeTruthy();
    // The lift ends with the race: the results track plays at the plain level.
    expect(audios.find((a) => a.src === '/sfx/end.mp3').volume).toBeCloseTo(0.5);

    const halfway = beatToastsSeen().filter((t) => t.variant === 'halfway');
    expect(halfway).toHaveLength(1);
    expect(halfway[0].elapsedS).toBe(90);
    expect(halfway[0].text).toMatch(/Halfway\d+ s ahead of par/);
    expect(beatToastsSeen().map((t) => t.variant)).toEqual(['split', 'halfway', 'last-minute']);
    expect(beatToastsSeen()[0].text).toMatch(/^1:00\d+ s ahead of par$/);

    const beats = logsOf('info', 'cycle_game.beat');
    expect(beats.map((b) => [b.beat, b.elapsedS])).toEqual([
      ['SPLIT', 60], ['HALFWAY', 90], ['LAST_MINUTE', 120], ['FINAL_SECONDS', 170]
    ]);
    expect(beats[1]).toMatchObject({ raceId: expect.stringMatching(/^\d{14}$/), gapS: expect.any(Number), gapM: expect.any(Number) });
    expect(beats[1].gapM).toBeGreaterThan(0);
    // The finale is announced once for the whole race (the last stretch never
    // fires in a time race).
    expect(logsOf('info', 'cycle_game.finale_started')).toEqual([expect.objectContaining({ beat: 'LAST_MINUTE', elapsedS: 120 })]);
  });

  it('a group race has no rival: halfway without a gap, no split toasts, the last minute', () => {
    mockCtx = makeCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
    const view = render(<CycleGameContainer />);
    act(() => { fireEvent.click(view.getByTestId('course-time')); });
    act(() => { fireEvent.click(view.getByTestId('tier-short')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    ticksUntil(view, 185);
    expect(beatToastsSeen().map((t) => [t.variant, t.text])).toEqual([
      ['halfway', 'Halfway'],
      ['last-minute', 'One minute left']
    ]);
    const beats = logsOf('info', 'cycle_game.beat');
    expect(beats.find((b) => b.beat === 'HALFWAY')).toMatchObject({ gapS: null, gapM: null });
  });

  it('beats never fire while every live rider is parked', () => {
    mockCtx = makeCtx({ cycle_ace: 'user_1', tricycle: 'user_2' }, { race_idle_dnf_s: 2 });
    const view = render(<CycleGameContainer />);
    act(() => { fireEvent.click(view.getByTestId('course-time')); });
    act(() => { fireEvent.click(view.getByTestId('tier-flash')); }); // 60 s: halfway at 30 s
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    ticksUntil(view, 20);
    rpmByBike.cycle_ace = 0;
    rpmByBike.tricycle = 0;
    ticksUntil(view, 34); // both parked from ~22 s; the race closes 15 s later
    expect(logsOf('info', 'cycle_game.rider_parked')).toHaveLength(2);
    ticksUntil(view, 60);
    expect(logsOf('info', 'cycle_game.beat')).toEqual([]);
    expect(beatToastsSeen()).toEqual([]);
  });
});
