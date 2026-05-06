#!/usr/bin/env node
/**
 * One-shot: recreate the May 5 2026 Lunch Run as a proper Strava-only session.
 *
 * Mirrors what FitnessActivityEnrichmentService._createStravaOnlySession does
 * (and what its new sliver-absorption helper does), but runs locally against
 * the Dropbox mirror so the data is right BEFORE prod deploys the new code.
 *
 * Steps:
 *   1. Fetch Strava activity 18390552794 (Lunch Run) and its HR streams.
 *   2. Build the session YAML (timeline, summary, polyline, etc.).
 *   3. Write it to data/.../2026-05-05/{startTime}.yml.
 *   4. Delete the 7-min cooldown sliver 20260505130756.yml.
 *   5. Update the webhook job to status: completed, note: manual-recreate.
 *
 * Run from project root with DAYLIGHT_BASE_PATH set to Dropbox.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
import yaml from 'js-yaml';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const baseDir = process.env.DAYLIGHT_BASE_PATH;
if (!baseDir) {
  console.error('DAYLIGHT_BASE_PATH not set');
  process.exit(1);
}

const ACTIVITY_ID = '18390552794';
const SLIVER_FILE = '20260505130756';

const stravaCli = path.join(projectRoot, 'cli/strava.cli.mjs');
function callStrava(args) {
  // strava CLI emits dotenv banner on stdout. Skip lines starting with '[dotenv'
  // and look for the first line that begins with '{' or '['.
  const cmd = `node ${stravaCli} ${args} --json 2>/dev/null`;
  const raw = execSync(cmd, { cwd: projectRoot, maxBuffer: 50 * 1024 * 1024 }).toString();
  const lines = raw.split('\n');
  const startIdx = lines.findIndex(l => l.startsWith('{') || (l.startsWith('[') && !l.startsWith('[dotenv')));
  if (startIdx < 0) {
    throw new Error(`No JSON found in strava CLI output: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(lines.slice(startIdx).join('\n'));
}

console.log('=== Step 1: Fetch Strava activity + streams ===');
const activity = callStrava(`get ${ACTIVITY_ID}`);
console.log(`  Activity: ${activity.name} (${activity.type}) ${activity.start_date_local} ${activity.elapsed_time}s ${activity.distance}m`);

const streams = callStrava(`streams ${ACTIVITY_ID} --keys=time,heartrate`);
const timeStream = streams.time?.data;
const hrStream = streams.heartrate?.data;
if (!timeStream || !hrStream || timeStream.length !== hrStream.length) {
  console.error('Time/HR streams missing or mismatched');
  process.exit(1);
}
console.log(`  Streams: ${timeStream.length} samples, time max=${timeStream[timeStream.length-1]}s`);

const lastSec = timeStream[timeStream.length - 1];
const hrPerSecond = new Array(lastSec + 1).fill(null);
for (let i = 0; i < timeStream.length; i++) {
  hrPerSecond[timeStream[i]] = hrStream[i];
}
let lastHr = null;
for (let i = 0; i < hrPerSecond.length; i++) {
  if (hrPerSecond[i] != null) lastHr = hrPerSecond[i];
  else hrPerSecond[i] = lastHr;
}
console.log(`  Per-second HR: ${hrPerSecond.length} samples`);

console.log('\n=== Step 2: Build session timeline ===');
const { buildStravaSessionTimeline } = await import(path.join(projectRoot, 'backend/src/2_domains/fitness/services/StravaSessionBuilder.mjs'));
const { encodeSingleSeries } = await import(path.join(projectRoot, 'backend/src/2_domains/fitness/services/TimelineService.mjs'));

const timelineData = buildStravaSessionTimeline(hrPerSecond);
console.log(`  hrSamples: ${timelineData.hrSamples.length} (5s interval)`);
console.log(`  totalCoins: ${timelineData.totalCoins}`);
console.log(`  hrStats: avg=${timelineData.hrStats.hrAvg} max=${timelineData.hrStats.hrMax} min=${timelineData.hrStats.hrMin}`);
console.log(`  zoneMinutes: ${JSON.stringify(timelineData.zoneMinutes)}`);

console.log('\n=== Step 3: Build session YAML ===');
const tz = 'America/Los_Angeles';
const username = 'kckern';
const startLocal = moment(activity.start_date).tz(tz);
const sessionId = startLocal.format('YYYYMMDDHHmmss');
const date = startLocal.format('YYYY-MM-DD');
const durationSeconds = activity.elapsed_time || activity.moving_time || 0;
const endLocal = startLocal.clone().add(durationSeconds, 'seconds');

const timelineSeries = {
  [`${username}:hr`]: encodeSingleSeries(timelineData.hrSamples),
  [`${username}:zone`]: encodeSingleSeries(timelineData.zoneSeries),
  [`${username}:coins`]: encodeSingleSeries(timelineData.coinsSeries),
  'global:coins': encodeSingleSeries(timelineData.coinsSeries),
};

const sessionData = {
  version: 3,
  sessionId,
  session: {
    id: sessionId,
    date,
    start: startLocal.format('YYYY-MM-DD HH:mm:ss'),
    end: endLocal.format('YYYY-MM-DD HH:mm:ss'),
    duration_seconds: durationSeconds,
    source: 'strava',
  },
  timezone: tz,
  participants: {
    [username]: {
      display_name: 'KC Kern',
      is_primary: true,
      strava: {
        activityId: activity.id,
        type: activity.type || activity.sport_type || null,
        sufferScore: activity.suffer_score || null,
        deviceName: activity.device_name || null,
        calories: activity.calories || null,
        avgHeartrate: activity.average_heartrate || null,
        maxHeartrate: activity.max_heartrate || null,
      },
    },
  },
  strava: {
    activityId: activity.id,
    name: activity.name || null,
    type: activity.type || null,
    sportType: activity.sport_type || null,
    movingTime: activity.moving_time || 0,
    distance: activity.distance || 0,
    totalElevationGain: activity.total_elevation_gain || 0,
    trainer: activity.trainer ?? false,
    avgHeartrate: activity.average_heartrate || null,
    maxHeartrate: activity.max_heartrate || null,
    map: {
      polyline: activity.map?.summary_polyline || null,
      startLatLng: activity.start_latlng || [],
      endLatLng: activity.end_latlng || [],
    },
  },
  timeline: {
    series: timelineSeries,
    events: [],
    interval_seconds: 5,
    tick_count: timelineData.hrSamples.length,
    encoding: 'rle',
  },
  treasureBox: { coinTimeUnitMs: 5000, totalCoins: timelineData.totalCoins, buckets: timelineData.buckets },
  summary: {
    participants: {
      [username]: {
        coins: timelineData.totalCoins,
        hr_avg: timelineData.hrStats.hrAvg,
        hr_max: timelineData.hrStats.hrMax,
        hr_min: timelineData.hrStats.hrMin,
        zone_minutes: timelineData.zoneMinutes,
      },
    },
    media: [],
    coins: { total: timelineData.totalCoins, buckets: timelineData.buckets },
    challenges: { total: 0, succeeded: 0, failed: 0 },
    voiceMemos: [],
  },
};

const sessionDir = path.join(baseDir, 'data', 'household', 'history', 'fitness', date);
const filePath = path.join(sessionDir, `${sessionId}.yml`);
mkdirSync(sessionDir, { recursive: true });
writeFileSync(filePath, yaml.dump(sessionData));
console.log(`  Written: ${filePath}`);
console.log(`    sessionId: ${sessionId}`);
console.log(`    duration: ${Math.round(durationSeconds / 60)} min`);
console.log(`    distance: ${(activity.distance / 1609.34).toFixed(2)} mi`);

console.log('\n=== Step 4: Delete sliver session ===');
const sliverPath = path.join(sessionDir, `${SLIVER_FILE}.yml`);
if (existsSync(sliverPath)) {
  unlinkSync(sliverPath);
  console.log(`  Deleted: ${sliverPath}`);
} else {
  console.log(`  Sliver already absent: ${sliverPath}`);
}

console.log('\n=== Step 5: Update webhook job ===');
const jobPath = path.join(baseDir, 'data', 'household', 'common', 'strava', 'strava-webhooks', `${ACTIVITY_ID}.yml`);
const jobData = {
  activityId: Number(ACTIVITY_ID),
  ownerId: 14872916,
  eventTime: 1778011746,
  receivedAt: '2026-05-05T20:09:07.267Z',
  status: 'completed',
  attempts: 4,
  matchedSessionId: sessionId,
  completedAt: new Date().toISOString(),
  note: 'manual-recreate-as-strava-only',
};
writeFileSync(jobPath, yaml.dump(jobData));
console.log(`  Updated: ${jobPath}`);
console.log(`    status: completed | matchedSessionId: ${sessionId}`);

console.log('\n=== DONE ===');
console.log(`May 5 Lunch Run is now session ${sessionId}, ${Math.round(durationSeconds/60)} min, ${(activity.distance/1609.34).toFixed(2)} mi.`);
console.log(`The 7-min cooldown sliver ${SLIVER_FILE} has been absorbed.`);
