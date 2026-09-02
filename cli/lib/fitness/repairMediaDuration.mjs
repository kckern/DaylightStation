/**
 * Repair corrupt `durationSeconds` on stored media events.
 *
 * Media events written between ~2026-03 and 2026-09-01 carry a nominal duration
 * that was divided by 1000 a second time — `normalizeDuration` guessed the unit
 * from magnitude, and its input had switched from Plex milliseconds to seconds
 * — so every video longer than 16m40s recorded a 1-11 second duration. 216 of
 * 455 non-audio media events on record are affected.
 *
 * Nothing RANKS on the field any more (the selectors moved to the played span),
 * so this is data hygiene rather than a correctness fix. It exists so exports
 * and future readers aren't handed a number that reads as valid.
 *
 * Three sources, in descending fidelity, recorded per event as
 * `durationSource` so a later pass can tell them apart:
 *
 *   plex    — re-fetched nominal length by contentId. Exact.
 *   played  — reconstructed as `end - start`. Correct for items played to
 *             completion, an undercount for abandoned ones.
 *   (none)  — neither available: the field is removed rather than left wrong.
 *
 * Media events are edited IN PLACE. This is deliberate and worth stating,
 * because the sibling `enrich-plex` command replaces `timeline.events`
 * wholesale — reusing that shape here would delete every challenge, governance
 * and voice-memo event in the file.
 *
 * Dry-run by default — prints what would change and writes nothing.
 *
 * See docs/_wip/bugs/2026-09-01-media-duration-divided-twice.md
 *
 * @module cli/lib/fitness/repairMediaDuration
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

const DEFAULT_PLEX_URL = 'https://plex.kckern.net';

/**
 * An event's duration is corrupt when the item demonstrably played for more
 * than this multiple of its recorded length. Mirrors the write-time invariant
 * in PersistenceManager so the repair and the guard agree on "implausible".
 */
export const IMPLAUSIBLE_RATIO = 3;
export const IMPLAUSIBLE_FLOOR_SEC = 300;

export const spec = {
  name: 'repair-duration',
  summary: 'fix media events whose durationSeconds was divided by 1000 twice',
  usage: 'fitness media repair-duration [--apply] [--since=YYYY-MM-DD] [--no-plex]',
  details: `  --apply           Write changes (default: dry run)
  --since=DATE      Only scan date folders >= YYYY-MM-DD
  --no-plex         Skip the Plex re-fetch; reconstruct from the played span only
  --plex-url=URL    Plex server base URL (env PLEX_URL, default ${DEFAULT_PLEX_URL})`,
};

/**
 * Is this event's stored duration demonstrably wrong?
 *
 * Only the played span can prove it, so an event with no span is left alone —
 * "unverifiable" is not "corrupt".
 *
 * @param {Object} data - a media event's `data` block
 * @returns {{corrupt: boolean, playedSeconds: number|null}}
 */
export function assessDuration(data) {
  const d = data || {};
  const ds = d.durationSeconds ?? d.duration_seconds ?? null;
  const playedSeconds = (Number.isFinite(d.start) && Number.isFinite(d.end) && d.end > d.start)
    ? (d.end - d.start) / 1000
    : null;
  if (!Number.isFinite(ds) || playedSeconds == null) return { corrupt: false, playedSeconds };
  const corrupt = playedSeconds > IMPLAUSIBLE_FLOOR_SEC && ds * IMPLAUSIBLE_RATIO < playedSeconds;
  return { corrupt, playedSeconds };
}

/** Bare Plex rating key from a `plex:1234` / `1234` content id. */
function plexRatingKey(contentId) {
  if (contentId == null) return null;
  const str = String(contentId);
  const bare = str.includes(':') ? str.split(':').pop() : str;
  return /^\d+$/.test(bare) ? bare : null;
}

/**
 * Nominal duration in seconds for one Plex item, or null when the item is gone
 * from the library or the server is unreachable. Never throws — a repair pass
 * must degrade to the played-span fallback, not abort halfway through a write.
 */
