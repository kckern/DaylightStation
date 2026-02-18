#!/usr/bin/env node
/**
 * rename-strava-activities.mjs
 *
 * Two-phase script:
 *   Phase 1 (--enrich):  Fill missing titles/descriptions in TSV via Plex API
 *   Phase 2 (--apply):   Rename Strava activities using the enriched TSV
 *
 * Usage:
 *   node cli/rename-strava-activities.mjs                     # dry run preview
 *   node cli/rename-strava-activities.mjs --enrich            # fetch missing titles from Plex
 *   node cli/rename-strava-activities.mjs --apply             # rename on Strava
 *   node cli/rename-strava-activities.mjs --apply --limit 10  # rename first 10
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- Config ---
const TSV_PATH = path.join(ROOT, 'strava-plex-media.tsv');
const USER_AUTH_PATH = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/users/kckern/auth/strava.yml';
const SYSTEM_AUTH_PATH = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/auth/strava.yml';
const PLEX_HOST = 'http://10.0.0.10:32400';
const PLEX_TOKEN = yaml.load(fs.readFileSync('/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/auth/plex.yml', 'utf8')).token;
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
  const url = `${PLEX_HOST}/library/metadata/${ratingKey}?X-Plex-Token=${PLEX_TOKEN}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Plex ${res.status} for key ${ratingKey}`);
  const data = await res.json();
  const item = data?.MediaContainer?.Metadata?.[0];
  if (!item) return null;

  // Build full title: "ShowName - EpisodeTitle"
  const showTitle = item.grandparentTitle || item.parentTitle || '';
  const episodeTitle = item.title || '';
  const fullTitle = showTitle && episodeTitle ? `${showTitle} - ${episodeTitle}` : episodeTitle || showTitle;

  // Build description: show name + summary
  const summary = (item.summary || '').replace(/[\t\n\r]/g, ' ').trim();
  const description = [showTitle, summary].filter(Boolean).join(' — ');

  return {
    title: fullTitle,
    description,
    type: item.type || '',
  };
}

async function plexSearch(query) {
  const url = `${PLEX_HOST}/hubs/search?query=${encodeURIComponent(query)}&limit=5&X-Plex-Token=${PLEX_TOKEN}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const hubs = data?.MediaContainer?.Hub || [];
  for (const hub of hubs) {
    for (const item of hub.Metadata || []) {
      // Match by title (case-insensitive)
      if (item.title?.toLowerCase() === query.toLowerCase()) {
        const showTitle = item.grandparentTitle || item.parentTitle || '';
        const episodeTitle = item.title || '';
        const fullTitle = showTitle && episodeTitle ? `${showTitle} - ${episodeTitle}` : episodeTitle || showTitle;
        const summary = (item.summary || '').replace(/[\t\n\r]/g, ' ').trim();
        const description = [showTitle, summary].filter(Boolean).join(' — ');
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

// --- Phase 1: Enrich from Plex ---

async function enrichFromPlex(rows) {
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
      if (meta.description && (!row.firstDesc || !row.firstDesc.includes(' — '))) { row.firstDesc = meta.description; enrichedDescs++; }
    }
    if (row.longestPlexId && cache.has(row.longestPlexId)) {
      const meta = cache.get(row.longestPlexId);
      if (meta.title) { row.longestTitle = meta.title; enrichedTitles++; }
      if (meta.description && (!row.longestDesc || !row.longestDesc.includes(' — '))) { row.longestDesc = meta.description; enrichedDescs++; }
    }
  }

  console.log(`Enriched ${enrichedTitles} missing titles, ${enrichedDescs} descriptions (from ID lookups)`);

  // Phase 2: Search by title for rows still missing descriptions
  // Covers: no plex ID, or plex ID returned 404
  const needsSearch = [];
  for (const row of rows) {
    if (row.firstTitle && (!row.firstDesc || !row.firstDesc.includes(' — '))) needsSearch.push({ row, field: 'first' });
    if (row.longestTitle && (!row.longestDesc || !row.longestDesc.includes(' — '))) needsSearch.push({ row, field: 'longest' });
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
      } catch (err) {
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

  // Build rename list from best_title/best_description
  const renames = [];
  for (const row of deduped) {
    const title = row.bestTitle || row.longestTitle || row.firstTitle;
    if (!title) continue;
    const desc = row.bestDesc || row.longestDesc || row.firstDesc || '';
    renames.push({ stravaId: row.stravaId, title, description: desc });
  }

  console.log(`Unique Strava IDs: ${deduped.length}`);
  console.log(`With usable title: ${renames.length}`);
  console.log(`Mode: ${doApply ? 'APPLY' : 'DRY RUN'}`);
  if (offset > 0) console.log(`Offset: ${offset}`);
  if (limit < Infinity) console.log(`Limit: ${limit}`);
  console.log('---');

  if (!doApply) {
    const preview = renames.slice(offset, offset + Math.min(limit, 20));
    for (const r of preview) {
      const descTag = r.description ? ` [${r.description}]` : '';
      console.log(`  ${r.stravaId} → ${r.title}${descTag}`);
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
    const { stravaId, title, description } = toProcess[i];
    try {
      await renameActivity(accessToken, stravaId, title, description);
      success++;
      console.log(`[${i + 1}/${toProcess.length}] ✓ ${stravaId} → ${title}`);
    } catch (err) {
      failed++;
      console.error(`[${i + 1}/${toProcess.length}] ✗ ${stravaId}: ${err.message}`);
      if (err.message.includes('Rate limited')) {
        console.log('Rate limited — sleeping 16 minutes...');
        await delay(16 * 60 * 1000);
        // Retry this one
        try {
          const retryToken = await getStravaToken();
          await renameActivity(retryToken, stravaId, title, description);
          success++; failed--;
          console.log(`[${i + 1}/${toProcess.length}] ✓ (retry) ${stravaId} → ${title}`);
        } catch (retryErr) {
          console.error(`[${i + 1}/${toProcess.length}] ✗ (retry) ${stravaId}: ${retryErr.message}`);
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
