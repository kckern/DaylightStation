#!/usr/bin/env node
/**
 * Push a Daylight Station fitness session to Strava as a new activity,
 * preserving heart-rate data via TCX upload.
 *
 * Use when the normal save-path failed to create the Strava activity
 * (e.g. two Apr 20 sessions had no strava block). Reads the session YAML,
 * decodes the RLE HR series, builds a TCX file, uploads to Strava via
 * /api/v3/uploads, polls for the activity_id, and writes the
 * resulting strava block back into participants.{userId}.strava.
 *
 * Usage:
 *   node cli/scripts/session-to-strava.mjs \
 *     <session-yml> <system-strava-auth-yml> <user-strava-auth-yml> [--dry-run]
 *
 * Example:
 *   node cli/scripts/session-to-strava.mjs \
 *     /data/household/history/fitness/2026-04-20/20260420055513.yml \
 *     /data/system/auth/strava.yml \
 *     /data/users/kckern/auth/strava.yml \
 *     --dry-run
 *
 * Notes:
 *   - The script mutates the user-strava-auth yml when the access token is
 *     refreshed (writes access_token + expires_at + refresh token).
 *   - Writes the TCX preview to <session>.tcx.preview for --dry-run.
 *   - Primary participant (is_primary:true) receives the strava block.
 *     Assumes a single primary user per session.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const SESSION_PATH = process.argv[2];
const SYS_AUTH_PATH = process.argv[3];
const USER_AUTH_PATH = process.argv[4];
const DRY_RUN = process.argv.includes('--dry-run');
const ACTIVITY_NAME = process.argv.find(a => a.startsWith('--name='))?.slice(7);

if (!SESSION_PATH || !SYS_AUTH_PATH || !USER_AUTH_PATH) {
  console.error('Usage: node session-to-strava.mjs <session-yml> <system-auth-yml> <user-auth-yml> [--dry-run] [--name="..."]');
  process.exit(1);
}

// ── Step 1: Load session + decode HR series ──

const sessionRaw = fs.readFileSync(SESSION_PATH, 'utf8');
const session = yaml.load(sessionRaw);
if (!session?.timeline?.series) {
  console.error('Session has no timeline.series');
  process.exit(1);
}

const primaryUserId = Object.entries(session.participants || {})
  .find(([, p]) => p?.is_primary)?.[0];
if (!primaryUserId) {
  console.error('Session has no primary participant');
  process.exit(1);
}

const existingStrava = session.participants[primaryUserId]?.strava;
if (existingStrava?.activityId) {
  console.error(`Session already has strava.activityId=${existingStrava.activityId}; refusing to duplicate.`);
  process.exit(1);
}

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

const hrKey = `${primaryUserId}:hr`;
const hrSeriesEncoded = session.timeline.series[hrKey];
const hrSeries = decodeRle(hrSeriesEncoded);
const intervalSeconds = session.timeline.interval_seconds || 5;
const tickCount = session.timeline.tick_count || hrSeries.length;

// ── Step 2: Resolve start time as UTC ──

// session.session.start is 'YYYY-MM-DD HH:MM:SS.sss' in session.timezone
const startLocalStr = session.session.start; // e.g. '2026-04-20 05:55:13.762'
const tz = session.timezone || 'America/Los_Angeles';
const durationSec = session.session.duration_seconds;

// Use Intl to compute the offset for the given timezone at that instant.
function localToUtcMs(localStr, timezone) {
  // Parse components to avoid fractional-second drift in the tz offset math.
  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) throw new Error(`Unparseable local time: ${localStr}`);
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

const startMs = localToUtcMs(startLocalStr, tz);
const startUtcIso = new Date(startMs).toISOString();

// ── Step 3: Build TCX ──

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

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

if (DRY_RUN) {
  const previewPath = `${SESSION_PATH}.tcx.preview`;
  fs.writeFileSync(previewPath, tcx);
  console.log(`\nDry run — TCX written to ${previewPath}. No upload performed.`);
  process.exit(0);
}

// ── Step 4: Strava auth (refresh if needed) ──

const sysAuth = yaml.load(fs.readFileSync(SYS_AUTH_PATH, 'utf8'));
const userAuth = yaml.load(fs.readFileSync(USER_AUTH_PATH, 'utf8'));

async function ensureAccessToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (userAuth.access_token && userAuth.expires_at && userAuth.expires_at > nowSec + 60) {
    return userAuth.access_token;
  }
  console.log('Refreshing Strava token…');
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: userAuth.refresh,
      client_id: String(sysAuth.client_id),
      client_secret: sysAuth.client_secret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const tok = await res.json();
  userAuth.access_token = tok.access_token;
  userAuth.expires_at = tok.expires_at;
  userAuth.refresh = tok.refresh_token || userAuth.refresh;
  userAuth.updated_at = new Date().toISOString();
  fs.writeFileSync(USER_AUTH_PATH, yaml.dump(userAuth));
  console.log(`  new expires_at=${tok.expires_at}`);
  return tok.access_token;
}

// ── Step 5: Upload TCX ──

async function upload(accessToken) {
  const name = ACTIVITY_NAME || `Workout ${session.session.date}`;
  const form = new FormData();
  form.append('file', new Blob([tcx], { type: 'application/xml' }), `${session.sessionId}.tcx`);
  form.append('data_type', 'tcx');
  form.append('activity_type', 'Workout');
  form.append('name', name);
  form.append('external_id', `daylight-${session.sessionId}`);

  console.log(`\nUploading to Strava as "${name}"…`);
  const res = await fetch('https://www.strava.com/api/v3/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${JSON.stringify(body)}`);
  console.log(`  upload id=${body.id} status=${body.status}`);
  return body;
}

async function pollUpload(uploadId, accessToken, maxSec = 60) {
  const startAt = Date.now();
  while (Date.now() - startAt < maxSec * 1000) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json();
    console.log(`  poll: status="${body.status}" activity_id=${body.activity_id} error=${body.error || ''}`);
    if (body.activity_id) return body;
    if (body.error) throw new Error(`Upload error: ${body.error}`);
  }
  throw new Error('Upload poll timed out');
}

async function getActivity(activityId, accessToken) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`getActivity failed: ${res.status}`);
  return await res.json();
}

// ── Step 6: Write strava block back into session ──

function writeStravaBlock(activity) {
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
  fs.writeFileSync(SESSION_PATH, yaml.dump(session, { lineWidth: 10000 }));
  console.log(`\nWrote strava block to ${SESSION_PATH}: activityId=${activity.id}`);
}

// ── Main ──

(async () => {
  const token = await ensureAccessToken();
  const upl = await upload(token);
  const done = await pollUpload(upl.id, token);
  const activity = await getActivity(done.activity_id, token);
  writeStravaBlock(activity);
})().catch(e => {
  console.error('\nFAILED:', e?.message || e);
  process.exit(2);
});
