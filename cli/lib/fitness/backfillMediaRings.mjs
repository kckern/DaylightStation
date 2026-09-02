/**
 * Attribute rings to each stored media item, so effort-based primary selection
 * works on history and not only on sessions saved from now on.
 *
 * `selectPrimaryMedia` prefers rings over played time — a hard 20 minutes is
 * the main workout, an hour of gentle cooldown is not — but it only does so
 * when EVERY candidate carries a figure. `buildSessionSummary` writes those at
 * save time, so without this pass every session already on disk falls back to
 * duration and the criterion changes nothing about what you can actually look
 * at today.
 *
 * The cumulative ring series is already stored on every session. An item's
 * contribution is the difference across the ticks it covers, which is exactly
 * what `ringsForSpan` computes for the live path — imported here rather than
 * reimplemented, so the backfilled numbers cannot drift from the ones the app
 * writes.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * Write a zero it cannot justify. An item the series does not cover scores
 * `null` and is left without a figure, which makes the whole session fall back
 * to duration. That is deliberate: a session whose timeline was truncated by a
 * reload would otherwise score its lost workout at 0 rings and hand primary to
 * whatever played afterwards — the precise inversion this feature exists to
 * fix.
 *
 * Dry-run by default.
 *
 * @module cli/lib/fitness/backfillMediaRings
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { ringsForSpan } from '#frontend/hooks/fitness/buildSessionSummary.js';
import { decodeStoredSeries } from './seriesWire.mjs';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

export const spec = {
  name: 'backfill-rings',
  summary: 'attribute rings to each stored media item so effort ranking works on history',
  usage: 'fitness media backfill-rings [--apply] [--since=YYYY-MM-DD]',
  details: `  --apply           Write changes (default: dry run)
  --since=DATE      Only scan date folders >= YYYY-MM-DD`,
};

/** `'YYYY-MM-DD HH:mm:ss.SSS'` → epoch ms, in the session's own (local) zone. */
export function parseClock(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = new Date(value.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Some sessions store `summary.media` as bare id STRINGS rather than objects —
 * `enrich-plex` writes `['plex:123', …]`. Those carry no fields to score and
 * must be stepped over, not indexed into.
 */
const isScorable = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);

const isAudio = (item) => item?.mediaType === 'audio' || item?.contentType === 'track' || !!item?.artist;

/**
 * Rings per `summary.media` item for one session, keyed by contentId.
 *
 * `summary.media` carries no timestamps, so each item is matched to its
 * timeline event by contentId to recover the span it played over.
 *
 * @param {Object} session - parsed session document
 * @returns {Map<string, number>} contentId -> rings (only where computable)
 */
export function ringsByContentId(session) {
  const out = new Map();
  const startMs = parseClock(session?.session?.start);
  if (startMs == null) return out;

  const intervalSeconds = Number(session?.timeline?.interval_seconds) || 5;
  const series = decodeStoredSeries(session?.timeline?.series || {});
  const cumulative = series['global:rings'] || series['global:rings_total'] || null;
  if (!cumulative) return out;

  for (const event of session?.timeline?.events || []) {
    if (event?.type !== 'media') continue;
    const d = event.data || {};
    if (!d.contentId || isAudio(d)) continue;
    const rings = ringsForSpan(cumulative, d.start, d.end, startMs, intervalSeconds);
    if (rings != null) out.set(d.contentId, rings);
  }
  return out;
}

function getSessionFiles(historyDir, since) {
  const dates = readdirSync(historyDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => !since || d >= since)
    .sort();
  const out = [];
  for (const date of dates) {
    const dir = path.join(historyDir, date);
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names.filter(n => n.endsWith('.yml'))) {
      out.push({ date, sessionId: name.replace(/\.yml$/, ''), filePath: path.join(dir, name) });
    }
  }
  return out;
}

export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['apply'] });
  const APPLY = bool(flags, 'apply');
  const SINCE = str(flags, 'since') || null;

  const historyDir = ctx.fitnessHistoryDir;
  if (!existsSync(historyDir)) throw new CliError(`Fitness history directory not found: ${historyDir}`);

  console.log('Attribute rings to stored media items');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${SINCE ? ` | since ${SINCE}` : ''}\n`);

  let scanned = 0;
  let filesChanged = 0;
  let itemsScored = 0;
  let filesFullyScored = 0;
  let filesNoSeries = 0;
  let itemsRemoved = 0;

  for (const entry of getSessionFiles(historyDir, SINCE)) {
    const session = ctx.loadYamlSafe(entry.filePath);
    const media = session?.summary?.media;
    if (!Array.isArray(media) || !media.length) continue;
    scanned++;

    const rings = ringsByContentId(session);
    const videos = media.filter(m => isScorable(m) && !isAudio(m));

    let changed = 0;
    let removed = 0;
    for (const item of videos) {
      const value = rings.get(item.contentId);
      if (value == null) {
        // A figure that can no longer be justified must GO, not linger. An
        // earlier pass wrote one by clamping past the end of a truncated
        // series, which credited a whole session's rings to a single workout.
        if ('rings' in item) { delete item.rings; removed++; }
        continue;
      }
      if (item.rings === value) continue;
      item.rings = value;
      changed++;
    }
    if (!rings.size && !removed) { filesNoSeries++; continue; }
    if (!changed && !removed) continue;
    itemsRemoved += removed;

    itemsScored += changed;
    filesChanged++;
    // Only a session where EVERY video is scored will actually rank on rings;
    // report that separately so the number means what a reader expects.
    const complete = videos.every(m => Number.isFinite(m.rings));
    if (complete) filesFullyScored++;

    const parts = [];
    if (changed) parts.push(`${changed} scored`);
    if (removed) parts.push(`${removed} unscored (no longer justifiable)`);
    console.log(`  ${entry.date} ${entry.sessionId} | ${parts.join(', ')}${complete ? '' : ' (partial — will still rank on time)'}`);
    if (APPLY) ctx.saveYaml(entry.filePath, session);
  }

  console.log(`\nScanned ${scanned} sessions with media.`);
  console.log(`  scored:            ${itemsScored} items across ${filesChanged} sessions`);
  console.log(`  fully scored:      ${filesFullyScored} sessions (these now rank on effort)`);
  console.log(`  unscored:          ${itemsRemoved} items whose figure could not be justified`);
  console.log(`  no ring series:    ${filesNoSeries} sessions (left on played time)`);
  if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply.');

  return { apply: APPLY, scanned, itemsScored, filesChanged, filesFullyScored, filesNoSeries };
}
