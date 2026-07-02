import { describe, it, expect } from 'vitest';
import {
  workspaceReducer,
  initialWorkspace,
  ActionTypes,
  addLayer,
  removeLayer,
  setGain,
  toggleMute,
  toggleSolo,
  setVoice,
  setKey,
  nudgeKey,
  setBpm,
  toggleMetronome,
  loadStack,
  clearWorkspace,
  setEditingSection,
  anySolo,
  effectiveMuted,
  toTransportLayers,
  DRUM_CHANNEL,
} from './workspaceReducer.js';

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
  actions.reduce((s, a) => workspaceReducer(deepFreeze(s), a), initialWorkspace);

const librarySource = (path, extra = {}) => ({
  kind: 'library',
  entry: { path, slug: path, barSpan: 4, ...extra },
});

const takeSource = (takeId, extra = {}) => ({
  kind: 'take',
  takeId,
  notes: [{ ticks: 0, durationTicks: 480, midi: 60 }],
  ppq: 480,
  lengthBars: 2,
  ...extra,
});

const addChords = (n) => addLayer({ source: librarySource(`loops/chords-${n}.mid`), role: 'chords' });
const addGroove = (n) => addLayer({ source: librarySource(`grooves/beat-${n}.mid`), role: 'groove' });

/** State with 15 harmonic layers → every non-drum channel (0–8, 10–15) taken. */
const fullMelodicState = () =>
  run(...Array.from({ length: 15 }, (_, i) => addChords(i)));

// ── initial state ─────────────────────────────────────────────────────────────

describe('initialWorkspace', () => {
  it('has the documented shape', () => {
    expect(initialWorkspace).toEqual({
      layers: [],
      keyShift: 0,
      bpm: 100,
      metronome: false,
      editingSectionId: null,
      lastError: null,
    });
  });

  it('unknown action returns state unchanged', () => {
    const s = run(addChords(1));
    expect(workspaceReducer(deepFreeze(s), { type: 'NOPE' })).toBe(s);
  });
});

// ── ADD_LAYER ────────────────────────────────────────────────────────────────

describe('ADD_LAYER', () => {
  it('adds a library layer with full defaults', () => {
    const s = run(addChords(1));
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0]).toEqual({
      id: 'loops/chords-1.mid',
      source: librarySource('loops/chords-1.mid'),
      role: 'chords',
      channel: 0,
      gmProgram: 0,
      gain: 1,
      muted: false,
      soloed: false,
      carried: false,
    });
  });

  it('assigns channels lowest-free: first harmonic → 0, second → 1', () => {
    const s = run(addChords(1), addChords(2));
    expect(s.layers.map((l) => l.channel)).toEqual([0, 1]);
  });

  it('gives grooves channel 9 always, with no gmProgram (drums ignore program)', () => {
    const s = run(addGroove(1));
    expect(s.layers[0].channel).toBe(DRUM_CHANNEL);
    expect(s.layers[0].gmProgram).toBeNull();
  });

  it('two grooves BOTH land on channel 9 (GM drum channel is shared)', () => {
    const s = run(addGroove(1), addGroove(2));
    expect(s.layers.map((l) => l.channel)).toEqual([9, 9]);
  });

  it('harmonic channel pool skips 9 even when 0–8 are taken', () => {
    const s = run(...Array.from({ length: 10 }, (_, i) => addChords(i)));
    expect(s.layers.map((l) => l.channel)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10]);
  });

  it('defaults gmProgram by role: bass → 33, melody/idea/chords → 0', () => {
    const s = run(
      addLayer({ source: librarySource('a'), role: 'bass' }),
      addLayer({ source: librarySource('b'), role: 'melody' }),
      addLayer({ source: librarySource('c'), role: 'idea' }),
    );
    expect(s.layers.map((l) => l.gmProgram)).toEqual([33, 0, 0]);
  });

  it('reuses a freed channel (lowest-free policy) after remove', () => {
    const s = run(
      addChords(1), addChords(2), addChords(3),
      removeLayer('loops/chords-2.mid'),
      addChords(4),
    );
    const byId = Object.fromEntries(s.layers.map((l) => [l.id, l.channel]));
    expect(byId['loops/chords-4.mid']).toBe(1);
  });

  it('take source: id = takeId, notes live in the layer source', () => {
    const s = run(addLayer({ source: takeSource('take-abc'), role: 'melody' }));
    expect(s.layers[0].id).toBe('take-abc');
    expect(s.layers[0].source.notes).toHaveLength(1);
  });

  it('adding the same source twice produces distinct layer ids', () => {
    const s = run(addChords(1), addChords(1));
    expect(s.layers).toHaveLength(2);
    expect(new Set(s.layers.map((l) => l.id)).size).toBe(2);
  });

  describe('channel exhaustion', () => {
    it('16th non-groove add sets lastError and leaves the rest of state identical', () => {
      const full = fullMelodicState();
      expect(full.layers).toHaveLength(15);
      const after = workspaceReducer(deepFreeze(full), addChords(99));
      expect(after.lastError).toBe('channels-exhausted');
      const { lastError: _a, ...restAfter } = after;
      const { lastError: _b, ...restFull } = full;
      expect(restAfter).toEqual(restFull);
    });

    it('a groove can still be added when melodic channels are exhausted', () => {
      const s = workspaceReducer(deepFreeze(fullMelodicState()), addGroove(1));
      expect(s.layers).toHaveLength(16);
      expect(s.layers.at(-1).channel).toBe(DRUM_CHANNEL);
      expect(s.lastError).toBeNull();
    });
  });

  describe('bpmHint adoption', () => {
    it('first layer while bpm is still initial adopts bpmHint', () => {
      const s = run(addLayer({ source: librarySource('a'), role: 'chords', bpmHint: 132 }));
      expect(s.bpm).toBe(132);
    });

    it('does NOT adopt bpmHint on the second layer', () => {
      const s = run(
        addLayer({ source: librarySource('a'), role: 'chords', bpmHint: 132 }),
        addLayer({ source: librarySource('b'), role: 'melody', bpmHint: 88 }),
      );
      expect(s.bpm).toBe(132);
    });

    it('does NOT adopt bpmHint when bpm was already set explicitly', () => {
      const s = run(setBpm(120), addLayer({ source: librarySource('a'), role: 'chords', bpmHint: 132 }));
      expect(s.bpm).toBe(120);
    });

    it('clamps an out-of-range bpmHint', () => {
      const s = run(addLayer({ source: librarySource('a'), role: 'chords', bpmHint: 500 }));
      expect(s.bpm).toBe(220);
    });
  });
});

