#!/usr/bin/env node
/**
 * rename-strava-activities.mjs
 *
 * Renames Strava activities using DaylightStation session data.
 *
 * Primary path: find matching fitness session → buildStravaDescription() (canonical format)
 * Fallback: TSV-based titles formatted to match buildStravaDescription conventions
 *
 * Phases:
 *   Phase 1 (--enrich):  Fill missing titles/descriptions in TSV via Plex API
 *   Phase 2 (--apply):   Rename on Strava (session-based primary, TSV fallback)
 *
 * Usage:
 *   node cli/rename-strava-activities.mjs                     # dry run preview
 *   node cli/rename-strava-activities.mjs --enrich            # fetch Plex metadata into TSV
 *   node cli/rename-strava-activities.mjs --apply             # rename on Strava
 *   node cli/rename-strava-activities.mjs --apply --limit 10  # rename first 10
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import { buildStravaDescription } from '../backend/src/1_adapters/fitness/buildStravaDescription.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

// --- Config (environment-aware) ---
const isDocker = fs.existsSync('/.dockerenv');
const BASE_PATH = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
if (!BASE_PATH) {
  console.error('DAYLIGHT_BASE_PATH not set in .env — cannot locate data directory.');
  process.exit(1);
}
const DATA_DIR = path.join(BASE_PATH, 'data');

const TSV_PATH = path.join(ROOT, 'strava-plex-media.tsv');
const USER_AUTH_PATH = path.join(DATA_DIR, 'users', 'kckern', 'auth', 'strava.yml');
const SYSTEM_AUTH_PATH = path.join(DATA_DIR, 'system', 'auth', 'strava.yml');
const FITNESS_HISTORY_DIR = path.join(DATA_DIR, 'household', 'history', 'fitness');
const PLEX_HOST = 'http://10.0.0.10:32400';

let PLEX_TOKEN = null;
try {
  PLEX_TOKEN = yaml.load(fs.readFileSync(path.join(DATA_DIR, 'household', 'auth', 'plex.yml'), 'utf8')).token;
} catch { /* Plex auth unavailable — Plex lookups will be skipped */ }

const RATE_LIMIT_MS = 12000; // 12s between calls = 5/min = 75 per 15min (under 100 limit)

// --- Parse args ---
const args = process.argv.slice(2);
const doEnrich = args.includes('--enrich');
const doApply = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const offsetIdx = args.indexOf('--offset');
const offset = offsetIdx !== -1 ? parseInt(args[offsetIdx + 1], 10) : 0;

// --- TSV helpers ---

const HEADER = ['strava_id', 'first_plex_id', 'first_title', 'first_description', 'longest_plex_id', 'longest_title', 'longest_description', 'best_title', 'best_description'];

function readTsv() {
  const raw = fs.readFileSync(TSV_PATH, 'utf8').trim().split('\n');
  return raw.slice(1).map(line => {
    const cols = line.split('\t');
    return {
      stravaId: cols[0] || '',
      firstPlexId: cols[1] || '',
      firstTitle: cols[2] || '',
      firstDesc: cols[3] || '',
      longestPlexId: cols[4] || '',
      longestTitle: cols[5] || '',
      longestDesc: cols[6] || '',
      bestTitle: cols[7] || '',
      bestDesc: cols[8] || '',
    };
  });
}

function writeTsv(rows) {
  const lines = [HEADER.join('\t')];
  for (const r of rows) {
    lines.push([r.stravaId, r.firstPlexId, r.firstTitle, r.firstDesc, r.longestPlexId, r.longestTitle, r.longestDesc, r.bestTitle, r.bestDesc].join('\t'));
  }
  fs.writeFileSync(TSV_PATH, lines.join('\n') + '\n');
}

// --- Plex API ---

async function plexGetMetadata(ratingKey) {
  if (!PLEX_TOKEN) return null;
  const url = `${PLEX_HOST}/library/metadata/${ratingKey}?X-Plex-Token=${PLEX_TOKEN}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Plex ${res.status} for key ${ratingKey}`);
  const data = await res.json();
  const item = data?.MediaContainer?.Metadata?.[0];
  if (!item) return null;

  const showTitle = item.grandparentTitle || item.parentTitle || '';
  const episodeTitle = item.title || '';
  const fullTitle = showTitle && episodeTitle ? `${showTitle} - ${episodeTitle}` : episodeTitle || showTitle;
  const summary = (item.summary || '').replace(/[\t\n\r]/g, ' ').trim();
  const description = [showTitle, summary].filter(Boolean).join(' \u2014 ');

  return {
    // Computed fields (for TSV enrichment)
    title: fullTitle,
    description,
    type: item.type || '',
    // Raw fields (for session hydration)
    grandparentTitle: item.grandparentTitle || '',
    parentTitle: item.parentTitle || '',
    rawTitle: item.title || '',
    summary,
  };
}

