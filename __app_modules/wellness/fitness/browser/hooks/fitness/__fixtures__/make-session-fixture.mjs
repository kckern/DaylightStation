/**
 * Generates `session-20010101100000.json` (name kept so the import in
 * sessionBackfill.golden.test.js is stable) - a SYNTHETIC session in the
 * in-memory shape `runSessionBackfill` takes: `{ entities, timeline.series, endTime, summary }`.
 *
 *   node __app_modules/wellness/fitness/browser/hooks/fitness/__fixtures__/make-session-fixture.mjs
 *
 * The original was a real household session. This keeps only the structure the
 * golden asserts: three occupants sharing one HR-strap device - `grannie` with a
 * full continuous trace, `learner1` with two samples and `parent-two` with one
 * before the strap was dropped (ghosts) - on an invented day (2001-01-01) with
 * an invented heart-rate curve. Series keys use the `user:<id>:<metric>`
 * convention. Profile ids are pseudonyms.
 *
 * Deterministic: no randomness, so regeneration produces no diff.
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTERVAL_S = 5;
const TICKS = 160;
const T0 = Date.UTC(2001, 0, 1, 18, 0, 0);

const nulls = () => new Array(TICKS).fill(null);
const zoneOf = (hr) => (hr < 70 ? 'c' : hr < 100 ? 'w' : hr < 120 ? 'a' : 'h');

const series = {};
for (const id of ['learner1', 'parent-two', 'grannie']) {
  series[`user:${id}:heart_beats`] = nulls();
  series[`user:${id}:heart_rate`] = nulls();
  series[`user:${id}:zone_id`] = nulls();
}

// Ghost occupants: the strap handed over before either got a real trace.
const ghost = (id, tick, beats) => {
  series[`user:${id}:heart_beats`][tick] = beats;
  series[`user:${id}:heart_rate`][tick] = 116;
  series[`user:${id}:zone_id`][tick] = 'c';
};
ghost('learner1', 0, 9.7);
ghost('learner1', 1, 19.3);
ghost('parent-two', 2, 9.7);

// The real occupant: a continuous trace from tick 3, with a few dropped samples.
let beats = 9.7;
const hrs = [];
for (let t = 3; t < TICKS - 3; t += 1) {
  const hr = Math.round(95 + 25 * Math.sin((t - 3) / 14) + 8 * Math.sin((t - 3) / 3));
  hrs.push(hr);
  if (t % 41 === 0) continue; // dropout
  series['user:grannie:heart_beats'][t] = Math.round(beats * 10) / 10;
  series['user:grannie:heart_rate'][t] = hr;
  series['user:grannie:zone_id'][t] = zoneOf(hr);
  beats += hr / 60 * INTERVAL_S / 5;
}

// Cumulative coins: ghosts earn ~nothing, grannie accrues steadily.
series['user:learner1:coins_total'] = Array.from({ length: TICKS }, (_, t) => (t < 2 ? 0 : 1));
series['user:grannie:coins_total'] = Array.from({ length: TICKS }, (_, t) => (t < 3 ? null : Math.floor((t - 3) * 1.5)));

const zoneMinutes = {};
for (const hr of hrs) zoneMinutes[zoneOf(hr)] = (zoneMinutes[zoneOf(hr)] ?? 0) + INTERVAL_S / 60;
for (const k of Object.keys(zoneMinutes)) zoneMinutes[k] = Math.round(zoneMinutes[k] * 100) / 100;

const fixture = {
  entities: [
    { entityId: 'entity-synthetic-1', profileId: 'parent-two', deviceId: '10001', startTime: T0, endTime: null, status: 'active', coins: 0 },
    { entityId: 'entity-synthetic-2', profileId: 'grannie', deviceId: '10001', startTime: T0 + 4500, endTime: null, status: 'active', coins: 0 },
  ],
  timeline: { series, interval_seconds: INTERVAL_S },
  endTime: T0 + TICKS * INTERVAL_S * 1000,
  summary: {
    participants: {
      grannie: {
        coins: series['user:grannie:coins_total'].at(-1),
        hr_avg: Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length),
        hr_max: Math.max(...hrs),
        hr_min: Math.min(...hrs),
        zone_minutes: zoneMinutes,
      },
      learner1: { coins: 1, hr_avg: 116, hr_max: 116, hr_min: 116, zone_minutes: { cool: 0.17 } },
      'parent-two': { coins: 0, hr_avg: 116, hr_max: 116, hr_min: 116, zone_minutes: { active: 0.08 } },
    },
  },
};

writeFileSync(path.join(HERE, 'session-20010101100000.json'), `${JSON.stringify(fixture)}\n`);
