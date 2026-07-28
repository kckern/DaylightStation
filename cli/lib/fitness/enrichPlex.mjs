/**
 * Enrich fitness sessions with Plex media events.
 *
 * Fetches play history from Plex's session-history API and backfills
 * `media_start` events into stored fitness sessions whose `timeline.events`
 * contain no media events yet. Session windows come from the Strava archive's
 * UTC `start_date` where available (ground truth), because some session files
 * carry timezone-shifted local timestamps.
 *
 * Dry-run by default; `--write` persists.
 *
 * Converted from the standalone `cli/enrich-sessions-with-plex.mjs`.
 *
 * @module cli/lib/fitness/enrichPlex
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import moment from 'moment-timezone';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

/** Defaults preserved from the standalone script. */
const DEFAULT_PLEX_URL = 'https://plex.kckern.net';
const DEFAULT_FITNESS_SECTION_ID = 14;
const TIMEZONE = 'America/Los_Angeles';

export const spec = {
  name: 'enrich-plex',
  summary: 'backfill media_start events into sessions from plex play history',
  usage: 'fitness media enrich-plex [--write]',
  details: `  --write          Apply changes (default: dry run)
  --plex-url=URL   Plex server base URL (env PLEX_URL, default ${DEFAULT_PLEX_URL})
  --section-id=N   Plex fitness library section id (env FITNESS_SECTION_ID, default ${DEFAULT_FITNESS_SECTION_ID})`,
};

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<Object>}
 */
export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['write'] });
  const writeMode = bool(flags, 'write');

  const plexUrl = str(flags, 'plex-url') || process.env.PLEX_URL || DEFAULT_PLEX_URL;
  const sectionId = str(flags, 'section-id')
    || process.env.FITNESS_SECTION_ID
    || String(DEFAULT_FITNESS_SECTION_ID);

  console.log(`Enrich fitness sessions with Plex media`);
  console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

  // ----------------------------------------------------------------
  // Plex config
  // ----------------------------------------------------------------
  const plexAuthPath = path.join(ctx.dataDir, 'household', 'auth', 'plex');
  const plexAuth = ctx.loadYamlSafe(plexAuthPath);
  if (!plexAuth?.token) {
    throw new CliError(`No Plex token found at ${plexAuthPath}`);
  }
  const plexToken = plexAuth.token;

  const fitnessHistoryDir = ctx.fitnessHistoryDir;
  if (!existsSync(fitnessHistoryDir)) {
    throw new CliError(`Fitness history directory not found: ${fitnessHistoryDir}`);
  }

  const plexPlays = await fetchPlexHistory({ plexUrl, plexToken, sectionId });
  const stravaIndex = buildStravaIndex(ctx);
  const sessionEntries = getAllSessions(fitnessHistoryDir);

  console.log(`Sessions on disk: ${sessionEntries.length}\n`);

  let enriched = 0;
  let skippedHasMedia = 0;
  let skippedNoMatch = 0;

  for (const entry of sessionEntries) {
    const session = ctx.loadYamlSafe(entry.filePath);
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
    const sessionStartMs = moment
      .tz(session.session.start, 'YYYY-MM-DD HH:mm:ss.SSS', tz)
      .valueOf();

    const mediaEvents = uniquePlays.map(p => ({
      timestamp: p.timestamp,
      offsetMs: Math.max(0, p.timestamp - sessionStartMs),
      type: 'media_start',
      data: {
        source: 'plex',
        ...(p.ratingKey ? { contentId: p.ratingKey, plexId: p.ratingKey } : {}),
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

      ctx.saveYaml(entry.filePath, session);
    }
  }

  console.log(`\nDone! ${sessionEntries.length} sessions scanned: ${enriched} enriched, ${skippedHasMedia} already had media, ${skippedNoMatch} no Plex match.`);

  return {
    writeMode,
    plexUrl,
    sectionId,
    plexPlays: plexPlays.length,
    stravaIndexSize: stravaIndex.size,
    scanned: sessionEntries.length,
    enriched,
    skippedHasMedia,
    skippedNoMatch,
  };
}

// --------------------------------------------------------------------
// Fetch all Plex fitness play history
// --------------------------------------------------------------------
/**
 * @param {{plexUrl: string, plexToken: string, sectionId: string}} opts
 * @returns {Promise<Array<{timestamp: number, dateStr: string, ratingKey: string|null, title: string, durationMs: number}>>}
 */
async function fetchPlexHistory({ plexUrl, plexToken, sectionId }) {
  const url = `${plexUrl}/status/sessions/history/all?X-Plex-Token=${plexToken}&librarySectionID=${sectionId}&sort=viewedAt:asc&X-Plex-Container-Start=0&X-Plex-Container-Size=20000`;
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

// --------------------------------------------------------------------
// Scan all fitness session files
// --------------------------------------------------------------------
/**
 * @param {string} fitnessHistoryDir
 * @returns {Array<{dateDir: string, filePath: string, sessionId: string}>}
 */
function getAllSessions(fitnessHistoryDir) {
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

// --------------------------------------------------------------------
// Build strava archive index: activityId -> { startMs, durationSeconds }
// Session files may have wrong timestamps (timezone bug in reconstruct),
// so we use the archive's UTC start_date as ground truth.
// --------------------------------------------------------------------
/**
 * @param {Object} ctx
 * @returns {Map<string, {startMs: number, durationSeconds: number}>}
 */
function buildStravaIndex(ctx) {
  const stravaLifelogDir = path.join(ctx.dataDir, 'users', 'user_1', 'lifelog', 'strava');
  const olderArchiveDir = path.join(ctx.baseDir, 'media', 'archives', 'strava');

  const index = new Map(); // activityId -> { startMs, durationSeconds }

  for (const dir of [stravaLifelogDir, olderArchiveDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
      const archive = ctx.loadYamlSafe(path.join(dir, file));
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

// --------------------------------------------------------------------
// Match plays to a session window
// --------------------------------------------------------------------
/**
 * @param {Object} session - parsed session YAML
 * @param {Array} plexPlays
 * @param {Map} stravaIndex
 * @returns {Array}
 */
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
  for (const [, group] of bySecond) {
    if (group.length <= 5) {
      realPlays.push(...group);
    }
  }

  return realPlays;
}
