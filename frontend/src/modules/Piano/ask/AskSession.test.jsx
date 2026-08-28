import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AskSession, { askTupleFor } from './AskSession.jsx';
import { pianoLearningApi } from '../PianoKiosk/modes/Exercises/pianoLearningApi.js';

/**
 * AskSession's contract: the one seam between a HOST (which knows why a child
 * is being asked to play) and a JUDGED ATTEMPT (which knows nothing about why).
 *
 * The inner `ExerciseRun` is deliberately NOT doubled. It is spied THROUGH —
 * every prop it receives is recorded, and the real component then renders and
 * reports with it. A double would let this suite agree with itself about a
 * boundary neither side actually honoured; a pass-through proves the seam
 * carries a real run, header line included.
 *
 * What IS doubled is everything below the run that a headless DOM cannot
 * provide: MIDI, the roster, the keyboard footer, the metronome, the score
 * engraver, and the two network clients.
 */
const h = vi.hoisted(() => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  runProps: [],
  activeNotes: new Map(),
  instanceOk: true,
  program: { ok: false, data: null },
  catalog: { ok: false, data: null },
  scoreXml: '<score/>',
  scoreOk: true,
  instance: {
    id: 'scales/modes@root=G,mode=ionian,direction=up,span_octaves=1',
    title: 'G major scale',
    form: 'scale',
    ordering: 'strict',
    key: 'G',
    meter: '4/4',
    tempo: { unit: 'quarter', start_bpm: 90 },
    level: { free: 1 },
    supports: ['free', 'cued'],
    axes: { root: 'G', mode: 'ionian' },
    staff: 'treble',
    events: [
      { id: 'first', value: 'quarter', notes: [{ midi: 67, hand: 'right' }] },
      { id: 'second', value: 'quarter', notes: [{ midi: 69, hand: 'right' }] },
    ],
  },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../PianoKiosk/PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'learner4' }) }));
vi.mock('../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));
vi.mock('../PianoKiosk/modes/SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: () => {} }));
// The engraver cannot run under happy-dom (no SVG text metrics). Stubbed to a
// silent stage: this suite asserts what the SESSION handed down for a score,
// not what the passage draws — `ExerciseRun.score.test.jsx` owns that.
vi.mock('../PianoKiosk/modes/Exercises/ScorePassage.jsx', () => ({
  default: ({ sourceId }) => <div data-testid="score-passage" data-source={sourceId} />,
}));
vi.mock('../PianoKiosk/modes/Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: {
    instance: vi.fn(async () => (h.instanceOk
      ? { ok: true, data: h.instance }
      : { ok: false, status: 502, data: null })),
    program: vi.fn(async () => h.program),
    // The catalog walk, for a collection whose ids cannot be derived. Down by
    // default: the only live levels that reach it are ones naming a collection
    // with no roots, and `catalog-unavailable` is the reason that must survive.
    catalog: vi.fn(async () => h.catalog),
    instances: vi.fn(async () => ({ ok: false, data: null })),
  },
}));
vi.mock('../../../lib/api.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  DaylightAPIText: vi.fn(async () => {
    if (!h.scoreOk) throw new Error('HTTP 502: Bad Gateway');
    return h.scoreXml;
  }),
}));
vi.mock('../PianoKiosk/modes/Exercises/ExerciseRun.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: (props) => {
      h.runProps.push(props);
      return actual.default(props);
    },
  };
});

/** The props the inner run was last given. */
const lastRun = () => h.runProps.at(-1);

const callbacks = () => ({
  onPassed: vi.fn(), onFailed: vi.fn(), onExit: vi.fn(), onUnavailable: vi.fn(),
});

beforeEach(() => {
  h.runProps = [];
  h.activeNotes = new Map();
  h.instanceOk = true;
  h.program = { ok: false, data: null };
  h.catalog = { ok: false, data: null };
  h.scoreOk = true;
  pianoLearningApi.instance.mockClear();
  pianoLearningApi.program.mockClear();
  for (const logger of Object.values(h.log)) logger.mockClear();
});

