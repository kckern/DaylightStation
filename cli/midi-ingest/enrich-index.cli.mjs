#!/usr/bin/env node
// enrich-index.cli.mjs — run the idempotent index enrichment against a real
// loops directory. Reads <dir>/index.yml, parses each entry's .mid, and writes
// the enriched index. Non-destructive to the canonical tree (only index.yml).
//
// Usage:
//   node cli/midi-ingest/enrich-index.cli.mjs --dir=/path/to/midi/loops [--out=/tmp/index.yml] [--limit=N]
//   node cli/midi-ingest/enrich-index.cli.mjs --dir=$DAYLIGHT_BASE_PATH/media/midi/loops --dry
//
// --out defaults to <dir>/index.yml (in place). --dry prints stats only.
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import midiPkg from '@tonejs/midi';
import { enrichIndex } from './enrichIndex.mjs';

const { Midi } = midiPkg;
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };

const DIR = opt('dir', path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media/midi/loops'));
const INDEX = path.join(DIR, 'index.yml');
const OUT = opt('out', INDEX);
const LIMIT = opt('limit') ? Number(opt('limit')) : Infinity;
const DRY = flag('dry');

const entries = yaml.load(readFileSync(INDEX, 'utf8')) || [];
const scoped = entries.slice(0, LIMIT);

const loadNotes = (entry) => {
  try {
    const midi = new Midi(readFileSync(path.join(DIR, entry.path)));
    const notes = midi.tracks.flatMap((tr) => tr.notes.map((n) => ({
      ticks: n.ticks, durationTicks: n.durationTicks, midi: n.midi,
    })));
    const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
    return { notes, ppq: midi.header.ppq || 480, timeSig: { beats: ts[0], beatType: ts[1] } };
  } catch { return null; }
};

const enriched = enrichIndex(scoped, loadNotes);

// Stats
const gainedRoman = enriched.filter((e, i) => !scoped[i].roman?.length && e.roman?.length).length;
const withSig = enriched.filter((e) => e.signature).length;
console.log(`Entries: ${enriched.length} | gained inferred roman: ${gainedRoman} | with signature: ${withSig}`);

if (DRY) { console.log('Dry-run only. Re-run without --dry to write.'); process.exit(0); }

// When limited, only the scoped slice is written back merged with the tail.
const finalIndex = LIMIT === Infinity ? enriched : [...enriched, ...entries.slice(LIMIT)];
writeFileSync(OUT, yaml.dump(finalIndex, { lineWidth: 120, noRefs: true }));
console.log(`Wrote ${finalIndex.length} entries to ${OUT}`);
