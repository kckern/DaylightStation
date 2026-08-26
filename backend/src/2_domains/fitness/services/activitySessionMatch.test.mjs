/**
 * activitySessionMatch — guards that decide whether a provider activity may
 * bind to a locally-recorded fitness session.
 *
 * Fixtures below carry the real numbers from the 2026-07-25 incident
 * (activity 19465331355 glued to garage session 20260725132556) and from two
 * legitimate indoor rides, so a regression here is a regression against
 * observed production data rather than an invented scenario.
 */
import { describe, it, expect } from 'vitest';

import {
  classifyActivityVenue,
  participantPresenceSeconds,
  evaluateActivitySessionMatch,
  DEFAULT_MATCH_POLICY,
} from './activitySessionMatch.mjs';

// --- fixture helpers -------------------------------------------------------

/** Build an RLE series string from [value, count] pairs / bare values. */
const rle = (entries) => JSON.stringify(entries);

/** Nulls, then `covered` live ticks at `atTick`, padded to `total`. */
const hrSeries = ({ total, blocks }) => {
  const entries = [];
  let cursor = 0;
  for (const { atTick, ticks, hr } of blocks) {
    const gap = atTick - cursor;
    if (gap > 0) entries.push([null, gap]);
    entries.push([hr, ticks]);
    cursor = atTick + ticks;
  }
  if (total > cursor) entries.push([null, total - cursor]);
  return rle(entries);
};

/**
 * The garage session: 13:25:56 → 16:41:15 (3h15m), three kids on straps,
 * 12 media events. the test user's strap drifts through range three times for a
 * combined 3.5 min — 2.5 min of it inside the run's window.
 */
const garageSession = () => ({
  timezone: 'America/Los_Angeles',
  sessionId: '20260725132556',
  session: {
    id: '20260725132556',
    date: '2026-07-25',
    start: '2026-07-25 13:25:56.135',
    end: '2026-07-25 16:41:15.601',
    duration_seconds: 11719,
  },
  participants: {
    'learner1': { display_name: 'Learner One', hr_device: '10001' },
    'learner2': { display_name: 'learner2', hr_device: '10002' },
    'learner3': { display_name: 'learner3', hr_device: '10003' },
    'test-user': { display_name: 'test-user', hr_device: '10000' },
  },
  summary: {
    media: [
      { contentId: 'plex:665664', title: 'A T-Rex and Tangled Ideas' },
      { contentId: 'plex:665672', title: 'Webcaster Disaster' },
    ],
  },
  timeline: {
    interval_seconds: 5,
    tick_count: 2346,
    encoding: 'rle',
    series: {
      'test-user:hr': hrSeries({
        total: 2346,
        blocks: [
          { atTick: 999, ticks: 4, hr: 73 },   // ~14:49 resting
          { atTick: 1273, ticks: 8, hr: 84 },  // ~15:12 resting
          { atTick: 1770, ticks: 30, hr: 150 }, // ~15:53–15:56 run tail + cooldown
        ],
      }),
    },
  },
});

/** The outdoor run: real GPS fix, 5.27 km, not a trainer. */
const outdoorRun = () => ({
  id: 19465331355,
  type: 'Run',
  start_date: '2026-07-25T22:41:28Z',
  moving_time: 2428,
  elapsed_time: 2555,
  distance: 5268.4,
  trainer: false,
  start_latlng: [47.409796, -122.168995],
});

/** A legitimate garage bike session: the test user on the bike for the whole ride. */
const indoorRideSession = () => ({
  timezone: 'America/Los_Angeles',
  sessionId: '20260704135839',
  session: {
    id: '20260704135839',
    start: '2026-07-04 13:58:39.958',
    end: '2026-07-04 15:00:09.958',
    duration_seconds: 3690,
  },
  participants: {
    'learner4': { hr_device: '10004' },
    'learner3': { hr_device: '10003' },
    'learner2': { hr_device: '10002' },
    'test-user': { hr_device: '10000' },
  },
  summary: { media: [{ contentId: 'plex:1', title: 'Mario Kart Arcade GP 2' }] },
  timeline: {
    interval_seconds: 5,
    tick_count: 739,
    encoding: 'rle',
    series: {
      'test-user:hr': hrSeries({ total: 739, blocks: [{ atTick: 5, ticks: 244, hr: 128 }] }),
    },
  },
});

/** The matching indoor ride: no GPS, trainer-flagged, zero distance. */
const indoorRide = () => ({
  id: 19181501121,
  type: 'Ride',
  start_date: '2026-07-04T20:59:25Z',
  moving_time: 1200,
  elapsed_time: 1200,
  distance: 0,
  trainer: true,
  start_latlng: [],
});

const TZ = 'America/Los_Angeles';

// --- classifyActivityVenue ------------------------------------------------