describe('AskSession — the gate shape (an ask level plus a picked material)', () => {
  const level = Object.freeze({ id: 'L2', tier: 2, material: [{ kind: 'exercise', collection: 'scales' }] });
  const spec = Object.freeze({ kind: 'exercise', instanceId: 'scales/modes@root=G,mode=ionian,direction=up,span_octaves=1' });

  it('resolves the material, builds the completeness requirement, and hands both down', async () => {
    render(<AskSession ask={level} materialSpec={spec} framing="Play this to start Chess" intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().requirement).toEqual({
      mode: 'free', rubric: { criteria: { completeness: 1 } }, passScore: null,
    });
    expect(lastRun().score).toBeNull();
  });

  it('writes the ask copy from the spec and the resolved instance, and carries the level tier', async () => {
    render(<AskSession ask={level} materialSpec={spec} framing="Play this to start Chess" intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().ask).toBe('G major scale, right hand.'));
    expect(lastRun().tier).toBe(2);
    expect(lastRun().framing).toBe('Play this to start Chess');
    // The seam is real: the run put the host's reason and the ask on screen.
    expect(await screen.findByText('Play this to start Chess')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'G major scale, right hand.' })).toBeInTheDocument();
  });

  it('synthesizes a lit-key ask from a keys spec rather than fetching one', async () => {
    const floor = { id: 'keys-1', tier: 0, material: [{ kind: 'keys', notes: 1 }] };
    render(<AskSession ask={floor} materialSpec={{ kind: 'keys', notes: 1 }} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance?.id).toBe('keys/lit@notes=1,arrangement=together,pick=0'));
    expect(lastRun().ask).toBe('Press the lit key.');
    expect(lastRun().tier).toBe(0);
  });

  it('takes a score material as a DOCUMENT, never dressed up as an instance', async () => {
    const scoreLevel = { id: 'L4', tier: 3, grading: { cleanliness: 0.8 }, material: [] };
    render(
      <AskSession
        ask={scoreLevel}
        materialSpec={{ kind: 'score', source: 'files:sheetmusic/minuet.musicxml', measures: [1, 4] }}
        intent="challenge"
        {...callbacks()}
      />,
    );

    await waitFor(() => expect(lastRun().score?.id).toBe('files:sheetmusic/minuet.musicxml'));
    expect(lastRun().instance).toBeNull();
    expect(lastRun().ask).toBe('Play this passage as written.');
    expect(lastRun().requirement.mode).toBe('cued');
  });

  it('turns a framing OBJECT into the host sentence', async () => {
    render(<AskSession ask={level} materialSpec={spec} framing={{ kind: 'gate', gameLabel: 'Tetris' }} intent="challenge" {...callbacks()} />);
    await waitFor(() => expect(lastRun().framing).toBe('Play this to start Tetris'));
  });
});

/**
 * The FOUR shapes a live repertoire level can actually write
 * (`data/household/piano/config.yml`), each resolved from the AUTHORED spec —
 * which is the only shape that carries both what to resolve and what to say.
 *
 * The trap this describe exists for: an earlier cut handed the same prop to the
 * resolver and to the copy writer while meaning two different things by it.
 * Reading it as a resolved descriptor made the floor say "Play these notes
 * together" instead of "Press the lit key"; reading it as an authored spec and
 * resolving it with `resolveGateMaterial` made every staff-level rung
 * (`{collection, roots}` — L1 through L4, i.e. every scale in the house)
 * unresolvable, so every one of them failed the gate open and root rotation
 * died with them. Both readings pass a suite that only ever tries
 * `{kind:'exercise', instanceId}`, which is why all four are here.
 */
