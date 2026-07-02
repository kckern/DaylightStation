import { describe, it, expect } from 'vitest';
import {
  draftReducer,
  initialDraftState,
  initialDraft,
  ActionTypes,
  promote,
  openSection,
  setArrangement,
  setRepeats,
  moveEntry,
  addEntry,
  removeEntry,
  setSectionLength,
  renameSection,
  deleteSection,
  cloneSection,
  mutateCarried,
  setMeta,
  resolveSectionStack,
  toSchedulerInputs,
  sectionGlyphSeeds,
} from './draftReducer.js';
import { seedFor } from './MaterialGlyph.jsx';
import { compileArrangement } from '@shared-music/arrangementScheduler.mjs';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Recursively freeze so any in-reducer mutation throws (modules are strict). */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

/** Dispatch a sequence of actions, deep-freezing state before every step so
 * immutability violations fail loudly in EVERY test, not just a dedicated one. */
const run = (...actions) =>
  actions.reduce((s, a) => draftReducer(deepFreeze(s), a), initialDraftState);

/** Workspace-shaped layer (see workspaceReducer.js header). */
const wsLayer = (id, role, channel, extra = {}) => ({
  id,
  source: { kind: 'library', entry: { path: id, slug: id, barSpan: 4 } },
  role,
  channel,
  gmProgram: role === 'groove' ? null : 0,
  gain: 1,
  muted: false,
  soloed: false,
  carried: false,
  ...extra,
});

const takeLayer = (takeId, role, channel, extra = {}) => ({
  id: takeId,
  source: {
    kind: 'take',
    takeId,
    notes: [{ ticks: 0, durationTicks: 480, midi: 60 }],
    ppq: 480,
    lengthBars: 2,
  },
  role,
  channel,
  gmProgram: 0,
  gain: 1,
  muted: false,
  soloed: false,
  carried: false,
  ...extra,
});

/** Workspace-shaped state. */
const ws = (layers, extra = {}) => ({
  layers,
  keyShift: 0,
  bpm: 100,
  metronome: false,
  editingSectionId: null,
  lastError: null,
  ...extra,
});

const CHORDS_A = 'loops/chords-a.mid';
const CHORDS_B = 'loops/chords-b.mid';
const GROOVE = 'grooves/rock.mid';

const carriedGroove = () => wsLayer(GROOVE, 'groove', 9, { carried: true });

const wholeNote = (midi) => [{ ticks: 0, durationTicks: 1920, midi }];
const notesById = {
  [CHORDS_A]: { notes: wholeNote(60), ppq: 480, barSpan: 2 },
  [CHORDS_B]: { notes: wholeNote(65), ppq: 480, barSpan: 2 },
  [GROOVE]: { notes: [{ ticks: 0, durationTicks: 120, midi: 36 }], ppq: 480, barSpan: 1 },
};

/** Draft with two sections sharing a carried groove:
 * sec-1 = chords A + groove, sec-2 = chords B + groove. */
const twoSectionDraft = () => run(
  promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), carriedGroove()], { keyShift: 2, bpm: 120 }), notesById }),
  promote({ workspaceState: ws([wsLayer(CHORDS_B, 'chords', 0), carriedGroove()]), notesById }),
);

// ── null state ───────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts as null — jamming never creates a hidden song', () => {
    expect(initialDraftState).toBeNull();
  });

  it('unknown action on null returns null', () => {
    expect(draftReducer(null, { type: 'NOPE' })).toBeNull();
  });

  it('every verb except PROMOTE is a no-op on null (draft materializes only by promotion or song load)', () => {
    const actions = [
      setArrangement([]), setRepeats(0, 2), moveEntry(0, 1), addEntry('sec-1'),
      removeEntry(0), setSectionLength('sec-1', 8), renameSection('sec-1', 'Verse'),
      deleteSection('sec-1'), cloneSection('sec-1'), mutateCarried('x', { gain: 0.5 }),
      setMeta({ title: 'T' }), openSection('sec-1'),
    ];
    for (const a of actions) expect(draftReducer(null, a)).toBeNull();
  });
});

describe('initialDraft', () => {
  it('builds an empty draft seeded with the workspace key/tempo', () => {
    expect(initialDraft(ws([], { keyShift: -3, bpm: 132 }))).toEqual({
      sections: [],
      carriedLayers: {},
      arrangement: [],
      meta: { title: null, author: null, keyShift: -3, bpm: 132 },
    });
  });

  it('falls back to keyShift 0 / bpm 100 when the workspace values are absent', () => {
    expect(initialDraft({}).meta).toEqual({ title: null, author: null, keyShift: 0, bpm: 100 });
  });
});

