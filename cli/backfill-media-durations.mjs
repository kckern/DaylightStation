#!/usr/bin/env node

/**
 * Backfill Media Durations & End Timestamps
 *
 * Fixes two bugs in affected Feb 2026 fitness sessions:
 *   Bug A: stale durationSeconds (Plex metadata placeholders like 2, 10, 15, 17)
 *   Bug B: missing end timestamps (null or start==end in media events)
 *
 * Dry-run by default. Pass --write to persist changes.
 *
 * Usage:
 *   node cli/backfill-media-durations.mjs                    # dry-run
 *   node cli/backfill-media-durations.mjs --write             # write mode
 *   node cli/backfill-media-durations.mjs --scope=b           # only Bug B
 *   node cli/backfill-media-durations.mjs --scope=a --write   # only Bug A, write mode
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { computeSessionEndMs, findBrokenEndEvents, findStaleDurationEvents } from './backfill-media-durations.lib.mjs';

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
await initConfigService(dataDir);

// ------------------------------------------------------------------
// Parse CLI args
// ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const scopeArg = args.find(a => a.startsWith('--scope='));
const scope = scopeArg ? scopeArg.split('=')[1] : 'all'; // 'a', 'b', or 'all'

console.log(`Backfill media durations & end timestamps`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}`);
console.log(`Scope: ${scope === 'all' ? 'Bug A + Bug B' : `Bug ${scope.toUpperCase()} only`}\n`);

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const fitnessHistoryDir = path.join(dataDir, 'household', 'history', 'fitness');

// Plex auth (for workout video duration lookups)
const plexAuthPath = path.join(dataDir, 'household', 'auth', 'plex');
const plexAuth = loadYamlSafe(plexAuthPath);
const PLEX_URL = 'https://plex.kckern.net';
const PLEX_TOKEN = plexAuth?.token;

// ------------------------------------------------------------------
// Session helpers
// ------------------------------------------------------------------

/**
 * Load a session YAML by sessionId.
 * SessionId format: YYYYMMDDHHmmss → directory: YYYY-MM-DD
 */
function sessionPath(sessionId) {
  const dateDir = `${sessionId.slice(0, 4)}-${sessionId.slice(4, 6)}-${sessionId.slice(6, 8)}`;
  return path.join(fitnessHistoryDir, dateDir, sessionId);
}

function loadSession(sessionId) {
  const p = sessionPath(sessionId);
  const data = loadYamlSafe(p);
  if (!data) {
    console.error(`  SKIP: Could not load ${p}.yml`);
    return null;
  }
  return data;
}

function saveSession(sessionId, data) {
  const p = sessionPath(sessionId);
  saveYaml(p, data);
}

// ------------------------------------------------------------------
// Plex API
// ------------------------------------------------------------------