async function plexSearch(query) {
  if (!PLEX_TOKEN) return null;
  const url = `${PLEX_HOST}/hubs/search?query=${encodeURIComponent(query)}&limit=5&X-Plex-Token=${PLEX_TOKEN}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const hubs = data?.MediaContainer?.Hub || [];
  for (const hub of hubs) {
    for (const item of hub.Metadata || []) {
      if (item.title?.toLowerCase() === query.toLowerCase()) {
        const showTitle = item.grandparentTitle || item.parentTitle || '';
        const episodeTitle = item.title || '';
        const fullTitle = showTitle && episodeTitle ? `${showTitle} - ${episodeTitle}` : episodeTitle || showTitle;
        const summary = (item.summary || '').replace(/[\t\n\r]/g, ' ').trim();
        const description = [showTitle, summary].filter(Boolean).join(' \u2014 ');
        return { ratingKey: item.ratingKey, title: fullTitle, description };
      }
    }
  }
  return null;
}

// --- Strava API ---

async function refreshStravaToken() {
  const systemAuth = yaml.load(fs.readFileSync(SYSTEM_AUTH_PATH, 'utf8'));
  const userAuth = yaml.load(fs.readFileSync(USER_AUTH_PATH, 'utf8'));

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: systemAuth.client_id,
      client_secret: systemAuth.client_secret,
      grant_type: 'refresh_token',
      refresh_token: userAuth.refresh,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const updatedAuth = {
    refresh: data.refresh_token || userAuth.refresh,
    access_token: data.access_token,
    expires_at: data.expires_at,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(USER_AUTH_PATH, yaml.dump(updatedAuth));
  return data.access_token;
}

async function getStravaToken() {
  const userAuth = yaml.load(fs.readFileSync(USER_AUTH_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (userAuth.access_token && userAuth.expires_at > now + 60) return userAuth.access_token;
  console.log('Refreshing Strava access token...');
  return refreshStravaToken();
}

async function renameActivity(accessToken, activityId, newName, description) {
  const body = { name: newName };
  if (description) body.description = description;

  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after') || '900';
    throw new Error(`Rate limited. Retry after ${retryAfter}s`);
  }
  if (!res.ok) throw new Error(`Rename failed for ${activityId}: ${res.status} ${await res.text()}`);
  return res.json();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Session lookup ---

/**
 * Scan fitness history and build activityId → session data map.
 */
function buildActivitySessionMap() {
  const map = new Map();
  if (!fs.existsSync(FITNESS_HISTORY_DIR)) {
    console.log('Fitness history not found \u2014 session enrichment disabled');
    return map;
  }

  let fileCount = 0;
  let dateDirs;
  try {
    dateDirs = fs.readdirSync(FITNESS_HISTORY_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch { return map; }

  for (const dateDir of dateDirs) {
    const dirPath = path.join(FITNESS_HISTORY_DIR, dateDir);
    let sessionFiles;
    try { sessionFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.yml')); } catch { continue; }

    for (const file of sessionFiles) {
      try {
        const data = yaml.load(fs.readFileSync(path.join(dirPath, file), 'utf8'));
        if (!data?.participants) continue;
        fileCount++;

        for (const participant of Object.values(data.participants)) {
          const actId = participant?.strava?.activityId;
          if (actId) map.set(String(actId), data);
        }
      } catch { /* skip corrupt files */ }
    }
  }

  console.log(`Session map: ${map.size} activities from ${fileCount} sessions`);
  return map;
}

/**
 * Hydrate session media events with Plex metadata (grandparentTitle, description).
 * Mutates session in place. Gracefully skips if Plex is unavailable.
 */
async function hydrateSessionMedia(session) {
  if (!PLEX_TOKEN) return;

  const events = session?.timeline?.events || [];
  for (const event of events) {
    if (event.type !== 'media' || !event.data) continue;
    // Skip if already has show-level metadata
    if (event.data.grandparentTitle || event.data.showTitle) continue;

    const contentId = event.data.contentId;
    if (!contentId?.startsWith('plex:')) continue;

    const ratingKey = contentId.split(':')[1];
    try {
      const meta = await plexGetMetadata(ratingKey);
      if (meta) {
        if (meta.grandparentTitle) event.data.grandparentTitle = meta.grandparentTitle;
        if (meta.summary) event.data.description = meta.summary;
      }
    } catch { /* skip Plex errors */ }
    await delay(100);
  }
}

// --- Dedupe ---

function dedupeRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const existing = byId.get(row.stravaId);
    if (!existing) {
      byId.set(row.stravaId, row);
    } else {
      const existingTitle = existing.longestTitle || existing.firstTitle;
      const newTitle = row.longestTitle || row.firstTitle;
      if (!existingTitle && newTitle) byId.set(row.stravaId, row);
    }
  }
  return [...byId.values()];
}

// --- Fallback ---

/**
 * Build enrichment payload from TSV data, formatted to match buildStravaDescription output.
 * Used when no session YAML is available.
 */
function buildFallbackPayload(row) {
  const rawTitle = row.bestTitle || row.longestTitle || row.firstTitle;
  if (!rawTitle) return null;

  // Title: em dash without spaces (matching buildStravaDescription)
  const name = rawTitle.includes(' - ')
    ? rawTitle.replace(' - ', '\u2014')
    : rawTitle;

  // Description: match buildStravaDescription emoji format
  const rawDesc = row.bestDesc || row.longestDesc || row.firstDesc || '';
  let description = null;

  if (rawDesc) {
    // rawDesc is typically "ShowName — summary" from Plex enrichment
    const emDashIdx = rawDesc.indexOf(' \u2014 ');
    if (emDashIdx !== -1) {
      const summary = rawDesc.substring(emDashIdx + 3).trim();
      const label = rawTitle.includes(' - ')
        ? rawTitle.replace(' - ', ' \u2014 ')
        : rawTitle;
      description = `\uD83D\uDDA5\uFE0F ${label}\n${summary}`;
    }
  }

  return { name, description };
}

// --- Resolve payload ---

/**
 * Resolve enrichment payload: session-based (primary) or TSV (fallback).
 */
async function resolvePayload(session, row) {
  // Primary: session-based via buildStravaDescription
  if (session) {
    try {
      await hydrateSessionMedia(session);
      const result = buildStravaDescription(session, {});
      if (result?.name) return { ...result, source: 'session' };
    } catch { /* fall through to TSV */ }
  }

  // Fallback: TSV-based with canonical formatting
  const fallback = buildFallbackPayload(row);
  if (fallback) return { ...fallback, source: 'tsv' };

  return null;
}

// --- Phase 1: Enrich from Plex ---

async function enrichFromPlex(rows) {
  if (!PLEX_TOKEN) {
    console.log('Plex token unavailable \u2014 skipping enrichment.');
    return rows;
  }

  // Collect ALL unique plex IDs for canonical title lookup
  const needsLookup = new Set();
  for (const row of rows) {
    if (row.firstPlexId) needsLookup.add(row.firstPlexId);
    if (row.longestPlexId) needsLookup.add(row.longestPlexId);
  }

  console.log(`Plex IDs needing lookup: ${needsLookup.size}`);
  if (needsLookup.size === 0) {
    console.log('Nothing to enrich.');
    return rows;
  }

  // Fetch metadata for each unique Plex ID
  const cache = new Map();
  const ids = [...needsLookup];
  let fetched = 0;
  let errors = 0;

  for (const plexId of ids) {
    try {
      const meta = await plexGetMetadata(plexId);
      if (meta) cache.set(plexId, meta);
      fetched++;
      if (fetched % 50 === 0) console.log(`  Fetched ${fetched}/${ids.length}...`);
    } catch (err) {
      errors++;
      console.error(`  Plex error for ${plexId}: ${err.message}`);
    }
    await delay(100); // light rate limit for Plex
  }

  console.log(`Fetched ${fetched} Plex items (${errors} errors)`);

  // Apply metadata back to rows (from ID lookups)
  // Always prefer Plex's canonical "Show - Episode" title over session YAML titles
  let enrichedTitles = 0;
  let enrichedDescs = 0;
  for (const row of rows) {
    if (row.firstPlexId && cache.has(row.firstPlexId)) {
      const meta = cache.get(row.firstPlexId);
      if (meta.title) { row.firstTitle = meta.title; enrichedTitles++; }
      if (meta.description && (!row.firstDesc || !row.firstDesc.includes(' \u2014 '))) { row.firstDesc = meta.description; enrichedDescs++; }
    }
    if (row.longestPlexId && cache.has(row.longestPlexId)) {
      const meta = cache.get(row.longestPlexId);
      if (meta.title) { row.longestTitle = meta.title; enrichedTitles++; }
      if (meta.description && (!row.longestDesc || !row.longestDesc.includes(' \u2014 '))) { row.longestDesc = meta.description; enrichedDescs++; }
    }
  }

  console.log(`Enriched ${enrichedTitles} missing titles, ${enrichedDescs} descriptions (from ID lookups)`);

  // Phase 2: Search by title for rows still missing descriptions
  // Covers: no plex ID, or plex ID returned 404
  const needsSearch = [];
  for (const row of rows) {
    if (row.firstTitle && (!row.firstDesc || !row.firstDesc.includes(' \u2014 '))) needsSearch.push({ row, field: 'first' });
    if (row.longestTitle && (!row.longestDesc || !row.longestDesc.includes(' \u2014 '))) needsSearch.push({ row, field: 'longest' });
  }

  if (needsSearch.length > 0) {
    console.log(`\nSearching Plex for ${needsSearch.length} items by title...`);
    let searchHits = 0;

    for (const { row, field } of needsSearch) {
      const fullTitle = field === 'first' ? row.firstTitle : row.longestTitle;
      // Parse "ShowName - EpisodeTitle" format
      const dashIdx = fullTitle.indexOf(' - ');
      if (dashIdx === -1) continue;

      const episodeTitle = fullTitle.substring(dashIdx + 3).trim();
      if (!episodeTitle) continue;

      try {
        const searchResult = await plexSearch(episodeTitle);
        if (searchResult) {
          if (field === 'first') {
            if (!row.firstPlexId) row.firstPlexId = searchResult.ratingKey;
            row.firstDesc = searchResult.description;
          } else {
            if (!row.longestPlexId) row.longestPlexId = searchResult.ratingKey;
            row.longestDesc = searchResult.description;
          }
          searchHits++;
        }
      } catch {
        // skip search errors
      }
      await delay(150);
    }

    console.log(`Search matched ${searchHits}/${needsSearch.length} items`);
  }

  return rows;
}

// --- Phase 2: Rename on Strava ---

async function renameOnStrava(rows) {
  const deduped = dedupeRows(rows);
  const sessionMap = buildActivitySessionMap();

  // Build rename candidates
  const renames = [];
  for (const row of deduped) {
    const session = sessionMap.get(row.stravaId) || null;
    const tsvTitle = row.bestTitle || row.longestTitle || row.firstTitle;
    if (!session && !tsvTitle) continue;
    renames.push({ stravaId: row.stravaId, session, row });
  }

  const sessionCount = renames.filter(r => r.session).length;
  const fallbackCount = renames.filter(r => !r.session).length;

  console.log(`Unique Strava IDs: ${deduped.length}`);
  console.log(`With session: ${sessionCount}, TSV fallback: ${fallbackCount}`);
  console.log(`Mode: ${doApply ? 'APPLY' : 'DRY RUN'}`);
  if (offset > 0) console.log(`Offset: ${offset}`);
  if (limit < Infinity) console.log(`Limit: ${limit}`);
  console.log('---');

  if (!doApply) {
    const preview = renames.slice(offset, offset + Math.min(limit, 20));
    for (const r of preview) {
      if (r.session) {
        const result = buildStravaDescription(r.session, {});
        const title = result?.name || '(needs Plex hydration)';
        console.log(`  ${r.stravaId} \u2192 [session] ${title}`);
      } else {
        const fb = buildFallbackPayload(r.row);
        console.log(`  ${r.stravaId} \u2192 [tsv] ${fb?.name || '?'}`);
      }
    }
    const remaining = renames.length - offset;
    if (remaining > 20) console.log(`  ... and ${remaining - 20} more`);
    console.log('\nRun with --apply to execute.');
    return;
  }

  const accessToken = await getStravaToken();
  const toProcess = renames.slice(offset, offset + limit);
  let success = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { stravaId, session, row } = toProcess[i];
    try {
      const payload = await resolvePayload(session, row);
      if (!payload?.name) {
        console.log(`[${i + 1}/${toProcess.length}] - ${stravaId}: no enrichment available`);
        continue;
      }

      await renameActivity(accessToken, stravaId, payload.name, payload.description);
      success++;
      console.log(`[${i + 1}/${toProcess.length}] \u2713 ${stravaId} \u2192 ${payload.name} [${payload.source}]`);
    } catch (err) {
      failed++;
      console.error(`[${i + 1}/${toProcess.length}] \u2717 ${stravaId}: ${err.message}`);
      if (err.message.includes('Rate limited')) {
        console.log('Rate limited \u2014 sleeping 16 minutes...');
        await delay(16 * 60 * 1000);
        try {
          const retryToken = await getStravaToken();
          const payload = await resolvePayload(session, row);
          if (payload?.name) {
            await renameActivity(retryToken, stravaId, payload.name, payload.description);
            success++; failed--;
            console.log(`[${i + 1}/${toProcess.length}] \u2713 (retry) ${stravaId} \u2192 ${payload.name}`);
          }
        } catch (retryErr) {
          console.error(`[${i + 1}/${toProcess.length}] \u2717 (retry) ${stravaId}: ${retryErr.message}`);
        }
      }
    }
    if (i < toProcess.length - 1) await delay(RATE_LIMIT_MS);
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
}

// --- Main ---

async function main() {
  const rows = readTsv();
  console.log(`Loaded ${rows.length} TSV rows`);

  if (doEnrich) {
    const enriched = await enrichFromPlex(rows);
    writeTsv(enriched);
    console.log('TSV updated with Plex metadata.');
  }

  if (doApply || (!doEnrich && !doApply)) {
    // If neither flag, show dry run preview
    await renameOnStrava(rows);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