async function fetchPlexDurationSeconds({ plexUrl, plexToken, ratingKey }) {
  try {
    const res = await fetch(`${plexUrl}/library/metadata/${ratingKey}`, {
      headers: { 'X-Plex-Token': plexToken, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const item = body?.MediaContainer?.Metadata?.[0];
    const ms = Number(item?.duration);
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null;
  } catch {
    return null;
  }
}

/** Every `<history>/<date>/<id>.yml`, ascending, optionally from `since`. */
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

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<{apply: boolean, scanned: number, corrupt: number, repaired: Object}>}
 */
export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['apply', 'no-plex'] });
  const APPLY = bool(flags, 'apply');
  const NO_PLEX = bool(flags, 'no-plex');
  const SINCE = str(flags, 'since') || null;
  const plexUrl = str(flags, 'plex-url') || process.env.PLEX_URL || DEFAULT_PLEX_URL;

  const historyDir = ctx.fitnessHistoryDir;
  if (!existsSync(historyDir)) {
    throw new CliError(`Fitness history directory not found: ${historyDir}`);
  }

  let plexToken = null;
  if (!NO_PLEX) {
    plexToken = ctx.loadYamlSafe(path.join(ctx.dataDir, 'household', 'auth', 'plex'))?.token || null;
    if (!plexToken) {
      console.log('No Plex token found — falling back to played-span reconstruction only.\n');
    }
  }

  console.log(`Repair corrupt media durationSeconds`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${SINCE ? ` | since ${SINCE}` : ''}\n`);

  const files = getSessionFiles(historyDir, SINCE);
  const plexCache = new Map();
  const counts = { plex: 0, played: 0, dropped: 0 };
  let scanned = 0;
  let corruptTotal = 0;
  let filesChanged = 0;

  for (const entry of files) {
    const session = ctx.loadYamlSafe(entry.filePath);
    const events = session?.timeline?.events;
    if (!Array.isArray(events)) continue;

    let fileChanged = false;
    for (const event of events) {
      if (event?.type !== 'media') continue;
      const data = event.data;
      if (!data || data.contentType === 'track' || data.artist) continue;
      scanned++;

      const { corrupt, playedSeconds } = assessDuration(data);
      if (!corrupt) continue;
      corruptTotal++;

      // 1. Plex nominal length, cached per rating key across the whole run.
      let resolved = null;
      let source = null;
      const ratingKey = plexToken ? plexRatingKey(data.contentId) : null;
      if (ratingKey) {
        if (!plexCache.has(ratingKey)) {
          plexCache.set(ratingKey, await fetchPlexDurationSeconds({ plexUrl, plexToken, ratingKey }));
        }
        const fromPlex = plexCache.get(ratingKey);
        if (fromPlex != null) { resolved = fromPlex; source = 'plex'; }
      }

      // 2. The played span — a floor on the true length, not the length itself.
      if (resolved == null && playedSeconds != null) {
        resolved = Math.round(playedSeconds);
        source = 'played';
      }

      const before = data.durationSeconds ?? data.duration_seconds;
      if (resolved == null) {
        counts.dropped++;
        console.log(`  ${entry.date} ${entry.sessionId} | ${String(data.title).slice(0, 38)} | ${before} -> (removed)`);
        if (APPLY) { delete data.durationSeconds; delete data.duration_seconds; delete data.durationSource; }
      } else {
        counts[source]++;
        console.log(`  ${entry.date} ${entry.sessionId} | ${String(data.title).slice(0, 38)} | ${before} -> ${resolved}s (${source})`);
        if (APPLY) {
          delete data.duration_seconds;
          data.durationSeconds = resolved;
          data.durationSource = source;
        }
      }
      fileChanged = true;
    }

    if (fileChanged) {
      filesChanged++;
      // In place: only the media events' data blocks were touched, so every
      // challenge / governance / voice-memo event is carried through untouched.
      if (APPLY) ctx.saveYaml(entry.filePath, session);
    }
  }

  console.log(`\nScanned ${scanned} non-audio media events across ${files.length} session files.`);
  console.log(`Corrupt: ${corruptTotal} in ${filesChanged} files`);
  console.log(`  from Plex:        ${counts.plex}`);
  console.log(`  from played span: ${counts.played}`);
  console.log(`  removed:          ${counts.dropped}`);
  if (!APPLY) console.log(`\nDry run — nothing written. Re-run with --apply.`);

  return { apply: APPLY, scanned, corrupt: corruptTotal, filesChanged, repaired: counts };
}