async function fetchPlexDurationMs(ratingKey) {
  if (!PLEX_TOKEN) {
    console.error('  WARN: No Plex token — cannot fetch duration');
    return null;
  }
  const id = ratingKey.replace('plex:', '');
  const url = `${PLEX_URL}/library/metadata/${id}?X-Plex-Token=${PLEX_TOKEN}`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      console.error(`  WARN: Plex API ${resp.status} for ${ratingKey}`);
      return null;
    }
    const json = await resp.json();
    const duration = json?.MediaContainer?.Metadata?.[0]?.duration;
    return duration || null; // ms
  } catch (err) {
    console.error(`  WARN: Plex API error for ${ratingKey}: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------------
// Bug B: Fix missing end timestamps
// ------------------------------------------------------------------

// Bug B: sessions with null or start==end in media events
const BUG_B_SESSIONS = [
  '20260223185457', '20260224124137', '20260224190930',
  '20260225053400', '20260225181217', '20260226185825', '20260227054558',
];

function backfillBugB(write) {
  let totalFixed = 0;

  for (const sessionId of BUG_B_SESSIONS) {
    console.log(`  Session ${sessionId}:`);
    const data = loadSession(sessionId);
    if (!data) continue;

    const sessionEndMs = computeSessionEndMs(data.session);
    if (!sessionEndMs) {
      console.log(`    SKIP: Cannot compute session end time`);
      continue;
    }

    const broken = findBrokenEndEvents(data.timeline?.events || []);
    if (broken.length === 0) {
      console.log(`    OK: No broken end timestamps`);
      continue;
    }

    for (const evt of broken) {
      const cid = evt.data?.contentId || '?';
      const oldEnd = evt.data?.end;
      console.log(`    FIX: ${cid} end: ${oldEnd} → ${sessionEndMs}`);
      if (write) evt.data.end = sessionEndMs;
      totalFixed++;
    }

    if (write) saveSession(sessionId, data);
  }

  console.log(`  Bug B total: ${totalFixed} events fixed\n`);
}

// ------------------------------------------------------------------
// Bug A: Fix stale durationSeconds and summary durationMs
// ------------------------------------------------------------------

// Bug A: sessions with known bad durationSeconds
// source: 'plex' → fetch real duration from Plex API (workout videos)
// source: 'session' → use session.duration_seconds (gaming, runs for full session)
const BUG_A_SESSIONS = {
  '20260224124137': { 'plex:10551': { source: 'plex' } },
  '20260225053400': { 'plex:600161': { source: 'plex' } },
  '20260227054558': { 'plex:664558': { source: 'plex' } },
  '20260223185457': { 'plex:606442': { source: 'session' } },
  '20260224190930': { 'plex:606442': { source: 'session' } },
  '20260225181217': { 'plex:606442': { source: 'session' }, 'plex:649319': { source: 'session' } },
  '20260226185825': { 'plex:649319': { source: 'session' } },
};

// Cache Plex durations so we don't fetch the same ID twice
const plexDurationCache = new Map();

async function getCorrectDurationSec(contentId, spec, sessionDurationSec) {
  if (spec.source === 'session') {
    return sessionDurationSec;
  }

  // source === 'plex'
  if (plexDurationCache.has(contentId)) {
    return plexDurationCache.get(contentId);
  }

  const durationMs = await fetchPlexDurationMs(contentId);
  if (durationMs) {
    const durationSec = Math.round(durationMs / 1000);
    plexDurationCache.set(contentId, durationSec);
    return durationSec;
  }

  // Fallback: use session duration
  console.log(`    WARN: Plex lookup failed for ${contentId}, falling back to session duration`);
  return sessionDurationSec;
}

async function backfillBugA(write) {
  let totalFixed = 0;

  for (const [sessionId, contentMap] of Object.entries(BUG_A_SESSIONS)) {
    console.log(`  Session ${sessionId}:`);
    const data = loadSession(sessionId);
    if (!data) continue;

    const sessionDurSec = data.session?.duration_seconds;
    let changed = false;

    // Fix timeline event durationSeconds
    const stale = findStaleDurationEvents(data.timeline?.events || [], contentMap);
    for (const evt of stale) {
      const cid = evt.data.contentId;
      const correctSec = await getCorrectDurationSec(cid, contentMap[cid], sessionDurSec);
      if (correctSec && evt.data.durationSeconds !== correctSec) {
        console.log(`    FIX timeline: ${cid} durationSeconds: ${evt.data.durationSeconds} → ${correctSec}`);
        if (write) evt.data.durationSeconds = correctSec;
        changed = true;
        totalFixed++;
      }
    }

    // Fix summary.media[].durationMs
    for (const media of data.summary?.media || []) {
      if (!contentMap[media.contentId]) continue;
      if (media.durationMs && media.durationMs > 1000) {
        console.log(`    OK summary: ${media.contentId} durationMs=${media.durationMs} (already set)`);
        continue;
      }

      // Compute durationMs from the (now-corrected) timeline event
      const evt = (data.timeline?.events || []).find(e => e.data?.contentId === media.contentId);
      let newDurationMs;

      // Prefer end-start if both exist, end is plausible (>1s gap), and was fixed by Bug B
      const gap = (evt?.data?.end && evt?.data?.start) ? evt.data.end - evt.data.start : 0;
      if (gap > 1000) {
        newDurationMs = gap;
      } else {
        // Fall back to corrected durationSeconds
        const correctSec = await getCorrectDurationSec(media.contentId, contentMap[media.contentId], sessionDurSec);
        newDurationMs = correctSec ? correctSec * 1000 : null;
      }

      if (newDurationMs) {
        console.log(`    FIX summary: ${media.contentId} durationMs: ${media.durationMs || 0} → ${newDurationMs}`);
        if (write) media.durationMs = newDurationMs;
        changed = true;
        totalFixed++;
      }
    }

    if (changed && write) saveSession(sessionId, data);
  }

  console.log(`  Bug A total: ${totalFixed} fields fixed\n`);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  console.log(`Fitness history dir: ${fitnessHistoryDir}`);
  console.log(`Plex token: ${PLEX_TOKEN ? 'found' : 'MISSING'}\n`);

  // Bug B first (fixes end timestamps, which Bug A may use for summary.durationMs)
  if (scope === 'all' || scope === 'b') {
    console.log('=== Bug B: Fix missing end timestamps ===\n');
    backfillBugB(writeMode);
  }

  if (scope === 'all' || scope === 'a') {
    console.log('=== Bug A: Fix stale durationSeconds ===\n');
    await backfillBugA(writeMode);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
