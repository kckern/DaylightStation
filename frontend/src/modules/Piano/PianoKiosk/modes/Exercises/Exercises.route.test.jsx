import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Exercises } from './Exercises.jsx';

/**
 * The exercise RUN ROUTE, from the URL a child arrives on to the words on the
 * header — the seam bug report C1 named and the one nothing could test before.
 *
 * The route is the only host that reaches a judged attempt through a QUERY
 * STRING rather than through props, and it serves three different children:
 *
 *  - **practice**, who chose an exercise from the browser and has its detail
 *    page one tap behind them — they get the bank's own title and nothing else;
 *  - **a program step**, who pressed "Pass at 90 BPM" on a program page and
 *    should read which step this finishes;
 *  - **a video checkpoint**, who was watching a lesson, was stopped by an
 *    exercise, and should read which lesson finishing it returns them to.
 *
 * `AskSession` and `ExerciseRun` are both REAL here — the run is spied THROUGH
 * so the props crossing the seam are observable, but the component that renders
 * is the one a child sees. A double would let this suite agree with itself
 * about a header neither side actually drew. What IS doubled is everything a
 * headless DOM cannot provide: MIDI, the roster, the keyboard footer, the
 * metronome, the notation renderers and the learning API.
 */
const h = vi.hoisted(() => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  runProps: [],
  activeNotes: new Map(),
  record: vi.fn(),
  instance: {
    id: 'scales/c-major@test',
    title: 'C major fragment',
    form: 'scale',
    ordering: 'strict',
    key: 'C',
    meter: '4/4',
    tempo: { start_bpm: 90 },
    level: { free: 1 },
    events: [
      { id: 'first', value: 'quarter', notes: [{ midi: 60, hand: 'right' }] },
      { id: 'second', value: 'quarter', notes: [{ midi: 62, hand: 'right' }] },
    ],
  },
  program: null,
  learning: null,
  catalog: null,
}));

vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: 'learner4', currentProfile: { id: 'learner4', name: 'User_4' } }),
}));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));
vi.mock('./ExerciseNotation.jsx', () => ({
  default: () => <div data-testid="notation" />,
  ExercisePreview: () => <div data-testid="preview" />,
}));
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: () => {} }));
vi.mock('./pianoLearningApi.js', () => ({
  pianoLearningApi: {
    instance: vi.fn(async () => ({ ok: true, data: h.instance })),
    program: vi.fn(async () => h.program),
    learning: vi.fn(async () => ({ ok: true, data: h.learning })),
    catalog: vi.fn(async () => ({ ok: true, data: h.catalog })),
    seed: vi.fn(async () => ({ ok: false, data: null })),
    instances: vi.fn(async () => ({ ok: false, data: null })),
    enroll: vi.fn(async () => ({ ok: true })),
    unenroll: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('../../../performance/attemptEvidence.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pianoAttemptClient: { record: h.record },
}));
vi.mock('./ExerciseRun.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: (props) => {
      h.runProps.push(props);
      return actual.default(props);
    },
  };
});

import { pianoLearningApi } from './pianoLearningApi.js';

/** The props the inner run was last given. */
const lastRun = () => h.runProps.at(-1);
/** Every distinct value a prop took once the material had settled. */
const settledValues = (name) => [...new Set(h.runProps.filter((p) => p.instance).map((p) => p[name]))];

const STEP = Object.freeze({
  id: 'hanon-01',
  order: 1,
  title: 'Exercise 1',
  subtitle: 'Five fingers, one hand',
  state: 'current',
  unlocked: true,
  passed: false,
  requirement: Object.freeze({
    exercise_id: 'scales/c-major@test',
    mode: 'free',
    rubric: { criteria: { completeness: 1 } },
    passScore: null,
  }),
});

/** A video checkpoint's own requirement, as it travels: JSON in the query. */
const CHECKPOINT = Object.freeze({
  exercise_id: 'scales/c-major@test', mode: 'free', hands: 1, span: 1, passScore: 0.8,
});

