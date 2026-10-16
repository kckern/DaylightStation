/**
 * backfill-route-tracks — add time-stamped route tracks to Strava sessions that
 * have a map but no track (sessions created before 2026-10-15).
 *
 * The detail pane's time cursor places the rider on the route from
 * `strava.map.track` (buildRouteTrack: latlng + time streams, one point / 5 s);
 * the summary polyline carries no times. Dry-run unless --write. Paced like
 * repair-notes: one Strava call per session, --delay ms apart (default 10 s).
 *
 *   node cli/fitness.cli.mjs backfill-route-tracks [--days 365] [--write] [--delay 10000]
 */
import path from 'path';
import { readdirSync } from 'fs';
import moment from 'moment-timezone';
import { parseArgs, bool, num } from "./argv.mjs";
import { stravaApi } from "./stravaAuth.mjs";
import { buildRouteTrack } from "../../server/domain/services/StravaSessionBuilder.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['write'] });
  const writeMode = bool(flags, 'write');
  const days = num(flags, 'days', 365);
  const delayMs = num(flags, 'delay', 10000);
  const root = ctx.fitnessHistoryDir;
  const cutoff = moment().subtract(days, 'days').format('YYYY-MM-DD');

  console.log(`Backfill route tracks (${days} days back, cutoff ${cutoff})`);
  console.log(`  Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

  const tally = { scanned: 0, candidates: 0, written: 0, noTrack: 0, errors: 0 };
  let requests = 0;
  const dayDirs = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff).sort();
  for (const day of dayDirs) {
    const files = readdirSync(path.join(root, day)).filter((f) => f.endsWith('.yml') && !f.includes('conflicted copy'));
    for (const file of files) {
      const full = path.join(root, day, file);
      const session = ctx.loadYamlSafe(full);
      if (!session) continue;
      tally.scanned++;
      const strava = session.strava;
      if (!strava?.activityId || !strava?.map?.polyline || strava.map.track) continue;
      tally.candidates++;
      try {
        if (requests++ > 0) await sleep(delayMs);
        const streams = await stravaApi(ctx, `/activities/${strava.activityId}/streams?keys=latlng,time&key_by_type=true`);
        const track = buildRouteTrack(streams?.latlng?.data, streams?.time?.data);
        if (!track) { tally.noTrack++; console.log(`  ${day}/${file}  no usable GPS stream`); continue; }
        console.log(`  ${day}/${file}  ${track.points.length} points over ${track.t[track.t.length - 1]} s`);
        if (writeMode) {
          session.strava.map.track = track;
          ctx.saveYaml(full, session);
          tally.written++;
        }
      } catch (err) {
        tally.errors++;
        console.log(`  ${day}/${file}  ERROR: ${err.message.split('\n')[0]}`);
      }
    }
  }
  console.log(`\n  Scanned ${tally.scanned}, candidates ${tally.candidates}, written ${tally.written}, no GPS ${tally.noTrack}, errors ${tally.errors}`);
  return { ...tally, write: writeMode };
}