describe('AskSession — every material shape a live level can name', () => {
  const scaleId = (root) => `scales/modes@root=${root},mode=ionian,direction=up,span_octaves=1`;

  it('resolves a collection+roots spec — the shape every staff-level rung is written in', async () => {
    const level = { id: 'L2', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['G', 'D', 'F'] }] };
    render(<AskSession ask={level} materialSpec={level.material[0]} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(pianoLearningApi.instance).toHaveBeenCalledWith(scaleId('G'));
    // Once, not twice: the descriptor the spec resolves to already carries its
    // instance, and the load below must short-circuit rather than refetch.
    expect(pianoLearningApi.instance).toHaveBeenCalledTimes(1);
    expect(lastRun().ask).toBe('G major scale, right hand.');
  });

  it('rotates those roots on the host’s pickIndex, so two consecutive gates differ', async () => {
    const level = { id: 'L2', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['G', 'D', 'F'] }] };
    render(<AskSession ask={level} materialSpec={level.material[0]} pickIndex={1} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(pianoLearningApi.instance).toHaveBeenCalledWith(scaleId('D')));
    expect(pianoLearningApi.instance).not.toHaveBeenCalledWith(scaleId('G'));
  });

  it('resolves a spec that names its instance outright', async () => {
    const level = { id: 'L1', tier: 2, material: [{ kind: 'exercise', instanceId: scaleId('C') }] };
    render(<AskSession ask={level} materialSpec={level.material[0]} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(pianoLearningApi.instance).toHaveBeenCalledWith(scaleId('C'));
  });

  /**
   * The floor's copy, word for word. `keys-1` is the rung a child arrives at
   * after failing everything above it, and "Press the lit key." is the whole of
   * what it says. Asserted per shape because the sentence is written from the
   * spec's own `notes`/`arrangement` — the two fields a resolved descriptor
   * throws away.
   */
  it.each([
    ['keys-1', { kind: 'keys', notes: 1 }, 'Press the lit key.', 'keys/lit@notes=1,arrangement=together,pick=0'],
    ['keys-2', { kind: 'keys', notes: 2, arrangement: 'together' }, 'Play these notes together.', 'keys/lit@notes=2,arrangement=together,pick=0'],
    ['keys-3', { kind: 'keys', notes: 3, arrangement: 'sequence' }, 'Play the lit keys in order.', 'keys/lit@notes=3,arrangement=sequence,pick=0'],
  ])('synthesizes %s and reads it out in that rung’s own words', async (id, spec, copy, instanceId) => {
    render(<AskSession ask={{ id, tier: 0, material: [spec] }} materialSpec={spec} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance?.id).toBe(instanceId));
    expect(lastRun().ask).toBe(copy);
    // Synthesized, never fetched: a 502 must not stand between a four-year-old
    // and the easiest thing the gate can ask.
    expect(pianoLearningApi.instance).not.toHaveBeenCalled();
  });

  it('takes a score spec as a document, fetched once, with the level’s bars', async () => {
    const spec = { kind: 'score', source: 'files:sheetmusic/minuet.musicxml', measures: [1, 4] };
    render(<AskSession ask={{ id: 'L4', tier: 3, grading: { cleanliness: 0.8 }, material: [spec] }} materialSpec={spec} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().score?.id).toBe('files:sheetmusic/minuet.musicxml'));
    expect(lastRun().score.measures).toEqual([1, 4]);
    expect(lastRun().instance).toBeNull();
    expect(lastRun().ask).toBe('Play this passage as written.');
  });

  it('surfaces a catalog that could not be reached, for a collection with no roots', async () => {
    const cb = callbacks();
    const spec = { kind: 'exercise', collection: 'chords' };
    render(<AskSession ask={{ id: 'Lc', tier: 2, material: [spec] }} materialSpec={spec} intent="challenge" {...cb} />);

    // The frozen word FIRST, and the exact reason beside it. A host that must
    // tell a config mistake from an outage — the gate's substitute-don't-grant
    // policy is exactly that — cannot read it off the log, and reading it off
    // the word would mean widening a vocabulary four call sites depend on.
    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'exercise', reason: 'catalog-unavailable', mode: 'free' },
    ));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'exercise', error: 'catalog-unavailable' }),
    );
  });

  it('surfaces a level that named neither a collection nor an instance', async () => {
    const cb = callbacks();
    const spec = { kind: 'exercise' };
    render(<AskSession ask={{ id: 'Lx', tier: 2, material: [spec] }} materialSpec={spec} intent="challenge" {...cb} />);

    // The frozen word FIRST, and the exact reason beside it. A host that must
    // tell a config mistake from an outage — the gate's substitute-don't-grant
    // policy is exactly that — cannot read it off the log, and reading it off
    // the word would mean widening a vocabulary four call sites depend on.
    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'exercise', reason: 'no-collection-or-instance', mode: 'free' },
    ));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'exercise', error: 'no-collection-or-instance' }),
    );
  });

  it('surfaces a score spec naming no document', async () => {
    const cb = callbacks();
    const spec = { kind: 'score' };
    render(<AskSession ask={{ id: 'Ls', tier: 3, grading: {}, material: [spec] }} materialSpec={spec} intent="challenge" {...cb} />);

    // The frozen word FIRST, and the exact reason beside it. A host that must
    // tell a config mistake from an outage — the gate's substitute-don't-grant
    // policy is exactly that — cannot read it off the log, and reading it off
    // the word would mean widening a vocabulary four call sites depend on.
    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'score', reason: 'no-score-source', mode: 'cued' },
    ));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'score', error: 'no-score-source' }),
    );
  });
});

