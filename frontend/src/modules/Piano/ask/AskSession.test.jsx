import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AskSession from './AskSession.jsx';
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

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith('instance-not-found'));
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

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith('instance-not-found'));
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

    await waitFor(() => expect(cb.onUnavailable).toHaveBeenCalledWith('instance-not-found'));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'score', error: 'score-unavailable' }),
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