// ── PROMOTE ──────────────────────────────────────────────────────────────────

describe('PROMOTE (new section)', () => {
  it('materializes the draft: seeds meta, creates the section, arrangement plays it once', () => {
    const s = run(promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)], { keyShift: 2, bpm: 120 }),
      notesById,
    }));
    expect(s.meta).toEqual({ title: null, author: null, keyShift: 2, bpm: 120 });
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0].id).toBe('sec-1');
    expect(s.sections[0].name).toBe('A');
    expect(s.arrangement).toEqual([{ sectionId: 'sec-1', repeats: 1 }]);
  });

  it('deep-copies non-carried layers (no shared references with the workspace)', () => {
    const layer = wsLayer(CHORDS_A, 'chords', 0);
    const s = run(promote({ workspaceState: ws([layer]), notesById }));
    const copy = s.sections[0].stack[0];
    expect(copy).toEqual(layer);
    expect(copy).not.toBe(layer);
    expect(copy.source).not.toBe(layer.source);
    expect(copy.source.entry).not.toBe(layer.source.entry);
  });

  it('section copies are INDEPENDENT: a later promote of an edited layer leaves earlier sections untouched', () => {
    const s = run(
      promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById }),
      promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0, { gain: 0.25 })]), notesById }),
    );
    expect(resolveSectionStack(s, 'sec-1')[0].gain).toBe(1);
    expect(resolveSectionStack(s, 'sec-2')[0].gain).toBe(0.25);
  });

  it('EVERY new-section promote appends to the arrangement (a promoted section is playable)', () => {
    const s = twoSectionDraft();
    expect(s.arrangement).toEqual([
      { sectionId: 'sec-1', repeats: 1 },
      { sectionId: 'sec-2', repeats: 1 },
    ]);
  });

  it('second promote does NOT re-seed meta (key/tempo are song-global once set)', () => {
    const s = run(
      promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)], { keyShift: 2, bpm: 120 }), notesById }),
      promote({ workspaceState: ws([wsLayer(CHORDS_B, 'chords', 0)], { keyShift: 5, bpm: 90 }), notesById }),
    );
    expect(s.meta.keyShift).toBe(2);
    expect(s.meta.bpm).toBe(120);
  });

  it('auto-names sections with structural labels A, B, C… (labels, not fabricated titles)', () => {
    const s = run(
      promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById }),
      promote({ workspaceState: ws([wsLayer(CHORDS_B, 'chords', 0)]), notesById }),
    );
    expect(s.sections.map((x) => x.name)).toEqual(['A', 'B']);
  });

  it('honors an explicit name', () => {
    const s = run(promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), name: 'Verse' }));
    expect(s.sections[0].name).toBe('Verse');
  });

  it('a malformed workspaceState is a no-op', () => {
    expect(run(promote({ workspaceState: null }))).toBeNull();
    expect(run(promote({ workspaceState: { layers: 'nope' } }))).toBeNull();
  });

  describe('lengthBars derivation', () => {
    it('uses the longest layer barSpan from notesById', () => {
      const s = run(promote({
        workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), wsLayer('loops/long.mid', 'melody', 1)]),
        notesById: { ...notesById, 'loops/long.mid': { notes: wholeNote(72), ppq: 480, barSpan: 8 } },
      }));
      expect(s.sections[0].lengthBars).toBe(8);
    });

    it('take layers fall back to source.lengthBars; library layers to entry.barSpan', () => {
      const s = run(promote({
        workspaceState: ws([takeLayer('take-1', 'melody', 0), wsLayer(CHORDS_A, 'chords', 1)]),
        notesById: {},
      }));
      expect(s.sections[0].lengthBars).toBe(4); // entry.barSpan 4 > take lengthBars 2
    });

    it('defaults to 1 when no span is derivable (min 1 floor)', () => {
      const layer = { ...wsLayer(CHORDS_A, 'chords', 0), source: { kind: 'library', entry: { path: CHORDS_A } } };
      const s = run(promote({ workspaceState: ws([layer]), notesById: {} }));
      expect(s.sections[0].lengthBars).toBe(1);
    });

    it('an explicit lengthBars param wins over derivation', () => {
      const s = run(promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById, lengthBars: 16 }));
      expect(s.sections[0].lengthBars).toBe(16);
    });
  });
});

