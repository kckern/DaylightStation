/**
 * Repair sessions whose `strava_notes` hold an echo of our own description.
 *
 * Until 2026-09-25, reconciliation pulled every Strava description back as
 * `strava_notes` — including the one we had just pushed. The next push then
 * nested that text inside a 📝 block, so the voice memo and media list showed
 * up twice on Strava. The live reconciler now filters notes through
 * `extractUserNotes` and heals its own lookback window (10 days by default);
 * this command reaches further back.
 *
 * Per session in the window:
 *   1. Reduce `strava_notes` to the text a person typed (drop it when there is
 *      none).
 *   2. If Strava may hold a doubled description, fetch the activity. When the
 *      description there is still ours — equal to what we last pushed, or made
 *      only of our own blocks — replace it with a freshly built one and record
 *      the push as provenance. A description a person edited is left alone.
 *
 * A session is saved only when both steps succeed, so a failed Strava call
 * leaves it exactly as it was and the next run retries it. Titles are never
 * touched. Dry-run by default; `--write` persists.
 *
 * @module cli/lib/fitness/repairNotes
 */

import path from 'path';
import { readdirSync, existsSync, utimesSync } from 'fs';
import moment from 'moment-timezone';
import { parseArgs, bool, num } from './argv.mjs';
import { stravaApi } from './stravaAuth.mjs';
import { CliError } from './context.mjs';
import { buildActivityDescription, extractUserNotes } from '#domains/fitness/services/buildActivityDescription.mjs';
import { buildSelectionConfig } from '#domains/fitness/services/selectPrimaryMedia.mjs';

