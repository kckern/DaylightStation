import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import ExerciseBrowser, {
  buildExerciseQuery,
  activeFilterCount,
  toggleFacetValue,
  PAGE_SIZE
} from './ExerciseBrowser.jsx';

// ── Logger (CLAUDE.md: framework logger, never console.*) ────────────────────
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
// This is not a canned-response stub: it re-implements the SERVER's facet
// semantics (repeated key = OR within a facet, different keys = AND across
// them, exactly as measured against the live endpoint). That matters because a
// query builder that comma-joins a facet then fails the same way it fails in
// production — zero matches, no error — instead of only tripping a string
// assertion someone could later "fix" by changing the expected string.
const CORPUS = [
  { slug: 'archer-push-up', name: 'Archer Push Up', image: 'media/library/exercise/assets/archer.gif', groups: ['chest'], targetMuscles: ['pectorals'], equipment: ['body-weight'] },
  { slug: 'barbell-bench-press', name: 'Barbell Bench Press', image: 'media/library/exercise/assets/bench.gif', groups: ['chest'], targetMuscles: ['pectorals'], equipment: ['barbell'] },
  { slug: 'dumbbell-fly', name: 'Dumbbell Fly', image: 'media/library/exercise/assets/fly.gif', groups: ['chest'], targetMuscles: ['pectorals'], equipment: ['dumbbell'] },
  { slug: 'barbell-row', name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif', groups: ['back'], targetMuscles: ['lats'], equipment: ['barbell'] },
  { slug: 'pull-up', name: 'Pull Up', image: 'media/library/exercise/assets/pullup.gif', groups: ['back'], targetMuscles: ['lats'], equipment: ['body-weight'] },
  { slug: 'cable-pulldown', name: 'Cable Pulldown', image: 'media/library/exercise/assets/pulldown.gif', groups: ['back'], targetMuscles: ['upper-back'], equipment: ['cable'] },
  { slug: 'barbell-squat', name: 'Barbell Squat', image: 'media/library/exercise/assets/squat.gif', groups: ['upper-legs'], targetMuscles: ['quads'], equipment: ['barbell'] },
  { slug: 'push-up', name: 'Push Up', image: 'media/library/exercise/assets/pushup.gif', groups: ['chest'], targetMuscles: ['pectorals'], equipment: ['body-weight'] }
];

const TAXONOMY = {
  groups: [
    { slug: 'chest', name: 'Chest' },
    { slug: 'back', name: 'Back' },
    { slug: 'upper-legs', name: 'Upper Legs' }
  ],
  muscles: [
    { slug: 'pectorals', name: 'Pectorals', group: 'chest' },
    { slug: 'lats', name: 'Lats', group: 'back' },
    { slug: 'upper-back', name: 'Upper Back', group: 'back' },
    { slug: 'quads', name: 'Quads', group: 'upper-legs' }
  ],
  equipment: [
    { slug: 'barbell', name: 'Barbell' },
    { slug: 'dumbbell', name: 'Dumbbell' },
    { slug: 'cable', name: 'Cable' },
    { slug: 'body-weight', name: 'Body Weight' }
  ]
};

const DETAILS = {
  'archer-push-up': {
    slug: 'archer-push-up',
    name: 'Archer Push Up',
    image: 'media/library/exercise/assets/archer.gif',
    instructions: ['Start in a high plank.', 'Shift onto one hand.', 'Press back up.'],
    stills: [],
    video: null,
    targetMuscles: ['pectorals'],
    groups: ['chest'],
    equipment: ['body-weight']
  }
};

/** Mutable per test: corpus, library status, and the recorded request log. */
const server = {
  corpus: CORPUS,
  library: { available: true, builtAt: '2026-08-11T23:02:13.178Z', counts: { exercises: CORPUS.length } },
  requests: [],
  /** Set to a message to make the LIST endpoint (only) fail. */
  failList: null
};

function listMatches(qs) {
  const params = new URLSearchParams(qs || '');
  const groups = params.getAll('group');
  const muscles = params.getAll('muscle');
  const equipment = params.getAll('equipment');
  const q = (params.get('q') || '').trim().toLowerCase();
  const anyOf = (selected, values) => !selected.length || selected.some((s) => values.includes(s));
  return server.corpus.filter((e) =>
    anyOf(groups, e.groups) &&
    anyOf(muscles, e.targetMuscles) &&
    anyOf(equipment, e.equipment) &&
    (!q || e.name.toLowerCase().includes(q))
  );
}

const apiHandler = vi.fn(async (path) => {
  server.requests.push(path);
  const [base, qs] = String(path).split('?');
  if (base === 'api/v1/fitness/exercises/taxonomy') {
    return { ...TAXONOMY, library: server.library };
  }
  if (base.startsWith('api/v1/fitness/exercises/')) {
    const slug = decodeURIComponent(base.slice('api/v1/fitness/exercises/'.length));
    const record = DETAILS[slug] ?? server.corpus.find((e) => e.slug === slug) ?? null;
    return { exercise: record, library: server.library };
  }
  if (base === 'api/v1/fitness/exercises') {
    if (server.failList) throw new Error(server.failList);
    if (server.library.available === false) {
      return { exercises: [], total: 0, library: server.library };
    }
    const matches = listMatches(qs);
    return { exercises: matches, total: matches.length, library: server.library };
  }
  throw new Error(`unexpected path ${path}`);
});

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (path) => apiHandler(path),
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

// ── Controllable IntersectionObserver ────────────────────────────────────────
// happy-dom ships an IO that never fires, which would make "the grid loads no
// GIFs" trivially true. This one is driven explicitly by the tests, so both
// halves are asserted: nothing loads until an element intersects, and it does
// load once it does.
const observed = new Map();
class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.elements = new Set();
  }
  observe(el) { this.elements.add(el); observed.set(el, this); }
  unobserve(el) { this.elements.delete(el); observed.delete(el); }
  disconnect() { this.elements.forEach((el) => observed.delete(el)); this.elements.clear(); }
}