describe('PROMOTE (carried layers)', () => {
  it('stores a carried layer ONCE in carriedLayers; the stack holds a placeholder ref', () => {
    const s = run(promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), carriedGroove()]), notesById }));
    expect(s.carriedLayers[GROOVE]).toEqual(carriedGroove());
    expect(s.sections[0].stack).toContainEqual({ carriedRef: GROOVE });
  });

  it('two sections promoting the same carried layer SHARE one entry', () => {
    const s = twoSectionDraft();
    expect(Object.keys(s.carriedLayers)).toEqual([GROOVE]);
    expect(resolveSectionStack(s, 'sec-1')).toContainEqual(s.carriedLayers[GROOVE]);
    expect(resolveSectionStack(s, 'sec-2')).toContainEqual(s.carriedLayers[GROOVE]);
  });

  it('MUTATE_CARRIED reflects in EVERY section that references the layer', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), mutateCarried(GROOVE, { gain: 0.4 }));
    expect(resolveSectionStack(s, 'sec-1').find((l) => l.id === GROOVE).gain).toBe(0.4);
    expect(resolveSectionStack(s, 'sec-2').find((l) => l.id === GROOVE).gain).toBe(0.4);
  });

  it('re-promoting a carried layer refreshes the shared entry (latest edit wins everywhere)', () => {
    const s = run(
      promote({ workspaceState: ws([carriedGroove()]), notesById }),
      promote({ workspaceState: ws([wsLayer(CHORDS_B, 'chords', 0), carriedGroove()]), notesById }),
    );
    const edited = { ...carriedGroove(), gain: 0.7 };
    const s2 = draftReducer(deepFreeze(s), promote({ workspaceState: ws([edited]), sectionId: 'sec-1', notesById }));
    expect(s2.carriedLayers[GROOVE].gain).toBe(0.7);
    expect(resolveSectionStack(s2, 'sec-2').find((l) => l.id === GROOVE).gain).toBe(0.7);
  });

  it('a carried-entry overwrite preserves the EXISTING channel (channel is structural, like MUTATE_CARRIED)', () => {
    const BASS = 'loops/bass.mid';
    const carriedBass = (channel, extra = {}) => wsLayer(BASS, 'bass', channel, { carried: true, gmProgram: 33, ...extra });
    // sec-1 promotes the carried bass on channel 2; the workspace then drifts
    // it onto channel 0 (e.g. after layers were removed and re-added).
    const base = run(
      promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), carriedBass(2)]), notesById }),
      promote({ workspaceState: ws([wsLayer(CHORDS_B, 'chords', 1), carriedBass(0, { gain: 0.6 })]), notesById }),
    );
    // Channel stays 2 (sec-1's stack already claims 0 for its chords); the
    // mix edit (gain) still wins everywhere.
    expect(base.carriedLayers[BASS].channel).toBe(2);
    expect(base.carriedLayers[BASS].gain).toBe(0.6);

    // Replace path too: re-promote sec-1 with the drifted channel.
    const replaced = draftReducer(deepFreeze(base), promote({
      workspaceState: ws([carriedBass(5, { gain: 0.3 })]), sectionId: 'sec-1', notesById,
    }));
    expect(replaced.carriedLayers[BASS].channel).toBe(2);
    expect(replaced.carriedLayers[BASS].gain).toBe(0.3);
  });

  it('a NEW carried entry adopts the promoting workspace channel as-is', () => {
    const s = run(promote({
      workspaceState: ws([wsLayer('loops/bass.mid', 'bass', 3, { carried: true })]), notesById,
    }));
    expect(s.carriedLayers['loops/bass.mid'].channel).toBe(3);
  });
});