export const spec = {
  name: 'repair-notes',
  summary: 'drop strava_notes that echo our own description and un-double the strava copy',
  usage: 'fitness strava repair-notes [--write] [--show] [--days=N] [--delay=MS]',
  details: `  --write      Apply changes (default: dry run — no files or activities touched)
  --show       Print dropped notes, and each Strava description before and after
  --days=N     How far back to scan (default: 90)
  --delay=MS   Pause between Strava requests (default: 10000; limit is 100 / 15 min)`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A 📝 block wrapping one of our own blocks: the signature of a doubled push.
const NESTED_ECHO = /📝 "(🎙|🖥|🎵|📝)/;

function activityIdOf(session) {
  if (session?.strava?.activityId) return String(session.strava.activityId);
  for (const p of Object.values(session?.participants || {})) {
    if (p?.strava?.activityId) return String(p.strava.activityId);
  }
  return null;
}

/**
 * Work out one session's repair. Never mutates `session`.
 *
 * @param {Object} session - parsed session YAML
 * @param {Object} deps
 * @param {(id: string) => Promise<Object>} deps.getActivity
 * @param {(id: string, body: Object) => Promise<any>} deps.updateActivity
 * @param {Object} deps.selectionConfig
 * @param {boolean} deps.write - when false, Strava is read but never written
 * @returns {Promise<{
 *   changed: boolean, session?: Object, notes: 'kept'|'dropped'|'trimmed'|'none',
 *   droppedText?: string, strava: string, before?: string, after?: string, error?: Error
 * }>} `session` is the repaired copy to save when `changed`
 */
export async function repairSession(session, { getActivity, updateActivity, selectionConfig, write }) {
  const next = structuredClone(session);
  const stored = next.strava_notes?.text;
  let notes = 'none';
  let droppedText;

  if (typeof stored === 'string') {
    const typed = extractUserNotes(stored);
    if (typed === stored.trim()) notes = 'kept';
    else if (typed) { next.strava_notes.text = typed; notes = 'trimmed'; droppedText = stored; }
    else { delete next.strava_notes; notes = 'dropped'; droppedText = stored; }
  }

  // Strava may hold a doubled description when we recorded pushing one, or
  // when the notes were an echo and we have no record of what we pushed.
  const activityId = activityIdOf(next);
  const pushed = next.strava?.pushed;
  const echoedPush = !!pushed?.description && NESTED_ECHO.test(pushed.description);
  const unknownPush = !pushed?.description && (notes === 'dropped' || notes === 'trimmed');
  const localChanged = notes === 'dropped' || notes === 'trimmed';

  if (!activityId || !(echoedPush || unknownPush)) {
    return {
      changed: localChanged, session: next, notes, droppedText,
      strava: activityId ? 'clean per provenance' : 'no activity',
    };
  }

  let activity;
  try {
    activity = await getActivity(activityId);
  } catch (error) {
    return { changed: false, notes, droppedText, strava: 'fetch failed', error };
  }
  const current = activity?.description || '';
  const fresh = buildActivityDescription(next, {}, selectionConfig)?.description;
  const ours = pushed?.description != null
    ? current === pushed.description
    : extractUserNotes(current) === null;

  if (!fresh || fresh === current) {
    return { changed: localChanged, session: next, notes, droppedText, strava: 'already clean' };
  }
  if (!ours) {
    return { changed: localChanged, session: next, notes, droppedText, strava: 'edited by hand — left alone' };
  }

  if (write) {
    try {
      await updateActivity(activityId, { description: fresh });
    } catch (error) {
      return { changed: false, notes, droppedText, strava: 'update failed', error };
    }
    next.strava = next.strava || {};
    next.strava.pushed = {
      name: pushed?.name ?? activity.name ?? null,
      description: fresh,
      at: new Date().toISOString(),
    };
  }
  return {
    changed: true, session: next, notes, droppedText,
    strava: write ? 'rewritten' : 'would be rewritten',
    before: current, after: fresh,
  };
}

/**
 * @param {string[]} argv
 * @param {Object} ctx - from `getContext()`
 */
export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['write', 'show'] });
  const writeMode = bool(flags, 'write');
  const days = num(flags, 'days', 90);
  const delayMs = num(flags, 'delay', 10000);
  const show = bool(flags, 'show');
  const indent = (s) => s.split('\n').map(l => `      ${l}`).join('\n');

  // Same warmup-aware selection the live enrichment uses (app.mjs builds it
  // from the fitness app config's `plex` block). Colocated config first,
  // legacy location second — as heal.mjs resolves it. Without it, warmups
  // would be mis-annotated in every rebuilt description, so refuse to guess.
  const fitnessConfig = [
    path.join(ctx.dataDir, 'household', 'fitness', 'config.yml'),
    path.join(ctx.dataDir, 'household', 'config', 'fitness.yml'),
  ].map(p => ctx.loadYamlSafe(p)).find(Boolean);
  if (!fitnessConfig) throw new CliError('fitness config not found (household/fitness/config.yml)');
  const selectionConfig = buildSelectionConfig(fitnessConfig.plex || {});

  const root = ctx.fitnessHistoryDir;
  const cutoff = moment().subtract(days, 'days').format('YYYY-MM-DD');

  console.log(`Repair echoed strava_notes (${days} days back, cutoff ${cutoff})`);
  console.log(`  Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

  // Paced Strava calls; a 429 waits out the 15-minute window and retries once.
  let requests = 0;
  const call = async (endpoint, opts) => {
    for (let attempt = 0; ; attempt++) {
      if (requests++ > 0) await sleep(delayMs);
      try {
        return await stravaApi(ctx, endpoint, opts);
      } catch (err) {
        if (attempt > 0 || !/\b429\b/.test(err.message)) throw err;
        console.error('  Rate limit hit — sleeping 15 min, then retrying.');
        await sleep(15 * 60_000);
      }
    }
  };
  const deps = {
    getActivity: (id) => call(`/activities/${id}`),
    updateActivity: (id, body) => call(`/activities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    selectionConfig,
    write: writeMode,
  };

  const tally = { scanned: 0, notesDropped: 0, notesTrimmed: 0, rewritten: 0, keptEdited: 0, alreadyClean: 0, errors: 0 };
  const touchedDays = new Set();

  try {
    const dayDirs = readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff).sort();
    for (const day of dayDirs) {
      const files = readdirSync(path.join(root, day)).filter(f => f.endsWith('.yml') && !f.includes('conflicted copy'));
      for (const file of files) {
        const full = path.join(root, day, file);
        const session = ctx.loadYamlSafe(full);
        if (!session) continue;
        tally.scanned++;

        const r = await repairSession(session, deps);
        if (r.error) {
          tally.errors++;
          console.log(`  ${day}/${file}  ERROR (${r.strava}, nothing saved): ${r.error.message.split('\n')[0]}`);
          continue;
        }
        if (!r.changed) continue;

        if (r.notes === 'dropped') tally.notesDropped++;
        if (r.notes === 'trimmed') tally.notesTrimmed++;
        if (r.strava === 'rewritten' || r.strava === 'would be rewritten') tally.rewritten++;
        if (r.strava === 'already clean') tally.alreadyClean++;
        if (r.strava.startsWith('edited')) tally.keptEdited++;

        console.log(`  ${day}/${file}  notes ${r.notes}; strava ${r.strava}`);
        if (show && r.droppedText) console.log(`    --- dropped notes ---\n${indent(r.droppedText)}`);
        if (show && r.before != null) console.log(`    --- strava before ---\n${indent(r.before)}\n    --- strava after ---\n${indent(r.after)}`);

        if (writeMode) {
          ctx.saveYaml(full, r.session);
          touchedDays.add(day);
        }
      }
    }
  } finally {
    // The session list index is invalidated by day-folder mtime, which an
    // in-place file write does not change. Touch each day we rewrote — even
    // when the run stops early.
    const now = new Date();
    for (const day of touchedDays) {
      const dir = path.join(root, day);
      if (existsSync(dir)) utimesSync(dir, now, now);
    }
  }

  console.log('\n=== repair-notes summary ===');
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`  Mode:          ${writeMode ? 'WRITE' : 'DRY-RUN (nothing touched)'}`);
  return { ...tally, write: writeMode };
}
