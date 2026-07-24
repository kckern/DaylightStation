#!/usr/bin/env node
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
 * Usage:
 *   DAYLIGHT_BASE_PATH=... node cli/backfill-fitness-primary-media.mjs [--apply] [--since YYYY-MM-DD]
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { selectPrimaryMediaSummary, buildSelectionConfig } from '#domains/fitness/services/selectPrimaryMedia.mjs';

const APPLY = process.argv.includes('--apply');
const sinceIdx = process.argv.indexOf('--since');
const SINCE = sinceIdx !== -1 ? process.argv[sinceIdx + 1] : null;

const BASE = process.env.DAYLIGHT_BASE_PATH || process.cwd();
const HISTORY = path.join(BASE, 'data', 'household', 'history', 'fitness');

// Selection config (warmup / deprioritized labels) — same source the runtime
// read path uses, so the backfill agrees with what the app derives on read.
// KidsFun-labeled game videos are deprioritized, keeping them out of primary
// when a real workout is also present.
const CONFIG_PATH = path.join(BASE, 'data', 'household', 'config', 'fitness.yml');
let selectionConfig;
try {
  const cfg = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
  selectionConfig = buildSelectionConfig(cfg?.content || cfg?.plex);
} catch {
  selectionConfig = buildSelectionConfig(null);
}

if (!fs.existsSync(HISTORY)) {
  console.error(`No history dir at ${HISTORY} — set DAYLIGHT_BASE_PATH`);
  process.exit(1);
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
