import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// Results that reward and restart: the board holds for 45 s (a touch keeps it
// up), compares each live rider's ride with their history at this exact type
// and length, names the solo rival, offers a Rematch, and has one way out.
//
// ── mocks (mirrors CycleGameContainer.raceMenu.test.jsx) ──────────────────
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
import { endRaceHere } from "./raceMenuTestHelpers.js";
import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";

// "Race my best" is opt-in (2026-11-10): these tests are about the rival, so
// they switch it on first, the way a rider would in the lobby.
const optInRival = (v) => {
  const sw = v.queryByTestId('race-my-best');
  if (sw && sw.getAttribute('aria-checked') !== 'true') act(() => { fireEvent.click(sw); });
};

const RACE_TICK_MS = 1000;
const GO_HOLD_MS = 800;
const START_COUNTDOWN_S = 3;

let rpmByBike;
let claims;

function makeCtx(cycleGameConfig = {}) {
  const vitals = {
    user_1: { name: 'User_1', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    user_2: { name: 'User_2', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' }
  };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1 },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 2.1 }
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
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
      ...cycleGameConfig
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => claims[id] || null,
      setEquipmentRider: (id, userId) => { claims[id] = userId; },
      getEquipmentCadence: (id) => ({ rpm: rpmByBike[id] ?? 100, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn()
  };
}

// A saved race at one type and length. `riders`: userId → { timeS } (distance
// race) or { distanceM } (time race); `stopped` marks a rider stopped at the close.
function raceRecord(id, riders, { winCondition = 'distance', goalM = 100, timeCapS = 60 } = {}) {
  const time = winCondition === 'time';
  return {
    version: 1,
    race: {
      id, win_condition: winCondition, interval_seconds: 1,
      ...(time ? { time_cap_s: timeCapS } : { goal_m: goalM })
    },
    participants: Object.fromEntries(Object.entries(riders).map(([userId, p], i) => {
      const n = time ? timeCapS : p.timeS;
      const total = time ? p.distanceM : goalM;
      return [userId, {
        display_name: userId,
        final_distance_m: total,
        final_time_s: time ? timeCapS : p.timeS,
        placement: i + 1,
        ...(p.stopped ? { stopped: true } : {}),
        distance_series: SessionSerializerV3.encodeSeries(Array.from({ length: n }, (_, k) => ((k + 1) * total) / n))
      }];
    }))
  };
}
// The server's rival-pool entry for a saved record (a light index row).
function poolEntry(rec) {
  const { race } = rec;
  return {
    raceId: race.id,
    winCondition: race.win_condition,
    ...(race.win_condition === 'time' ? { timeCapS: race.time_cap_s } : { goalM: race.goal_m }),
    participants: Object.entries(rec.participants).map(([id, pt]) => ({
      id, isGhost: false, stopped: !!pt.stopped,
      finalTimeS: pt.final_time_s ?? null, finalDistanceM: pt.final_distance_m, placement: pt.placement
    }))
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
// races: the lobby's loaded history; pool: rival-pool rows; ladder / ladderAfter
// (after the first save; `null` = 404); byId: single-record reads.
function makeFetch({ races = [], pool = [], ladder = null, ladderAfter, byId = {} } = {}) {
  let saved = false;
  return vi.fn((url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST') { saved = true; return json({}); }
    if (u.includes('/ladder')) {
      const body = saved && ladderAfter !== undefined ? ladderAfter : ladder;
      return body ? json(body) : Promise.resolve({ ok: false, status: 404 });
    }
    if (u.includes('/personal-bests')) return json({ best: null });
    if (u.includes('/rival-pool')) return json({ entries: pool });
    if (u.includes('?date=')) return json({ races });
    const one = u.match(/\/cycle-races\/(\d+)$/);
    if (one) return byId[one[1]] ? json({ race: byId[one[1]] }) : Promise.resolve({ ok: false, status: 404 });
    return json({ dates: races.length ? ['2026-01-01'] : [] });
  });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const configLogs = () => logsOf('info', 'cycle_game.config');
const savePosts = () => global.fetch.mock.calls
  .filter(([, opts]) => opts && opts.method === 'POST')
  .map(([, opts]) => JSON.parse(opts.body).record);
const ghostIds = (cfg) => cfg.riders.filter((r) => r.isGhost).map((r) => r.userId);

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

describe('CycleGameContainer — results that reward and restart', () => {
  let nowMs;

  beforeEach(() => {
    rpmByBike = {};
    claims = { cycle_ace: 'user_1' };
    mockCtx = makeCtx();
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
    window.sessionStorage.clear();
  });

  const renderLobby = async (fetchOpts) => {
    global.fetch = makeFetch(fetchOpts);
    const view = render(<CycleGameContainer />);
    await flush();
    return view;
  };
  const pickRace = (view, type = 'distance', tier = 'flash') => {
    act(() => { fireEvent.click(view.getByTestId(`course-${type}`)); });
    act(() => { fireEvent.click(view.getByTestId(`tier-${tier}`)); });
  };
  const pressStart = async (view) => {
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    await flush(); // a lone rider's rival lookup
  };
  // Countdown, the green-light hold, then one race tick per act until the
  // results board is up.
  const raceToResults = async (view, maxSeconds = 90) => {
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    for (let i = 0; i < maxSeconds && !view.queryByTestId('race-results'); i += 1) {
      nowMs += RACE_TICK_MS;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await vi.advanceTimersByTimeAsync(RACE_TICK_MS); });
    }
    expect(view.getByTestId('race-results')).toBeTruthy();
    await flush(); // the save
  };
  const compare = (view, userId) => view.queryByTestId(`result-compare-${userId}`)?.textContent ?? null;

  describe('the board holds, and a touch keeps it up', () => {
    it('counts down from 45 s by default and returns to the lobby at 0', async () => {
      const view = await renderLobby();
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      expect(view.getByTestId('race-results-countdown').textContent).toBe('Back to lobby in 45');
      act(() => { vi.advanceTimersByTime(44000); });
      expect(view.getByTestId('race-results')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(view.queryByTestId('race-results')).toBeNull();
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
    });

    it('results_dwell_s still overrides the default', async () => {
      mockCtx = makeCtx({ results_dwell_s: 10 });
      const view = await renderLobby();
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      expect(view.getByTestId('race-results-countdown').textContent).toBe('Back to lobby in 10');
    });

    it('the first touch on the board stops the countdown for this board, once', async () => {
      const view = await renderLobby();
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      act(() => { vi.advanceTimersByTime(3000); });
      act(() => { fireEvent.pointerDown(view.getByTestId('race-results')); });
      expect(view.queryByTestId('race-results-countdown')).toBeNull();
      act(() => { vi.advanceTimersByTime(120000); });
      expect(view.getByTestId('race-results')).toBeTruthy();
      act(() => { fireEvent.keyDown(view.getByTestId('race-results'), { key: 'a' }); });
      expect(logsOf('info', 'cycle_game.results_held')).toEqual([
        expect.objectContaining({ raceId: expect.stringMatching(/^\d{14}$/), secondsLeft: 42 })
      ]);
      // Exit still leaves at once.
      act(() => { fireEvent.click(view.getByTestId('race-results-exit')); });
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
    });

    it('the board has one way out: its own Exit, no second Back-to-home button', async () => {
      const view = await renderLobby();
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      expect(view.getByTestId('race-results-exit')).toBeTruthy();
      expect(view.queryByTestId('cycle-game-start')).toBeNull();
      expect(view.queryByText('Back to home')).toBeNull();
    });
  });

  describe('comparisons with the rider\'s own history at this type and length', () => {
    it('a new best: faster than every earlier ride, against "your best"', async () => {
      const view = await renderLobby({
        races: [
          raceRecord('20260101100000', { user_1: { timeS: 30 } }),
          raceRecord('20260101110000', { user_1: { timeS: 40 } }), // the most recent
          raceRecord('20260101120000', { user_1: { timeS: 5 } }, { goalM: 300 }) // another length: ignored
        ]
      });
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      const finish = savePosts()[0].participants.user_1.final_time_s;
      expect(finish).toBeLessThan(30);
      expect(compare(view, 'user_1')).toBe(`New best${Math.round(30 - finish)} s faster`);
      expect(view.getByTestId('race-results-versus').textContent).toMatch(/^You beat your best by \d+ (s|m)$/);
    });

    it('the first ride at this length says so, against par pace', async () => {
      const view = await renderLobby({ races: [raceRecord('20260101100000', { user_1: { timeS: 30 } }, { goalM: 300 })] });
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      expect(compare(view, 'user_1')).toBe('First ride at this length');
      expect(view.getByTestId('race-results-versus').textContent).toMatch(/par pace/);
    });

    it('off the best, compared with the last ride: from the server pool the lookup already fetched', async () => {
      // The best (10 s) is older than the loaded history: only the server pool has it.
      const old = raceRecord('20250101100000', { user_1: { timeS: 10 } });
      const earlier = raceRecord('20260101090000', { user_1: { timeS: 50 } });
      const recent = raceRecord('20260101100000', { user_1: { timeS: 40 } }); // the last ride
      const view = await renderLobby({
        races: [earlier, recent],
        pool: [poolEntry(old), poolEntry(earlier), poolEntry(recent)],
        byId: { [old.race.id]: old }
      });
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      const finish = savePosts()[0].participants.user_1.final_time_s;
      expect(compare(view, 'user_1')).toBe(
        `${Math.round(finish - 10)} s off your best${Math.round(40 - finish)} s faster than last time`
      );
      // The pool was asked once, at Start: the board fetched nothing more.
      expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/rival-pool'))).toHaveLength(1);
    });

    it('a group race compares each live rider from the loaded history, and not a rider stopped at the close', async () => {
      claims = { cycle_ace: 'user_1', tricycle: 'user_2' };
      mockCtx = makeCtx({ race_idle_dnf_s: 3 });
      const view = await renderLobby({
        races: [raceRecord('20260101100000', { user_1: { distanceM: 100 }, user_2: { distanceM: 100 } }, { winCondition: 'time' })]
      });
      pickRace(view, 'time', 'flash'); // 60 s
      await pressStart(view);
      // user_2 stops for good near the end: stopped at the close.
      act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
      act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
      for (let i = 0; i < 50; i += 1) {
        nowMs += RACE_TICK_MS;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await vi.advanceTimersByTimeAsync(RACE_TICK_MS); });
      }
      rpmByBike.tricycle = 0;
      await raceToResults(view);
      expect(view.getByTestId('result-row-user_2').textContent).toMatch(/Stopped at/);
      expect(compare(view, 'user_1')).toMatch(/^New best\d+ m further$/);
      expect(compare(view, 'user_2')).toBeNull();
      expect(view.queryByTestId('race-results-versus')).toBeNull(); // no rival in a group race
    });

    it('an ended-early ride is compared with nothing', async () => {
      // A time race, so the cut-short ride still has a distance to compare.
      const view = await renderLobby({ races: [raceRecord('20260101100000', { user_1: { distanceM: 10 } }, { winCondition: 'time' })] });
      pickRace(view, 'time', 'flash');
      await pressStart(view);
      act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
      act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
      for (let i = 0; i < 5; i += 1) {
        nowMs += RACE_TICK_MS;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await vi.advanceTimersByTimeAsync(RACE_TICK_MS); });
      }
      endRaceHere(view);
      await flush();
      expect(view.getByTestId('race-results')).toBeTruthy();
      expect(view.container.querySelectorAll('[data-testid^="result-compare-"]')).toHaveLength(0);
    });
  });

  describe('Rematch', () => {
    it('starts the same race again with the same riders, a fresh raceId and a fresh automatic rival', async () => {
      const view = await renderLobby({ races: [raceRecord('20260101100000', { user_1: { timeS: 30 } })] });
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      const [first] = configLogs();
      act(() => { fireEvent.click(view.getByTestId('race-results-rematch')); });
      await flush();
      const configs = configLogs();
      expect(configs).toHaveLength(2);
      const second = configs[1];
      expect(second).toMatchObject({ winCondition: 'distance', goalM: 100, timeCapS: null });
      expect(second.riders.filter((r) => !r.isGhost).map((r) => r.userId)).toEqual(['user_1']);
      expect(second.raceId).not.toBe(first.raceId);
      expect(second.rivalKind).toBe('self'); // re-picked, not carried over
      expect(logsOf('info', 'cycle_game.pace_rival')).toHaveLength(2);
      expect(logsOf('info', 'cycle_game.rematch')).toEqual([{
        fromRaceId: first.raceId, winCondition: 'distance', goalM: 100, timeCapS: null, hasGhost: false
      }]);
      expect(view.queryByTestId('race-results')).toBeNull();
    });

    it('a hand-picked ghost races again', async () => {
      const ghostRace = raceRecord('20260101100000', { user_2: { timeS: 30 } });
      const view = await renderLobby({ races: [ghostRace] });
      act(() => { fireEvent.click(view.getByTestId('course-ghost')); });
      act(() => { fireEvent.click(view.getByTestId(`ghost-${ghostRace.race.id}`)); });
      act(() => { fireEvent.click(view.getByTestId(`ghost-${ghostRace.race.id}`)); });
      await pressStart(view);
      await raceToResults(view);
      expect(view.getByTestId('race-results-versus').textContent).toMatch(/user_2/);
      act(() => { fireEvent.click(view.getByTestId('race-results-rematch')); });
      await flush();
      const configs = configLogs();
      expect(configs).toHaveLength(2);
      expect(ghostIds(configs[1])).toEqual([`ghost:${ghostRace.race.id}:user_2`]);
      expect(configs[1].rivalKind).toBe('ghost');
      expect(logsOf('info', 'cycle_game.rematch')).toEqual([expect.objectContaining({ hasGhost: true })]);
    });

    describe('after a featured-course ride', () => {
      const COURSE = { id: 'course-100', win_condition: 'distance', goal_m: 100 };
      const RIVAL_RACE = '20251201100000';
      const rivalRecord = raceRecord(RIVAL_RACE, { user_2: { timeS: 40 } });
      const ladder = { course: COURSE, standings: [{ userId: 'user_2', raceId: RIVAL_RACE, bestValue: 40 }] };

      const rideFeatured = async (ladderAfter) => {
        const view = await renderLobby({ ladder, ladderAfter, byId: { [RIVAL_RACE]: rivalRecord } });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
        await flush();
        expect(logsOf('info', 'cycle_game.ride_featured')).toHaveLength(1);
        await raceToResults(view);
        await flush();
        return view;
      };

      it('rides the same course again, against the same ladder rival', async () => {
        const view = await rideFeatured(ladder);
        act(() => { fireEvent.click(view.getByTestId('race-results-rematch')); });
        await flush();
        const configs = configLogs();
        expect(configs).toHaveLength(2);
        expect(ghostIds(configs[1])).toEqual([`ghost:${RIVAL_RACE}:user_2`]);
        expect(logsOf('info', 'cycle_game.rematch')).toEqual([expect.objectContaining({ hasGhost: true, goalM: 100 })]);
        await raceToResults(view);
        const posts = savePosts();
        expect(posts).toHaveLength(2);
        expect(posts[1].race.course_id).toBe(COURSE.id);
      });

      it('offers no Rematch when the course can no longer be found', async () => {
        const view = await rideFeatured(null); // the ladder is gone after the ride
        expect(view.getByTestId('race-results')).toBeTruthy();
        expect(view.queryByTestId('race-results-rematch')).toBeNull();
        expect(view.getByTestId('race-results-exit')).toBeTruthy();
      });
    });

    it('offers no Rematch when nobody is on a bike any more', async () => {
      const view = await renderLobby();
      pickRace(view);
      await pressStart(view);
      await raceToResults(view);
      expect(view.getByTestId('race-results-rematch')).toBeTruthy();
      claims = {};
      act(() => { vi.advanceTimersByTime(1000); }); // the countdown re-renders the board
      expect(view.queryByTestId('race-results-rematch')).toBeNull();
    });
  });
});
