/**
 * Generates the synthetic NVR search responses `selection.test.mjs` runs against.
 * The record counts and ranking expectations asserted in selection.test.mjs derive
 * from this generator: change one, regenerate, and update the other together.
 *
 *   node __app_modules/household/camera/server/domain/fixtures/make-search-fixtures.mjs
 *
 * The originals were real captures of one household's camera day. These are
 * invented: a made-up day (2001-01-01), made-up sessions and made-up file names.
 * Only the SHAPE of the Reolink `Search` reply and the edge cases the tests
 * assert survive:
 *
 *   driveway  - a LONG, LOW-density night session (01:24, 86 min, 0.6 MB/min)
 *               that duration alone would rank above a SHORT, DENSE evening
 *               session (17:58, 28 min, 3.5 MB/min); a tiny 04:45 scrap; further
 *               gated and ungated sessions so the budget tests have something
 *               to reject for each reason.
 *   doorbell  - short clips; one gap of exactly 120 s (merges) and one of
 *               121 s (splits) at the sessionizer's default threshold.
 *   nvr-ch1   - 26 contiguous recording segments, no `name`, one session.
 *
 * Output is deterministic (no randomness) so regeneration yields no diff.
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = { year: 2001, mon: 1, day: 1 };

const at = (secOfDay) => ({
  ...DAY,
  hour: Math.floor(secOfDay / 3600),
  min: Math.floor((secOfDay % 3600) / 60),
  sec: secOfDay % 60,
});
const hms = (s) => {
  const t = at(s);
  return [t.hour, t.min, t.sec].map((n) => String(n).padStart(2, '0')).join('');
};
const sec = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;

/** Contiguous-ish clips: `clipSec` long, `gapSec` apart, filling [startSec, startSec + totalSec). */
function run({ startSec, totalSec, clipSec, gapSec, mbPerMin }) {
  const clips = [];
  for (let s = startSec; s < startSec + totalSec; s += clipSec + gapSec) {
    const len = Math.min(clipSec, startSec + totalSec - s);
    clips.push({ start: s, end: s + len, size: Math.round((len / 60) * mbPerMin * 1e6) });
  }
  return clips;
}

function cameraRecord(prefix, channel, { start, end, size }) {
  return {
    EndTime: at(end),
    StartTime: at(start),
    frameRate: 0,
    height: 0,
    name: `Mp4Record/2001-01-01/${prefix}${channel}_DST20010101_${hms(start)}_${hms(end)}_0_00000000_000000.mp4`,
    size: String(size),
    type: 'sub',
    width: 0,
  };
}

function envelope(files, channel) {
  return [{
    cmd: 'Search',
    code: 0,
    value: { SearchResult: { File: files, Status: [{ mon: 1, table: '1000000000000000000000000000000', year: 2001 }], channel } },
  }];
}

const driveway = [
  run({ startSec: sec(1, 24), totalSec: 86 * 60, clipSec: 240, gapSec: 5, mbPerMin: 0.6 }), // night noise
  run({ startSec: sec(4, 45), totalSec: 30, clipSec: 30, gapSec: 0, mbPerMin: 0.2 }), // scrap
  run({ startSec: sec(7, 10), totalSec: 6 * 60, clipSec: 120, gapSec: 10, mbPerMin: 3.0 }),
  run({ startSec: sec(9, 30), totalSec: 8 * 60, clipSec: 120, gapSec: 10, mbPerMin: 2.5 }),
  run({ startSec: sec(12, 15), totalSec: 12 * 60, clipSec: 120, gapSec: 10, mbPerMin: 4.0 }),
  run({ startSec: sec(15, 40), totalSec: 5 * 60, clipSec: 100, gapSec: 10, mbPerMin: 3.2 }),
  run({ startSec: sec(17, 58), totalSec: 28 * 60, clipSec: 120, gapSec: 10, mbPerMin: 3.5 }), // evening
  run({ startSec: sec(20, 30), totalSec: 9 * 60, clipSec: 120, gapSec: 10, mbPerMin: 2.8 }),
  run({ startSec: sec(22, 5), totalSec: 15 * 60, clipSec: 150, gapSec: 10, mbPerMin: 0.8 }), // late, gated
].flat().map((c) => cameraRecord('RecS', '0A', c));

// 30 s clips separated by the listed gaps (seconds). 120 merges, 121 splits.
let cursor = sec(8, 0);
const doorbell = [];
for (const gap of [0, 20, 45, 120, 121, 600, 30, 120, 300, 15, 121, 60]) {
  cursor += gap;
  doorbell.push({ start: cursor, end: cursor + 30, size: 1_100_000 });
  cursor += 30;
}
const doorbellRecords = doorbell.map((c) => cameraRecord('RecS', '07', c));

// 26 contiguous segments: 20 hourly (00:00-20:00) then 6 half-hourly (20:00-23:00).
const nvrRecords = [];
for (let i = 0, t = 0; i < 26; i += 1) {
  const len = i < 20 ? 3600 : 1800;
  nvrRecords.push({
    EndTime: at(t + len),
    PlaybackTime: at(t + 6 * 3600),
    StartTime: at(t),
    frameRate: 0,
    height: 0,
    size: String(Math.round((len / 3600) * 47_710_208)),
    type: 'sub',
    width: 0,
  });
  t += len;
}

const write = (name, data) => writeFileSync(path.join(HERE, name), `${JSON.stringify(data, null, 2)}\n`);
write('search-driveway-synthetic.json', envelope(driveway, 0));
write('search-doorbell-synthetic.json', envelope(doorbellRecords, 0));
write('search-nvr-ch1-synthetic.json', envelope(nvrRecords, 1));
console.log(`driveway ${driveway.length} clips, doorbell ${doorbellRecords.length}, nvr ${nvrRecords.length}`);