const runUrl = (params) => `/piano/exercises/run/${encodeURIComponent(h.instance.id)}?${new URLSearchParams(params)}`;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const treeAt = (entry) => (
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/piano/exercises/*" element={<Exercises />} />
      {/* Where a checkpoint's `return` lands. It has to be a real route: a
          `navigate` to a path nothing matches renders nothing and would let a
          broken return read as a passing test. */}
      <Route path="/piano/videos/*" element={<div data-testid="back-at-the-lesson" />} />
    </Routes>
    <LocationProbe />
  </MemoryRouter>
);

const renderAt = (entry) => {
  const view = render(treeAt(entry));
  // A FRESH element every time: re-rendering the identical element reference
  // lets React bail out of the subtree, and the mocked MIDI hook's new value
  // would never be read.
  const again = () => act(() => view.rerender(treeAt(entry)));
  return {
    view,
    /** A note struck and released, with the re-renders the mocked MIDI hook needs. */
    press: (midi) => {
      h.activeNotes = new Map([[midi, { velocity: 1 }]]);
      again();
      h.activeNotes = new Map();
      again();
    },
    rerender: again,
  };
};

const where = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  h.runProps = [];
  h.activeNotes = new Map();
  h.program = { ok: true, data: { id: 'hanon', title: 'Hanon', description: 'Five-finger studies', steps: [STEP] } };
  h.learning = {
    programs: [{
      id: 'hanon', title: 'Hanon', required: false, percent: 0, passed_steps: 0, total_steps: 1,
      current_step: STEP, steps: [STEP],
    }],
    available_programs: [],
    next_up: null,
    catalog_progress: {},
  };
  h.catalog = { totals: { seeds: 1, variants: 1 }, categories: [], seeds: [] };
  h.record.mockReset();
  h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 3 });
  for (const client of Object.values(pianoLearningApi)) client.mockClear?.();
  for (const logger of Object.values(h.log)) logger.mockClear();
});

/**
 * C1, the assertion that could never pass before this task: the `program`
 * branch of `framingFor` had no production caller, so a child who pressed
 * "Pass challenge" on a program step read the eyebrow "Pass challenge" over the
 * exercise bank's own title and learned nothing about why the screen existed.
 */
describe('the run route — a program step says which step it finishes', () => {
  it('reads "Pass this to finish {step title}" over the ask', async () => {
    renderAt(runUrl({ intent: 'challenge', program: 'hanon', step: 'hanon-01' }));

    expect(await screen.findByText('Pass this to finish Exercise 1')).toBeInTheDocument();
    // The framing REPLACES the intent label — a child reads one reason, not two.
    expect(screen.queryByText('Pass challenge')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'C major fragment' })).toBeInTheDocument();
  });

  it('takes the step’s own requirement and still names the program in the evidence', async () => {
    renderAt(runUrl({ intent: 'challenge', program: 'hanon', step: 'hanon-01' }));

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().requirement).toBe(STEP.requirement);
    expect(lastRun().programId).toBe('hanon');
    expect(lastRun().stepId).toBe('hanon-01');
  });

  it('is the screen the program page’s own Pass button leads to', async () => {
    // The whole C1 path, from the button a child actually presses.
    renderAt('/piano/exercises/program/hanon');

    fireEvent.click(await screen.findByRole('button', { name: /^Pass at/ }));

    expect(await screen.findByText('Pass this to finish Exercise 1')).toBeInTheDocument();
  });
});

/**
 * The other half of C1, and the one that must NOT change: practice keeps the
 * exercise title as its headline, because a child who chose it from the browser
 * has its detail page one tap behind them.
 */
