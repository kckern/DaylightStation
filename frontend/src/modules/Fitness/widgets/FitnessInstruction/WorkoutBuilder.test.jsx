import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import WorkoutBuilder, {
  WORKOUTS_PATH,
  RUN_PATH,
  toDisplayList,
  clamp,
  makeGroup,
  effectivePasses,
  mergeGroups,
  splitGroup,
  moveItem,
  loadLabel,
  toPayload,
  totalWorkSteps,
  parseSaveError,
  defaultWorkoutTitle
} from './WorkoutBuilder.jsx';
// The real expansion, imported so the plan this screen AUTHORS is checked against the
// ordering the runner will actually walk — not against a hand-written expectation that
// could drift from the domain. (Test code runs under Node, where the path resolves;
// the component cannot import it, which is why the payload is asserted this way.)
import { expandWorkout } from '../../../../../../backend/src/2_domains/fitness/workout/workout.mjs';

// ── Logger ───────────────────────────────────────────────────────────────────
const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [] }));
vi.mock('@/lib/logging/Logger.js', () => {
  const makeLogger = (ctx = {}) => {
    const push = (bucket) => (event, data) =>
      logCalls[bucket].push({ component: ctx.component ?? null, event, data });
    return {
      debug: push('debug'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
      sampled: push('debug'),
      child: (childCtx = {}) => makeLogger({ ...ctx, ...childCtx })
    };
  };
  const getLogger = () => makeLogger();
  const noop = () => {};
  return {
    default: getLogger,
    getLogger,
    configure: noop,
    resetSamplingState: noop,
    getRecentEvents: () => [],
    getConfig: () => ({}),
    startDiagnostics: noop,
    stopDiagnostics: noop,
    perfSnapshot: () => ({}),
    getStatus: () => ({})
  };
});

// ── Fake API ─────────────────────────────────────────────────────────────────
// Not a canned stub: it re-implements the save endpoint's contract as measured against
// the live server on :3112 — a payload carrying an id UPDATES (created:false) rather
// than making a second workout, an unknown slug is a 400 naming every offender, and the
// rejection reaches the caller the way DaylightAPI actually delivers it: as an Error
// whose message is `HTTP 400: Bad Request - {json}`. A builder that reads `err.body`
// (there isn't one) passes a friendlier fake and fails in the garage.
const LIBRARY = new Set(['push-up', 'barbell-row', 'barbell-squat', 'plank']);

const server = {
  saved: new Map(),
  requests: [],
  /** Set to a message to make POST fail without a JSON body (503, socket drop, …). */
  hardFail: null,
  /** Same, for the run endpoint only — a save can succeed while Start cannot. */
  runFail: null,
  nextId: 1
};

/** Display records the corpus would return, keyed by slug. Not every slug has one. */
const CORPUS_DISPLAY = {
  'push-up': { name: 'Push Up', image: 'media/library/exercise/assets/pushup.gif' },
  'barbell-row': { name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif' },
  'barbell-squat': { name: 'Barbell Squat', image: 'media/library/exercise/assets/squat.gif' },
  plank: { name: 'Plank', image: 'media/library/exercise/assets/plank.gif' }
};

const apiHandler = vi.fn(async (path, data, method) => {
  server.requests.push({ path, data, method });

  // POST /workouts/run — the expansion + corpus join. The REAL `expandWorkout` is used
  // here (see the import note above), so the step list this fake serves is the one the
  // live server would, and a builder that mangles the payload shows up as wrong steps.
  if (path === RUN_PATH && method === 'POST') {
    if (server.runFail) throw new Error(server.runFail);
    const steps = expandWorkout(data);
    const exercises = {};
    const missingSlugs = [];
    steps.forEach((step) => [step.slug, step.afterSlug, step.nextSlug].forEach((slug) => {
      if (!slug || exercises[slug] || missingSlugs.includes(slug)) return;
      if (CORPUS_DISPLAY[slug]) exercises[slug] = { ...CORPUS_DISPLAY[slug] };
      else missingSlugs.push(slug);
    }));
    return { ok: true, workout: { id: data.id ?? null, title: data.title ?? null }, steps, exercises, missingSlugs };
  }

  if (path !== WORKOUTS_PATH || method !== 'POST') throw new Error(`unexpected ${method} ${path}`);
  if (server.hardFail) throw new Error(server.hardFail);

  const unknownSlugs = [];
  (data.groups || []).forEach((g) => (g.exercises || []).forEach((e) => {
    if (!LIBRARY.has(e.slug) && !unknownSlugs.includes(e.slug)) unknownSlugs.push(e.slug);
  }));
  if (unknownSlugs.length > 0) {
    // The live wording, measured: `unknown exercise slugs: "a", "b"`.
    const body = JSON.stringify({
      error: `unknown exercise slugs: ${unknownSlugs.map((s) => `"${s}"`).join(', ')}`,
      unknownSlugs
    });
    throw new Error(`HTTP 400: Bad Request - ${body}`);
  }

  const created = !data.id || !server.saved.has(data.id);
  const id = data.id || `workout-${server.nextId++}`;
  const now = '2026-08-11T23:30:00.000Z';
  server.saved.set(id, data);
  return { id, created, createdAt: now, updatedAt: now };
});

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (path, data, method) => apiHandler(path, data, method),
  DaylightAPIText: async () => '',
  DaylightMediaPath: (p) => `https://kiosk.test/${String(p).replace(/^\/|\/$/g, '')}`,
  DaylightImagePath: (k) => `https://kiosk.test/api/v1/static/img/${k}`,
  DaylightStatusCheck: async () => 200,
  DaylightHostPath: () => 'https://kiosk.test',
  ContentDisplayUrl: () => '',
  normalizeImageUrl: (u) => u,
  DaylightWebsocketSubscribe: () => () => {},
  DaylightWebsocketUnsubscribe: () => () => {}
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Three DISTINCT exercises. Interchangeable fixtures are how a broken reorder passes:
// swapping two look-alike groups leaves the DOM identical.
const PUSH = { slug: 'push-up', name: 'Push Up', image: 'media/library/exercise/assets/pushup.gif' };
const ROW = { slug: 'barbell-row', name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif' };
const SQUAT = { slug: 'barbell-squat', name: 'Barbell Squat', image: 'media/library/exercise/assets/squat.gif' };
const TRAY = [PUSH, ROW, SQUAT];

/** The plan as rendered: group kind + member slugs, in DOM order. Never sorted. */
const plan = (container) =>
  Array.from(container.querySelectorAll('.group-editor')).map((g) => ({
    kind: g.getAttribute('data-kind'),
    slugs: Array.from(g.querySelectorAll('[data-slug]')).map((el) => el.getAttribute('data-slug'))
  }));

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'workout-builder' && l.event === event);

const lastPost = () => server.requests[server.requests.length - 1];

const tap = (view, testId) => fireEvent.pointerDown(view.getByTestId(testId));

function mount(props = {}) {
  return render(<WorkoutBuilder exercises={TRAY} {...props} />);
}

beforeEach(() => {
  logCalls.debug.length = 0;
  logCalls.info.length = 0;
  logCalls.warn.length = 0;
  logCalls.error.length = 0;
  server.saved = new Map();
  server.requests = [];
  server.hardFail = null;
  server.runFail = null;
  server.nextId = 1;
  apiHandler.mockClear();
});

/** Tap Start and wait for the handover — Start is a server round trip now. */
const startRun = async (view, onStartRun) => {
  tap(view, 'fitness-instruction-to-run');
  await waitFor(() => expect(onStartRun).toHaveBeenCalled());
  return onStartRun.mock.calls[0][0];
};

// ─────────────────────────────────────────────────────────────────────────────
describe('plan helpers', () => {
  it('clamp rounds, floors and ceilings', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
    expect(clamp('nope', 2, 10)).toBe(2);
    expect(clamp(3.4, 1, 10)).toBe(3);
  });

  it('moveItem swaps neighbours in the requested direction', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 2, -1)).toEqual(['a', 'c', 'b']);
    // Three distinct entries, so an inverted delta produces a DIFFERENT array rather
    // than an accidentally-equal one.
    expect(moveItem(list, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(list, 1, -1)).toEqual(['b', 'a', 'c']);
  });

  it('moveItem returns the SAME array off either end, so callers can tell nothing moved', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 5, 1)).toBe(list);
  });

  it('effectivePasses reads sets for a single and rounds for a group', () => {
    expect(effectivePasses({ rounds: 1, exercises: [{ sets: 4 }] })).toBe(4);
    expect(effectivePasses({ rounds: 3, exercises: [{ sets: 1 }, { sets: 1 }] })).toBe(3);
    expect(effectivePasses({ exercises: [] })).toBe(1);
  });

  it('mergeGroups pins sets to 1 and carries the passes into rounds', () => {
    const a = makeGroup(PUSH); // 3 sets
    const b = makeGroup(ROW);
    b.exercises[0].sets = 5;
    const merged = mergeGroups([a, b], 0);
    expect(merged).toHaveLength(1);
    expect(merged[0].rounds).toBe(5); // the larger of the two, nothing loses work
    expect(merged[0].exercises.map((m) => m.slug)).toEqual(['push-up', 'barbell-row']);
    expect(merged[0].exercises.map((m) => m.sets)).toEqual([1, 1]);
  });

  it('mergeGroups is a no-op past the end of the list', () => {
    const list = [makeGroup(PUSH)];
    expect(mergeGroups(list, 0)).toBe(list);
  });

  it('splitGroup gives every exercise the group\'s passes back as sets', () => {
    const merged = mergeGroups([makeGroup(PUSH), makeGroup(ROW)], 0);
    const split = splitGroup(merged, 0);
    expect(split).toHaveLength(2);
    expect(split.map((g) => g.rounds)).toEqual([1, 1]);
    expect(split.map((g) => g.exercises[0].sets)).toEqual([3, 3]);
    expect(split.map((g) => g.exercises[0].slug)).toEqual(['push-up', 'barbell-row']);
  });

  it('splitGroup leaves a single-exercise group alone', () => {
    const list = [makeGroup(PUSH)];
    expect(splitGroup(list, 0)).toBe(list);
  });

  it('loadLabel renders pounds, and nothing at zero', () => {
    expect(loadLabel(135)).toBe('135 lb');
    expect(loadLabel(0)).toBeNull();
    expect(loadLabel(null)).toBeNull();
  });

  it('totalWorkSteps is rounds x sets, summed — the domain\'s own arithmetic', () => {
    const groups = [
      { rounds: 1, exercises: [{ sets: 3 }] },        // 3
      { rounds: 4, exercises: [{ sets: 1 }, { sets: 1 }] } // 8
    ];
    expect(totalWorkSteps(groups)).toBe(11);
    // Cross-check against the real expansion so a plausible-but-wrong formula
    // (rounds + sets, or ignoring rounds) cannot survive.
    const expanded = expandWorkout({
      groups: groups.map((g) => ({ rounds: g.rounds, exercises: g.exercises.map((e) => ({ slug: 'push-up', sets: e.sets })) }))
    });
    expect(expanded.filter((s) => s.kind === 'work')).toHaveLength(11);
  });

  it('toPayload sends reps OR seconds, never both, and omits an absent id', () => {
    const payload = toPayload({
      title: '  Leg Day  ',
      groups: [{
        rounds: 2,
        exercises: [
          { slug: 'push-up', sets: 1, mode: 'reps', reps: 12, seconds: 45, loadLb: 0, restSeconds: 60 },
          { slug: 'plank', sets: 1, mode: 'time', reps: 12, seconds: 45, loadLb: 25, restSeconds: 0 }
        ]
      }]
    });
    expect(payload.id).toBeUndefined();
    expect(payload.title).toBe('Leg Day');
    expect(payload.groups[0].exercises[0]).toEqual({
      slug: 'push-up', sets: 1, reps: 12, seconds: null, load: null, restSeconds: 60
    });
    expect(payload.groups[0].exercises[1]).toEqual({
      slug: 'plank', sets: 1, reps: null, seconds: 45, load: '25 lb', restSeconds: 0
    });
  });

  it('toPayload carries an id through — the server reads that as an update', () => {
    expect(toPayload({ id: 'leg-day-a1b2', title: 'x', groups: [] }).id).toBe('leg-day-a1b2');
  });

  it('parseSaveError recovers the slug list DaylightAPI stringifies onto the message', () => {
    const err = new Error('HTTP 400: Bad Request - {"error":"workout references unknown exercises","unknownSlugs":["nope-1","nope-2"]}');
    expect(parseSaveError(err)).toEqual({
      message: 'workout references unknown exercises',
      unknownSlugs: ['nope-1', 'nope-2'],
      issues: []
    });
  });

  it('parseSaveError handles the real server body, quotes and all', () => {
    // Captured verbatim from :3112 on 2026-08-11 — the message embeds ESCAPED quotes
    // around each slug, which a naive substring/regex reader mangles.
    const err = new Error('HTTP 400: Bad Request - {"error":"unknown exercise slugs: \\"ghost-press\\", \\"phantom-curl\\"","unknownSlugs":["ghost-press","phantom-curl"]}');
    const parsed = parseSaveError(err);
    expect(parsed.unknownSlugs).toEqual(['ghost-press', 'phantom-curl']);
    expect(parsed.message).toBe('unknown exercise slugs: "ghost-press", "phantom-curl"');
  });

  it('parseSaveError degrades to the raw message when there is no JSON tail', () => {
    expect(parseSaveError(new Error('NetworkError when attempting to fetch resource.')))
      .toEqual({ message: 'NetworkError when attempting to fetch resource.', unknownSlugs: [], issues: [] });
    expect(parseSaveError(new Error('HTTP 503: Service Unavailable - {not json')).unknownSlugs).toEqual([]);
  });

  it('defaultWorkoutTitle names the day so nothing has to be typed on a keyboardless kiosk', () => {
    expect(defaultWorkoutTitle(new Date(2026, 7, 11))).toBe('Workout · Aug 11');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('WorkoutBuilder — seeding from the tray', () => {
  it('turns each pick into its own straight-sets group, in pick order', () => {
    const view = mount();
    expect(plan(view.container)).toEqual([
      { kind: 'sets', slugs: ['push-up'] },
      { kind: 'sets', slugs: ['barbell-row'] },
      { kind: 'sets', slugs: ['barbell-squat'] }
    ]);
    expect(view.getByTestId('workout-group-0-ex-0-sets-value').textContent).toBe('3');
    expect(view.getByTestId('workout-group-0-ex-0-reps-value').textContent).toBe('10');
  });

  it('counts the work the plan expands to', () => {
    const view = mount();
    expect(view.getByTestId('workout-builder-summary').textContent).toBe('3 groups · 9 sets');
  });

  it('shows nothing in the tray strip while every pick is placed', () => {
    const view = mount();
    expect(view.queryByTestId('workout-builder-tray')).toBeNull();
  });

  it('renders the empty state, and refuses to save, with no picks', () => {
    const view = render(<WorkoutBuilder exercises={[]} />);
    expect(view.getByTestId('workout-builder-empty')).toBeTruthy();
    expect(view.getByTestId('workout-builder-save').getAttribute('data-disabled')).toBe('true');
    tap(view, 'workout-builder-save');
    expect(apiHandler).not.toHaveBeenCalled();
  });
});

describe('WorkoutBuilder — the three derived kinds', () => {
  it('pairing two groups makes a superset and carries the sets across as rounds', () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    expect(plan(view.container)).toEqual([
      { kind: 'superset', slugs: ['push-up', 'barbell-row'] },
      { kind: 'sets', slugs: ['barbell-squat'] }
    ]);
    expect(view.getByTestId('workout-group-0-kind').textContent).toBe('Superset');
    // 3 sets each became 3 passes — the alternating authoring, same amount of work.
    expect(view.getByTestId('workout-group-0-rounds-value').textContent).toBe('3');
    expect(view.getByTestId('workout-builder-summary').textContent).toBe('2 groups · 9 sets');
  });

  it('pairing a third exercise in makes it a circuit', () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    tap(view, 'workout-group-0-merge');
    expect(plan(view.container)).toEqual([
      { kind: 'circuit', slugs: ['push-up', 'barbell-row', 'barbell-squat'] }
    ]);
    expect(view.getByTestId('workout-group-0-kind').textContent).toBe('Circuit');
  });

  it('splitting a circuit returns every exercise to straight sets with its work intact', () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    tap(view, 'workout-group-0-merge');
    tap(view, 'workout-group-0-split');
    expect(plan(view.container)).toEqual([
      { kind: 'sets', slugs: ['push-up'] },
      { kind: 'sets', slugs: ['barbell-row'] },
      { kind: 'sets', slugs: ['barbell-squat'] }
    ]);
    expect(view.getByTestId('workout-group-2-ex-0-sets-value').textContent).toBe('3');
    expect(view.getByTestId('workout-builder-summary').textContent).toBe('3 groups · 9 sets');
  });

  it('logs the merge with the kind it produced', () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    expect(logsFor('info', 'group-merge')[0].data).toMatchObject({ index: 0, kind: 'superset', groups: 2 });
    tap(view, 'workout-group-0-merge');
    expect(logsFor('info', 'group-merge')[1].data).toMatchObject({ index: 0, kind: 'circuit', groups: 1 });
  });
});

