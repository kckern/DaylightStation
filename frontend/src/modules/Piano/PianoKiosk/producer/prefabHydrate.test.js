/**
 * prefabHydrate — resolver tests (Task 9.1). Pure module, so every case is a
 * plain input → output assertion against a minimal fake loop index. The final
 * block is the REQUIRED round-trip: a prefab song payload → resolvePrefabSong →
 * draftReducer HYDRATE → toSchedulerInputs → compileArrangement, proving a
 * hand-authored prefab compiles through the REAL pipeline without throwing.
 */
import { describe, it, expect } from 'vitest';
import { resolveEntry, resolvePrefabStack, resolvePrefabSong } from './prefabHydrate.js';
import { draftReducer, hydrate, toSchedulerInputs } from './draftReducer.js';
import { compileArrangement } from '@shared-music/arrangementScheduler.mjs';

// ── a tiny loop index: two harmonic entries (with timelines + notes-less) and
// a groove (no timeline). Notes come from lib.loadNotes at runtime; the index
// only needs path/slug/type for resolution. ────────────────────────────────
const IDX = [
  { slug: 'c-g-am-f', path: 'chords/pop/c-g-am-f.mid', type: 'chord-progression', roman: ['I', 'V', 'vi', 'IV'], bpm: 100 },
  { slug: 'am-f-c-g', path: 'chords/pop/am-f-c-g.mid', type: 'chord-progression', roman: ['vi', 'IV', 'I', 'V'], bpm: 100 },
  { slug: 'the-bass', path: 'bass/the-bass.mid', type: 'bassline', bpm: 100 },
  { slug: 'rock-groove', path: 'perc/rock-groove.mid', type: 'groove', feel: 'straight', bpm: 120 },
  // A slug that appears twice under different paths (real index has these) —
  // path disambiguates.
  { slug: 'dupe', path: 'a/dupe.mid', type: 'chord-progression' },
  { slug: 'dupe', path: 'b/dupe.mid', type: 'chord-progression' },
];

describe('resolveEntry', () => {
  it('prefers path (slugs are not unique across packs)', () => {
    expect(resolveEntry({ slug: 'dupe', path: 'b/dupe.mid' }, IDX).path).toBe('b/dupe.mid');
  });
  it('falls back to slug when no path given', () => {
    expect(resolveEntry({ slug: 'the-bass' }, IDX).path).toBe('bass/the-bass.mid');
  });
  it('returns null for an unknown ref', () => {
    expect(resolveEntry({ slug: 'nope', path: 'no/where.mid' }, IDX)).toBeNull();
  });
});

describe('resolvePrefabStack', () => {
  const payload = {
    id: 'pop', title: 'Pop', kind: 'stack',
    layers: [
      { slug: 'c-g-am-f', path: 'chords/pop/c-g-am-f.mid', role: 'chords', gain: 1, gmProgram: 0 },
      { slug: 'the-bass', path: 'bass/the-bass.mid', role: 'bass', gain: 0.9 },
      { slug: 'rock-groove', path: 'perc/rock-groove.mid', role: 'groove', gain: 0.8 },
    ],
  };

  it('resolves each ref into a library layer with source + defaults', () => {
    const { layers, source } = resolvePrefabStack(payload, IDX);
    expect(source).toBe('prefab');
    expect(layers).toHaveLength(3);
    expect(layers[0]).toMatchObject({
      id: 'chords/pop/c-g-am-f.mid', role: 'chords', gain: 1, gmProgram: 0,
      source: { kind: 'library' },
    });
    expect(layers[0].source.entry.slug).toBe('c-g-am-f');
  });

  it('pins grooves to channel 9 and gives non-grooves distinct channels', () => {
    const { layers } = resolvePrefabStack(payload, IDX);
    const groove = layers.find((l) => l.role === 'groove');
    const others = layers.filter((l) => l.role !== 'groove');
    expect(groove.channel).toBe(9);
    expect(groove.gmProgram).toBeNull();
    expect(new Set(others.map((l) => l.channel)).size).toBe(others.length);
    expect(others.every((l) => l.channel !== 9)).toBe(true);
  });

  it('bass defaults to GM program 33 when unspecified', () => {
    const { layers } = resolvePrefabStack(payload, IDX);
    expect(layers.find((l) => l.role === 'bass').gmProgram).toBe(33);
  });

  it('drops unresolved refs and reports them (never crashes)', () => {
    const bad = { id: 'x', layers: [{ slug: 'ghost', path: 'no/where.mid', role: 'chords' }, ...payload.layers] };
    const { layers, unresolved } = resolvePrefabStack(bad, IDX);
    expect(layers).toHaveLength(3);
    expect(unresolved).toContain('no/where.mid');
  });
});

