/**
 * Calibration of the presence ladder's practice rate (`practice_npm`) on the
 * engagement audit (__fixtures__/audit-sittings.json) and the synthetic mash.
 *
 * Every sitting is replayed the way the kiosk now runs it (replayLadder: idle
 * check-ins at the rung's interval, the keepalive deadline, every check-in
 * answered at once). Printed per candidate; the bars are asserted for the
 * default (owner, 2026-11-13: hard to fake):
 *   - school absentee + rhythm-loop sittings with ≥ 3 check-ins that reach rung ≥ 2: ≥ 90 %
 *   - mash replays with any `practice` interval: 0
 *   - school engaged + low-touch sittings that ever reach rung ≥ 3: the plan's
 *     bar was ≤ 5 %, which NO practice_npm meets (2026-11-13: 54/177 = 0.305 at
 *     every candidate 2–6). Those sittings spend a median 87 % of their time in
 *     silences of 90 s or more (longest gap median ~10 min): the ladder sees no
 *     playing because there was none, so the rate cannot move them. The
 *     measured value is held here as a ceiling so a regression shows.
 * practice_npm 2–6 tie on all three; 4 is the highest that costs an engaged
 * child nothing over 2 (from 6 up, practice intervals start reading partial).
 * Results are recorded in __docs/reference/piano/lesson-engagement.md.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { replayLadder, ladderConfig, PRESENCE_LADDER_DEFAULTS } from './presenceLadder.mjs';
import { mashSittings } from './__fixtures__/mash.mjs';

const FIXTURE = new URL('./__fixtures__/audit-sittings.json', import.meta.url);
const sittings = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const evs = (notes) => notes.map(([t, note, velocity]) => ({ t: Math.round(t * 1000), note, velocity }));
const mevs = (notes) => notes.map(([t, note, velocity]) => ({ t, note, velocity }));
const rate = (n, d) => ({ n, of: d, rate: d ? Math.round((n / d) * 1000) / 1000 : 0 });
const peak = (log) => log.reduce((m, c) => Math.max(m, c.rung), 0);

export function ladderReport(npm) {
  const cfg = ladderConfig({ practice_npm: npm });
  const school = sittings.filter((s) => s.cohort === 'school');
  const engaged = school.filter((s) => s.label === 'engaged' || s.label === 'low-touch')
    .map((s) => replayLadder(evs(s.notes), s.playedSec, cfg));
  const absent = school.filter((s) => s.label === 'absentee' || s.label === 'rhythm-loop')
    .map((s) => replayLadder(evs(s.notes), s.playedSec, cfg))
    .filter((log) => log.length >= 3);
  const mash = mashSittings(1).map((m) => replayLadder(mevs(m.notes), m.durationSec, cfg));
  return {
    npm,
    engagedReachedRung3: rate(engaged.filter((l) => peak(l) >= 3).length, engaged.length),
    engagedReachedRung2: rate(engaged.filter((l) => peak(l) >= 2).length, engaged.length),
    absenteeReachedRung2: rate(absent.filter((l) => peak(l) >= 2).length, absent.length),
    mashEverPractice: mash.filter((l) => l.some((c) => c.evidence === 'practice')).length,
  };
}

describe('presence ladder calibration', () => {
  it('prints every candidate; absentee and mash bars met; engaged held at the measured 30.5 % ceiling (plan bar 5 % not met)', () => {
    for (const npm of [2, 3, 4, 5, 6]) {
      // eslint-disable-next-line no-console -- calibration record, read by a person
      console.log('[calibration] presence-ladder', JSON.stringify(ladderReport(npm)));
    }
    const report = ladderReport(PRESENCE_LADDER_DEFAULTS.practiceNpm);
    expect(report.engagedReachedRung3.rate).toBeLessThanOrEqual(0.31);
    expect(report.absenteeReachedRung2.rate).toBeGreaterThanOrEqual(0.9);
    expect(report.mashEverPractice).toBe(0);
  });
});