describe('WorkoutBuilder — reordering (up/down targets, not drag)', () => {
  it('moves a group later', () => {
    const view = mount();
    tap(view, 'workout-group-0-down');
    expect(plan(view.container).map((g) => g.slugs[0]))
      .toEqual(['barbell-row', 'push-up', 'barbell-squat']);
  });

  it('moves a group earlier — a different result than moving it later', () => {
    const view = mount();
    tap(view, 'workout-group-2-up');
    expect(plan(view.container).map((g) => g.slugs[0]))
      .toEqual(['push-up', 'barbell-squat', 'barbell-row']);
  });

  it('does nothing off either end, and says so rather than logging a reorder', () => {
    const view = mount();
    tap(view, 'workout-group-0-up');
    tap(view, 'workout-group-2-down');
    expect(plan(view.container).map((g) => g.slugs[0]))
      .toEqual(['push-up', 'barbell-row', 'barbell-squat']);
    expect(logsFor('info', 'group-reorder')).toHaveLength(0);
  });

  it('logs a reorder with the direction and the index it landed on', () => {
    const view = mount();
    tap(view, 'workout-group-2-up');
    expect(logsFor('info', 'group-reorder')[0].data)
      .toMatchObject({ index: 2, to: 1, direction: 'up', groups: 3 });
  });

  it('reorders exercises inside a group without touching the groups around it', () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    tap(view, 'workout-group-0-merge'); // circuit: push, row, squat
    tap(view, 'workout-group-0-ex-2-up');
    expect(plan(view.container)).toEqual([
      { kind: 'circuit', slugs: ['push-up', 'barbell-squat', 'barbell-row'] }
    ]);
    expect(logsFor('info', 'exercise-reorder')[0].data)
      .toMatchObject({ index: 0, memberIndex: 2, to: 1, direction: 'up' });
  });
});

