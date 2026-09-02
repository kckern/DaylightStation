/**
 * Rejoin media events that a mid-workout reload split in half.
 *
 * When the kiosk reloads while something is playing, the `media_start` lives in
 * the pre-reload page and the `media_end` in the post-reload one. Each save
 * consolidates only what its own page saw, so the session ends up with TWO
 * events for one play under the same `contentId` — one carrying `start` with a
 * null `end`, the other carrying `end` with a null `start`.
 *
 * Neither half has a measurable span, so `summary.media` computes
 * `durationMs = end - start` as 0 and the item drops out of primary selection
 * entirely. Session 20260901154746 titled itself after a 31-minute ride because
 * the 37-minute Insanity workout beside it registered as zero.
 *
 * The two halves are rejoinable precisely because they share a `contentId`:
 * take `start` from the first, `end` from the second, and prefer the richer
 * (start-half) metadata, since the end-half typically has a null title.
 *
 * Rare — 2 sessions in 314 at the time of writing — so this is a repair, not a
 * routine pass. The forward fix belongs in the reload/resume path.
 *
 * Dry-run by default.
 *
 * @module cli/lib/fitness/pairOrphanMedia
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

export const spec = {
  name: 'pair-orphans',
  summary: 'rejoin media events a mid-workout reload split into start/end halves',
  usage: 'fitness media pair-orphans [--apply] [--since=YYYY-MM-DD]',
  details: `  --apply           Write changes (default: dry run)
  --since=DATE      Only scan date folders >= YYYY-MM-DD`,
};

/**
 * Find rejoinable half-pairs among a session's media events.
 *
 * A pair qualifies only when the halves share a contentId, exactly one has a
 * lone `start` and one a lone `end`, and the end is after the start. Anything
 * looser risks welding two genuinely separate plays of the same video into one
 * span, which would overstate it — the opposite of the defect.
 *
 * @param {Array} events - `timeline.events`
 * @returns {Array<{contentId: string, startEvent: Object, endEvent: Object, spanMs: number}>}
 */
export function findOrphanPairs(events) {
  if (!Array.isArray(events)) return [];
  const byId = new Map();
  for (const event of events) {
    if (event?.type !== 'media') continue;
    const d = event.data;
    if (!d || d.contentType === 'track' || d.artist) continue;
    if (!d.contentId) continue;
    if (!byId.has(d.contentId)) byId.set(d.contentId, []);
    byId.get(d.contentId).push(event);
  }

  const pairs = [];
  for (const [contentId, list] of byId) {
    const openStarts = list.filter(e => Number.isFinite(e.data.start) && !Number.isFinite(e.data.end));
    const openEnds = list.filter(e => !Number.isFinite(e.data.start) && Number.isFinite(e.data.end));
    if (openStarts.length !== 1 || openEnds.length !== 1) continue;
    const [startEvent] = openStarts;
    const [endEvent] = openEnds;
    const spanMs = endEvent.data.end - startEvent.data.start;
    if (!(spanMs > 0)) continue;
    pairs.push({ contentId, startEvent, endEvent, spanMs });
  }
  return pairs;
}

/**
 * Rejoin the pairs in place: the start-half absorbs the end, the end-half is
 * dropped. Returns the new events array; does not mutate the input array's
 * membership, though the surviving event objects are updated in place.
 */
export function applyPairs(events, pairs) {
  const drop = new Set(pairs.map(p => p.endEvent));
  for (const { startEvent, endEvent } of pairs) {
    startEvent.data.end = endEvent.data.end;
    // The end-half sometimes carries fields the start-half lacks (parentTitle
    // arrives with the later record). Fill gaps; never overwrite.
    for (const [key, value] of Object.entries(endEvent.data)) {
      if (value == null || key === 'start' || key === 'end') continue;
      if (startEvent.data[key] == null) startEvent.data[key] = value;
    }
  }
  return events.filter(e => !drop.has(e));
}


/**
 * Bring `summary.media` back in line with the rejoined events.
 *
 * `summary.media` is STORED, not derived on read, so rejoining the timeline
 * halves alone leaves the summary — and therefore the header, the session list,
 * and primary selection — still reading two 0-minute entries. For each
 * contentId that appears more than once, keep the richest entry, give it the
 * played span from the (now whole) timeline event, and drop the rest.
 *
 * @param {Object} session - parsed session document (mutated)
 * @returns {number} number of summary entries removed
 */
export function reconcileSummaryMedia(session) {
  const list = session?.summary?.media;
  if (!Array.isArray(list)) return 0;

  const spanById = new Map();
  for (const event of session?.timeline?.events || []) {
    if (event?.type !== 'media') continue;
    const d = event.data || {};
    if (!d.contentId || !Number.isFinite(d.start) || !Number.isFinite(d.end)) continue;
    spanById.set(d.contentId, d.end - d.start);
  }

  const byId = new Map();
  for (const item of list) {
    if (!item?.contentId) continue;
    if (!byId.has(item.contentId)) byId.set(item.contentId, []);
    byId.get(item.contentId).push(item);
  }

  const drop = new Set();
  for (const [contentId, items] of byId) {
    if (items.length < 2) continue;
    // "Richest" = the one that actually names the item; the orphan half's
    // entry typically has a null title.
    const keep = items.find(i => i.title) || items[0];
    for (const item of items) if (item !== keep) drop.add(item);
    for (const [key, value] of Object.entries(items.find(i => i !== keep) || {})) {
      if (value != null && keep[key] == null) keep[key] = value;
    }
    const span = spanById.get(contentId);
    if (Number.isFinite(span)) keep.durationMs = span;
  }
  if (!drop.size) return 0;
  session.summary.media = list.filter(item => !drop.has(item));
  return drop.size;
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

  console.log(`Rejoin reload-split media events`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${SINCE ? ` | since ${SINCE}` : ''}\n`);

  let scanned = 0;
  let rejoined = 0;
  let filesChanged = 0;

  for (const entry of getSessionFiles(historyDir, SINCE)) {
    const session = ctx.loadYamlSafe(entry.filePath);
    const events = session?.timeline?.events;
    if (!Array.isArray(events)) continue;
    scanned++;

    const pairs = findOrphanPairs(events);
    const joined = pairs.length ? applyPairs(events, pairs) : events;
    const probe = { summary: session.summary, timeline: { events: joined } };
    const summaryDrops = reconcileSummaryMedia(probe);
    if (!pairs.length && !summaryDrops) continue;

    for (const p of pairs) {
      const minutes = Math.round(p.spanMs / 60000);
      const title = p.startEvent.data.title || p.endEvent.data.title || p.contentId;
      console.log(`  ${entry.date} ${entry.sessionId} | ${String(title).slice(0, 40)} | rejoined -> ${minutes} min`);
      rejoined++;
    }

    if (summaryDrops) {
      console.log(`  ${entry.date} ${entry.sessionId} | summary.media: ${summaryDrops} duplicate entr${summaryDrops === 1 ? 'y' : 'ies'} folded`);
    }
    if (APPLY) {
      session.timeline.events = joined;
      session.summary = probe.summary;
      ctx.saveYaml(entry.filePath, session);
    }
    filesChanged++;
  }

  console.log(`\nScanned ${scanned} sessions with a timeline.`);
  console.log(`Rejoined ${rejoined} split plays across ${filesChanged} files.`);
  if (!APPLY) console.log(`\nDry run — nothing written. Re-run with --apply.`);

  return { apply: APPLY, scanned, rejoined, filesChanged };
}
