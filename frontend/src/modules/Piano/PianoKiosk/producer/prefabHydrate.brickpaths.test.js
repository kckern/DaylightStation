/**
 * prefabHydrate — resolution LOCK against REAL brick paths (Task 8, adapted).
 *
 * The 5 curated prefabs (3 stacks + 2 songs) are re-authored to reference
 * bricks that actually exist on the new brick tree (`media/midi/{chords,
 * basslines,percussion}`). This test defines a manifest of exactly those
 * real paths (mirroring the shape `/api/v1/piano/loop-manifest` returns —
 * `{ path, type }` entries) and asserts every prefab ref resolves against
 * it: `unresolved` must be `[]` for all five, proving the YAML this task
 * hands off to the data volume will hydrate cleanly through the unchanged
 * `resolvePrefabStack` / `resolvePrefabSong` resolvers.
 *
 * The payload objects below are the EXACT shape written to
 * `media/midi/prefabs/{stacks,songs}/<id>.yml` on the host (see the task
 * report for the YAML text) — this file is the ground truth for those ids,
 * titles, and layer/section wiring.
 */
import { describe, it, expect } from 'vitest';
import { resolvePrefabStack, resolvePrefabSong } from './prefabHydrate.js';

// ── manifest: every real brick path referenced by the 5 prefabs below ──────
// Shape mirrors loop-manifest bricks: { path, type }. `type` values follow
// the brick-folder taxonomy (chord-progression / bassline / groove).
const MANIFEST = [
  { path: 'chords/I⠃-V⠃-vi⠃-IV⠃.musicxml', type: 'chord-progression' },
  { path: 'percussion/pop-16ths.musicxml', type: 'groove' },
  { path: 'chords/i⠏-bIII⠏-iii°⠏-IV⠏-#iv°⠏-v⠏-iii°⠏-bIII⠏.musicxml', type: 'chord-progression' },
  { path: 'percussion/brush-swing.musicxml', type: 'groove' },
  { path: 'basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml', type: 'bassline' },
  { path: 'percussion/four-on-floor.musicxml', type: 'groove' },
  { path: 'chords/I⠇-V⠟-vi⠇-IV⠟.musicxml', type: 'chord-progression' },
  { path: 'chords/I⠏-V⠏-vi⠇-IV⠟.musicxml', type: 'chord-progression' },
  { path: 'percussion/halftime-backbeat.musicxml', type: 'groove' },
  { path: 'chords/I⠿-V⠃-vi⠏-IV⠏.musicxml', type: 'chord-progression' },
  { path: 'chords/I⣿-V⣿-vi⣿-IV⣿.musicxml', type: 'chord-progression' },
  { path: 'basslines/I⠃-V⠃.musicxml', type: 'bassline' },
  { path: 'percussion/waltz.musicxml', type: 'groove' },
];

// ── stacks ───────────────────────────────────────────────────────────────
const POP_1_5_6_4 = {
  id: 'pop-1-5-6-4',
  title: 'Pop I–V–vi–IV',
  author: 'curated',
  kind: 'stack',
  layers: [
    { path: 'chords/I⠃-V⠃-vi⠃-IV⠃.musicxml', role: 'chords', gain: 1, gmProgram: 0 },
    { path: 'percussion/pop-16ths.musicxml', role: 'groove', gain: 0.85 },
  ],
};

const LOFI_GROOVE_BED = {
  id: 'lofi-groove-bed',
  title: 'Lo-fi groove bed',
  author: 'curated',
  kind: 'stack',
  layers: [
    { path: 'chords/i⠏-bIII⠏-iii°⠏-IV⠏-#iv°⠏-v⠏-iii°⠏-bIII⠏.musicxml', role: 'chords', gain: 0.9 },
    { path: 'percussion/brush-swing.musicxml', role: 'groove', gain: 0.7 },
  ],
};

const BASS_DRUMS_POCKET = {
  id: 'bass-drums-pocket',
  title: 'Bass + drums pocket',
  author: 'curated',
  kind: 'stack',
  layers: [
    { path: 'basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml', role: 'bass' },
    { path: 'percussion/four-on-floor.musicxml', role: 'groove' },
  ],
};