describe('WorkoutBuilder — adding and removing', () => {
  it('removing a group puts its exercise back in the tray, and re-adding appends it', () => {
    const view = mount();
    tap(view, 'workout-group-0-remove');
    expect(plan(view.container).map((g) => g.slugs[0])).toEqual(['barbell-row', 'barbell-squat']);
    expect(logsFor('info', 'group-remove')[0].data).toMatchObject({ index: 0, slugs: ['push-up'] });

    const add = view.getByTestId('workout-builder-tray-add-push-up');
    expect(add.textContent).toContain('Push Up');
    fireEvent.pointerDown(add);
    expect(plan(view.container).map((g) => g.slugs[0]))
      .toEqual(['barbell-row', 'barbell-squat', 'push-up']);
    expect(view.queryByTestId('workout-builder-tray')).toBeNull();
    expect(logsFor('info', 'exercise-add')[0].data).toMatchObject({ slug: 'push-up', groups: 3 });
  });

  it('removing one exercise from a superset drops it back to straight sets, work intact', () => {
    const view = mount();
    tap(view, 'workout-group-0-merge'); // superset, 3 rounds
    tap(view, 'workout-group-0-ex-0-remove');
    expect(plan(view.container)[0]).toEqual({ kind: 'sets', slugs: ['barbell-row'] });
    // The three passes were living in `rounds`; they come back as the survivor's sets.
    expect(view.getByTestId('workout-group-0-ex-0-sets-value').textContent).toBe('3');
    expect(view.getByTestId('workout-builder-summary').textContent).toBe('2 groups · 6 sets');
    expect(logsFor('info', 'exercise-remove')[0].data)
      .toMatchObject({ index: 0, memberIndex: 0, slug: 'push-up' });
  });

  it('removing the last exercise of a group removes the group', () => {
    const view = mount();
    tap(view, 'workout-group-1-ex-0-remove');
    expect(plan(view.container).map((g) => g.slugs[0])).toEqual(['push-up', 'barbell-squat']);
    expect(view.getByTestId('workout-builder-tray-add-barbell-row')).toBeTruthy();
  });
});