describe('PROMOTE (replace / re-promote)', () => {
  it('replaces the target section stack without touching sections count or arrangement', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), promote({
      workspaceState: ws([wsLayer('loops/new.mid', 'chords', 0)]),
      sectionId: 'sec-1',
      notesById,
    }));
    expect(s.sections).toHaveLength(2);
    expect(s.sections[0].stack.map((l) => l.id ?? l.carriedRef)).toEqual(['loops/new.mid']);
    expect(s.arrangement).toEqual(base.arrangement);
  });

  it('keeps the existing lengthBars and name unless explicitly overridden (section length is a structural choice)', () => {
    const base = run(promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById, name: 'Verse', lengthBars: 16,
    }));
    const kept = draftReducer(deepFreeze(base), promote({
      workspaceState: ws([wsLayer(CHORDS_B, 'chords', 0)]), sectionId: 'sec-1', notesById,
    }));
    expect(kept.sections[0].lengthBars).toBe(16);
    expect(kept.sections[0].name).toBe('Verse');
    const overridden = draftReducer(deepFreeze(base), promote({
      workspaceState: ws([wsLayer(CHORDS_B, 'chords', 0)]), sectionId: 'sec-1', notesById, lengthBars: 8, name: 'Chorus',
    }));
    expect(overridden.sections[0].lengthBars).toBe(8);
    expect(overridden.sections[0].name).toBe('Chorus');
  });

  it('unknown sectionId is a no-op (dangling target is a caller bug)', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), sectionId: 'ghost', notesById,
    }))).toBe(base);
  });

  it('garbage-collects a carried layer once NO section references it', () => {
    const base = run(promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), carriedGroove()]), notesById }));
    expect(base.carriedLayers[GROOVE]).toBeDefined();
    const s = draftReducer(deepFreeze(base), promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), sectionId: 'sec-1', notesById,
    }));
    expect(s.carriedLayers).toEqual({});
  });

  it('retains a carried layer still referenced by ANOTHER section after replace', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), sectionId: 'sec-1', notesById,
    }));
    expect(s.carriedLayers[GROOVE]).toBeDefined();
    expect(resolveSectionStack(s, 'sec-2').some((l) => l.id === GROOVE)).toBe(true);
  });
});

// ── OPEN_SECTION ─────────────────────────────────────────────────────────────

describe('OPEN_SECTION', () => {
  it('returns state unchanged — opening is a WORKSPACE action (caller uses resolveSectionStack + LOAD_STACK)', () => {
    const s = twoSectionDraft();
    expect(draftReducer(deepFreeze(s), openSection('sec-1'))).toBe(s);
    expect(draftReducer(deepFreeze(s), openSection('ghost'))).toBe(s);
  });
});

// ── arrangement verbs ────────────────────────────────────────────────────────

describe('SET_ARRANGEMENT', () => {
  it('replaces the arrangement, coercing repeats like the scheduler (floor, min 1, non-numeric → 1)', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), setArrangement([
      { sectionId: 'sec-2', repeats: 2.7 },
      { sectionId: 'sec-1', repeats: 0 },
      { sectionId: 'sec-2', repeats: 'x' },
      { sectionId: 'sec-1' },
    ]));
    expect(s.arrangement).toEqual([
      { sectionId: 'sec-2', repeats: 2 },
      { sectionId: 'sec-1', repeats: 1 },
      { sectionId: 'sec-2', repeats: 1 },
      { sectionId: 'sec-1', repeats: 1 },
    ]);
  });

  it('rejects the WHOLE action when any sectionId is unknown (compileArrangement throws on dangling refs)', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), setArrangement([
      { sectionId: 'sec-1', repeats: 2 },
      { sectionId: 'ghost', repeats: 1 },
    ]));
    expect(s).toBe(base);
  });

  it('an empty arrangement is valid (song with no play order yet)', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), setArrangement([]));
    expect(s.arrangement).toEqual([]);
  });

  it('non-array entries are a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), setArrangement('nope'))).toBe(base);
  });
});

describe('SET_REPEATS', () => {
  it('sets (coerced) repeats on one entry', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), setRepeats(1, 3.9));
    expect(s.arrangement[1].repeats).toBe(3);
    expect(s.arrangement[0].repeats).toBe(1);
  });

  it('out-of-range index is a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), setRepeats(5, 2))).toBe(base);
    expect(draftReducer(deepFreeze(base), setRepeats(-1, 2))).toBe(base);
  });
});

describe('MOVE_ENTRY', () => {
  const threeEntries = () => draftReducer(deepFreeze(twoSectionDraft()), setArrangement([
    { sectionId: 'sec-1', repeats: 1 },
    { sectionId: 'sec-2', repeats: 2 },
    { sectionId: 'sec-1', repeats: 3 },
  ]));

  it('moves an entry to a new index', () => {
    const s = draftReducer(deepFreeze(threeEntries()), moveEntry(0, 2));
    expect(s.arrangement.map((e) => e.repeats)).toEqual([2, 3, 1]);
  });

  it('moves backward too', () => {
    const s = draftReducer(deepFreeze(threeEntries()), moveEntry(2, 0));
    expect(s.arrangement.map((e) => e.repeats)).toEqual([3, 1, 2]);
  });

  it('out-of-range from/to and from===to are no-ops', () => {
    const base = threeEntries();
    expect(draftReducer(deepFreeze(base), moveEntry(0, 3))).toBe(base);
    expect(draftReducer(deepFreeze(base), moveEntry(-1, 0))).toBe(base);
    expect(draftReducer(deepFreeze(base), moveEntry(1, 1))).toBe(base);
  });
});

