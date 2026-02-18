#!/usr/bin/env node

/**
 * Enrich Fitness Sessions with Plex Media Events
 *
 * Fetches play history from Plex's session history API and adds media_start
 * events to existing fitness session files whose timeline.events are empty.
 *
 * Dry-run by default. Pass --write to persist changes.
 *
 * Usage:
 *   node cli/enrich-sessions-with-plex.mjs            # dry-run
 *   node cli/enrich-sessions-with-plex.mjs --write     # write mode
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync, readdirSync } from 'fs';
import moment from 'moment-timezone';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

// Bootstrap config
const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService } = await import('#system/config/index.mjs');
const { loadYamlSafe, saveYaml } = await import('#system/utils/FileIO.mjs');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

// ------------------------------------------------------------------
// Parse CLI args
// ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeMode = args.includes('--write');

console.log(`Enrich fitness sessions with Plex media`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

// ------------------------------------------------------------------
// Plex config
// ------------------------------------------------------------------
const plexAuthPath = path.join(dataDir, 'household', 'auth', 'plex');
const plexAuth = loadYamlSafe(plexAuthPath);
if (!plexAuth?.token) {
  console.error('No Plex token found at', plexAuthPath);
  process.exit(1);
}

const PLEX_URL = 'https://plex.kckern.net';
const PLEX_TOKEN = plexAuth.token;
const FITNESS_SECTION_ID = 14;
const TIMEZONE = 'America/Los_Angeles';

// ------------------------------------------------------------------
// Fetch all Plex fitness play history
// ------------------------------------------------------------------
async function fetchPlexHistory() {
  const url = `${PLEX_URL}/status/sessions/history/all?X-Plex-Token=${PLEX_TOKEN}&librarySectionID=${FITNESS_SECTION_ID}&sort=viewedAt:asc&X-Plex-Container-Start=0&X-Plex-Container-Size=20000`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await resp.json();
  const items = data?.MediaContainer?.Metadata || [];

  const plays = [];
  for (const item of items) {
    let viewedAt = item.viewedAt || 0;
    if (viewedAt < 0) viewedAt += 2 ** 32;
    if (viewedAt <= 0) continue;

    const dt = moment.unix(viewedAt).tz(TIMEZONE);
    if (dt.year() > 2030) continue; // corrupted timestamp

    plays.push({
      timestamp: viewedAt * 1000, // ms
      dateStr: dt.format('YYYY-MM-DD'),
      ratingKey: item.ratingKey ? String(item.ratingKey) : null,
      title: [item.grandparentTitle, item.title].filter(Boolean).join(' - '),
      durationMs: item.duration || 0,
    });
  }

  console.log(`Plex: loaded ${plays.length} fitness plays (${plays[0]?.dateStr || 'none'} to ${plays[plays.length - 1]?.dateStr || 'none'})\n`);
  return plays;
}

// ------------------------------------------------------------------
// Scan all fitness session files
// ------------------------------------------------------------------
const fitnessHistoryDir = path.join(dataDir, 'household', 'history', 'fitness');

function getAllSessions() {
  const sessions = [];
  const dateDirs = readdirSync(fitnessHistoryDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

  for (const dateDir of dateDirs) {
    const fullDir = path.join(fitnessHistoryDir, dateDir);
    const files = readdirSync(fullDir).filter(f => f.endsWith('.yml'));
    for (const file of files) {
      const filePath = path.join(fullDir, file);
      sessions.push({ dateDir, filePath, sessionId: file.replace('.yml', '') });
    }
  }
  return sessions;
}

// ------------------------------------------------------------------
// Build strava archive index: activityId -> { startMs, durationSeconds }
// Session files may have wrong timestamps (timezone bug in reconstruct),
// so we use the archive's UTC start_date as ground truth.
// ------------------------------------------------------------------
const stravaLifelogDir = path.join(dataDir, 'users', 'kckern', 'lifelog', 'strava');
const olderArchiveDir = path.join(baseDir, 'media', 'archives', 'strava');

function buildStravaIndex() {
  const index = new Map(); // activityId -> { startMs, durationSeconds }

  for (const dir of [stravaLifelogDir, olderArchiveDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
      const archive = loadYamlSafe(path.join(dir, file));
      if (!archive?.data) continue;

      const activityId = String(archive.data.id || archive.id);
      if (index.has(activityId)) continue;

      const startDate = archive.data.start_date; // UTC ISO string
      if (!startDate) continue;

      const startMs = moment.utc(startDate).valueOf();
      const duration = archive.data.moving_time || archive.data.elapsed_time || 1800;
      index.set(activityId, { startMs, durationSeconds: duration });
    }
  }

  console.log(`Strava archive index: ${index.size} activities\n`);
  return index;
}

// ------------------------------------------------------------------
// Match plays to a session window
// ------------------------------------------------------------------
function findPlaysForSession(session, plexPlays, stravaIndex) {
  // Get real UTC start time from strava archive via activityId
  const activityId = String(
    session.participants?.kckern?.strava?.activityId || ''
  );
  const archiveInfo = stravaIndex.get(activityId);

  let startMs, endMs;
  if (archiveInfo) {
    // Use strava archive's UTC start_date (ground truth)
    startMs = archiveInfo.startMs;
    endMs = startMs + archiveInfo.durationSeconds * 1000;
  } else {
    // Fallback: session file timestamps (may be wrong for non-PST activities)
    const startStr = session.session?.start;
    const endStr = session.session?.end;
    if (!startStr || !endStr) return [];
    const tz = session.timezone || TIMEZONE;
    startMs = moment.tz(startStr, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();
    endMs = moment.tz(endStr, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();
  }

  // Window: 5 min before session start to 5 min after session end
  const windowStart = startMs - 5 * 60 * 1000;
  const windowEnd = endMs + 5 * 60 * 1000;

  const candidates = plexPlays.filter(p => p.timestamp >= windowStart && p.timestamp <= windowEnd);

  // Filter out batch "mark as watched" clusters: if more than 5 plays
  // share the same second, they're not real plays
  const bySecond = new Map();
  for (const p of candidates) {
    const sec = Math.floor(p.timestamp / 1000);
    if (!bySecond.has(sec)) bySecond.set(sec, []);
    bySecond.get(sec).push(p);
  }

  const realPlays = [];
  for (const [sec, group] of bySecond) {
    if (group.length <= 5) {
      realPlays.push(...group);
    }
  }

  return realPlays;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
const plexPlays = await fetchPlexHistory();
const stravaIndex = buildStravaIndex();
const sessionEntries = getAllSessions();

console.log(`Sessions on disk: ${sessionEntries.length}\n`);

let enriched = 0;
let skippedHasMedia = 0;
let skippedNoMatch = 0;

for (const entry of sessionEntries) {
  const session = loadYamlSafe(entry.filePath);
  if (!session) continue;

  // Skip sessions that already have media events
  const existingEvents = session.timeline?.events || [];
  const hasMediaEvents = existingEvents.some(e => e.type === 'media_start');
  if (hasMediaEvents) {
    skippedHasMedia++;
    continue;
  }

  // Find matching Plex plays
  const matchedPlays = findPlaysForSession(session, plexPlays, stravaIndex);
  if (matchedPlays.length === 0) {
    skippedNoMatch++;
    continue;
  }

  // De-duplicate by ratingKey (keep first occurrence)
  const seen = new Set();
  const uniquePlays = [];
  for (const p of matchedPlays) {
    const key = p.ratingKey || p.title;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePlays.push(p);
    }
  }

  // Build media events
  const tz = session.timezone || TIMEZONE;
  const sessionStartMs = moment.tz(session.session.start, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();

  const mediaEvents = uniquePlays.map(p => ({
    timestamp: p.timestamp,
    offsetMs: Math.max(0, p.timestamp - sessionStartMs),
    type: 'media_start',
    data: {
      source: 'plex',
      ...(p.ratingKey ? { mediaId: p.ratingKey, plexId: p.ratingKey } : {}),
      title: p.title,
      ...(p.durationMs > 0 ? { durationSeconds: Math.round(p.durationMs / 1000) } : {}),
    },
  }));

  // Build summary.media list
  const mediaList = uniquePlays
    .filter(p => p.ratingKey)
    .map(p => `plex:${p.ratingKey}`);

  const titles = uniquePlays.map(p => p.title).join(', ');

  enriched++;
  const dateStr = session.session?.date || entry.dateDir;
  console.log(`[ENRICH] ${dateStr} ${entry.sessionId} | ${uniquePlays.length} media (${titles})`);

  if (writeMode) {
    // Update session
    session.timeline.events = mediaEvents;
    if (!session.summary) session.summary = {};
    session.summary.media = mediaList.length > 0 ? mediaList : undefined;

    saveYaml(entry.filePath, session);
  }
}

console.log(`\nDone! ${sessionEntries.length} sessions scanned: ${enriched} enriched, ${skippedHasMedia} already had media, ${skippedNoMatch} no Plex match.`);