describe('AskSession — the practice shape (a bank instance and nothing else)', () => {
  it('yields no framing and no requirement, and keeps the exercise title as the headline', async () => {
    render(<AskSession instanceId={h.instance.id} intent="practice" practiceMode="free" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().framing).toBeNull();
    expect(lastRun().ask).toBeNull();
    expect(lastRun().requirement).toBeNull();
    expect(lastRun().tier).toBeNull();
    expect(await screen.findByRole('heading', { name: 'G major scale' })).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();
  });
});

describe('AskSession — the program shape (C1: a step that says why it is on screen)', () => {
  const step = Object.freeze({
    id: 'hanon-01',
    title: 'Exercise 1',
    requirement: { mode: 'free', rubric: { criteria: { completeness: 1 } }, passScore: null },
  });

  beforeEach(() => { h.program = { ok: true, data: { id: 'hanon', steps: [step] } }; });

  it('computes "Pass this to finish {step title}" from the program it fetched', async () => {
    render(<AskSession instanceId={h.instance.id} programId="hanon" stepId="hanon-01" intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().framing).toBe('Pass this to finish Exercise 1'));
    expect(await screen.findByText('Pass this to finish Exercise 1')).toBeInTheDocument();
  });

  it('takes the step’s own requirement, by identity', async () => {
    render(<AskSession instanceId={h.instance.id} programId="hanon" stepId="hanon-01" intent="challenge" {...callbacks()} />);
    await waitFor(() => expect(lastRun().requirement).toBe(step.requirement));
  });

  it('passes the program identity down so the evidence still names it', async () => {
    render(<AskSession instanceId={h.instance.id} programId="hanon" stepId="hanon-01" intent="challenge" {...callbacks()} />);
    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().programId).toBe('hanon');
    expect(lastRun().stepId).toBe('hanon-01');
  });
});

describe('AskSession — the video-checkpoint shape (a host-authored requirement)', () => {
  const requirementOverride = Object.freeze({ mode: 'free', hands: 1, span: 1, passScore: 0.8 });

  it('keeps the requirement it was given, by identity, and adds no framing of its own', async () => {
    render(<AskSession instanceId={h.instance.id} requirementOverride={requirementOverride} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().requirement).toBe(requirementOverride));
    expect(lastRun().framing).toBeNull();
  });

  it('wins over a program step’s requirement', async () => {
    h.program = { ok: true, data: { id: 'hanon', steps: [{ id: 's1', title: 'Step one', requirement: { mode: 'cued' } }] } };
    render(
      <AskSession
        instanceId={h.instance.id}
        programId="hanon"
        stepId="s1"
        requirementOverride={requirementOverride}
        intent="challenge"
        {...callbacks()}
      />,
    );

    await waitFor(() => expect(lastRun().requirement).toBe(requirementOverride));
    // The step is still fetched, and still names the reason the screen exists.
    expect(lastRun().framing).toBe('Pass this to finish Step one');
  });
});

