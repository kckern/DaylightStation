/**
 * Selection tests against REAL captured search metadata (2026-07-17).
 *
 * The fixtures are the evidence this design was derived from. The central
 * assertion is the night-vs-evening inversion: a naive duration ranking puts an
 * 86-minute 01:37 session (rain / insects at the floodlight) above a 28-minute
 * 18:01 session of actual yard activity. The density gate is what fixes that,
 * and if it ever regresses the archive silently fills with night noise.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { toClip, sessionize, labelSessions, scoreSession, selectSessions } from './selection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  const raw = JSON.parse(readFileSync(path.join(HERE, 'fixtures', name), 'utf8'));
  return raw[0].value.SearchResult.File ?? [];
}

const SCORING = {
  triggerWeights: { person: 3.0, visitor: 3.0, pet: 3.0, vehicle: 1.0, motion: 0.6 },
  densityFloorMBPerMin: 2.0,
  densityPenalty: 0.1,
};

const driveway = () => loadFixture('search-driveway-2026-07-17.json').map((r) => toClip(r));

function sessionStartingAt(sessions, hour, minute) {
  return sessions.find((s) => s.start.getHours() === hour && s.start.getMinutes() === minute);
}

describe('toClip', () => {
  it('derives density from size and duration', () => {
    const clip = toClip({
      StartTime: { year: 2026, mon: 7, day: 17, hour: 18, min: 0, sec: 0 },
      EndTime: { year: 2026, mon: 7, day: 17, hour: 18, min: 1, sec: 0 },
      size: '3000000',
      name: 'x.mp4',
    });
    expect(clip.durationSec).toBe(60);
    expect(clip.densityMBPerMin).toBeCloseTo(3.0, 2);
  });

  it('tolerates NVR records, which carry no name', () => {
    const clip = toClip({
      StartTime: { year: 2026, mon: 7, day: 17, hour: 0, min: 0, sec: 0 },
      EndTime: { year: 2026, mon: 7, day: 17, hour: 1, min: 0, sec: 0 },
      size: '47710208',
    });
    expect(clip.name).toBeNull();
  });
});

describe('sessionize', () => {
  it('clusters the real day into far fewer sessions than clips', () => {
    const clips = driveway();
    expect(clips.length).toBe(573);
    const sessions = sessionize(clips, { maxGapSeconds: 120 });
    expect(sessions.length).toBe(100);
  });

  it('splits when the gap exceeds the threshold and merges when it does not', () => {
    const mk = (h, m, dur = 30) =>
      toClip({
        StartTime: { year: 2026, mon: 7, day: 17, hour: h, min: m, sec: 0 },
        EndTime: { year: 2026, mon: 7, day: 17, hour: h, min: m, sec: dur },
        size: '1000000',
      });
    expect(sessionize([mk(10, 0), mk(10, 1)], { maxGapSeconds: 120 })).toHaveLength(1);
    expect(sessionize([mk(10, 0), mk(10, 5)], { maxGapSeconds: 120 })).toHaveLength(2);
  });
});

describe('scoring — the night/evening inversion', () => {
  const sessions = sessionize(driveway(), { maxGapSeconds: 120 });

  it('ranks the 86-minute night session BELOW the 28-minute evening one', () => {
    const night = sessionStartingAt(sessions, 1, 24);
    const evening = sessionStartingAt(sessions, 17, 58);
    expect(night).toBeDefined();
    expect(evening).toBeDefined();

    // Duration alone would invert this — the night session is nearly 3x longer.
    expect(night.durationSec).toBeGreaterThan(evening.durationSec);

    const labelled = labelSessions([night, evening], []);
    const [nightScore, eveningScore] = labelled.map((s) => scoreSession(s, SCORING));
    expect(eveningScore).toBeGreaterThan(nightScore);
  });

  it('separates night from daytime on density alone', () => {
    const night = sessionStartingAt(sessions, 1, 24);
    const evening = sessionStartingAt(sessions, 17, 58);
    expect(night.densityMBPerMin).toBeLessThan(SCORING.densityFloorMBPerMin);
    expect(evening.densityMBPerMin).toBeGreaterThan(SCORING.densityFloorMBPerMin);
  });

  it('weights a person session above a vehicle session of equal shape', () => {
    const base = {
      durationSec: 600,
      densityMBPerMin: 3.0,
      sizeBytes: 30e6,
      start: new Date(),
      end: new Date(),
    };
    const person = scoreSession({ ...base, labels: ['person'] }, SCORING);
    const vehicle = scoreSession({ ...base, labels: ['vehicle'] }, SCORING);
    expect(person).toBeCloseTo(vehicle * 3, 5);
  });

  it('takes the strongest label when a session carries several', () => {
    const base = { durationSec: 100, densityMBPerMin: 3.0, sizeBytes: 5e6 };
    expect(scoreSession({ ...base, labels: ['vehicle', 'person'] }, SCORING)).toBe(
      scoreSession({ ...base, labels: ['person'] }, SCORING),
    );
  });
});

describe('labelSessions', () => {
  it('applies ledger labels that overlap the session window', () => {
    const session = sessionize(
      [
        toClip({
          StartTime: { year: 2026, mon: 7, day: 17, hour: 18, min: 0, sec: 0 },
          EndTime: { year: 2026, mon: 7, day: 17, hour: 18, min: 5, sec: 0 },
          size: '9000000',
        }),
      ],
      {},
    );
    const [labelled] = labelSessions(session, [
      {
        ts: '2026-07-17T18:02:00',
        endTs: '2026-07-17T18:03:00',
        labels: ['person'],
        source: 'ha',
      },
    ]);
    expect(labelled.labels).toEqual(['person']);
    expect(labelled.classificationSource).toBe('ha');
  });

  it('records the WEAKEST source so a density guess is never mistaken for HA', () => {
    const session = sessionize(
      [
        toClip({
          StartTime: { year: 2026, mon: 7, day: 17, hour: 18, min: 0, sec: 0 },
          EndTime: { year: 2026, mon: 7, day: 17, hour: 18, min: 5, sec: 0 },
          size: '9000000',
        }),
      ],
      {},
    );
    const [labelled] = labelSessions(session, [
      { ts: '2026-07-17T18:01:00', labels: ['person'], source: 'ha' },
      { ts: '2026-07-17T18:02:00', labels: [], source: 'density' },
    ]);
    expect(labelled.classificationSource).toBe('density');
  });

  it('leaves sessions unlabelled when the ledger is empty', () => {
    const sessions = labelSessions(sessionize(driveway().slice(0, 20), {}), []);
    expect(sessions.every((s) => s.labels.length === 0)).toBe(true);
    expect(sessions.every((s) => s.classificationSource === 'none')).toBe(true);
  });
});

describe('selectSessions', () => {
  const sessions = labelSessions(sessionize(driveway(), { maxGapSeconds: 120 }), []);

  it('never exceeds the budget', () => {
    const plan = selectSessions(sessions, { ...SCORING, budgetMB: 200, compressionRatio: 0.6 });
    expect(plan.projectedMB).toBeLessThanOrEqual(200);
    expect(plan.selected.length).toBeGreaterThan(0);
  });

  it('accounts for every session as selected or rejected', () => {
    const plan = selectSessions(sessions, { ...SCORING, budgetMB: 200, compressionRatio: 0.6 });
    expect(plan.selected.length + plan.rejected.length).toBe(sessions.length);
  });

  it('keeps nothing when the budget is zero', () => {
    const plan = selectSessions(sessions, { ...SCORING, budgetMB: 0, compressionRatio: 0.6 });
    expect(plan.selected).toHaveLength(0);
  });

  it('returns selections in chronological order for a readable manifest', () => {
    const plan = selectSessions(sessions, { ...SCORING, budgetMB: 200, compressionRatio: 0.6 });
    const times = plan.selected.map((s) => s.start.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('prefers the evening block over night noise under a tight budget', () => {
    const plan = selectSessions(sessions, { ...SCORING, budgetMB: 60, compressionRatio: 0.6 });
    const hours = plan.selected.map((s) => s.start.getHours());
    // Under pressure the daytime/evening material should win outright.
    expect(hours.every((h) => h >= 6 && h <= 23)).toBe(true);
  });

  it('never selects a density-gated session just because it is small', () => {
    // Regression: greedy budget-filling used to pick up near-zero-score scraps
    // purely because they fit — a 0.5min 04:45 session scoring 2 was landing in
    // the archive next to a 31min evening session scoring 1118.
    const plan = selectSessions(sessions, { ...SCORING, budgetMB: 60, compressionRatio: 0.6 });
    expect(plan.selected.every((s) => s.densityMBPerMin >= SCORING.densityFloorMBPerMin)).toBe(true);
    expect(plan.rejected.some((s) => s.reason === 'density-gated')).toBe(true);
  });

  it('lets a strong trigger label override the density gate', () => {
    const gated = {
      start: new Date(2026, 6, 17, 2, 0),
      end: new Date(2026, 6, 17, 2, 5),
      durationSec: 300,
      sizeBytes: 2e6,
      densityMBPerMin: 0.8, // well below the floor
      clips: [],
      labels: ['person'], // ...but HA saw a person
    };
    const plan = selectSessions([gated], { ...SCORING, budgetMB: 200, compressionRatio: 0.6 });
    expect(plan.selected).toHaveLength(1);
  });
});

describe('doorbell fixture', () => {
  it('sessionizes the doorbell day', () => {
    const clips = loadFixture('search-doorbell-2026-07-17.json').map((r) => toClip(r));
    expect(clips.length).toBe(147);
    expect(sessionize(clips, { maxGapSeconds: 120 }).length).toBe(61);
  });
});

describe('nvr fixture', () => {
  it('collapses continuous hourly segments into one session', () => {
    const segs = loadFixture('search-nvr-ch1-2026-07-17.json').map((r) => toClip(r));
    expect(segs.length).toBe(26);
    expect(segs.every((s) => s.name === null)).toBe(true);
    // Continuous recording has no gaps, so it is one session for the whole day.
    expect(sessionize(segs, { maxGapSeconds: 120 })).toHaveLength(1);
  });
});
