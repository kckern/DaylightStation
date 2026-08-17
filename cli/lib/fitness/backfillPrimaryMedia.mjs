/**
 * Backfill the `primary` flag on `summary.media` across stored fitness sessions.
 *
 * Old sessions were written before selectPrimaryMedia keyed on actual played
 * time (`durationMs = event.end - start`) and filtered audio, so their stored
 * `primary: true` can sit on the wrong item — a brief bleed-over episode from
 * the previous session, or a music track. This re-derives primary with the
 * current domain policy (selectPrimaryMediaSummary) and moves the flag.
 *
 * Read-time re-derivation already heals the API view; this fixes the durable
 * data so every other consumer (Strava descriptions, exports) agrees.
 *
 * Dry-run by default — prints what would change and writes nothing.
 *
 * @module cli/lib/fitness/backfillPrimaryMedia
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { selectPrimaryMediaSummary, buildSelectionConfig } from '#domains/fitness/services/selectPrimaryMedia.mjs';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

export const spec = {
  name: 'backfill-primary',
  summary: 're-derive summary.media primary flags on stored sessions',
  usage: 'fitness media backfill-primary [--apply] [--since=YYYY-MM-DD]',
  details: `  --apply           Write changes (default: dry run)
  --since=DATE      Only scan date folders >= YYYY-MM-DD`,
};

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<{apply: boolean, since: string|null, scanned: number, changed: number, changes: Array}>}
 */
export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['apply'] });
  const APPLY = bool(flags, 'apply');
  const SINCE = str(flags, 'since') || null;

  const HISTORY = ctx.fitnessHistoryDir;

  // Selection config (warmup / deprioritized labels) — same source the runtime
  // read path uses, so the backfill agrees with what the app derives on read.
  // KidsFun-labeled game videos are deprioritized, keeping them out of primary
  // when a real workout is also present.
  //
  // Colocated-first with legacy fallback (task-13 review, Important 5): this
  // used to hardcode ONLY household/config/fitness.yml, which the task-13
  // data move relocated to household/fitness/config.yml — every environment
  // that has been migrated silently fell through to the catch below and ran
  // with DEFAULT selection rules instead of "the same source the runtime
  // read path uses" this comment claims, then WROTE the wrong primary flag
  // into every fitness history file under --apply. The path.join(...) shape
  // here is exactly what a literal-string grep for 'config/fitness.yml'
  // misses.
  const COLOCATED_CONFIG_PATH = path.join(ctx.dataDir, 'household', 'fitness', 'config.yml');
  const LEGACY_CONFIG_PATH = path.join(ctx.dataDir, 'household', 'config', 'fitness.yml');
  const CONFIG_PATH = fs.existsSync(COLOCATED_CONFIG_PATH) ? COLOCATED_CONFIG_PATH : LEGACY_CONFIG_PATH;
  let selectionConfig;
  try {
    const cfg = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    selectionConfig = buildSelectionConfig(cfg?.content || cfg?.plex);
  } catch (err) {
    // Loud, not silent: a swallowed failure here is exactly what let this
    // fall back to DEFAULT rules undetected in production.
    console.warn(`backfill-primary: could not load fitness config at ${CONFIG_PATH} (${err.message}) — falling back to DEFAULT selection rules, which may not match the runtime read path`);
    selectionConfig = buildSelectionConfig(null);
  }

  if (!fs.existsSync(HISTORY)) {
    throw new CliError(`No history dir at ${HISTORY} — set DAYLIGHT_BASE_PATH`);
  }

  const dateDirs = fs.readdirSync(HISTORY)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => !SINCE || d >= SINCE)
    .sort();

  let scanned = 0;
  let changed = 0;
  const changes = [];

  for (const date of dateDirs) {
    const dir = path.join(HISTORY, date);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
      const full = path.join(dir, file);
      let doc;
      try {
        doc = yaml.load(fs.readFileSync(full, 'utf8'));
      } catch {
        continue; // unparseable — not this tool's job
      }
      // Mirror the read path: only object-shaped items count. Legacy sessions
      // store summary.media as an array of strings; the read path ignores those
      // and derives primary from timeline events, so this backfill must too.
      const items = (doc?.summary?.media || []).filter((m) => typeof m === 'object' && m !== null);
      if (items.length === 0) continue;
      scanned++;

      const stored = items.find((m) => m.primary);
      if (!stored) continue; // never flagged (all-audio or degenerate stub) — don't invent one; matches the read path

      const correct = selectPrimaryMediaSummary(items, selectionConfig);
      if (!correct || stored === correct) continue; // policy agrees or can't improve

      changed++;
      changes.push({
        id: file.replace('.yml', ''),
        from: stored ? `${stored.title} (${stored.mediaType}, ${Math.round((stored.durationMs || 0) / 1000)}s)` : '(none)',
        to: `${correct.title} (${correct.mediaType}, ${Math.round((correct.durationMs || 0) / 1000)}s)`,
      });

      if (APPLY) {
        for (const m of items) delete m.primary;
        correct.primary = true;
        fs.writeFileSync(full, yaml.dump(doc, { lineWidth: -1, noRefs: true }), 'utf8');
      }
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — scanned ${scanned} sessions with media, ${changed} need${changed === 1 ? 's' : ''} a primary change\n`);
  for (const c of changes) {
    console.log(`  ${c.id}`);
    console.log(`    ${c.from}`);
    console.log(`    -> ${c.to}`);
  }
  if (!APPLY && changed > 0) console.log('\nRe-run with --apply to write.');

  return { apply: APPLY, since: SINCE, scanned, changed, changes };
}