describe('AskSession — the reasons a run cannot happen', () => {
  it('refuses a schema-invalid ask as unrunnable, naming the errors', async () => {
    const cb = callbacks();
    render(<AskSession ask={{ id: 'bad', tier: 9, material: [] }} materialSpec={{ kind: 'keys', notes: 1 }} intent="challenge" {...cb} />);

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith('unrunnable'));
    expect(h.log.warn).toHaveBeenCalledWith('piano.ask-invalid', expect.objectContaining({
      errors: expect.arrayContaining(['tier: unknown preset tier-9']),
    }));
    // Nothing was mounted, so nothing fetched: a broken ask is refused before
    // it can put a half-built run in front of a child.
    expect(h.runProps).toHaveLength(0);
  });

  it('refuses an ask asking for something SP1 has not built yet', async () => {
    const cb = callbacks();
    render(
      <AskSession
        ask={{ id: 'future', tier: 2, presentation: { hints: 'always' }, material: [] }}
        materialSpec={{ kind: 'exercise', instanceId: h.instance.id }}
        intent="challenge"
        {...cb}
      />,
    );

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith('unrunnable'));
    expect(h.log.warn).toHaveBeenCalledWith('piano.ask-invalid', expect.objectContaining({
      errors: expect.arrayContaining(['not-yet-implemented: hints']),
    }));
  });

  it('surfaces a bank that could not be reached as instance-not-found, keeping the decline string in the log', async () => {
    h.instanceOk = false;
    const cb = callbacks();
    render(
      <AskSession
        ask={{ id: 'L2', tier: 2, material: [] }}
        materialSpec={{ kind: 'exercise', instanceId: 'scales/nope' }}
        intent="challenge"
        {...cb}
      />,
    );

    // The frozen word FIRST, and the exact reason beside it. A host that must
    // tell a config mistake from an outage — the gate's substitute-don't-grant
    // policy is exactly that — cannot read it off the log, and reading it off
    // the word would mean widening a vocabulary four call sites depend on.
    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'exercise', reason: 'instance-unavailable', mode: 'free' },
    ));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'exercise', error: 'instance-unavailable' }),
    );
  });

  it('surfaces a material kind nothing implements the same way', async () => {
    const cb = callbacks();
    render(
      <AskSession
        ask={{ id: 'L2', tier: 2, material: [] }}
        materialSpec={{ kind: 'interpretive-dance' }}
        intent="challenge"
        {...cb}
      />,
    );

    // The frozen word FIRST, and the exact reason beside it. A host that must
    // tell a config mistake from an outage — the gate's substitute-don't-grant
    // policy is exactly that — cannot read it off the log, and reading it off
    // the word would mean widening a vocabulary four call sites depend on.
    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'interpretive-dance', reason: 'unknown-material-kind', mode: 'free' },
    ));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'interpretive-dance', error: 'unknown-material-kind' }),
    );
  });

  it('surfaces a score the media tree could not serve', async () => {
    h.scoreOk = false;
    const cb = callbacks();
    render(
      <AskSession
        ask={{ id: 'L4', tier: 3, grading: { cleanliness: 0.8 }, material: [] }}
        materialSpec={{ kind: 'score', source: 'files:sheetmusic/gone.musicxml', measures: [1, 4] }}
        intent="challenge"
        {...cb}
      />,
    );

    // The frozen word FIRST, and the exact reason beside it. A host that must
    // tell a config mistake from an outage — the gate's substitute-don't-grant
    // policy is exactly that — cannot read it off the log, and reading it off
    // the word would mean widening a vocabulary four call sites depend on.
    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'score', reason: 'score-unavailable', mode: 'cued' },
    ));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'score', error: 'score-unavailable' }),
    );
  });
});