describe('ADD_ENTRY', () => {
  it('appends with repeats 1 by default', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), addEntry('sec-1'));
    expect(s.arrangement.at(-1)).toEqual({ sectionId: 'sec-1', repeats: 1 });
    expect(s.arrangement).toHaveLength(3);
  });

  it('inserts at an explicit index', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), addEntry('sec-2', 0));
    expect(s.arrangement.map((e) => e.sectionId)).toEqual(['sec-2', 'sec-1', 'sec-2']);
  });

  it('unknown sectionId is a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), addEntry('ghost'))).toBe(base);
  });
});

describe('REMOVE_ENTRY', () => {
  it('removes the entry at index', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), removeEntry(0));
    expect(s.arrangement).toEqual([{ sectionId: 'sec-2', repeats: 1 }]);
  });

  it('out-of-range index is a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), removeEntry(9))).toBe(base);
  });
});

// ── section verbs ────────────────────────────────────────────────────────────

describe('SET_SECTION_LENGTH', () => {
  it('sets lengthBars, floored, clamped to min 1', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), setSectionLength('sec-1', 8.9)).sections[0].lengthBars).toBe(8);
    expect(draftReducer(deepFreeze(base), setSectionLength('sec-1', 0)).sections[0].lengthBars).toBe(1);
    expect(draftReducer(deepFreeze(base), setSectionLength('sec-1', -4)).sections[0].lengthBars).toBe(1);
  });

  it('non-finite length and unknown section are no-ops', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), setSectionLength('sec-1', NaN))).toBe(base);
    expect(draftReducer(deepFreeze(base), setSectionLength('ghost', 8))).toBe(base);
  });
});

describe('RENAME_SECTION', () => {
  it('sets a trimmed name', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), renameSection('sec-1', '  Verse 2  '));
    expect(s.sections[0].name).toBe('Verse 2');
  });

  it('empty name falls back to the next free structural label', () => {
    // sec-2 is named 'B', so renaming sec-1 to '' yields 'A' (first free).
    const s = draftReducer(deepFreeze(twoSectionDraft()), renameSection('sec-1', '  '));
    expect(s.sections[0].name).toBe('A');
  });

  it('unknown section is a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), renameSection('ghost', 'X'))).toBe(base);
  });
});

describe('DELETE_SECTION', () => {
  it('removes the section and ALL its arrangement entries', () => {
    const base = draftReducer(deepFreeze(twoSectionDraft()), setArrangement([
      { sectionId: 'sec-1', repeats: 1 },
      { sectionId: 'sec-2', repeats: 2 },
      { sectionId: 'sec-1', repeats: 3 },
    ]));
    const s = draftReducer(deepFreeze(base), deleteSection('sec-1'));
    expect(s.sections.map((x) => x.id)).toEqual(['sec-2']);
    expect(s.arrangement).toEqual([{ sectionId: 'sec-2', repeats: 2 }]);
  });

  it('garbage-collects carried layers no longer referenced by any section', () => {
    const base = twoSectionDraft();
    const afterOne = draftReducer(deepFreeze(base), deleteSection('sec-1'));
    expect(afterOne.carriedLayers[GROOVE]).toBeDefined(); // sec-2 still refs it
    const afterBoth = draftReducer(deepFreeze(afterOne), deleteSection('sec-2'));
    expect(afterBoth.carriedLayers).toEqual({});
  });

  it('deleting the LAST section leaves an empty-sections draft, not null (UI decides what empty means)', () => {
    const base = run(promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById }));
    const s = draftReducer(deepFreeze(base), deleteSection('sec-1'));
    expect(s).not.toBeNull();
    expect(s.sections).toEqual([]);
    expect(s.arrangement).toEqual([]);
    expect(s.meta).toEqual(base.meta);
  });

  it('unknown section is a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), deleteSection('ghost'))).toBe(base);
  });
});

