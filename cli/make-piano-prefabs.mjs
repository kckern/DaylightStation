#!/usr/bin/env node

/**
 * Prefab content generator — seeds the Producer's curated prefab collection
 * (Producer overhaul, Task 9.1; design §4 "Prefabs"). Emits hand-authored
 * example STACKS and SONGS as YAML into the media tree, next to the loop index,
 * plus a light `index.yml` manifest the frontend loader (`usePrefabs`) fetches.
 *
 * WHY GENERATE (not hand-place): prefab content lives in the Dropbox media
 * tree, NOT the repo (same as the loop index + starter grooves) — so only this
 * generator + the loader are committed. Re-running is deterministic and idempotent
 * (spelled-out content, no randomness). Mirrors cli/make-starter-grooves.mjs.
 *
 * REFERENCES ARE BY LIBRARY SLUG/PATH, resolved at load time against the live
 * loop index (prefabHydrate) — prefabs never embed the index's fat timelines.
 * Every slug/path below is a REAL enriched entry (verified stackable pairs via
 * shared/music/consonance.mjs); grooves carry no timeline so they stack with
 * anything (design §4b). The generator re-reads each written file and asserts
 * it parses + every referenced path exists in loops/index.yml before reporting
 * success — a typo makes the run FAIL, not ship a dead prefab.
 *
 * Structure TEMPLATES are deliberately NOT authored here: the 5 basics live in
 * code (producer/structureTemplates.js) as the SSOT (design §7 empty state).
 * These data prefabs are the example STACKS + SONGS that reference real loops.
 *
 * Output tree:
 *   media/midi/prefabs/index.yml            — { stacks:[…light…], songs:[…] }
 *   media/midi/prefabs/stacks/{id}.yml      — { id, title, author, kind, layers }
 *   media/midi/prefabs/songs/{id}.yml       — { id, title, author, kind, meta, carried, sections, arrangement }
 *
 * Usage:
 *   node cli/make-piano-prefabs.mjs                 # write to the media tree
 *   node cli/make-piano-prefabs.mjs --out=/path     # write elsewhere
 *   node cli/make-piano-prefabs.mjs --loops=/path/to/loops  # verify against a specific index
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import dotenv from 'dotenv';
import jsyaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const MEDIA = path.resolve(opt('out', path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media/midi/prefabs')));
const LOOPS_DIR = path.resolve(opt('loops', path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media/midi/loops')));

// ── content (verified real slugs/paths; see the module header) ───────────────

/** Example STACKS — a base + a companion, both real, verified stackable. */
const STACKS = [
  {
    id: 'pop-1-5-6-4',
    title: 'Pop I–V–vi–IV',
    author: 'curated',
    kind: 'stack',
    layers: [
      { slug: 'c-g-am-f-c-g', path: 'chord-progressions/famous/justin-bieber/c-g-am-f-c-g.mid', role: 'chords', gain: 1, gmProgram: 0 },
      { slug: 'f-g-am-em', path: 'basslines/niko/catchy-basslines-pack/f-g-am-em.mid', role: 'bass', gain: 0.9, gmProgram: 33 },
    ],
  },
  {
    id: 'lofi-groove-bed',
    title: 'Lo-fi groove bed',
    author: 'curated',
    kind: 'stack',
    layers: [
      // maj7/9 colour + electric-piano voice + a lazy half-time backbeat.
      { slug: 'fmaj7-em7-dm9-cmaj9', path: 'chord-progressions/famous/justin-bieber/300/fmaj7-em7-dm9-cmaj9.mid', role: 'chords', gain: 0.85, gmProgram: 4 },
      { slug: 'halftime-backbeat-85bpm', path: 'percussion/starters/halftime-backbeat-85bpm.mid', role: 'groove', gain: 0.8 },
    ],
  },
  {
    id: 'bass-drums-pocket',
    title: 'Bass + drums pocket',
    author: 'curated',
    kind: 'stack',
    layers: [
      { slug: 'am-c-em', path: 'basslines/niko/catchy-basslines-pack/am-c-em.mid', role: 'bass', gain: 1, gmProgram: 33 },
      { slug: 'rock-8ths-120bpm', path: 'percussion/starters/rock-8ths-120bpm.mid', role: 'groove', gain: 0.9 },
    ],
  },
];

/** Example SONGS — verse/chorus with a CARRIED groove across sections (design
 * §4.1 continuity), a real arrangement, and meta key/tempo from the loops. */