function setIntersecting(el, isIntersecting) {
  const observer = observed.get(el);
  if (!observer) throw new Error('element is not being observed by the browser');
  act(() => observer.callback([{ target: el, isIntersecting }], observer));
}

const thumbOf = (card) => {
  const thumb = card.querySelector('.exercise-browser__thumb');
  if (!thumb) throw new Error('card has no thumb element');
  return thumb;
};

let originalIO;

// ── Helpers ──────────────────────────────────────────────────────────────────
const listRequests = () => server.requests.filter((p) => p.split('?')[0] === 'api/v1/fitness/exercises');
const lastListRequest = () => listRequests()[listRequests().length - 1];

/** Slugs in DOM order. Deliberately NOT sorted — order is part of the contract. */
const renderedSlugs = (container) =>
  Array.from(container.querySelectorAll('[data-testid^="exercise-card-"]'))
    .map((el) => el.getAttribute('data-testid').replace('exercise-card-', ''));

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'exercise-browser' && l.event === event);

async function mountBrowser(props = {}) {
  const view = render(<ExerciseBrowser {...props} />);
  // Wait past the initial corpus AND taxonomy responses.
  await view.findByTestId('exercise-browser-grid');
  await view.findByTestId('exercise-group-chest');
  return view;
}

beforeEach(() => {
  logCalls.debug.length = 0;
  logCalls.info.length = 0;
  logCalls.warn.length = 0;
  logCalls.error.length = 0;
  server.corpus = CORPUS;
  server.library = { available: true, builtAt: '2026-08-11T23:02:13.178Z', counts: { exercises: CORPUS.length } };
  server.requests = [];
  server.failList = null;
  apiHandler.mockClear();
  observed.clear();
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
});

