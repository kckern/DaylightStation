import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// ── mocks (mirrors CycleGameContainer.checkpoint.test.jsx) ─────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
import { RACE_MENU_GUARD_MS } from "./RaceMenu.jsx";
import { discardRace, endRaceHere } from "./raceMenuTestHelpers.js";
import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";

// "Race my best" is opt-in (2026-11-10): these tests are about the rival, so
// they switch it on first, the way a rider would in the lobby.
const optInRival = (v) => {
  const sw = v.queryByTestId('race-my-best');
  if (sw && sw.getAttribute('aria-checked') !== 'true') act(() => { fireEvent.click(sw); });
};

const CHECKPOINT_KEY = 'cycleGame.checkpoint';
const RACE_TICK_MS = 1000;
const GO_HOLD_MS = 800;
const START_COUNTDOWN_S = 3;
const ENDED_EARLY_LINE = 'Ended early: saved to history, not counted for records or the ladder.';

// Per-bike cadence the tests can change mid-race.
let rpmByBike;

function makeCtx(cycleGameConfig = {}) {
  const riders = { cycle_ace: 'user_1', tricycle: 'user_2' };
  const vitals = {
    user_1: { name: 'User_1', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    user_2: { name: 'User_2', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' }
  };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1, eligible_users: ['user_1'] },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 }
    ],
    configuredUsers: [
      { id: 'user_1', name: 'User_1' },
      { id: 'user_2', name: 'User_2' }
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
      staging_buffer_ms: 0, // straight to countdown unless a test asks for staging
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
      ...cycleGameConfig
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: (id) => ({ rpm: rpmByBike[id] ?? 100, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn()
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

// Answers the lobby's mount-time reads and the save POST. `ladder` is the
// /ladder body (default 404: no featured course); `ladderAfter` replaces it
// once a race has been saved; `byId` answers single-race reads.
function makeFetch({ ladder = null, ladderAfter = null, byId = {} } = {}) {
  let saved = false;
  return vi.fn((url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST') { saved = true; return json({}); }
    if (u.includes('/ladder')) {
      const body = saved && ladderAfter ? ladderAfter : ladder;
      return body ? json(body) : Promise.resolve({ ok: false, status: 404 });
    }
    if (u.includes('/personal-bests')) return json({ best: null });
    if (u.includes('/rival-pool')) return json({ entries: [] });
    const one = u.match(/\/cycle-races\/(\d+)$/);
    if (one) return byId[one[1]] ? json({ race: byId[one[1]] }) : Promise.resolve({ ok: false, status: 404 });
    return json({ dates: [] });
  });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const savePosts = () => global.fetch.mock.calls
  .filter(([, opts]) => opts && opts.method === 'POST')
  .map(([, opts]) => JSON.parse(opts.body).record);
const ladderCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/ladder'));

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

describe('CycleGameContainer — the race menu is the one way to stop a race', () => {
  let nowMs;

  beforeEach(() => {
    rpmByBike = {};
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

  const startDistanceRace = (view, { tier = null } = {}) => {
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    if (tier) act(() => { fireEvent.click(view.getByTestId(`tier-${tier}`)); });
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
  };
  // Countdown to the green light (the `go` hold).
  const toGo = () => { act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); }); };
  // Through the green-light hold onto the race screen, then `seconds` race ticks.
  const toRacing = (seconds = 5) => {
    toGo();
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = seconds * 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
  };
  // Race on, one wall-clock second at a time, until the results board is up.
  // (One act per second: the board only renders, and the tick interval only
  // stops, when an act closes.)
  const raceToResults = async (view, maxSeconds = 60) => {
    for (let i = 0; i < maxSeconds && !view.queryByTestId('race-results'); i += 1) {
      nowMs += RACE_TICK_MS;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await vi.advanceTimersByTimeAsync(RACE_TICK_MS); });
    }
  };

  describe('racing', () => {
    it('shows one race menu button and neither of the old Finish / Cancel buttons', () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      toRacing();
      expect(view.getByTestId('cycle-race-screen')).toBeTruthy();
      const open = view.getByTestId('race-menu-open');
      // A direct child of the container root: the button pins to its corner.
      expect(open.parentElement).toBe(view.getByTestId('cycle-game-container'));
      expect(view.container.querySelector('.cycle-game-container__finish')).toBeNull();
      expect(view.container.querySelector('.cycle-game-container__cancel')).toBeNull();
    });

    it('End race here: results, the ride saved as incomplete, ended_early logged', async () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      toRacing();
      endRaceHere(view);
      await flush();
      expect(view.getByTestId('race-results')).toBeTruthy();
      const posts = savePosts();
      expect(posts).toHaveLength(1);
      expect(posts[0].race.incomplete).toBe(true);
      expect(posts[0].participants.user_1.final_distance_m).toBeGreaterThan(0);
      // Both riders were still pedalling: nobody is marked stopped.
      expect(posts[0].participants.user_1.stopped).toBeUndefined();
      expect(posts[0].participants.user_2.stopped).toBeUndefined();
      expect(logsOf('info', 'cycle_game.ended_early')).toEqual([
        expect.objectContaining({ raceId: posts[0].race.id, elapsedS: 5, control: 'race-menu.end' })
      ]);
      expect(logsOf('info', 'cycle_game.finish_forced')).toEqual([]);
    });

    it('no single tap ends the race: a tap on End before the guard time does nothing', async () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      toRacing();
      // Opening the menu is not an ending.
      act(() => { fireEvent.click(view.getByTestId('race-menu-open')); });
      expect(view.getByTestId('cycle-race-screen')).toBeTruthy();
      // The second tap of a double-tap lands on the item that just appeared.
      act(() => { vi.advanceTimersByTime(RACE_MENU_GUARD_MS - 1); });
      act(() => { fireEvent.click(view.getByTestId('race-menu-end')); });
      act(() => { fireEvent.click(view.getByTestId('race-menu-discard')); });
      await flush();
      expect(view.getByTestId('cycle-race-screen')).toBeTruthy();
      expect(view.queryByTestId('race-results')).toBeNull();
      expect(logsOf('info', 'cycle_game.ended_early')).toEqual([]);
      expect(logsOf('info', 'cycle_game.cancelled')).toEqual([]);
      expect(savePosts()).toEqual([]);
      // Once the guard has run out the same item does end it.
      act(() => { vi.advanceTimersByTime(1); });
      act(() => { fireEvent.click(view.getByTestId('race-menu-end')); });
      expect(view.getByTestId('race-results')).toBeTruthy();
    });

    it('Discard race: back to the lobby, nothing saved, and a new Start works', async () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      toRacing();
      discardRace(view);
      await flush();
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
      expect(savePosts()).toEqual([]);
      expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
      expect(logsOf('info', 'cycle_game.cancelled')).toEqual([
        expect.objectContaining({ fromPhase: 'racing', control: 'race-menu.discard' })
      ]);
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      expect(logsOf('info', 'cycle_game.staged')).toHaveLength(2);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    });
  });

  describe('before the race', () => {
    it('staging: the sheet has no End item, and Discard returns to the lobby', () => {
      mockCtx = makeCtx({ staging_buffer_ms: 5000 });
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      expect(view.getByTestId('cycle-game-staging')).toBeTruthy();
      const open = view.getByTestId('race-menu-open');
      expect(open.parentElement).toBe(view.getByTestId('cycle-game-container'));
      act(() => { fireEvent.click(open); });
      expect(view.getByTestId('race-menu-sheet')).toBeTruthy();
      expect(view.queryByTestId('race-menu-end')).toBeNull();
      act(() => { vi.advanceTimersByTime(RACE_MENU_GUARD_MS); });
      act(() => { fireEvent.click(view.getByTestId('race-menu-discard')); });
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
      expect(logsOf('info', 'cycle_game.cancelled')).toEqual([
        expect.objectContaining({ fromPhase: 'staging', control: 'race-menu.discard' })
      ]);
      expect(savePosts()).toEqual([]);
    });

    it('countdown: the sheet has no End item, and Discard returns to the lobby', () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
      const open = view.getByTestId('race-menu-open');
      expect(open.parentElement).toBe(view.getByTestId('cycle-game-container'));
      act(() => { fireEvent.click(open); });
      expect(view.queryByTestId('race-menu-end')).toBeNull();
      act(() => { vi.advanceTimersByTime(RACE_MENU_GUARD_MS); });
      act(() => { fireEvent.click(view.getByTestId('race-menu-discard')); });
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
      expect(logsOf('info', 'cycle_game.cancelled')).toEqual([
        expect.objectContaining({ fromPhase: 'countdown', control: 'race-menu.discard' })
      ]);
      expect(savePosts()).toEqual([]);
    });
  });

  describe('where there is no race menu', () => {
    it('none in the lobby', () => {
      const view = render(<CycleGameContainer />);
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
      expect(view.queryByTestId('race-menu-open')).toBeNull();
    });

    it('none during the green-light hold', () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      expect(view.getByTestId('race-menu-open')).toBeTruthy(); // countdown: there
      toGo();
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy(); // still the stoplight, now green
      expect(view.queryByTestId('cycle-race-screen')).toBeNull();
      expect(view.queryByTestId('race-menu-open')).toBeNull();
    });

    it('none on the results board', async () => {
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      toRacing();
      endRaceHere(view);
      await flush();
      expect(view.getByTestId('race-results')).toBeTruthy();
      expect(view.queryByTestId('race-menu-open')).toBeNull();
    });
  });

  describe('what is saved', () => {
    it('a normal finish is saved without `incomplete`, with `stopped` on a rider parked at the close', async () => {
      // user_2 pedals for two seconds and then stops for good: parked after 3 idle
      // seconds. user_1 rides the 100 m out, which closes the race around user_2.
      mockCtx = makeCtx({ race_idle_dnf_s: 3 });
      const view = render(<CycleGameContainer />);
      startDistanceRace(view, { tier: 'flash' });
      toRacing(2);
      rpmByBike.tricycle = 0;
      await raceToResults(view);
      expect(view.getByTestId('race-results')).toBeTruthy();
      const posts = savePosts();
      expect(posts).toHaveLength(1);
      expect(posts[0].race).not.toHaveProperty('incomplete');
      expect(posts[0].participants.user_1.final_time_s).toBeGreaterThan(0);
      expect(posts[0].participants.user_1.stopped).toBeUndefined();
      expect(posts[0].participants.user_2.final_time_s).toBeNull();
      expect(posts[0].participants.user_2.stopped).toBe(true);
      expect(logsOf('info', 'cycle_game.ended_early')).toEqual([]);
      // No ended-early line on the board of a race that ran to its end.
      expect(view.queryByText(ENDED_EARLY_LINE)).toBeNull();
    });

    it('End race here marks a rider who was parked at that moment as stopped', async () => {
      mockCtx = makeCtx({ race_idle_dnf_s: 3 });
      const view = render(<CycleGameContainer />);
      startDistanceRace(view);
      toRacing(2);
      rpmByBike.tricycle = 0;
      nowMs = 8000;
      act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
      endRaceHere(view);
      await flush();
      const [record] = savePosts();
      expect(record.race.incomplete).toBe(true);
      expect(record.participants.user_2.stopped).toBe(true);
      expect(record.participants.user_1.stopped).toBeUndefined();
    });

    describe('pagehide beacon', () => {
      let beacons;
      beforeEach(() => {
        beacons = [];
        // jsdom has no sendBeacon; the Blob is read back through its parts.
        const RealBlob = global.Blob;
        vi.stubGlobal('Blob', class extends RealBlob {
          constructor(parts, opts) { super(parts, opts); this.parts = parts; }
        });
        navigator.sendBeacon = vi.fn((url, blob) => { beacons.push({ url, body: JSON.parse(blob.parts.join('')) }); return true; });
      });
      afterEach(() => {
        delete navigator.sendBeacon;
        vi.unstubAllGlobals();
      });

      it('mid-race sends the ride as incomplete, with its stopped riders', () => {
        mockCtx = makeCtx({ race_idle_dnf_s: 3 });
        const view = render(<CycleGameContainer />);
        startDistanceRace(view);
        toRacing(2);
        rpmByBike.tricycle = 0;
        nowMs = 8000;
        act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
        act(() => { window.dispatchEvent(new Event('pagehide')); });
        expect(beacons).toHaveLength(1);
        expect(beacons[0].url).toBe('/api/v1/fitness/cycle-races');
        expect(beacons[0].body.record.race.incomplete).toBe(true);
        expect(beacons[0].body.record.participants.user_2.stopped).toBe(true);
        expect(beacons[0].body.record.participants.user_1.stopped).toBeUndefined();
      });
    });

    describe('checkpoint', () => {
      const checkpoint = () => JSON.parse(window.sessionStorage.getItem(CHECKPOINT_KEY));

      it('the mid-race checkpoint carries who is stopped and that the race is still running', () => {
        mockCtx = makeCtx({ race_idle_dnf_s: 3 });
        const view = render(<CycleGameContainer />);
        startDistanceRace(view);
        toRacing(2);
        rpmByBike.tricycle = 0;
        nowMs = 10000;
        act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
        expect(checkpoint().raceState).toEqual({ parked: ['user_2'], noSensor: [], endedEarly: false, finished: false });
      });

      it('End race here leaves a checkpoint that says so until the save lands', () => {
        const view = render(<CycleGameContainer />);
        startDistanceRace(view);
        toRacing();
        endRaceHere(view);
        // Read before the save POST has resolved (it clears the checkpoint).
        expect(checkpoint().raceState).toMatchObject({ endedEarly: true, finished: true });
        expect(checkpoint().engineState.elapsedS).toBe(5);
      });

      it('a race that finishes on its own leaves a finished, not-ended-early checkpoint if its save fails', async () => {
        const base = makeFetch();
        global.fetch = vi.fn((url, opts) => (opts && opts.method === 'POST'
          ? Promise.resolve({ ok: false, status: 503 })
          : base(url, opts)));
        const view = render(<CycleGameContainer />);
        rpmByBike.tricycle = 110; // the slower bike: home on a tick the periodic checkpoint skips
        startDistanceRace(view, { tier: 'flash' });
        toRacing(2);
        await raceToResults(view);
        expect(view.getByTestId('race-results')).toBeTruthy();
        // Let the save's retries (1 s, 3 s backoff) run out.
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(logsOf('info', 'cycle_game.race_saved')).toEqual([expect.objectContaining({ ok: false })]);
        const cp = checkpoint();
        // The periodic checkpoint lands every 5th tick; this race ended between two.
        expect(cp.engineState.elapsedS % 5).not.toBe(0);
        expect(cp.raceState).toMatchObject({ endedEarly: false, finished: true });
        // The final state, not the last periodic snapshot: both riders are home.
        expect(Object.values(cp.engineState.riders).every((r) => r.finishTimeS != null)).toBe(true);
      });
    });
  });

  describe('results board of a featured-course ride', () => {
    const COURSE = { id: 'course-100', win_condition: 'distance', goal_m: 100 };
    const RIVAL_RACE = '20251201100000';
    const rivalRecord = {
      version: 1,
      race: { id: RIVAL_RACE, win_condition: 'distance', goal_m: 100, interval_seconds: 1 },
      participants: {
        user_2: {
          display_name: 'user_2', final_distance_m: 100, final_time_s: 40, placement: 1,
          distance_series: SessionSerializerV3.encodeSeries(Array.from({ length: 40 }, (_, i) => (i + 1) * 2.5))
        }
      }
    };
    const ladder = { course: COURSE, standings: [{ userId: 'user_2', raceId: RIVAL_RACE, bestValue: 40 }] };
    const ladderAfter = {
      course: COURSE,
      standings: [{ userId: 'user_1', raceId: 'x', bestValue: 15 }, { userId: 'user_2', raceId: RIVAL_RACE, bestValue: 40 }]
    };

    const rideFeatured = async () => {
      // One live rider (user_1) against the ladder rival's recording.
      const ctx = makeCtx();
      ctx.fitnessSessionInstance.getEquipmentRider = (id) => (id === 'cycle_ace' ? 'user_1' : null);
      mockCtx = ctx;
      global.fetch = makeFetch({ ladder, ladderAfter, byId: { [RIVAL_RACE]: rivalRecord } });
      const view = render(<CycleGameContainer />);
      await flush();
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      expect(logsOf('info', 'cycle_game.ride_featured')).toEqual([expect.objectContaining({ courseId: COURSE.id, ghostArmed: true })]);
      return view;
    };

    it('a normal finish gets its ladder callout and no ended-early line', async () => {
      const view = await rideFeatured();
      toRacing(2);
      await raceToResults(view);
      await flush();
      const [record] = savePosts();
      expect(record.race).not.toHaveProperty('incomplete');
      expect(record.race.course_id).toBe(COURSE.id);
      expect(logsOf('info', 'cycle_game.ladder_movement')).toEqual([expect.objectContaining({ notes: 1 })]);
      expect(view.getByTestId('race-results-ladder').textContent).toContain('Ladder lead this week!');
      expect(view.queryByText(ENDED_EARLY_LINE)).toBeNull();
    });

    it('an ended-early ride gets no ladder callout, and one plain line instead', async () => {
      const view = await rideFeatured();
      toRacing(5);
      const ladderCallsBefore = ladderCalls().length;
      endRaceHere(view);
      await flush();
      const [record] = savePosts();
      expect(record.race.incomplete).toBe(true);
      expect(record.race.course_id).toBe(COURSE.id);
      expect(logsOf('info', 'cycle_game.race_saved')).toEqual([expect.objectContaining({ ok: true })]);
      // The ladder is not asked again, and nothing about it is said.
      expect(ladderCalls()).toHaveLength(ladderCallsBefore);
      expect(logsOf('info', 'cycle_game.ladder_movement')).toEqual([]);
      const notes = view.getByTestId('race-results-ladder');
      expect(notes.textContent).toBe(ENDED_EARLY_LINE);
      expect(notes.textContent).not.toContain('this week');
    });

    it('an ended-early ride whose save failed does not claim to be saved', async () => {
      const view = await rideFeatured();
      toRacing(5);
      const base = global.fetch;
      global.fetch = vi.fn((url, opts) => (opts && opts.method === 'POST'
        ? Promise.resolve({ ok: false, status: 503 })
        : base(url, opts)));
      endRaceHere(view);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(logsOf('info', 'cycle_game.race_saved')).toEqual([expect.objectContaining({ ok: false })]);
      expect(view.queryByText(ENDED_EARLY_LINE)).toBeNull();
    });
  });
});