// ── REMOVE_LAYER ─────────────────────────────────────────────────────────────

describe('REMOVE_LAYER', () => {
  it('removes the layer (channel freed implicitly by absence)', () => {
    const s = run(addChords(1), addChords(2), removeLayer('loops/chords-1.mid'));
    expect(s.layers.map((l) => l.id)).toEqual(['loops/chords-2.mid']);
  });

  it('unknown id leaves state unchanged', () => {
    const before = run(addChords(1));
    const after = workspaceReducer(deepFreeze(before), removeLayer('ghost'));
    expect(after.layers).toEqual(before.layers);
  });

  it('removing the only soloed layer lifts the solo dimming from the others', () => {
    const s = run(addChords(1), addChords(2), toggleSolo('loops/chords-1.mid'));
    expect(effectiveMuted(s, 'loops/chords-2.mid')).toBe(true);
    const s2 = workspaceReducer(deepFreeze(s), removeLayer('loops/chords-1.mid'));
    expect(effectiveMuted(s2, 'loops/chords-2.mid')).toBe(false);
  });
});

// ── per-layer knobs ──────────────────────────────────────────────────────────

describe('SET_GAIN', () => {
  it('sets gain and clamps to 0..1', () => {
    const base = run(addChords(1));
    const id = 'loops/chords-1.mid';
    expect(workspaceReducer(deepFreeze(base), setGain(id, 0.4)).layers[0].gain).toBe(0.4);
    expect(workspaceReducer(deepFreeze(base), setGain(id, -3)).layers[0].gain).toBe(0);
    expect(workspaceReducer(deepFreeze(base), setGain(id, 7)).layers[0].gain).toBe(1);
  });

  it('non-finite gain and unknown id are no-ops', () => {
    const base = run(addChords(1));
    expect(workspaceReducer(deepFreeze(base), setGain('loops/chords-1.mid', NaN)).layers[0].gain).toBe(1);
    expect(workspaceReducer(deepFreeze(base), setGain('ghost', 0.5)).layers).toEqual(base.layers);
  });
});

describe('TOGGLE_MUTE / TOGGLE_SOLO', () => {
  it('toggles only the targeted layer', () => {
    const s = run(addChords(1), addChords(2), toggleMute('loops/chords-1.mid'), toggleSolo('loops/chords-2.mid'));
    expect(s.layers[0].muted).toBe(true);
    expect(s.layers[0].soloed).toBe(false);
    expect(s.layers[1].muted).toBe(false);
    expect(s.layers[1].soloed).toBe(true);
  });

  it('toggling twice restores the original flag', () => {
    const s = run(addChords(1), toggleMute('loops/chords-1.mid'), toggleMute('loops/chords-1.mid'));
    expect(s.layers[0].muted).toBe(false);
  });
});