describe('WorkoutBuilder — per-exercise fields', () => {
  it('edits land on the row that was tapped and reach the payload', async () => {
    const view = mount();
    tap(view, 'workout-group-1-ex-0-reps-inc');
    tap(view, 'workout-group-1-ex-0-reps-inc');
    tap(view, 'workout-group-1-ex-0-load-inc'); // 0 -> 5
    tap(view, 'workout-group-1-ex-0-rest-dec'); // 60 -> 45
    tap(view, 'workout-group-1-ex-0-sets-inc'); // 3 -> 4

    expect(view.getByTestId('workout-group-1-ex-0-reps-value').textContent).toBe('12');
    expect(view.getByTestId('workout-group-1-ex-0-load-value').textContent).toBe('5 lb');
    // The untouched neighbours keep their own values.
    expect(view.getByTestId('workout-group-0-ex-0-reps-value').textContent).toBe('10');
    expect(view.getByTestId('workout-group-2-ex-0-rest-value').textContent).toBe('60s');

    tap(view, 'workout-builder-save');
    await waitFor(() => expect(server.requests).toHaveLength(1));
    expect(lastPost().data.groups[1].exercises[0])
      .toEqual({ slug: 'barbell-row', sets: 4, reps: 12, seconds: null, load: '5 lb', restSeconds: 45 });
    expect(lastPost().data.groups[0].exercises[0])
      .toEqual({ slug: 'push-up', sets: 3, reps: 10, seconds: null, load: null, restSeconds: 60 });
  });

  it('switching a row to time sends seconds and drops reps', async () => {
    const view = mount();
    tap(view, 'workout-group-2-ex-0-mode-toggle');
    tap(view, 'workout-group-2-ex-0-seconds-inc'); // 30 -> 35
    expect(view.getByTestId('workout-group-2-ex-0-seconds-value').textContent).toBe('35s');

    tap(view, 'workout-builder-save');
    await waitFor(() => expect(server.requests).toHaveLength(1));
    expect(lastPost().data.groups[2].exercises[0])
      .toMatchObject({ slug: 'barbell-squat', reps: null, seconds: 35 });
  });

  it('keeps the rep count while a row is switched to time and back', () => {
    const view = mount();
    tap(view, 'workout-group-0-ex-0-reps-inc'); // 11
    tap(view, 'workout-group-0-ex-0-mode-toggle');
    tap(view, 'workout-group-0-ex-0-mode-toggle');
    expect(view.getByTestId('workout-group-0-ex-0-reps-value').textContent).toBe('11');
  });

  it('changing a superset\'s rounds changes how many passes are saved', async () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    tap(view, 'workout-group-0-rounds-inc'); // 3 -> 4
    expect(view.getByTestId('workout-builder-summary').textContent).toBe('2 groups · 11 sets');

    tap(view, 'workout-builder-save');
    await waitFor(() => expect(server.requests).toHaveLength(1));
    expect(lastPost().data.groups[0].rounds).toBe(4);
  });
});

