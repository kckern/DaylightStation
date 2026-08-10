#!/usr/bin/env node
/**
 * lilypond-import — import public-domain graded piano repertoire from the
 * Mutopia Project into Sheet Music mode as MusicXML.
 *
 * Offline batch tool. Requires python-ly (`pip install python-ly`) on the
 * machine running it; nothing it depends on ships in the app image.
 *
 *   node cli/lilypond-import.cli.mjs --list
 *   node cli/lilypond-import.cli.mjs --set burgmuller --out /tmp/scores
 *   node cli/lilypond-import.cli.mjs --all --out /tmp/scores --dry-run
 *   LY_BIN=/path/to/venv/bin/ly node cli/lilypond-import.cli.mjs --all --out /tmp/scores
 *
 * Design: docs/superpowers/specs/2026-08-10-lilypond-musicxml-design.md
 */
import path from 'node:path';
import process from 'node:process';
import { listOpus, cacheSources, listCached } from './lilypond-import/fetch.mjs';
import { runImport } from './lilypond-import/importRun.mjs';
import { backendAvailable, resolveLyBin } from './lilypond-import/convert.mjs';

// The graded pedagogical ladder — the repertoire the library is missing.
const SETS = {
  burgmuller: { composer: 'BurgmullerJFF', opus: 'O100', label: '25 Easy and Progressive Studies, Op. 100' },
  clementi36: { composer: 'ClementiM', opus: 'O36', label: 'Six Sonatinas, Op. 36' },
  clementi42: { composer: 'ClementiM', opus: 'O42', label: 'Sonatinas, Op. 42' },
  schumann68: { composer: 'SchumannR', opus: 'O68', label: 'Album for the Young, Op. 68' },
};

function parseArgs(argv) {
  const args = { sets: [], out: null, dryRun: false, list: false, cache: null, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--all') args.sets = Object.keys(SETS);
    else if (a === '--set') args.sets.push(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--cache') args.cache = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.list && !args.sets.length)) {
    console.log(`lilypond-import — Mutopia LilyPond → MusicXML

  --list             show the available sets
  --set <name>       import one set (repeatable)
  --all              import every set
  --out <dir>        where to write .musicxml (required unless --dry-run)
  --cache <dir>      .ly download cache (default: .cache/mutopia)
  --limit <n>        stop after n source files
  --offline          use only what is already cached; never touch the network
  --dry-run          convert and validate, write nothing

Sets: ${Object.keys(SETS).join(', ')}
Requires python-ly. Point LY_BIN at its binary if it is not on PATH.`);
    process.exit(args.help ? 0 : 1);
  }

  if (args.list) {
    for (const [key, s] of Object.entries(SETS)) console.log(`  ${key.padEnd(12)} ${s.label}`);
    process.exit(0);
  }

  const backend = await backendAvailable();
  if (!backend.ok) {
    console.error(`ERROR: MusicXML backend not runnable (${resolveLyBin()}): ${backend.error}`);
    console.error('Install it with:  pip install python-ly     (or set LY_BIN)');
    process.exit(2);
  }
  console.log(`backend: ${backend.version}`);

  if (!args.out && !args.dryRun) {
    console.error('ERROR: --out is required unless --dry-run');
    process.exit(1);
  }

  const cacheDir = args.cache || path.resolve('.cache/mutopia');
  let sources = [];
  for (const key of args.sets) {
    const set = SETS[key];
    if (!set) { console.error(`unknown set: ${key}`); process.exit(1); }
    console.log(`\n${set.label}`);
    const cached = args.offline
      ? await listCached(cacheDir, { composer: set.composer, opus: set.opus })
      : await cacheSources(
        await listOpus(set.composer, set.opus, (m) => console.log(m)),
        cacheDir,
        (m) => console.log(m),
      );
    console.log(`  ${cached.length} source files${args.offline ? ' (from cache)' : ''}`);
    sources.push(...cached);
  }
  if (Number.isFinite(args.limit)) sources = sources.slice(0, args.limit);

  console.log(`\nconverting ${sources.length} sources${args.dryRun ? ' (dry run)' : ''}…`);
  const { written, failed, rows } = await runImport({
    sources,
    outDir: args.out,
    ledgerPath: args.dryRun ? null : path.join(args.out, '_import-ledger.jsonl'),
    dryRun: args.dryRun,
    log: (m) => console.log(m),
  });

  const fingerings = rows.filter((r) => r.ok).reduce((n, r) => n + (r.stats?.fingerings || 0), 0);
  console.log(`\n=== ${written} score(s) ${args.dryRun ? 'would be written' : 'written'}, ${failed} failed; ${fingerings} fingerings preserved ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