describe('AskSession — what it reports back to the host', () => {
  const level = Object.freeze({ id: 'L2', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['G'] }] });
  const spec = Object.freeze({ kind: 'exercise', collection: 'scales', roots: ['G'] });

  it('names what it settled on — the descriptor, the instance and the requirement', async () => {
    // A host cannot name this itself. The level wrote `roots: ['G','D','F']`;
    // which of those is on the stand today is decided in here, and a gate that
    // logged the spec would log the same line for three different scales.
    const cb = { ...callbacks(), onResolved: vi.fn() };
    render(<AskSession ask={level} materialSpec={spec} intent="challenge" {...cb} />);

    await waitFor(() => expect(cb.onResolved).toHaveBeenCalledTimes(1));
    const settled = cb.onResolved.mock.calls[0][0];
    expect(settled.material).toEqual({ kind: 'exercise', instanceId: h.instance.id, instance: h.instance });
    expect(settled.instance).toBe(h.instance);
    // The LEVEL's requirement, not the host's: a repertoire level IS its
    // requirement, and this is the only place that derivation happens.
    expect(settled.requirement).toEqual({ mode: 'free', rubric: { criteria: { completeness: 1 } }, passScore: null });
    // …and it is the same object the run was given, not a second copy.
    expect(settled.requirement).toBe(lastRun().requirement);
    expect(cb.onUnavailable).not.toHaveBeenCalled();
  });

  it('reports a decline on ONE channel, and does not mount a run on nothing', async () => {
    // The run reports "settled with nothing" as `instance-not-found` too. If it
    // were mounted here it would say so a second time, WITHOUT the reason — and
    // a host that acted on the second report would fail open on a config typo.
    h.instanceOk = false;
    const cb = { ...callbacks(), onResolved: vi.fn() };
    render(<AskSession ask={level} materialSpec={{ kind: 'exercise', instanceId: 'scales/nope' }} intent="challenge" {...cb} />);

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledTimes(1));
    expect(cb.onResolved).not.toHaveBeenCalled();
    // The run mounts while the material is still in flight — that is its
    // skeleton, and it is correct. What it is never handed is a SETTLED pair
    // of nothings, which is the state it reports `instance-not-found` from.
    expect(h.runProps.some((props) => props.instance === null && props.score === null)).toBe(false);
    expect(screen.getByText('Exercise not found. It may have been renamed.')).toBeInTheDocument();
  });

  it('answers a REJECTED fetch instead of letting it escape', async () => {
    // Nothing above catches this. Unhandled, a child sits on a skeleton that
    // never lifts and a gate that fails open on outages is never told there was
    // one — the child forfeits a match they earned to a backend restart.
    pianoLearningApi.instance.mockRejectedValueOnce(new Error('network down'));
    const cb = { ...callbacks(), onResolved: vi.fn() };
    render(<AskSession ask={level} materialSpec={spec} intent="challenge" {...cb} />);

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith(
      'instance-not-found', { kind: 'exercise', reason: 'instance-unavailable', mode: 'free' },
    ));
    // The message a human needs survives, on the line a human reads.
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ error: 'instance-unavailable', thrown: 'network down' }),
    );
  });
});