describe('WorkoutBuilder — what it authors matches expandWorkout', () => {
  it('a superset saves as rounds-with-single-sets, which expands to alternating passes', async () => {
    const view = mount();
    tap(view, 'workout-group-0-merge');
    tap(view, 'workout-builder-save');
    await waitFor(() => expect(server.requests).toHaveLength(1));

    const payload = lastPost().data;
    expect(payload.groups[0]).toMatchObject({ rounds: 3 });
    expect(payload.groups[0].exercises.map((e) => e.sets)).toEqual([1, 1]);

    const work = expandWorkout(payload).filter((s) => s.kind === 'work');
    // A B A B A B — the alternation is the point of a superset. `sets: 3, rounds: 1`
    // would expand to A A A B B B, which is not one.
    expect(work.map((s) => s.slug)).toEqual([
      'push-up', 'barbell-row', 'push-up', 'barbell-row', 'push-up', 'barbell-row',
      'barbell-squat', 'barbell-squat', 'barbell-squat'
    ]);
    expect(work.map((s) => s.groupKind)).toEqual([
      'superset', 'superset', 'superset', 'superset', 'superset', 'superset',
      'sets', 'sets', 'sets'
    ]);
    expect(work.filter((s) => s.slug === 'push-up').map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it('a straight-sets group saves as consecutive sets in one pass', async () => {
    const view = mount();
    tap(view, 'workout-builder-save');
    await waitFor(() => expect(server.requests).toHaveLength(1));

    const payload = lastPost().data;
    expect(payload.groups.map((g) => g.rounds)).toEqual([1, 1, 1]);
    const work = expandWorkout(payload).filter((s) => s.kind === 'work');
    expect(work.map((s) => s.slug)).toEqual([
      'push-up', 'push-up', 'push-up',
      'barbell-row', 'barbell-row', 'barbell-row',
      'barbell-squat', 'barbell-squat', 'barbell-squat'
    ]);
    expect(work.map((s) => s.totalSets)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });
});

describe('WorkoutBuilder — saving', () => {
  it('posts the plan and reports the id it came back with', async () => {
    const view = mount();
    fireEvent.change(view.getByTestId('workout-builder-title'), { target: { value: 'Leg Day' } });
    tap(view, 'workout-builder-save');

    await view.findByTestId('workout-builder-saved');
    expect(lastPost().path).toBe('api/v1/fitness/workouts');
    expect(lastPost().method).toBe('POST');
    expect(lastPost().data.title).toBe('Leg Day');
    expect(view.getByTestId('workout-builder-saved').textContent).toContain('workout-1');
    expect(logsFor('info', 'save-start')[0].data)
      .toMatchObject({ id: null, title: 'Leg Day', groups: 3, exercises: 3 });
    expect(logsFor('info', 'save-success')[0].data)
      .toMatchObject({ id: 'workout-1', created: true, groups: 3 });
  });

  it('a second save updates the same workout instead of shelving a duplicate', async () => {
    const view = mount();
    tap(view, 'workout-builder-save');
    await view.findByTestId('workout-builder-saved');

    tap(view, 'workout-group-0-ex-0-reps-inc');
    tap(view, 'workout-builder-save');
    await waitFor(() => expect(server.requests).toHaveLength(2));

    expect(server.requests[0].data.id).toBeUndefined();
    expect(server.requests[1].data.id).toBe('workout-1');
    expect(server.saved.size).toBe(1);
    await waitFor(() => expect(logsFor('info', 'save-success')[1].data)
      .toMatchObject({ id: 'workout-1', created: false }));
  });

  it('clears the saved badge as soon as the plan changes again', async () => {
    const view = mount();
    tap(view, 'workout-builder-save');
    await view.findByTestId('workout-builder-saved');
    tap(view, 'workout-group-0-ex-0-reps-inc');
    expect(view.queryByTestId('workout-builder-saved')).toBeNull();
  });

  it('names every rejected slug and flags the rows they came from', async () => {
    const view = render(<WorkoutBuilder exercises={[PUSH, { slug: 'ghost-press', name: 'Ghost Press' }, SQUAT]} />);
    tap(view, 'workout-builder-save');

    await view.findByTestId('workout-builder-error');
    expect(view.getByTestId('workout-builder-unknown-ghost-press')).toBeTruthy();
    expect(view.getByTestId('workout-builder-error').textContent).toContain('not in the library');
    // Named in place too: the fix has to happen on that row.
    expect(view.getByTestId('workout-group-1-ex-0').className).toContain('--unknown');
    expect(view.getByTestId('workout-group-0-ex-0').className).not.toContain('--unknown');

    const failures = logsFor('error', 'save-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].data.unknownSlugs).toEqual(['ghost-press']);
    expect(failures[0].data.error).toBe('unknown exercise slugs: "ghost-press"');
  });

  it('lists ALL the rejected slugs, not just the first', async () => {
    const view = render(<WorkoutBuilder exercises={[
      { slug: 'ghost-press', name: 'Ghost Press' },
      PUSH,
      { slug: 'phantom-curl', name: 'Phantom Curl' }
    ]} />);
    tap(view, 'workout-builder-save');

    await view.findByTestId('workout-builder-error');
    expect(view.getByTestId('workout-builder-unknown-ghost-press')).toBeTruthy();
    expect(view.getByTestId('workout-builder-unknown-phantom-curl')).toBeTruthy();
    expect(logsFor('error', 'save-failed')[0].data.unknownSlugs)
      .toEqual(['ghost-press', 'phantom-curl']);
  });

  it('shows the raw failure when the server did not name anything', async () => {
    server.hardFail = 'HTTP 503: Service Unavailable - workouts unavailable';
    const view = mount();
    tap(view, 'workout-builder-save');

    await view.findByTestId('workout-builder-error');
    expect(view.getByTestId('workout-builder-error').textContent).toContain('Service Unavailable');
    expect(view.queryByTestId('workout-builder-unknown')).toBeNull();
    expect(logsFor('error', 'save-failed')[0].data.unknownSlugs).toEqual([]);
  });

  it('a retry after a rejection clears the previous complaint', async () => {
    server.hardFail = 'HTTP 503: Service Unavailable - workouts unavailable';
    const view = mount();
    tap(view, 'workout-builder-save');
    await view.findByTestId('workout-builder-error');

    server.hardFail = null;
    tap(view, 'workout-builder-save');
    await view.findByTestId('workout-builder-saved');
    expect(view.queryByTestId('workout-builder-error')).toBeNull();
  });

  it('does not fire a second request while one is in flight', async () => {
    const view = mount();
    tap(view, 'workout-builder-save');
    tap(view, 'workout-builder-save');
    await view.findByTestId('workout-builder-saved');
    expect(server.requests).toHaveLength(1);
  });
});

describe('toDisplayList', () => {
  it('turns the server lookup into display records', () => {
    expect(toDisplayList({ 'push-up': { name: 'Push Up', image: 'a.gif' } }))
      .toEqual([{ slug: 'push-up', name: 'Push Up', image: 'a.gif' }]);
  });

  it('appends a fallback only for a slug the server did not resolve', () => {
    const lookup = { 'push-up': { name: 'Push Up', image: 'a.gif' } };
    const fallbacks = [
      { slug: 'push-up', name: 'STALE', image: 'stale.gif' },
      { slug: 'ghost', name: 'Ghost Press', image: 'g.gif' }
    ];
    expect(toDisplayList(lookup, fallbacks)).toEqual([
      { slug: 'push-up', name: 'Push Up', image: 'a.gif' },
      { slug: 'ghost', name: 'Ghost Press', image: 'g.gif' }
    ]);
  });

  it('degrades to the fallbacks when the server sent no lookup at all', () => {
    expect(toDisplayList(null, [{ slug: 'ghost' }]))
      .toEqual([{ slug: 'ghost', name: null, image: null }]);
    expect(toDisplayList(undefined)).toEqual([]);
  });
});

describe('WorkoutBuilder — handing the plan to Run', () => {
  it('gives the runner the SERVER-expanded step list, not the authored groups', async () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    tap(view, 'workout-group-0-merge'); // push-up + barbell-row become a 3-round superset
    const handed = await startRun(view, onStartRun);

    // The authored plan still travels (Run logs it against the workout), but what the
    // runner walks is `steps` — flat, ordered, and produced by the domain server-side.
    expect(handed.groups[0]).toMatchObject({ rounds: 3 });
    expect(lastPost()).toMatchObject({ path: RUN_PATH, method: 'POST' });
    const work = handed.steps.filter((s) => s.kind === 'work');
    expect(work.map((s) => s.slug)).toEqual([
      'push-up', 'barbell-row',
      'push-up', 'barbell-row',
      'push-up', 'barbell-row',
      'barbell-squat', 'barbell-squat', 'barbell-squat'
    ]);
    // The one thing a client-side copy of the expansion would get wrong: a superset
    // ALTERNATES, it does not block.
    expect(work.slice(0, 6).every((s) => s.groupKind === 'superset')).toBe(true);
    // The default 60s rest is authored, so rest steps are interleaved and the trailing
    // one is dropped: 9 work + 8 rest.
    expect(handed.steps).toHaveLength(17);
    expect(handed.steps.at(-1).kind).toBe('work');
  });

  it('gives the runner the display records the server joined against the corpus', async () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    const handed = await startRun(view, onStartRun);

    expect(handed.exercises).toEqual([
      { slug: 'push-up', name: 'Push Up', image: 'media/library/exercise/assets/pushup.gif' },
      { slug: 'barbell-row', name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif' },
      { slug: 'barbell-squat', name: 'Barbell Squat', image: 'media/library/exercise/assets/squat.gif' }
    ]);
  });

  it('falls back to the picked record for a slug the corpus no longer knows', async () => {
    const onStartRun = vi.fn();
    const view = render(<WorkoutBuilder onStartRun={onStartRun} exercises={[
      PUSH,
      { slug: 'retired-machine-fly', name: 'Machine Fly', image: 'media/library/exercise/assets/fly.gif' }
    ]} />);
    const handed = await startRun(view, onStartRun);

    expect(handed.steps.some((s) => s.slug === 'retired-machine-fly')).toBe(true);
    expect(handed.exercises).toContainEqual({
      slug: 'retired-machine-fly', name: 'Machine Fly', image: 'media/library/exercise/assets/fly.gif'
    });
    expect(logsFor('info', 'start-run')[0].data.missingSlugs).toEqual(['retired-machine-fly']);
  });

  it('starts an UNSAVED plan — Start does not require Save', async () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    const handed = await startRun(view, onStartRun);

    expect(handed.id).toBeUndefined();
    expect(handed.steps.filter((s) => s.kind === 'work')).toHaveLength(9);
    // Nothing was written to the shelf on the way.
    expect(server.requests.every((r) => r.path === RUN_PATH)).toBe(true);
    expect(server.saved.size).toBe(0);
  });

  it('carries the saved id across so Run knows which workout it is walking', async () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    tap(view, 'workout-builder-save');
    await view.findByTestId('workout-builder-saved');
    const handed = await startRun(view, onStartRun);
    expect(handed.id).toBe('workout-1');
    expect(lastPost().data.id).toBe('workout-1');
  });

  it('logs the handover with the step count it actually received', async () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    await startRun(view, onStartRun);
    expect(logsFor('info', 'start-run')[0].data)
      .toMatchObject({ groups: 3, workSteps: 9, steps: 17, hasSteps: true });
  });

  it('holds on the builder with an error when the expansion cannot be fetched', async () => {
    server.runFail = 'HTTP 503: Service Unavailable - workouts unavailable';
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    tap(view, 'fitness-instruction-to-run');

    await view.findByTestId('workout-builder-run-error');
    // Moving to a runner with nothing in it would show "Nothing to run" mid-session.
    expect(onStartRun).not.toHaveBeenCalled();
    expect(view.getByTestId('workout-builder-run-error').textContent).toContain('Service Unavailable');
    expect(logsFor('error', 'start-run-failed')).toHaveLength(1);

    // And it is retryable: the next tap goes through.
    server.runFail = null;
    await startRun(view, onStartRun);
  });

  it('does not fire a second run request while one is in flight', async () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    tap(view, 'fitness-instruction-to-run');
    tap(view, 'fitness-instruction-to-run');
    await waitFor(() => expect(onStartRun).toHaveBeenCalled());
    expect(server.requests.filter((r) => r.path === RUN_PATH)).toHaveLength(1);
  });

  it('backs out to Browse', () => {
    const onCancel = vi.fn();
    const view = mount({ onCancel });
    tap(view, 'fitness-instruction-build-back');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(logsFor('info', 'cancel-build')).toHaveLength(1);
  });
});