afterEach(() => {
  globalThis.IntersectionObserver = originalIO;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildExerciseQuery', () => {
  it('emits no query string for an empty filter set', () => {
    expect(buildExerciseQuery({})).toBe('api/v1/fitness/exercises');
    expect(buildExerciseQuery({ groups: [], muscles: [], equipment: [], q: '  ' }))
      .toBe('api/v1/fitness/exercises');
  });

  it('repeats the key for multiple values in one facet (OR), never a comma list', () => {
    const path = buildExerciseQuery({ groups: ['chest', 'back'] });
    expect(path).toBe('api/v1/fitness/exercises?group=chest&group=back');
    // Spelled out because this is the exact mistake the API answers with 0
    // matches rather than an error.
    expect(path).not.toContain('chest%2Cback');
    expect(path).not.toContain('chest,back');
  });

  it('uses a distinct key per facet (AND across facets)', () => {
    expect(buildExerciseQuery({ groups: ['chest'], equipment: ['barbell'] }))
      .toBe('api/v1/fitness/exercises?group=chest&equipment=barbell');
    expect(buildExerciseQuery({ muscles: ['lats', 'pectorals'], equipment: ['barbell', 'cable'] }))
      .toBe('api/v1/fitness/exercises?muscle=lats&muscle=pectorals&equipment=barbell&equipment=cable');
  });

  it('trims and drops blank values rather than sending empty keys', () => {
    expect(buildExerciseQuery({ groups: [' chest ', '', null], q: '  push up  ' }))
      .toBe('api/v1/fitness/exercises?group=chest&q=push+up');
  });
});

describe('filter helpers', () => {
  it('activeFilterCount sums every facet plus a non-blank search term', () => {
    expect(activeFilterCount({ groups: ['a', 'b'], muscles: ['c'], equipment: [], q: '' })).toBe(3);
    expect(activeFilterCount({ groups: [], muscles: [], equipment: [], q: '   ' })).toBe(0);
    expect(activeFilterCount({ groups: [], muscles: [], equipment: [], q: 'row' })).toBe(1);
  });

  it('toggleFacetValue adds a missing value and removes a present one', () => {
    const base = { groups: ['chest'], muscles: [], equipment: [], q: '' };
    expect(toggleFacetValue(base, 'groups', 'back').groups).toEqual(['chest', 'back']);
    expect(toggleFacetValue(base, 'groups', 'chest').groups).toEqual([]);
    // Other facets are untouched.
    expect(toggleFacetValue(base, 'groups', 'back').muscles).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ExerciseBrowser — initial load', () => {
  it('requests the unfiltered corpus and renders one card per result, in server order', async () => {
    const view = await mountBrowser();
    expect(listRequests()).toEqual(['api/v1/fitness/exercises']);
    expect(renderedSlugs(view.container)).toEqual(CORPUS.map((e) => e.slug));
    expect(view.getByTestId('exercise-browser-count').textContent).toBe('Showing 8 of 8');
  });

  it('renders taxonomy as touch-first category tabs with one option rail', async () => {
    const view = await mountBrowser();
    expect(view.getByTestId('exercise-group-upper-legs').textContent).toBe('Upper Legs');
    expect(view.queryByTestId('exercise-browser-search')).toBeNull();
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-equipment'));
    expect(view.getByTestId('exercise-equipment-barbell').textContent).toBe('Barbell');
  });

  it('logs the fetch at info with the result count', async () => {
    await mountBrowser();
    const success = logsFor('info', 'fetch-success');
    expect(success).toHaveLength(1);
    expect(success[0].data).toMatchObject({
      path: 'api/v1/fitness/exercises',
      count: 8,
      total: 8,
      libraryAvailable: true
    });
  });

  it('surfaces a failed corpus fetch and logs it at error', async () => {
    server.failList = 'HTTP 503';
    const view = render(<ExerciseBrowser />);
    await view.findByTestId('exercise-browser-error');
    expect(view.getByTestId('exercise-browser-error').textContent).toContain('HTTP 503');
    expect(view.queryByTestId('exercise-browser-grid')).toBeNull();
    const failures = logsFor('error', 'fetch-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].data.error).toBe('HTTP 503');
  });
});

describe('ExerciseBrowser — filtering', () => {
  it('filters by muscle group', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(lastListRequest()).toBe('api/v1/fitness/exercises?group=chest'));
    await waitFor(() => expect(renderedSlugs(view.container))
      .toEqual(['archer-push-up', 'barbell-bench-press', 'dumbbell-fly', 'push-up']));
    expect(view.getByTestId('exercise-group-chest').getAttribute('data-active')).toBe('true');
  });

  it('ORs two values inside one facet — repeated key, wider result set', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(4));
    fireEvent.pointerDown(view.getByTestId('exercise-group-back'));

    await waitFor(() => expect(lastListRequest())
      .toBe('api/v1/fitness/exercises?group=chest&group=back'));
    // 7, not 4 and not 0: a comma-joined param would match nothing, and a
    // last-value-wins param would land on the 3 back exercises.
    await waitFor(() => expect(renderedSlugs(view.container)).toEqual([
      'archer-push-up', 'barbell-bench-press', 'dumbbell-fly',
      'barbell-row', 'pull-up', 'cable-pulldown', 'push-up'
    ]));
  });

  it('filters by equipment on its own', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-equipment'));
    fireEvent.pointerDown(view.getByTestId('exercise-equipment-barbell'));
    await waitFor(() => expect(lastListRequest()).toBe('api/v1/fitness/exercises?equipment=barbell'));
    await waitFor(() => expect(renderedSlugs(view.container))
      .toEqual(['barbell-bench-press', 'barbell-row', 'barbell-squat']));
  });

  it('ANDs across facets — group + equipment narrows below either alone', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(4));
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-equipment'));
    fireEvent.pointerDown(view.getByTestId('exercise-equipment-barbell'));

    await waitFor(() => expect(lastListRequest())
      .toBe('api/v1/fitness/exercises?group=chest&equipment=barbell'));
    // Dropping the equipment facet would leave the 4 chest exercises here.
    await waitFor(() => expect(renderedSlugs(view.container)).toEqual(['barbell-bench-press']));
  });

  it('filters by muscle, once a group has opened the rail', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-back'));
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-muscles'));
    fireEvent.pointerDown(await view.findByTestId('exercise-muscle-lats'));
    await waitFor(() => expect(lastListRequest())
      .toBe('api/v1/fitness/exercises?group=back&muscle=lats'));
    await waitFor(() => expect(renderedSlugs(view.container)).toEqual(['barbell-row', 'pull-up']));
  });

  it('shows selected counts on category tabs and preserves filters while switching', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(4));
    expect(view.getByTestId('exercise-browser-tab-groups').textContent).toContain('1');
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-equipment'));
    fireEvent.pointerDown(view.getByTestId('exercise-equipment-body-weight'));
    await waitFor(() => expect(lastListRequest())
      .toBe('api/v1/fitness/exercises?group=chest&equipment=body-weight'));
    await waitFor(() => expect(renderedSlugs(view.container)).toEqual(['archer-push-up', 'push-up']));
    expect(view.getByTestId('exercise-browser-tab-equipment').textContent).toContain('1');
  });

  it('clears every category back to the full corpus', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(4));
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-equipment'));
    fireEvent.pointerDown(view.getByTestId('exercise-equipment-barbell'));
    await waitFor(() => expect(renderedSlugs(view.container)).toEqual(['barbell-bench-press']));
    fireEvent.pointerDown(view.getByTestId('exercise-browser-clear'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(8));
    expect(view.queryByTestId('exercise-browser-clear')).toBeNull();
  });

  it('logs each filter change at info', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(4));
    const changes = logsFor('info', 'filter-change');
    expect(changes).toHaveLength(1);
    expect(changes[0].data).toMatchObject({ reason: 'toggle:groups', groups: ['chest'], active: 1 });
  });
});

