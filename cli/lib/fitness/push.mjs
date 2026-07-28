/**
 * Push a local fitness session to Strava as a new activity, preserving
 * heart-rate data via TCX upload.
 *
 * Use when the normal save-path failed to create the Strava activity. Reads
 * the session YAML, decodes the RLE HR series, builds a TCX file, uploads it
 * to `/api/v3/uploads`, polls for the resulting `activity_id`, and writes the
 * strava block back into `participants.{userId}.strava`.
 *
 * Notes:
 *   - `--dry-run` writes the TCX to `<session>.tcx.preview` and uploads nothing.
 *   - The primary participant (`is_primary: true`) receives the strava block;
 *     a single primary user per session is assumed.
 *   - Auth comes from the shared strava auth files, refreshed and persisted by
 *     `stravaAuth.mjs` (`--user=NAME` selects a non-default user).
 *
 * @module cli/lib/fitness/push
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';
import { stravaApi, getAccessToken, STRAVA_BASE } from './stravaAuth.mjs';

export const spec = {
  name: 'push',
  summary: 'upload a local session to strava as a new activity via tcx',
  usage: 'fitness strava push <session.yml> [--dry-run] [--name="..."] [--user=NAME]',
  details: `  --dry-run    Write <session>.tcx.preview instead of uploading
  --name=TEXT  Activity name (default: "Workout <session date>")
  --user=NAME  Strava auth user (default: the configured CLI user)`,
};

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<Object>}
 */