describe('CLONE_SECTION', () => {
  it('clones stack + lengthBars under a new id and the next structural label', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), cloneSection('sec-1'));
    expect(s.sections).toHaveLength(3);
    const clone = s.sections[2];
    expect(clone.id).toBe('sec-3');
    expect(clone.name).toBe('C');
    expect(clone.lengthBars).toBe(base.sections[0].lengthBars);
    expect(clone.stack).toEqual(base.sections[0].stack);
  });

  it('deep-copies non-carried layers (clone diverges independently)', () => {
    const base = run(promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById }));
    const s = draftReducer(deepFreeze(base), cloneSection('sec-1'));
    expect(s.sections[1].stack[0]).not.toBe(s.sections[0].stack[0]);
    expect(s.sections[1].stack[0].source).not.toBe(s.sections[0].stack[0].source);
  });

  it('keeps carriedRef placeholders — clones SHARE carried layers', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), cloneSection('sec-1'));
    const mutated = draftReducer(deepFreeze(s), mutateCarried(GROOVE, { gain: 0.3 }));
    expect(resolveSectionStack(mutated, 'sec-3').find((l) => l.id === GROOVE).gain).toBe(0.3);
  });

  it('does NOT touch the arrangement (placement is an explicit ADD_ENTRY)', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), cloneSection('sec-1'));
    expect(s.arrangement).toEqual(base.arrangement);
  });

  it('unknown section is a no-op', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), cloneSection('ghost'))).toBe(base);
  });
});

// ── MUTATE_CARRIED ───────────────────────────────────────────────────────────

describe('MUTATE_CARRIED', () => {
  it('patches gain (clamped 0..1), muted, gmProgram', () => {
    const base = run(promote({
      workspaceState: ws([wsLayer('loops/bass.mid', 'bass', 0, { carried: true, gmProgram: 33 })]),
      notesById,
    }));
    const s = draftReducer(deepFreeze(base), mutateCarried('loops/bass.mid', { gain: 1.7, muted: true, gmProgram: 35 }));
    expect(s.carriedLayers['loops/bass.mid']).toMatchObject({ gain: 1, muted: true, gmProgram: 35 });
  });

  it('structural fields are LOCKED: channel/role/id/source in the patch are ignored', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), mutateCarried(GROOVE, {
      channel: 3, role: 'chords', id: 'hijack', source: null, muted: true,
    }));
    expect(s.carriedLayers[GROOVE]).toMatchObject({
      channel: 9, role: 'groove', id: GROOVE, muted: true,
    });
    expect(s.carriedLayers[GROOVE].source).toEqual(carriedGroove().source);
  });

  it('gmProgram is a no-op on groove layers (drums have no program), non-finite gain ignored', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), mutateCarried(GROOVE, { gmProgram: 5 }))).toBe(base);
    expect(draftReducer(deepFreeze(base), mutateCarried(GROOVE, { gain: NaN }))).toBe(base);
  });

  it('unknown layerId and empty patch are no-ops', () => {
    const base = twoSectionDraft();
    expect(draftReducer(deepFreeze(base), mutateCarried('ghost', { gain: 0.5 }))).toBe(base);
    expect(draftReducer(deepFreeze(base), mutateCarried(GROOVE, {}))).toBe(base);
  });
});

// ── SET_META ─────────────────────────────────────────────────────────────────

describe('SET_META', () => {
  it('patches only the provided keys', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), setMeta({ title: 'My Song', author: 'kc' }));
    expect(s.meta).toEqual({ title: 'My Song', author: 'kc', keyShift: 2, bpm: 120 });
  });

  it('clamps bpm to 40..220 and truncates keyShift', () => {
    const s = draftReducer(deepFreeze(twoSectionDraft()), setMeta({ bpm: 999, keyShift: 3.9 }));
    expect(s.meta.bpm).toBe(220);
    expect(s.meta.keyShift).toBe(3);
  });

  it('title can be cleared back to null (never fabricated)', () => {
    const s = run(
      promote({ workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0)]), notesById }),
      setMeta({ title: 'X' }),
      setMeta({ title: null }),
    );
    expect(s.meta.title).toBeNull();
  });

  it('non-finite bpm/keyShift are ignored', () => {
    const base = twoSectionDraft();
    const s = draftReducer(deepFreeze(base), setMeta({ bpm: NaN, keyShift: 'x' }));
    expect(s.meta.bpm).toBe(120);
    expect(s.meta.keyShift).toBe(2);
  });
});

// ── selectors ────────────────────────────────────────────────────────────────