describe('ExerciseBrowser — vertical budget', () => {
  // The panel is a fixed-height box with `overflow-y: hidden`, so every pixel a
  // filter rail takes is taken from the grid and there is no page scroll to get
  // it back. Measured in Chromium at 1920x1080, an unbounded wrapping rail left
  // the grid 88px of a 744px container — 11.8%, a strip of clipped card tops.
  //
  // jsdom has no layout engine and CANNOT see that. These assert the structural
  // facts the fix rests on; the measured proof is the Playwright test in
  // tests/live/flow/fitness/exercise-browser-layout.runtime.test.mjs.

  it('renders no muscle chips at all in the default unfiltered state', async () => {
    const view = await mountBrowser();
    // 38 in production. Wrapped, that alone was ~1,225px of content.
    expect(view.container.querySelectorAll('[data-testid^="exercise-muscle-"]')).toHaveLength(0);
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-muscles'));
    expect(view.getByTestId('exercise-browser-muscle-hint').textContent)
      .toBe('Pick a body area first, then refine by muscle');
  });

  it('opens the muscle rail to the picked group only', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-back'));
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-muscles'));
    await view.findByTestId('exercise-muscle-lats');
    expect(view.queryByTestId('exercise-browser-muscle-hint')).toBeNull();
    expect(Array.from(view.container.querySelectorAll('[data-testid^="exercise-muscle-"]'))
      .map((el) => el.getAttribute('data-testid'))).toEqual([
      'exercise-muscle-lats',
      'exercise-muscle-upper-back'
    ]);
  });

  it('pins a muscle that is filtering even with no group selected', async () => {
    // The detail sheet can push a muscle in without a group. A filter you
    // cannot see is a filter you cannot switch off.
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-card-cable-pulldown'));
    fireEvent.pointerDown(await view.findByTestId('exercise-detail-muscle-upper-back'));
    await waitFor(() => expect(lastListRequest()).toBe('api/v1/fitness/exercises?muscle=upper-back'));

    const chip = view.getByTestId('exercise-muscle-upper-back');
    expect(chip.getAttribute('data-active')).toBe('true');
    expect(view.queryByTestId('exercise-browser-muscle-hint')).toBeNull();
    // Only the pinned one — the rail did not fall back to all 38.
    expect(view.container.querySelectorAll('[data-testid^="exercise-muscle-"]')).toHaveLength(1);
  });

  it('shows exactly one non-wrapping option rail at a time', async () => {
    const view = await mountBrowser();
    expect(view.container.querySelectorAll('.exercise-browser__option-rail')).toHaveLength(1);
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-equipment'));
    const row = view.getByTestId('exercise-browser-equipment');
    const chips = row.querySelectorAll('[data-testid^="exercise-equipment-"]');
    expect(chips).toHaveLength(TAXONOMY.equipment.length);
    chips.forEach((chip) => expect(chip.parentElement).toBe(row));
  });

  it('renders nothing below the grid — Show more is a cell inside it', async () => {
    server.corpus = Array.from({ length: 100 }, (_, i) => ({
      slug: `e-${i}`, name: `E ${i}`, image: `media/g-${i}.gif`,
      groups: ['chest'], targetMuscles: ['pectorals'], equipment: ['barbell']
    }));
    const view = await mountBrowser();
    const grid = view.getByTestId('exercise-browser-grid');
    const more = view.getByTestId('exercise-browser-more');
    // As a sibling BELOW the grid this control cost ~100px of permanent chrome.
    expect(more.parentElement).toBe(grid);
    // And the grid is the last thing in the panel, so nothing competes with it
    // for the remaining height.
    expect(view.getByTestId('exercise-browser').lastElementChild).toBe(grid);
  });
});