describe('SET_VOICE', () => {
  it('sets gmProgram on melodic/harmonic layers', () => {
    const s = run(addChords(1), setVoice('loops/chords-1.mid', 48));
    expect(s.layers[0].gmProgram).toBe(48);
  });

  it('is a documented no-op for groove layers (drums have no program)', () => {
    const s = run(addGroove(1));
    const after = workspaceReducer(deepFreeze(s), setVoice(s.layers[0].id, 48));
    expect(after.layers[0].gmProgram).toBeNull();
  });
});

// ── global knobs ─────────────────────────────────────────────────────────────

describe('SET_KEY / NUDGE_KEY', () => {
  it('SET_KEY is absolute', () => {
    const s = run(setKey(5), setKey(-2));
    expect(s.keyShift).toBe(-2);
  });

  it('NUDGE_KEY accumulates deltas', () => {
    const s = run(nudgeKey(1), nudgeKey(1), nudgeKey(-3));
    expect(s.keyShift).toBe(-1);
  });
});

describe('SET_BPM', () => {
  it('sets and clamps to 40..220', () => {
    expect(run(setBpm(128)).bpm).toBe(128);
    expect(run(setBpm(10)).bpm).toBe(40);
    expect(run(setBpm(999)).bpm).toBe(220);
  });
});

describe('TOGGLE_METRONOME', () => {
  it('flips the metronome flag', () => {
    expect(run(toggleMetronome()).metronome).toBe(true);
    expect(run(toggleMetronome(), toggleMetronome()).metronome).toBe(false);
  });
});

// ── LOAD_STACK ───────────────────────────────────────────────────────────────

describe('LOAD_STACK', () => {
  const mkLayer = (id, role, channel, extra = {}) => ({
    id, source: librarySource(id), role, channel,
    gmProgram: role === 'groove' ? null : 0,
    gain: 1, muted: false, soloed: false, carried: false, ...extra,
  });

  it('wholesale-replaces layers and adopts bpm/keyShift/editingSectionId', () => {
    const s = run(
      addChords(1),
      loadStack({
        layers: [mkLayer('a', 'chords', 0), mkLayer('b', 'bass', 1, { gmProgram: 33 })],
        bpm: 90, keyShift: 3, editingSectionId: 'section-1',
      }),
    );
    expect(s.layers.map((l) => l.id)).toEqual(['a', 'b']);
    expect(s.bpm).toBe(90);
    expect(s.keyShift).toBe(3);
    expect(s.editingSectionId).toBe('section-1');
  });

  it('keeps current bpm/keyShift when omitted; editingSectionId defaults to null', () => {
    const s = run(setBpm(150), setKey(2), setEditingSection('x'),
      loadStack({ layers: [mkLayer('a', 'chords', 0)] }));
    expect(s.bpm).toBe(150);
    expect(s.keyShift).toBe(2);
    expect(s.editingSectionId).toBeNull();
  });

  it('repairs duplicate non-drum channels to lowest free', () => {
    const s = run(loadStack({
      layers: [mkLayer('a', 'chords', 2), mkLayer('b', 'melody', 2), mkLayer('c', 'bass', 2)],
    }));
    expect(s.layers.map((l) => l.channel)).toEqual([2, 0, 1]);
  });

  it('repairs a groove that arrives off channel 9, and a harmonic layer squatting on 9', () => {
    const s = run(loadStack({
      layers: [mkLayer('g', 'groove', 3), mkLayer('h', 'chords', 9)],
    }));
    expect(s.layers.find((l) => l.id === 'g').channel).toBe(DRUM_CHANNEL);
    expect(s.layers.find((l) => l.id === 'h').channel).toBe(0);
  });

  it('fills missing per-layer defaults (gain/muted/soloed/carried/gmProgram)', () => {
    const s = run(loadStack({
      layers: [{ id: 'a', source: librarySource('a'), role: 'bass', channel: 0 }],
    }));
    expect(s.layers[0]).toEqual({
      id: 'a', source: librarySource('a'), role: 'bass', channel: 0,
      gmProgram: 33, gain: 1, muted: false, soloed: false, carried: false,
    });
  });
});

// ── CLEAR / SET_EDITING_SECTION ──────────────────────────────────────────────

describe('CLEAR', () => {
  it('is a FULL reset — bpm and metronome included', () => {
    const s = run(addChords(1), setBpm(180), toggleMetronome(), setKey(4), clearWorkspace());
    expect(s).toEqual(initialWorkspace);
  });
});

describe('SET_EDITING_SECTION', () => {
  it('sets and clears the editing section id', () => {
    expect(run(setEditingSection('sec-1')).editingSectionId).toBe('sec-1');
    expect(run(setEditingSection('sec-1'), setEditingSection(null)).editingSectionId).toBeNull();
  });
});

// ── lastError lifecycle ──────────────────────────────────────────────────────

describe('lastError', () => {
  it('is cleared by the next successful action', () => {
    const errored = workspaceReducer(deepFreeze(fullMelodicState()), addChords(99));
    expect(errored.lastError).toBe('channels-exhausted');
    const healed = workspaceReducer(deepFreeze(errored), toggleMetronome());
    expect(healed.lastError).toBeNull();
  });
});