describe('classifyActivityVenue', () => {
  it('calls an activity with a GPS start fix outdoor', () => {
    expect(classifyActivityVenue(outdoorRun())).toBe('outdoor');
  });

  it('calls a trainer-flagged activity with no distance indoor', () => {
    expect(classifyActivityVenue(indoorRide())).toBe('indoor');
  });

  it('calls real distance without a trainer flag outdoor even with no latlng available', () => {
    // The harvester rebuilds activities from summary entries, which carry
    // distance but never start_latlng — the guard must still fire there.
    expect(classifyActivityVenue({ distance: 5268.4, trainer: false })).toBe('outdoor');
  });

  it('reports unknown when no venue signal is present at all', () => {
    expect(classifyActivityVenue({ id: 1 })).toBe('unknown');
  });
});

// --- participantPresenceSeconds -------------------------------------------

describe('participantPresenceSeconds', () => {
  it('counts only live HR ticks inside the window', () => {
    const session = garageSession();
    // The run's window: 15:41:28 → 16:21:56 local.
    const seconds = participantPresenceSeconds(session, 'test-user', {
      from: new Date('2026-07-25T22:41:28Z'),
      to: new Date('2026-07-25T23:21:56Z'),
      tz: TZ,
    });
    // 30 ticks x 5s of drive-by coverage — the two resting blips fall outside.
    expect(seconds).toBe(150);
  });

  it('returns 0 for a participant with no HR series', () => {
    const seconds = participantPresenceSeconds(garageSession(), 'learner1', {
      from: new Date('2026-07-25T22:41:28Z'),
      to: new Date('2026-07-25T23:21:56Z'),
      tz: TZ,
    });
    expect(seconds).toBe(0);
  });
});

// --- evaluateActivitySessionMatch -----------------------------------------

describe('evaluateActivitySessionMatch', () => {
  const evaluate = (overrides = {}) => evaluateActivitySessionMatch({
    activity: outdoorRun(),
    session: garageSession(),
    username: 'test-user',
    tz: TZ,
    ...overrides,
  });

  it('rejects the outdoor run that was glued to the garage session (2026-07-25)', () => {
    const result = evaluate();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('outdoor_activity_vs_home_session');
  });

  it('rejects a session the athlete is not a participant of', () => {
    const result = evaluate({ activity: indoorRide(), username: 'nobody' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_a_participant');
  });

  it('rejects drive-by presence when the venue check cannot decide', () => {
    // Same contamination shape, but with the venue signal stripped: the
    // presence floor is what has to catch it.
    const activity = { ...outdoorRun(), distance: 0, start_latlng: [], trainer: undefined };
    const result = evaluate({ activity });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('presence_below_floor');
    expect(result.presenceFraction).toBeCloseTo(150 / 2428, 3);
  });

  it('accepts a legitimate indoor garage ride', () => {
    const result = evaluateActivitySessionMatch({
      activity: indoorRide(),
      session: indoorRideSession(),
      username: 'test-user',
      tz: TZ,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(null);
    expect(result.presenceMeasured).toBe(true);
    expect(result.presenceFraction).toBeGreaterThan(0.9);
  });

  it('skips the presence check when there is no HR series to measure', () => {
    // Riding the garage bike with cadence only and no strap leaves no
    // `<user>:hr` series. Absent evidence must not read as absent athlete.
    const session = indoorRideSession();
    delete session.timeline.series['test-user:hr'];
    const result = evaluateActivitySessionMatch({
      activity: indoorRide(),
      session,
      username: 'test-user',
      tz: TZ,
    });
    expect(result.ok).toBe(true);
    expect(result.presenceMeasured).toBe(false);
  });

  it('still lets an outdoor activity bind to its own strava-sourced session', () => {
    // _createStravaOnlySession writes source: 'strava'; those sessions ARE the
    // outdoor activity and must keep matching.
    const session = garageSession();
    session.session.source = 'strava';
    session.strava = { distance: 5268.4 };
    const result = evaluate({ session });
    expect(result.reason).not.toBe('outdoor_activity_vs_home_session');
  });

  it('rejects an activity that barely overlaps the session window', () => {
    const activity = { ...indoorRide(), start_date: '2026-07-04T21:50:00Z' }; // 14:50, mostly past a 20-min ride window
    const session = indoorRideSession();
    session.session.end = '2026-07-04 14:52:00';
    session.session.duration_seconds = 3200;
    const result = evaluateActivitySessionMatch({ activity, session, username: 'test-user', tz: TZ });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('overlap_fraction_below_floor');
  });

  it('exposes a policy that callers can tune', () => {
    expect(DEFAULT_MATCH_POLICY.minPresenceFraction).toBeGreaterThan(0);
    expect(DEFAULT_MATCH_POLICY.minOverlapFraction).toBe(0.5);
  });
});