describe('ExerciseBrowser — library not built', () => {
  beforeEach(() => {
    server.library = {
      available: false,
      builtAt: null,
      counts: {},
      hint: 'Run `npm run exercise:index` to build the exercise library.'
    };
  });

  it('renders the build hint instead of an empty-result screen', async () => {
    const view = render(<ExerciseBrowser />);
    const notice = await view.findByTestId('exercise-browser-unavailable');
    expect(notice.textContent).toContain('npm run exercise:index');
    // The distinction this state exists for: zero cards because nobody built
    // the index, NOT zero cards because the filter is narrow.
    expect(view.queryByTestId('exercise-browser-empty')).toBeNull();
    expect(view.queryByTestId('exercise-browser-grid')).toBeNull();
  });

  it('hides the facet rails and reports the state in the count line', async () => {
    const view = render(<ExerciseBrowser />);
    await view.findByTestId('exercise-browser-unavailable');
    expect(view.queryByTestId('exercise-browser-groups')).toBeNull();
    expect(view.queryByTestId('exercise-browser-equipment')).toBeNull();
    expect(view.getByTestId('exercise-browser-count').textContent).toBe('Library not built');
  });

  it('still logs the fetch, flagged unavailable', async () => {
    const view = render(<ExerciseBrowser />);
    await view.findByTestId('exercise-browser-unavailable');
    expect(logsFor('info', 'fetch-success')[0].data).toMatchObject({ count: 0, libraryAvailable: false });
  });
});