describe('WorkoutBuilder — touchscreen interaction contract', () => {
  it('does nothing on a bare click (targets are onPointerDown, not onClick)', () => {
    const onStartRun = vi.fn();
    const view = mount({ onStartRun });
    fireEvent.click(view.getByTestId('fitness-instruction-to-run'));
    fireEvent.click(view.getByTestId('workout-builder-save'));
    fireEvent.click(view.getByTestId('workout-group-0-down'));
    expect(onStartRun).not.toHaveBeenCalled();
    expect(apiHandler).not.toHaveBeenCalled();
    expect(plan(view.container).map((g) => g.slugs[0]))
      .toEqual(['push-up', 'barbell-row', 'barbell-squat']);
  });

  it('activates on Enter and on Space', async () => {
    const onStartRun = vi.fn();
    const onCancel = vi.fn();
    const view = mount({ onStartRun, onCancel });
    fireEvent.keyDown(view.getByTestId('fitness-instruction-to-run'), { key: 'Enter' });
    fireEvent.keyDown(view.getByTestId('fitness-instruction-build-back'), { key: ' ' });
    await waitFor(() => expect(onStartRun).toHaveBeenCalledTimes(1));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps a disabled save inert under the keyboard as well as the finger', () => {
    const view = render(<WorkoutBuilder exercises={[]} />);
    fireEvent.keyDown(view.getByTestId('workout-builder-save'), { key: 'Enter' });
    expect(apiHandler).not.toHaveBeenCalled();
  });
});