const SONGS = [
  {
    id: 'sunset-drive',
    title: 'Sunset Drive',
    author: 'curated',
    kind: 'song',
    meta: { bpm: 100, keyShift: 0 },
    carried: {
      // one groove, carried under BOTH sections — mutate once, changes everywhere.
      groove: { slug: 'pop-16ths-104bpm', path: 'percussion/starters/pop-16ths-104bpm.mid', role: 'groove', gain: 0.8 },
    },
    sections: [
      {
        id: 'sec-1',
        name: 'Verse',
        lengthBars: 8,
        layers: [
          { slug: 'c-g-am-f-c-g', path: 'chord-progressions/famous/justin-bieber/c-g-am-f-c-g.mid', role: 'chords', gain: 1 },
          { carried: 'groove' },
        ],
      },
      {
        id: 'sec-2',
        name: 'Chorus',
        lengthBars: 8,
        layers: [
          { slug: 'am-f-c-g', path: 'chord-progressions/famous/justin-bieber/am-f-c-g.mid', role: 'chords', gain: 1 },
          { carried: 'groove' },
        ],
      },
    ],
    // Verse ×2 · Chorus ×2 · Verse ×1 — the carried groove rides the whole form.
    arrangement: [
      { section: 'sec-1', repeats: 2 },
      { section: 'sec-2', repeats: 2 },
      { section: 'sec-1', repeats: 1 },
    ],
  },
  {
    id: 'slow-bloom',
    title: 'Slow Bloom',
    author: 'curated',
    kind: 'song',
    meta: { bpm: 86, keyShift: 0 },
    carried: {
      groove: { slug: 'halftime-backbeat-85bpm', path: 'percussion/starters/halftime-backbeat-85bpm.mid', role: 'groove', gain: 0.75 },
    },
    sections: [
      {
        id: 'sec-1',
        name: 'A',
        lengthBars: 8,
        layers: [
          { slug: 'c-c-g-g-fmaj7-fmaj7-c-c', path: 'chord-progressions/famous/coldplay/c-c-g-g-fmaj7-fmaj7-c-c.mid', role: 'chords', gain: 0.95 },
          { carried: 'groove' },
        ],
      },
      {
        id: 'sec-2',
        name: 'B',
        lengthBars: 4,
        layers: [
          { slug: 'fmaj7-am-g', path: 'chord-progressions/famous/coldplay/fmaj7-am-g.mid', role: 'chords', gain: 0.95 },
          { carried: 'groove' },
        ],
      },
    ],
    // A ×2 · B ×1 · A ×1
    arrangement: [
      { section: 'sec-1', repeats: 2 },
      { section: 'sec-2', repeats: 1 },
      { section: 'sec-1', repeats: 1 },
    ],
  },
];

// ── validation: every referenced path must exist in the loop index ───────────

function loadLoopPaths() {
  const idxFile = path.join(LOOPS_DIR, 'index.yml');
  if (!existsSync(idxFile)) {
    throw new Error(`loop index not found at ${idxFile} — cannot verify prefab slugs`);
  }
  const idx = jsyaml.load(readFileSync(idxFile, 'utf8')) || [];
  return new Set(idx.map((e) => e.path));
}

/** Collect every { slug, path } ref in a stack/song payload. */
function refsOf(payload) {
  const refs = [];
  if (Array.isArray(payload.layers)) refs.push(...payload.layers.filter((l) => l.path || l.slug));
  if (payload.carried) refs.push(...Object.values(payload.carried));
  if (Array.isArray(payload.sections)) {
    for (const s of payload.sections) {
      for (const l of (s.layers || [])) if (l.path || l.slug) refs.push(l);
    }
  }
  return refs;
}

// ── write ─────────────────────────────────────────────────────────────────────

function main() {
  const knownPaths = loadLoopPaths();
  const errors = [];

  // Verify every ref before writing anything.
  for (const p of [...STACKS, ...SONGS]) {
    for (const ref of refsOf(p)) {
      if (ref.path && !knownPaths.has(ref.path)) {
        errors.push(`${p.id}: referenced path not in loop index → ${ref.path}`);
      }
    }
  }
  if (errors.length) {
    console.error('PREFAB VERIFY FAILED:');
    errors.forEach((e) => console.error('  ✗', e));
    process.exit(1);
  }

  mkdirSync(path.join(MEDIA, 'stacks'), { recursive: true });
  mkdirSync(path.join(MEDIA, 'songs'), { recursive: true });

  const dump = (obj) => jsyaml.dump(obj, { lineWidth: 120, noRefs: true });

  for (const s of STACKS) {
    const file = path.join(MEDIA, 'stacks', `${s.id}.yml`);
    writeFileSync(file, dump(s));
    const back = jsyaml.load(readFileSync(file, 'utf8'));
    if (back.id !== s.id || !Array.isArray(back.layers)) throw new Error(`stack ${s.id} failed re-read`);
  }
  for (const s of SONGS) {
    const file = path.join(MEDIA, 'songs', `${s.id}.yml`);
    writeFileSync(file, dump(s));
    const back = jsyaml.load(readFileSync(file, 'utf8'));
    if (back.id !== s.id || !Array.isArray(back.sections)) throw new Error(`song ${s.id} failed re-read`);
  }

  // Light manifest — the loader fetches THIS, then payloads on demand.
  const manifest = {
    stacks: STACKS.map((s) => ({
      id: s.id, title: s.title, author: s.author, kind: 'stack', layerCount: s.layers.length,
    })),
    songs: SONGS.map((s) => ({
      id: s.id, title: s.title, author: s.author, kind: 'song', sectionCount: s.sections.length,
    })),
  };
  const manifestFile = path.join(MEDIA, 'index.yml');
  writeFileSync(manifestFile, dump(manifest));
  const backManifest = jsyaml.load(readFileSync(manifestFile, 'utf8'));
  if (!Array.isArray(backManifest.stacks) || !Array.isArray(backManifest.songs)) {
    throw new Error('manifest failed re-read');
  }

  console.log('Prefabs written + verified:');
  console.log(`  ${STACKS.length} stacks → ${path.join(MEDIA, 'stacks')}`);
  console.log(`  ${SONGS.length} songs  → ${path.join(MEDIA, 'songs')}`);
  console.log(`  manifest → ${manifestFile}`);
  console.log(`  all ${[...STACKS, ...SONGS].reduce((n, p) => n + refsOf(p).length, 0)} refs verified against ${LOOPS_DIR}/index.yml`);
}

main();