describe('ExerciseBrowser — 1,296 GIFs', () => {
  const BIG = Array.from({ length: 1296 }, (_, i) => ({
    slug: `exercise-${i}`,
    name: `Exercise ${i}`,
    image: `media/library/exercise/assets/gif-${i}.gif`,
    groups: ['chest'],
    targetMuscles: ['pectorals'],
    equipment: ['barbell']
  }));

  beforeEach(() => { server.corpus = BIG; });

  it('mounts only one page of cards for a 1,296-result set', async () => {
    const view = await mountBrowser();
    expect(renderedSlugs(view.container)).toHaveLength(PAGE_SIZE);
    expect(view.getByTestId('exercise-browser-count').textContent).toBe('Showing 60 of 1296');
    expect(view.getByTestId('exercise-browser-more').textContent).toContain('1236 more');
  });

  it('grows the window by a page per Show more tap', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-browser-more'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(PAGE_SIZE * 2));
    // The page it grew by is the NEXT slice of the corpus, not a re-render of
    // the first one.
    expect(renderedSlugs(view.container)[PAGE_SIZE]).toBe('exercise-60');
  });

  it('resets the window when a filter changes', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-browser-more'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(PAGE_SIZE * 2));
    fireEvent.pointerDown(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(lastListRequest()).toBe('api/v1/fitness/exercises?group=chest'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(PAGE_SIZE));
  });

  it('loads no GIF at all until a card enters the viewport', async () => {
    const view = await mountBrowser();
    expect(renderedSlugs(view.container)).toHaveLength(PAGE_SIZE);
    // 60 mounted cards, zero image requests. Eagerly rendering the window would
    // be ~28 MB of GIF on a kiosk that never scrolled.
    expect(view.container.querySelectorAll('img')).toHaveLength(0);
    expect(view.container.querySelectorAll('.exercise-browser__thumb-placeholder')).toHaveLength(PAGE_SIZE);
  });

  it('loads exactly the card that scrolled in, through DaylightMediaPath', async () => {
    const view = await mountBrowser();
    setIntersecting(thumbOf(view.getByTestId('exercise-card-exercise-7')), true);

    const imgs = view.container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src'))
      .toBe('https://kiosk.test/media/library/exercise/assets/gif-7.gif');
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(view.getByTestId('exercise-card-exercise-7').getAttribute('data-in-view')).toBe('true');
  });

  it('drops the GIF again when the card scrolls away, so resident bytes track the viewport', async () => {
    const view = await mountBrowser();
    const thumb = thumbOf(view.getByTestId('exercise-card-exercise-7'));
    setIntersecting(thumb, true);
    expect(view.container.querySelectorAll('img')).toHaveLength(1);

    setIntersecting(thumb, false);
    expect(view.container.querySelectorAll('img')).toHaveLength(0);
    expect(view.getByTestId('exercise-card-exercise-7').getAttribute('data-in-view')).toBe('false');
  });
});

describe('ExerciseBrowser — detail', () => {
  it('opens the detail sheet for the tapped card and fetches that slug', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-card-archer-push-up'));

    const sheet = await view.findByTestId('exercise-detail');
    expect(sheet.getAttribute('data-slug')).toBe('archer-push-up');
    await view.findByTestId('exercise-detail-instructions');
    expect(server.requests).toContain('api/v1/fitness/exercises/archer-push-up');
    expect(logsFor('info', 'detail-open')[0].data).toEqual({ slug: 'archer-push-up' });
  });

  it('closes the detail sheet', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-card-archer-push-up'));
    await view.findByTestId('exercise-detail');
    fireEvent.pointerDown(view.getByTestId('exercise-detail-close'));
    await waitFor(() => expect(view.queryByTestId('exercise-detail')).toBeNull());
    // The grid is still behind it, unchanged.
    expect(renderedSlugs(view.container)).toHaveLength(8);
  });

  it('applies a chip tapped inside the detail as the whole filter set', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-group-back'));
    await waitFor(() => expect(renderedSlugs(view.container)).toHaveLength(3));

    fireEvent.pointerDown(view.getByTestId('exercise-card-cable-pulldown'));
    fireEvent.pointerDown(await view.findByTestId('exercise-detail-muscle-upper-back'));

    // Replaced, not ANDed onto group=back — the union of the two would have
    // been the same 1 result, so the assertion is on the query the user's
    // gesture produced.
    await waitFor(() => expect(lastListRequest()).toBe('api/v1/fitness/exercises?muscle=upper-back'));
    await waitFor(() => expect(view.queryByTestId('exercise-detail')).toBeNull());
    fireEvent.pointerDown(view.getByTestId('exercise-browser-tab-groups'));
    expect(view.getByTestId('exercise-group-back').getAttribute('data-active')).toBe('false');
  });
});