describe('resolveSectionStack', () => {
  it('expands carriedRef placeholders into the shared layer', () => {
    const s = twoSectionDraft();
    const stack = resolveSectionStack(s, 'sec-1');
    expect(stack.map((l) => l.id)).toEqual([CHORDS_A, GROOVE]);
    expect(stack[1]).toBe(s.carriedLayers[GROOVE]);
  });

  it('returns null for an unknown section or a null draft', () => {
    expect(resolveSectionStack(twoSectionDraft(), 'ghost')).toBeNull();
    expect(resolveSectionStack(null, 'sec-1')).toBeNull();
  });

  it('skips a dangling carriedRef (defensive; GC should prevent this)', () => {
    const s = twoSectionDraft();
    const broken = { ...s, carriedLayers: {} };
    expect(resolveSectionStack(broken, 'sec-1').map((l) => l.id)).toEqual([CHORDS_A]);
  });
});

describe('toSchedulerInputs', () => {
  it('null draft → empty inputs', () => {
    expect(toSchedulerInputs(null, notesById)).toEqual({ sections: [], arrangement: [] });
  });

  it('maps sections to scheduler shape: meta.keyShift transpose, groove pinned to 0, gain/channel passthrough', () => {
    const { sections, arrangement } = toSchedulerInputs(twoSectionDraft(), notesById);
    expect(arrangement).toEqual([
      { sectionId: 'sec-1', repeats: 1 },
      { sectionId: 'sec-2', repeats: 1 },
    ]);
    expect(sections[0].id).toBe('sec-1');
    expect(sections[0].lengthBars).toBe(2);
    expect(sections[0].stack).toEqual([
      { notes: notesById[CHORDS_A].notes, ppq: 480, barSpan: 2, transpose: 2, muted: false, channel: 0, gain: 1 },
      { notes: notesById[GROOVE].notes, ppq: 480, barSpan: 1, transpose: 0, muted: false, channel: 9, gain: 1 },
    ]);
  });

  it('omits layers with no loaded notes (they join once notes arrive)', () => {
    const { sections } = toSchedulerInputs(twoSectionDraft(), { [GROOVE]: notesById[GROOVE] });
    expect(sections[0].stack).toHaveLength(1);
    expect(sections[0].stack[0].channel).toBe(9);
  });

  it('take layers fall back to notes embedded in their source', () => {
    const draft = run(promote({ workspaceState: ws([takeLayer('take-1', 'melody', 0)]), notesById: {} }));
    const { sections } = toSchedulerInputs(draft, {});
    expect(sections[0].stack).toHaveLength(1);
    expect(sections[0].stack[0].barSpan).toBe(2); // lengthBars → barSpan
  });

  it('applies per-section solo semantics to muted', () => {
    const draft = run(promote({
      workspaceState: ws([
        wsLayer(CHORDS_A, 'chords', 0, { soloed: true }),
        wsLayer(CHORDS_B, 'melody', 1),
      ]),
      notesById,
    }));
    const { sections } = toSchedulerInputs(draft, notesById);
    expect(sections[0].stack.map((l) => l.muted)).toEqual([false, true]);
  });

  describe('per-section channel repair', () => {
    it('repairs duplicate/squatting channels (first claim wins, dupes → lowest free, grooves pinned 9)', () => {
      // Hand-built draft (a historical save from before channel locking): the
      // stack claims ch0 twice and holds a groove squatting off the drum channel.
      const draft = {
        sections: [{
          id: 'sec-1',
          name: 'A',
          lengthBars: 2,
          stack: [
            wsLayer(CHORDS_A, 'chords', 0),
            wsLayer(CHORDS_B, 'melody', 0), // duplicate claim
            wsLayer(GROOVE, 'groove', 4), // groove off 9
          ],
        }],
        carriedLayers: {},
        arrangement: [{ sectionId: 'sec-1', repeats: 1 }],
        meta: { title: null, author: null, keyShift: 0, bpm: 100 },
      };
      const { sections } = toSchedulerInputs(deepFreeze(draft), notesById);
      expect(sections[0].stack.map((l) => l.channel)).toEqual([0, 1, 9]);
    });

    it('a shared carried layer colliding with a section-local claim comes out collision-free', () => {
      const BASS = 'loops/bass.mid';
      const nb = { ...notesById, [BASS]: { notes: wholeNote(40), ppq: 480, barSpan: 2 } };
      const s = run(
        promote({ workspaceState: ws([wsLayer(BASS, 'bass', 2, { carried: true })]), notesById: nb }),
        // Workspace drifted: the carried bass now sits on 0 while a melody
        // claims 2 — the shared entry keeps ch2 (structural), so sec-2's
        // resolved stack holds TWO ch2 layers until the repair pass.
        promote({
          workspaceState: ws([wsLayer(BASS, 'bass', 0, { carried: true }), wsLayer(CHORDS_B, 'melody', 2)]),
          notesById: nb,
        }),
      );
      expect(s.carriedLayers[BASS].channel).toBe(2);
      const { sections } = toSchedulerInputs(s, nb);
      // Stack order is promote order: carried bass first → it keeps its valid
      // claim of 2; the melody dupe is reassigned lowest-free (0).
      expect(sections[1].stack.map((l) => l.channel)).toEqual([2, 0]);
    });
  });

  it('INTEGRATION: compiles through the real compileArrangement — carried groove sounds in every section', () => {
    const base = twoSectionDraft(); // meta: keyShift 2, bpm 120
    const draft = draftReducer(deepFreeze(base), setArrangement([
      { sectionId: 'sec-1', repeats: 2 },
      { sectionId: 'sec-2', repeats: 1 },
    ]));
    const { sections, arrangement } = toSchedulerInputs(draft, notesById);
    const { blocks, totalMs } = compileArrangement(sections, arrangement, { bpm: draft.meta.bpm });

    // 2-bar sections at 120bpm 4/4 → 4000ms each; A×2 + B×1 → 3 blocks, 12s.
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.sectionId)).toEqual(['sec-1', 'sec-1', 'sec-2']);
    expect(blocks.map((b) => b.startMs)).toEqual([0, 4000, 8000]);
    expect(totalMs).toBe(12000);

    // The carried groove is present in BOTH sections' events, on channel 9,
    // untransposed (kick 36) while chords ride meta.keyShift (+2).
    for (const block of [blocks[0], blocks[2]]) {
      const drumOns = block.events.filter((e) => e.type === 'note_on' && e.channel === 9);
      expect(drumOns.length).toBeGreaterThan(0);
      expect(drumOns.every((e) => e.note === 36)).toBe(true);
    }
    const chordOnsA = blocks[0].events.filter((e) => e.type === 'note_on' && e.channel === 0);
    expect(chordOnsA.map((e) => e.note)).toEqual([62]); // 60 + keyShift 2
    const chordOnsB = blocks[2].events.filter((e) => e.type === 'note_on' && e.channel === 0);
    expect(chordOnsB.map((e) => e.note)).toEqual([67]); // 65 + keyShift 2
  });
});