describe('AskSession — what it promises the run underneath', () => {
  const cb = callbacks();

  it('passes every host callback straight through, by identity', async () => {
    render(<AskSession instanceId={h.instance.id} intent="practice" {...cb} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().onPassed).toBe(cb.onPassed);
    expect(lastRun().onFailed).toBe(cb.onFailed);
    expect(lastRun().onExit).toBe(cb.onExit);
    expect(lastRun().onUnavailable).toBe(cb.onUnavailable);
  });

  it('keeps the instance and the requirement REFERENTIALLY STABLE across its own re-renders', async () => {
    const level = Object.freeze({ id: 'L2', tier: 2, material: [] });
    const spec = Object.freeze({ kind: 'exercise', instanceId: h.instance.id });
    const view = render(<AskSession ask={level} materialSpec={spec} intent="challenge" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    const settled = lastRun();
    view.rerender(<AskSession ask={level} materialSpec={spec} intent="challenge" {...callbacks()} />);

    // A fresh object here would rebuild the attempt in the run below and reset
    // the cursor under the child's hands.
    expect(lastRun().instance).toBe(settled.instance);
    expect(lastRun().requirement).toBe(settled.requirement);
  });

  it('shows the run’s own skeleton while it resolves, never a blank screen', async () => {
    render(<AskSession instanceId={h.instance.id} intent="practice" {...callbacks()} />);
    expect(document.querySelector('.piano-skeleton')).toBeTruthy();
    // Settle before leaving, so the resolution lands inside this test rather
    // than as an unacted update in the next one.
    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
  });

  /**
   * The run below still carries a compatibility path that loads for itself when
   * NO resolved source reaches it. A session that left one of the three props
   * undefined while it resolved would hand that path a live `instanceId` and
   * fetch the same instance twice — the second one landing after the first, and
   * rebuilding the attempt under the child's hands.
   */
  it('never lets the run underneath resolve a second time on its own', async () => {
    render(<AskSession instanceId={h.instance.id} programId="hanon" stepId="s1" intent="practice" {...callbacks()} />);

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(pianoLearningApi.instance).toHaveBeenCalledTimes(1);
    expect(pianoLearningApi.program).toHaveBeenCalledTimes(1);
    expect(lastRun().instanceId).toBeUndefined();
    expect(lastRun().material).toBeUndefined();
  });
});

/**
 * The tuple construction, on its own — the two subtlest decisions in this seam,
 * observable directly rather than only through how often a refusal fires.
 *
 * Both facts come from the MATERIAL because a legacy level never states them,
 * and without them the constraint table cannot say anything true about one:
 * every live tier-3 level asserts `timing: cued`, and `cued ⇒ a source that can
 * carry note values` is unanswerable until the material is known.
 */
describe('askTupleFor — the tuple a level plus its material actually expresses', () => {
  const tupleOf = (level, spec) => askTupleFor(level, spec).tuple;

  it.each([
    ['keys', { kind: 'keys', notes: 1 }, 'synthesized'],
    ['exercise', { kind: 'exercise', collection: 'scales' }, 'bank'],
    ['score', { kind: 'score', source: 'files:x.musicxml' }, 'score'],
  ])('reads the source axis off a %s spec', (_label, spec, sourceKind) => {
    expect(tupleOf({ tier: 2 }, spec).source).toEqual({ kind: sourceKind });
  });

  it('leaves the source axis ABSENT when no material has been picked', () => {
    expect(tupleOf({ tier: 2 }, null).source).toBeUndefined();
  });

  it('carries the preset’s presentation axes and the level’s judging', () => {
    expect(tupleOf({ tier: 3, grading: { cleanliness: 0.8 } }, { kind: 'exercise', instanceId: 'x' })).toEqual({
      prompt: 'read',
      secondary: 'keyboard-strip',
      notationStyle: 'engraved',
      timing: 'cued',
      judging: 'placed',
      source: { kind: 'bank' },
    });
  });

  /**
   * A document has exactly one honest stage. This is not a liberty taken with
   * the level: it reproduces the short-circuit the run surface has always run
   * (`stage = score ? 'score' : stageForTier(...)`), and it is what lets a
   * tier-2 level name a passage without the tuple claiming it will be drawn on
   * a one-staff sequence renderer that never sees it.
   */
  it('forces notationStyle score for score material, at a tier whose preset says otherwise', () => {
    const spec = { kind: 'score', source: 'files:x.musicxml' };
    expect(tupleOf({ tier: 2 }, spec).notationStyle).toBe('score');
    expect(tupleOf({ tier: 3, grading: {} }, spec).notationStyle).toBe('score');
    // And without that override the level would be refused, which is the whole
    // reason it is here rather than left to the run to paper over.
    expect(askTupleFor({ tier: 2 }, spec).errors).toEqual([]);
  });

  it('concatenates the expansion’s errors with the constraint table’s', () => {
    const { errors } = askTupleFor({ tier: 9, presentation: { hints: 'always' } }, { kind: 'keys', notes: 1 });
    expect(errors).toEqual(expect.arrayContaining([
      'tier: unknown preset tier-9',
      'not-yet-implemented: hints',
    ]));
  });

  it('refuses a cued level whose material cannot carry note values', () => {
    // A tier-3 lit key: grammatically expressible, and nothing can count a
    // child in on a note the ask synthesized without a tempo of its own.
    expect(askTupleFor({ tier: 3, grading: {} }, { kind: 'keys', notes: 1 }).errors).toEqual(
      expect.arrayContaining(['cued: requires source bank or score, not synthesized']),
    );
  });

  /**
   * Every level the house actually runs, as written in
   * `data/household/piano/config.yml` — paired with its own first material
   * spec, which is how `AskSession` will see it. Zero errors is the
   * reproduces-today contract: a level that validates clean today must not
   * become `unrunnable` because this seam started checking.
   */
  it.each([
    ['keys-1', { id: 'keys-1', tier: 0, material: [{ kind: 'keys', notes: 1 }] }],
    ['keys-2', { id: 'keys-2', tier: 1, material: [{ kind: 'keys', notes: 2, arrangement: 'together' }] }],
    ['keys-3', { id: 'keys-3', tier: 1, material: [{ kind: 'keys', notes: 3, arrangement: 'sequence' }] }],
    ['L1', { id: 'L1', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['C'] }] }],
    ['L2', { id: 'L2', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['G', 'D', 'F'] }] }],
    ['L3', { id: 'L3', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['A', 'E'] }] }],
    ['L4', { id: 'L4', tier: 3, grading: { cleanliness: 0.8 }, material: [{ kind: 'exercise', collection: 'scales', roots: ['C', 'G'] }] }],
  ])('accepts the live level %s without a single error', (_id, level) => {
    expect(askTupleFor(level, level.material[0]).errors).toEqual([]);
  });
});