// ── songs ────────────────────────────────────────────────────────────────
const SUNSET_DRIVE = {
  id: 'sunset-drive',
  title: 'Sunset Drive',
  author: 'curated',
  kind: 'song',
  meta: { bpm: 96, keyShift: 0 },
  carried: {
    groove: { path: 'percussion/halftime-backbeat.musicxml', role: 'groove', gain: 0.8 },
  },
  sections: [
    {
      id: 'verse',
      name: 'Verse',
      lengthBars: 8,
      layers: [
        { path: 'chords/I⠇-V⠟-vi⠇-IV⠟.musicxml', role: 'chords', gain: 1 },
        { carried: 'groove' },
      ],
    },
    {
      id: 'chorus',
      name: 'Chorus',
      lengthBars: 8,
      layers: [
        { path: 'chords/I⠏-V⠏-vi⠇-IV⠟.musicxml', role: 'chords', gain: 1 },
        { carried: 'groove' },
      ],
    },
  ],
  arrangement: [
    { section: 'verse', repeats: 2 },
    { section: 'chorus', repeats: 2 },
    { section: 'verse', repeats: 1 },
  ],
};

const SLOW_BLOOM = {
  id: 'slow-bloom',
  title: 'Slow Bloom',
  author: 'curated',
  kind: 'song',
  meta: { bpm: 72, keyShift: 0 },
  carried: {
    groove: { path: 'percussion/waltz.musicxml', role: 'groove', gain: 0.7 },
  },
  sections: [
    {
      id: 'a',
      name: 'A',
      lengthBars: 8,
      layers: [
        { path: 'chords/I⠿-V⠃-vi⠏-IV⠏.musicxml', role: 'chords', gain: 0.9 },
        { path: 'basslines/I⠃-V⠃.musicxml', role: 'bass', gain: 0.9 },
        { carried: 'groove' },
      ],
    },
    {
      id: 'b',
      name: 'B',
      lengthBars: 8,
      layers: [
        { path: 'chords/I⣿-V⣿-vi⣿-IV⣿.musicxml', role: 'chords', gain: 0.9 },
        { carried: 'groove' },
      ],
    },
  ],
  arrangement: [
    { section: 'a', repeats: 2 },
    { section: 'b', repeats: 1 },
  ],
};

// ── stack assertions ─────────────────────────────────────────────────────
describe('prefab stacks resolve against real brick paths', () => {
  it('pop-1-5-6-4: 2 layers, no unresolved refs, groove pinned to channel 9', () => {
    const out = resolvePrefabStack(POP_1_5_6_4, MANIFEST);
    expect(out.unresolved).toEqual([]);
    expect(out.layers).toHaveLength(POP_1_5_6_4.layers.length);
    expect(out.layers.find((l) => l.role === 'groove').channel).toBe(9);
  });

  it('lofi-groove-bed: 2 layers, no unresolved refs, groove pinned to channel 9', () => {
    const out = resolvePrefabStack(LOFI_GROOVE_BED, MANIFEST);
    expect(out.unresolved).toEqual([]);
    expect(out.layers).toHaveLength(LOFI_GROOVE_BED.layers.length);
    expect(out.layers.find((l) => l.role === 'groove').channel).toBe(9);
  });

  it('bass-drums-pocket: 2 layers, no unresolved refs, groove pinned to channel 9', () => {
    const out = resolvePrefabStack(BASS_DRUMS_POCKET, MANIFEST);
    expect(out.unresolved).toEqual([]);
    expect(out.layers).toHaveLength(BASS_DRUMS_POCKET.layers.length);
    expect(out.layers.find((l) => l.role === 'groove').channel).toBe(9);
  });
});

// ── song assertions ──────────────────────────────────────────────────────
describe('prefab songs resolve against real brick paths', () => {
  it('sunset-drive: no unresolved refs, 2 sections, matching arrangement length', () => {
    const out = resolvePrefabSong(SUNSET_DRIVE, MANIFEST);
    expect(out.unresolved).toEqual([]);
    expect(out.draft.sections).toHaveLength(2);
    expect(out.draft.arrangement).toHaveLength(SUNSET_DRIVE.arrangement.length);
  });

  it('slow-bloom: no unresolved refs, 2 sections, matching arrangement length', () => {
    const out = resolvePrefabSong(SLOW_BLOOM, MANIFEST);
    expect(out.unresolved).toEqual([]);
    expect(out.draft.sections).toHaveLength(2);
    expect(out.draft.arrangement).toHaveLength(SLOW_BLOOM.arrangement.length);
  });
});