// ── selectors ────────────────────────────────────────────────────────────────

describe('anySolo', () => {
  it('reflects whether any layer is soloed', () => {
    const s = run(addChords(1), addChords(2));
    expect(anySolo(s)).toBe(false);
    expect(anySolo(workspaceReducer(deepFreeze(s), toggleSolo('loops/chords-1.mid')))).toBe(true);
  });
});

describe('effectiveMuted', () => {
  const A = 'loops/chords-1.mid';
  const B = 'loops/chords-2.mid';

  it('no solo: only explicit mutes count', () => {
    const s = run(addChords(1), addChords(2), toggleMute(A));
    expect(effectiveMuted(s, A)).toBe(true);
    expect(effectiveMuted(s, B)).toBe(false);
  });

  it('solo dims every non-soloed layer (muted OR (anySolo && !soloed)))', () => {
    const s = run(addChords(1), addChords(2), toggleSolo(A));
    expect(effectiveMuted(s, A)).toBe(false);
    expect(effectiveMuted(s, B)).toBe(true);
  });

  it('a muted layer stays muted even when it is the soloed one', () => {
    const s = run(addChords(1), addChords(2), toggleMute(A), toggleSolo(A));
    expect(effectiveMuted(s, A)).toBe(true);
  });

  it('unknown id reads as not muted (layer will not schedule anyway)', () => {
    expect(effectiveMuted(initialWorkspace, 'ghost')).toBe(false);
  });
});

describe('toTransportLayers', () => {
  const notes = [{ ticks: 0, durationTicks: 480, midi: 60 }];
  const loaded = (id) => ({ [id]: { notes, ppq: 480, barSpan: 4 } });

  it('maps a workspace layer into the loopScheduler shape (gain/channel passthrough)', () => {
    const s = run(addChords(1), setGain('loops/chords-1.mid', 0.5), setKey(3));
    const out = toTransportLayers(s, loaded('loops/chords-1.mid'));
    expect(out).toEqual([{
      notes, ppq: 480, barSpan: 4, transpose: 3, muted: false, channel: 0, gain: 0.5,
    }]);
  });

  it('pins groove transpose to 0 while keyShift is 3 (percussion never transposes)', () => {
    const s = run(addGroove(1), addChords(1), setKey(3));
    const grooveId = s.layers[0].id;
    const out = toTransportLayers(s, {
      ...loaded(grooveId),
      ...loaded('loops/chords-1.mid'),
    });
    expect(out).toHaveLength(2);
    expect(out[0].transpose).toBe(0);
    expect(out[0].channel).toBe(DRUM_CHANNEL);
    expect(out[1].transpose).toBe(3);
  });

  it('omits layers with no loaded notes yet', () => {
    const s = run(addChords(1), addChords(2));
    const out = toTransportLayers(s, loaded('loops/chords-2.mid'));
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe(1);
  });

  it('omits layers whose loaded notes are empty', () => {
    const s = run(addChords(1));
    expect(toTransportLayers(s, { 'loops/chords-1.mid': { notes: [], ppq: 480 } })).toEqual([]);
  });

  it('take layers fall back to notes embedded in their source', () => {
    const s = run(addLayer({ source: takeSource('take-1'), role: 'melody' }));
    const out = toTransportLayers(s, {});
    expect(out).toHaveLength(1);
    expect(out[0].notes).toEqual(takeSource('take-1').notes);
    expect(out[0].ppq).toBe(480);
    expect(out[0].barSpan).toBe(2); // lengthBars → barSpan
  });

  it('muted uses effectiveMuted (solo semantics)', () => {
    const s = run(addChords(1), addChords(2), toggleSolo('loops/chords-1.mid'));
    const out = toTransportLayers(s, {
      ...loaded('loops/chords-1.mid'),
      ...loaded('loops/chords-2.mid'),
    });
    expect(out.map((l) => l.muted)).toEqual([false, true]);
  });
});

// ── action creator / type consistency ────────────────────────────────────────

describe('action creators', () => {
  it('every creator emits a type registered in ActionTypes', () => {
    const samples = [
      addLayer({ source: librarySource('a'), role: 'chords' }),
      removeLayer('a'), setGain('a', 1), toggleMute('a'), toggleSolo('a'),
      setVoice('a', 0), setKey(0), nudgeKey(1), setBpm(100), toggleMetronome(),
      loadStack({ layers: [] }), clearWorkspace(), setEditingSection(null),
    ];
    const types = new Set(Object.values(ActionTypes));
    for (const a of samples) expect(types.has(a.type)).toBe(true);
    expect(new Set(samples.map((a) => a.type)).size).toBe(samples.length);
  });
});