export async function run(argv, ctx) {
  // `--dry-run` declared boolean so `push --dry-run session.yml` keeps the
  // path as a positional instead of feeding it to the flag.
  const { positional, flags } = parseArgs(argv, {
    valueFlags: ['name', 'user'],
    booleanFlags: ['dry-run'],
  });

  const dryRun = bool(flags, 'dry-run');
  const activityName = str(flags, 'name');
  const username = str(flags, 'user');

  const sessionArg = positional[0];
  if (!sessionArg) {
    throw new CliError(`Usage: ${spec.usage}`);
  }
  const sessionPath = path.resolve(sessionArg);
  if (!fs.existsSync(sessionPath)) {
    throw new CliError(`Session file not found: ${sessionPath}`);
  }

  // ── Step 1: Load session + decode HR series ──

  const session = yaml.load(fs.readFileSync(sessionPath, 'utf8'));
  if (!session?.timeline?.series) {
    throw new CliError('Session has no timeline.series');
  }

  const primaryUserId = Object.entries(session.participants || {})
    .find(([, p]) => p?.is_primary)?.[0];
  if (!primaryUserId) {
    throw new CliError('Session has no primary participant');
  }

  const existingStrava = session.participants[primaryUserId]?.strava;
  if (existingStrava?.activityId) {
    throw new CliError(`Session already has strava.activityId=${existingStrava.activityId}; refusing to duplicate.`);
  }

  const hrKey = `${primaryUserId}:hr`;
  const hrSeries = decodeRle(session.timeline.series[hrKey]);
  const intervalSeconds = session.timeline.interval_seconds || 5;
  const tickCount = session.timeline.tick_count || hrSeries.length;

  // ── Step 2: Resolve start time as UTC ──

  // session.session.start is 'YYYY-MM-DD HH:MM:SS.sss' in session.timezone
  const startLocalStr = session.session.start;
  const tz = session.timezone || 'America/Los_Angeles';
  const durationSec = session.session.duration_seconds;

  const startMs = localToUtcMs(startLocalStr, tz);
  const startUtcIso = new Date(startMs).toISOString();

  // ── Step 3: Build TCX ──

  const trackpoints = [];
  for (let i = 0; i < Math.min(hrSeries.length, tickCount); i++) {
    const hr = hrSeries[i];
    if (hr == null) continue; // skip nulls at the tail
    const tMs = startMs + (i + 1) * intervalSeconds * 1000;
    trackpoints.push(
      `          <Trackpoint>\n            <Time>${iso(tMs)}</Time>\n            <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>\n          </Trackpoint>`
    );
  }

  const summary = session.summary?.participants?.[primaryUserId] || {};
  const hrAvg = Math.max(1, Math.round(summary.hr_avg || 0));
  const hrMax = Math.max(1, Math.round(summary.hr_max || 0));

  const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Other">
      <Id>${startUtcIso}</Id>
      <Lap StartTime="${startUtcIso}">
        <TotalTimeSeconds>${durationSec}</TotalTimeSeconds>
        <DistanceMeters>0</DistanceMeters>
        <Calories>0</Calories>
        <AverageHeartRateBpm><Value>${hrAvg}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${hrMax}</Value></MaximumHeartRateBpm>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${trackpoints.join('\n')}
        </Track>
      </Lap>
      <Creator xsi:type="Device_t">
        <Name>Daylight Station (reconstructed)</Name>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;

  console.log(`Session ${session.sessionId}: ${hrSeries.length} HR ticks, ${durationSec}s duration, primary=${primaryUserId}`);
  console.log(`Start (UTC): ${startUtcIso}`);
  console.log(`HR avg=${hrAvg} max=${hrMax}`);
  console.log(`TCX size: ${tcx.length} bytes`);

  if (dryRun) {
    const previewPath = `${sessionPath}.tcx.preview`;
    fs.writeFileSync(previewPath, tcx);
    console.log(`\nDry run — TCX written to ${previewPath}. No upload performed.`);
    return {
      dryRun: true,
      sessionId: session.sessionId,
      primaryUserId,
      startUtc: startUtcIso,
      hrTicks: hrSeries.length,
      previewPath,
    };
  }

  // ── Step 4: Auth (shared refresh-and-persist) ──

  const token = await getAccessToken(ctx, { username });

  // ── Step 5: Upload TCX, poll, fetch the created activity ──

  const name = activityName || `Workout ${session.session.date}`;
  const upl = await upload({ tcx, name, session, token });
  const done = await pollUpload(upl.id, token);
  const activity = await stravaApi(ctx, `/activities/${done.activity_id}`, { username });

  // ── Step 6: Write strava block back into session ──

  const block = {
    activityId: activity.id,
    type: activity.type || 'Workout',
    sufferScore: activity.suffer_score || 0,
    deviceName: activity.device_name || 'Daylight Station (reconstructed)',
  };
  if (!session.participants[primaryUserId].strava) {
    session.participants[primaryUserId].strava = {};
  }
  Object.assign(session.participants[primaryUserId].strava, block);
  fs.writeFileSync(sessionPath, yaml.dump(session, { lineWidth: 10000 }));
  console.log(`\nWrote strava block to ${sessionPath}: activityId=${activity.id}`);

  return {
    dryRun: false,
    sessionId: session.sessionId,
    primaryUserId,
    startUtc: startUtcIso,
    hrTicks: hrSeries.length,
    uploadId: upl.id,
    activityId: activity.id,
    name,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode an RLE-encoded series: '[71,[72,3],...]' → [71,72,72,72,...] */
function decodeRle(encoded) {
  if (!encoded) return [];
  const s = typeof encoded === 'string' ? encoded : String(encoded);
  const arr = JSON.parse(s);
  const out = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      const [val, count] = item;
      for (let i = 0; i < count; i++) out.push(val);
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Convert a wall-clock local timestamp in `timezone` to epoch ms, using Intl
 * to derive the offset at that instant.
 *
 * @param {string} localStr - 'YYYY-MM-DD HH:MM:SS(.sss)'
 * @param {string} timezone
 * @returns {number}
 */
function localToUtcMs(localStr, timezone) {
  // Parse components to avoid fractional-second drift in the tz offset math.
  const m = String(localStr).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) throw new CliError(`Unparseable local time: ${localStr}`);
  const [, Y, Mo, D, H, Mi, S, Ms] = m;
  const fracMs = Ms ? parseInt(Ms.padEnd(3, '0').slice(0, 3), 10) : 0;
  // Naive UTC from integer components (no fractional).
  const naiveMs = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
  // Format the naive-as-UTC instant as if viewed in tz → integer components.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(naiveMs)).map(p => [p.type, p.value]));
  const shownMs = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour === '24' ? '0' : parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  const offsetMs = shownMs - naiveMs;
  return naiveMs - offsetMs + fracMs;
}

/** @param {number} ms @returns {string} whole-second ISO timestamp */
function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Multipart TCX upload — driven with raw `fetch` because the shared
 * `stravaApi` helper is JSON-oriented.
 */
async function upload({ tcx, name, session, token }) {
  const form = new FormData();
  form.append('file', new Blob([tcx], { type: 'application/xml' }), `${session.sessionId}.tcx`);
  form.append('data_type', 'tcx');
  form.append('activity_type', 'Workout');
  form.append('name', name);
  form.append('external_id', `daylight-${session.sessionId}`);

  console.log(`\nUploading to Strava as "${name}"…`);
  const res = await fetch(`${STRAVA_BASE}/api/v3/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new CliError(`Upload failed: ${res.status} ${JSON.stringify(body)}`);
  console.log(`  upload id=${body.id} status=${body.status}`);
  return body;
}

/** Poll an upload until Strava reports an activity_id (or errors out). */
async function pollUpload(uploadId, token, maxSec = 60) {
  const startAt = Date.now();
  while (Date.now() - startAt < maxSec * 1000) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${STRAVA_BASE}/api/v3/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    console.log(`  poll: status="${body.status}" activity_id=${body.activity_id} error=${body.error || ''}`);
    if (body.activity_id) return body;
    if (body.error) throw new CliError(`Upload error: ${body.error}`);
  }
  throw new CliError('Upload poll timed out');
}