describe('sectionGlyphSeeds', () => {
  it('yields library entries and take stubs as MaterialGlyph child materials (carried refs expanded)', () => {
    const draft = run(promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), carriedGroove(), takeLayer('take-1', 'melody', 1)]),
      notesById,
    }));
    const seeds = sectionGlyphSeeds(draft, 'sec-1');
    expect(seeds).toEqual([
      { path: CHORDS_A, slug: CHORDS_A, barSpan: 4 },
      { path: GROOVE, slug: GROOVE, barSpan: 4 },
      { kind: 'take', id: 'take-1' },
    ]);
  });

  it('unknown section → empty list', () => {
    expect(sectionGlyphSeeds(twoSectionDraft(), 'ghost')).toEqual([]);
  });

  it('composes into an order-insensitive section glyph seed via seedFor', () => {
    const a = run(promote({
      workspaceState: ws([wsLayer(CHORDS_A, 'chords', 0), carriedGroove()]), notesById,
    }));
    const b = run(promote({
      workspaceState: ws([carriedGroove(), wsLayer(CHORDS_A, 'chords', 0)]), notesById,
    }));
    const seedA = seedFor({ kind: 'section', children: sectionGlyphSeeds(a, 'sec-1') });
    const seedB = seedFor({ kind: 'section', children: sectionGlyphSeeds(b, 'sec-1') });
    expect(seedA).toBe(seedB);
    expect(seedA.startsWith('stack(')).toBe(true);
  });
});

// ── action creator / type consistency ────────────────────────────────────────

describe('action creators', () => {
  it('every creator emits a type registered in ActionTypes', () => {
    const samples = [
      promote({ workspaceState: ws([]) }),
      openSection('sec-1'),
      setArrangement([]), setRepeats(0, 1), moveEntry(0, 1), addEntry('sec-1'), removeEntry(0),
      setSectionLength('sec-1', 4), renameSection('sec-1', 'A'), deleteSection('sec-1'),
      cloneSection('sec-1'), mutateCarried('x', {}), setMeta({}),
    ];
    const types = new Set(Object.values(ActionTypes));
    for (const a of samples) expect(types.has(a.type)).toBe(true);
    expect(new Set(samples.map((a) => a.type)).size).toBe(samples.length);
  });
});