describe('ExerciseBrowser — build tray', () => {
  it('adds a card to the tray without opening its detail', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-add-pull-up'));

    expect(view.getByTestId('exercise-add-pull-up').getAttribute('data-in-tray')).toBe('true');
    expect(view.getByTestId('fitness-instruction-to-build').textContent).toContain('1 selected');
    // The + sits inside the card, which also has a pointer handler.
    expect(view.queryByTestId('exercise-detail')).toBeNull();
    expect(logsFor('info', 'tray-add')[0].data).toEqual({ slug: 'pull-up', size: 1 });
  });

  it('removes an already-added card on a second tap', async () => {
    const view = await mountBrowser();
    fireEvent.pointerDown(view.getByTestId('exercise-add-pull-up'));
    fireEvent.pointerDown(view.getByTestId('exercise-add-pull-up'));
    expect(view.getByTestId('exercise-add-pull-up').getAttribute('data-in-tray')).toBe('false');
    expect(view.getByTestId('fitness-instruction-to-build').textContent).toContain('0 selected');
    expect(logsFor('info', 'tray-remove')[0].data).toEqual({ slug: 'pull-up', size: 0 });
  });

  it('hands the tray to onStartBuild in the order it was picked', async () => {
    const onStartBuild = vi.fn();
    const view = await mountBrowser({ onStartBuild });
    fireEvent.pointerDown(view.getByTestId('exercise-add-pull-up'));
    fireEvent.pointerDown(view.getByTestId('exercise-add-barbell-squat'));
    fireEvent.pointerDown(view.getByTestId('fitness-instruction-to-build'));

    expect(onStartBuild).toHaveBeenCalledTimes(1);
    expect(onStartBuild.mock.calls[0][0].map((e) => e.slug)).toEqual(['pull-up', 'barbell-squat']);
  });

  it('adds from the detail sheet too, carrying the full record', async () => {
    const onStartBuild = vi.fn();
    const view = await mountBrowser({ onStartBuild });
    fireEvent.pointerDown(view.getByTestId('exercise-card-archer-push-up'));
    await view.findByTestId('exercise-detail-instructions');
    fireEvent.pointerDown(view.getByTestId('exercise-detail-add'));
    fireEvent.pointerDown(view.getByTestId('exercise-detail-close'));
    fireEvent.pointerDown(view.getByTestId('fitness-instruction-to-build'));

    const picked = onStartBuild.mock.calls[0][0];
    expect(picked.map((e) => e.slug)).toEqual(['archer-push-up']);
    // The detail record, not the list summary — build needs the instructions.
    expect(picked[0].instructions).toHaveLength(3);
  });
});

describe('ExerciseBrowser — touch conventions', () => {
  it('does not activate a chip on a bare click (onPointerDown, not onClick)', async () => {
    const view = await mountBrowser();
    fireEvent.click(view.getByTestId('exercise-group-chest'));
    await waitFor(() => expect(view.getByTestId('exercise-group-chest').getAttribute('data-active')).toBe('false'));
    expect(listRequests()).toEqual(['api/v1/fitness/exercises']);
  });

  it('does not open the detail sheet on a bare click', async () => {
    const view = await mountBrowser();
    fireEvent.click(view.getByTestId('exercise-card-archer-push-up'));
    expect(view.queryByTestId('exercise-detail')).toBeNull();
  });

  it('activates a chip on Enter and the card on Space', async () => {
    const view = await mountBrowser();
    fireEvent.keyDown(view.getByTestId('exercise-group-chest'), { key: 'Enter' });
    await waitFor(() => expect(lastListRequest()).toBe('api/v1/fitness/exercises?group=chest'));

    fireEvent.keyDown(view.getByTestId('exercise-card-archer-push-up'), { key: ' ' });
    await view.findByTestId('exercise-detail');
  });

  it('adds to the tray from the keyboard without opening detail', async () => {
    const view = await mountBrowser();
    fireEvent.keyDown(view.getByTestId('exercise-add-pull-up'), { key: 'Enter' });
    expect(view.getByTestId('exercise-add-pull-up').getAttribute('data-in-tray')).toBe('true');
    expect(view.queryByTestId('exercise-detail')).toBeNull();
  });
});