describe('the run route — practice is untouched', () => {
  it('keeps the bank title as the headline and the plain Practice label', async () => {
    renderAt(runUrl({ intent: 'practice', mode: 'free' }));

    expect(await screen.findByRole('heading', { name: 'C major fragment' })).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(lastRun().framing).toBeNull();
    expect(lastRun().ask).toBeNull();
    expect(lastRun().tier).toBeNull();
  });

  it('carries the requested practice mode through', async () => {
    renderAt(runUrl({ intent: 'practice', mode: 'cued' }));
    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().practiceMode).toBe('cued');
  });

  it('says nothing about finishing a step when the step is being PRACTISED', async () => {
    // Same program, same step, `intent=practice` — the program page's other
    // button. Nothing is being judged and nothing gets finished, so "Pass this
    // to finish Exercise 1" would be a promise this screen does not make.
    renderAt(runUrl({ intent: 'practice', program: 'hanon', step: 'hanon-01' }));

    expect(await screen.findByRole('heading', { name: 'C major fragment' })).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(screen.queryByText('Pass this to finish Exercise 1')).not.toBeInTheDocument();
  });
});

describe('the run route — a video checkpoint says which lesson it returns to', () => {
  const checkpointUrl = ({ omit = [], ...over } = {}) => {
    const params = {
      intent: 'challenge',
      requirement: JSON.stringify(CHECKPOINT),
      return: '/piano/videos/piano-basics/lesson-2',
      label: 'Lesson 1',
      ...over,
    };
    for (const key of omit) delete params[key];
    return runUrl(params);
  };

  it('reads "Pass this to finish {lesson title}"', async () => {
    renderAt(checkpointUrl());

    expect(await screen.findByText('Pass this to finish Lesson 1')).toBeInTheDocument();
    expect(screen.queryByText('Pass challenge')).not.toBeInTheDocument();
  });

  it('keeps the JSON requirement identical, and stable across re-renders', async () => {
    renderAt(checkpointUrl());

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().requirement).toEqual(CHECKPOINT);
    // ONE object for the life of the mount: a fresh parse per render would
    // rebuild the attempt under the child's hands.
    expect(settledValues('requirement')).toHaveLength(1);
    // No program in the query, so nothing is fetched for one.
    expect(pianoLearningApi.program).not.toHaveBeenCalled();
  });

  it('returns to the lesson when the checkpoint is passed', async () => {
    const { press } = renderAt(checkpointUrl());
    await screen.findByText('Play the first note to begin.');

    press(60);
    press(62);

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('back-at-the-lesson')).toBeInTheDocument();
    expect(where()).toBe('/piano/videos/piano-basics/lesson-2');
  });

  it('still runs, unframed, for a checkpoint URL that carries no label', async () => {
    // An older bookmark, or a host that has not been taught to name its lesson.
    // The run is the same run; only the line above it is missing.
    renderAt(checkpointUrl({ omit: ['label'] }));

    await waitFor(() => expect(lastRun().instance).toBe(h.instance));
    expect(lastRun().framing).toBeNull();
    expect(screen.getByText('Pass challenge')).toBeInTheDocument();
  });

  it('is the screen the dashboard’s own Continue button leads to', async () => {
    h.learning = {
      ...h.learning,
      next_up: {
        type: 'video-checkpoint',
        title: 'Lesson 1',
        course_title: 'Piano Basics',
        requirement: CHECKPOINT,
        return_to: '/piano/videos/piano-basics/lesson-2',
      },
    };
    renderAt('/piano/exercises');

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Pass this to finish Lesson 1')).toBeInTheDocument();
  });
});

describe('the run route — the ways out', () => {
  it('shows the run’s own words for material the bank cannot find', async () => {
    pianoLearningApi.instance.mockResolvedValueOnce({ ok: false, status: 404, data: null });
    renderAt(runUrl({ intent: 'practice', mode: 'free' }));

    expect(await screen.findByText('Exercise not found. It may have been renamed.')).toBeInTheDocument();
  });

  it('sends a passed program step back to its program page', async () => {
    const { press } = renderAt(runUrl({ intent: 'challenge', program: 'hanon', step: 'hanon-01' }));
    await screen.findByText('Play the first note to begin.');

    press(60);
    press(62);

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(where()).toBe('/piano/exercises/program/hanon');
  });
});