describe('resolvePrefabSong', () => {
  const payload = {
    id: 'song-1', title: 'Sunset Drive', author: 'curated',
    meta: { bpm: 100, keyShift: 0 },
    carried: { groove: { slug: 'rock-groove', path: 'perc/rock-groove.mid', role: 'groove', gain: 0.8 } },
    sections: [
      { id: 'sec-1', name: 'Verse', lengthBars: 8, layers: [{ slug: 'c-g-am-f', path: 'chords/pop/c-g-am-f.mid', role: 'chords', gain: 1 }, { carried: 'groove' }] },
      { id: 'sec-2', name: 'Chorus', lengthBars: 8, layers: [{ slug: 'am-f-c-g', path: 'chords/pop/am-f-c-g.mid', role: 'chords', gain: 1 }, { carried: 'groove' }] },
    ],
    arrangement: [
      { section: 'sec-1', repeats: 2 },
      { section: 'sec-2', repeats: 2 },
      { section: 'sec-1', repeats: 1 },
    ],
  };

  it('produces a HYDRATE-ready draft with meta from the payload', () => {
    const { draft, source } = resolvePrefabSong(payload, IDX);
    expect(source).toBe('prefab');
    expect(draft.meta).toMatchObject({ title: 'Sunset Drive', author: 'curated', bpm: 100, keyShift: 0 });
    expect(draft.sections).toHaveLength(2);
    expect(draft.arrangement).toHaveLength(3);
  });

  it('shares ONE carried layer across sections via carriedRef placeholders', () => {
    const { draft } = resolvePrefabSong(payload, IDX);
    const carriedIds = Object.keys(draft.carriedLayers);
    expect(carriedIds).toHaveLength(1);
    const layerId = carriedIds[0];
    // both sections reference the SAME carried id (not a per-section copy)
    for (const s of draft.sections) {
      expect(s.stack.some((e) => e.carriedRef === layerId)).toBe(true);
    }
    expect(draft.carriedLayers[layerId].role).toBe('groove');
    expect(draft.carriedLayers[layerId].carried).toBe(true);
  });

  it('remaps the arrangement `section` key to `sectionId`', () => {
    const { draft } = resolvePrefabSong(payload, IDX);
    expect(draft.arrangement[0]).toEqual({ sectionId: 'sec-1', repeats: 2 });
  });

  // ── the required round-trip: real reducer + real scheduler ─────────────────
  it('HYDRATEs + compiles through the real pipeline without throwing', () => {
    const { draft } = resolvePrefabSong(payload, IDX);
    const hydrated = draftReducer(null, hydrate(draft));
    expect(hydrated).not.toBeNull();
    expect(hydrated.sections).toHaveLength(2);
    // Carried groove survived HYDRATE's clone + GC sweep (still referenced).
    expect(Object.keys(hydrated.carriedLayers)).toHaveLength(1);

    // Feed notes for every referenced layer so the stacks are non-empty and
    // compileArrangement builds REAL blocks (a 1-bar loop of one note).
    const notesById = {};
    const oneBar = { notes: [{ ticks: 0, durationTicks: 480, midi: 60 }], ppq: 480, barSpan: 1 };
    for (const s of hydrated.sections) {
      for (const e of s.stack) {
        const id = e.carriedRef ?? e.id;
        if (id) notesById[id] = oneBar;
      }
    }
    const { sections, arrangement } = toSchedulerInputs(hydrated, notesById);
    expect(sections.every((s) => Array.isArray(s.stack))).toBe(true);
    // Every section resolved at least the chord + carried groove → non-empty.
    expect(sections.every((s) => s.stack.length >= 1)).toBe(true);

    const compiled = compileArrangement(sections, arrangement, { bpm: hydrated.meta.bpm });
    // 2 + 2 + 1 repeats = 5 blocks, positive total duration.
    expect(compiled.blocks).toHaveLength(5);
    expect(compiled.totalMs).toBeGreaterThan(0);
  });

  it('degrades gracefully when a section ref is unresolved', () => {
    const bad = {
      ...payload,
      sections: [
        { id: 'sec-1', name: 'Verse', lengthBars: 8, layers: [{ slug: 'ghost', path: 'no/where.mid', role: 'chords' }, { carried: 'groove' }] },
      ],
      arrangement: [{ section: 'sec-1', repeats: 1 }],
    };
    const { draft, unresolved } = resolvePrefabSong(bad, IDX);
    expect(unresolved).toContain('no/where.mid');
    // section survives with just the carried groove placeholder
    expect(draft.sections[0].stack.some((e) => e.carriedRef)).toBe(true);
    const hydrated = draftReducer(null, hydrate(draft));
    expect(hydrated.sections).toHaveLength(1);
  });
});
