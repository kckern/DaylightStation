/**
 * LibraryBrowser tests (Task 5.1) — the full-screen library surface with
 * consonance guardrails. Pure-ranking behavior lives in libraryRanking.test.js;
 * these cover the SURFACE: cards, facets, guardrail indicator + Show-all lift,
 * honest naming (no keyed spelling on cards), the 120-card cap, and the pick seam.
 *
 * Timelines reuse the hand-built consonance-vocabulary fixtures: I-I-V-I base,
 * roots-only stackable candidate, dim7 wall dissonant against it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { facets } from '@shared-music/loopQuery.mjs';
import { LibraryBrowser } from './LibraryBrowser.jsx';

// ── timeline fixtures (root-relative pc sets) ────────────────────────────────
const TL_I_V = [[0, 4, 7], [0, 4, 7], [2, 7, 11], [0, 4, 7]];
const TL_ROOTS = [[0], [0], [7], [0]];
const TL_DIM7 = [[0, 3, 6, 9], [0, 3, 6, 9], [0, 3, 6, 9], [0, 3, 6, 9]];

// ── entries ──────────────────────────────────────────────────────────────────
// Migrated from the legacy `mood` string to the brick fields: `genre`/`emotion`
// arrays + a `quality` string. `quality: 'best'` on every fixture here keeps
// them visible under the browser's new default Best-only view (Task 7); the
// dedicated quality-toggle test below adds a non-best entry instead of
// touching these.
const BASE = {
  slug: 'base-loop', path: 'chord-progressions/base-loop.mid', type: 'chord-progression',
  roman: ['I', 'I', 'V', 'I'], title: 'C · G', genre: ['pop'], emotion: ['happy'], quality: 'best', bpm: 120,
  timeline: TL_I_V, timelineRoot: 0, specificity: 'triad',
};
const FRIEND = {
  slug: 'friendly-roots', path: 'chord-progressions/friendly-roots.mid', type: 'chord-progression',
  roman: ['I', 'I', 'V', 'I'], title: 'Root Notes', genre: ['pop'], emotion: ['happy'], quality: 'best', bpm: 120,
  timeline: TL_ROOTS, timelineRoot: 0, specificity: 'root',
};
const CLASH = {
  slug: 'dim-wall', path: 'chord-progressions/dim-wall.mid', type: 'chord-progression',
  roman: ['viio7'], title: 'Dim Wall', genre: ['rock'], emotion: ['dark'], quality: 'best',
  timeline: TL_DIM7, timelineRoot: 0, specificity: 'extended',
};
const UNTITLED_MELODY = {
  slug: 'nameless-tune', path: 'melodies/nameless-tune.mid', type: 'melody',
  degrees: [1, 2, 3], genre: ['indie'], emotion: ['catchy'], quality: 'best',
  timeline: [[0], [4], [7], [0]], timelineRoot: 0, specificity: 'triad',
};
const GROOVE = {
  // Real grooves carry NO quality tier — they must still show under Best.
  slug: 'basic-rock', path: 'grooves/basic-rock.mid', type: 'groove',
  feel: 'straight', bpm: 96, title: 'Basic Rock', quality: '',
};

const ALL = [BASE, FRIEND, CLASH, UNTITLED_MELODY, GROOVE];

function makeLib(loops = ALL) {
  return {
    loops,
    facets: facets(loops),
    loadNotes: vi.fn(() => Promise.resolve({ ppq: 480, notes: [{ ticks: 0, durationTicks: 240, midi: 60 }] })),
  };
}

const layerFor = (entry) => ({ id: entry.path, role: 'chords', source: { kind: 'library', entry } });

function renderBrowser(overrides = {}) {
  const props = {
    lib: makeLib(),
    layers: [],
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const utils = render(<LibraryBrowser {...props} />);
  return { ...utils, props };
}

const cardTitles = () => [...document.querySelectorAll('.piano-loop')].map((c) => c.getAttribute('aria-label'));

beforeEach(() => vi.clearAllMocks());

describe('LibraryBrowser — cards & honest identity', () => {
  it('renders glyph-forward cards; roman shown for harmonic entries', async () => {
    renderBrowser();
    const card = await screen.findByRole('button', { name: 'C · G' });
    expect(card.querySelector('.piano-material-glyph')).toBeTruthy();
    expect(card.querySelector('.roman-progression')).toBeTruthy();
  });

  it('harmonic cards never render a keyed spelling — the abstract Roman IS the identity', async () => {
    renderBrowser();
    // 'C · G' is the vendor's keyed title on a chord-progression brick; the
    // library is abstract/key-agnostic (transposed at playtime), so it must
    // survive ONLY as the aria-label, never as visible card text.
    const card = await screen.findByRole('button', { name: 'C · G' });
    expect(card.querySelector('.piano-loop__name')).toBeNull();
    expect(card.querySelector('.piano-loop__caption')).toBeNull();
    expect(card.querySelector('.roman-progression')).toBeTruthy();
    expect(card.textContent).not.toContain('C · G');
  });

  it('never fabricates a name: untitled melodic card has no name text, only a subdued slug caption', async () => {
    renderBrowser();
    const card = await screen.findByRole('button', { name: 'nameless-tune' });
    expect(card.querySelector('.piano-loop__name')).toBeNull();
    const caption = card.querySelector('.piano-loop__caption');
    expect(caption?.textContent).toBe('nameless-tune');
    expect(card.querySelector('.piano-loop__staff')).toBeTruthy(); // staff = its identity
  });

  it('groove cards show honest feel/bpm chips — no staff, no fake onsets', async () => {
    renderBrowser();
    const card = await screen.findByRole('button', { name: 'Basic Rock' });
    expect(card.querySelector('.piano-loop__staff')).toBeNull();
    const chips = [...card.querySelectorAll('.piano-loop__chip')].map((c) => c.textContent);
    expect(chips).toEqual(['straight', '96 bpm']);
  });

  it('tap card = onPick(entry) (the Producer seam)', async () => {
    const { props } = renderBrowser();
    fireEvent.click(await screen.findByRole('button', { name: 'Root Notes' }));
    expect(props.onPick).toHaveBeenCalledWith(FRIEND);
  });
});

describe('LibraryBrowser — consonance guardrail', () => {
  it('with a workspace base: dissonant loops are gated out, indicator counts the fits', async () => {
    renderBrowser({ layers: [layerFor(BASE)] });
    await screen.findByRole('button', { name: 'Root Notes' });
    expect(screen.queryByRole('button', { name: 'Dim Wall' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'C · G' })).toBeNull(); // base not re-offered
    expect(screen.getByText(/showing what fits your jam · 3 loops/i)).toBeInTheDocument();
    // Grooves are neutral, melodies are ranked not gated — both offered.
    expect(screen.getByRole('button', { name: 'Basic Rock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nameless-tune' })).toBeInTheDocument();
  });

  it('"Show all" lifts the gate: non-stackable cards appear with a ⚠ and are still pickable', async () => {
    const { props } = renderBrowser({ layers: [layerFor(BASE)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    const clashCard = await screen.findByRole('button', { name: 'Dim Wall' });
    expect(within(clashCard).getByRole('img', { name: 'may clash' })).toBeInTheDocument();
    // Stackable cards carry no warning in the lifted view.
    const friendCard = screen.getByRole('button', { name: 'Root Notes' });
    expect(friendCard.querySelector('.piano-loop__warn')).toBeNull();
    // Guardrails are defaults, not prisons — adding from the ungated list works.
    fireEvent.click(clashCard);
    expect(props.onPick).toHaveBeenCalledWith(CLASH);
    // And the escape is reversible.
    fireEvent.click(screen.getByRole('button', { name: 'Show fits' }));
    expect(screen.queryByRole('button', { name: 'Dim Wall' })).toBeNull();
  });

  it('no gate without a base: everything is offered, no indicator', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Dim Wall' });
    expect(screen.queryByText(/fits your jam/i)).toBeNull();
  });
});

describe('LibraryBrowser — facets, stubs, cap', () => {
  it('kind facet filters (Grooves shows only grooves; All restores)', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    const kindGroup = screen.getByRole('group', { name: 'kind' });
    fireEvent.click(within(kindGroup).getByRole('button', { name: 'Grooves' }));
    expect(cardTitles()).toEqual(['Basic Rock']);
    fireEvent.click(within(kindGroup).getByRole('button', { name: 'All' }));
    expect(cardTitles().length).toBe(ALL.length);
  });

  it('initialRole pre-filters kind (the "Start from a loop" door)', async () => {
    renderBrowser({ initialRole: 'chords' });
    await screen.findByRole('button', { name: 'C · G' });
    expect(cardTitles()).toEqual(expect.arrayContaining(['C · G', 'Root Notes', 'Dim Wall']));
    expect(screen.queryByRole('button', { name: 'Basic Rock' })).toBeNull();
  });

  it('genre facet chips filter and toggle off', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    const genreGroup = screen.getByRole('group', { name: 'genre' });
    fireEvent.click(within(genreGroup).getByRole('button', { name: 'pop' }));
    expect(cardTitles()).toEqual(expect.arrayContaining(['C · G', 'Root Notes']));
    expect(cardTitles()).toHaveLength(2);
    fireEvent.click(within(genreGroup).getByRole('button', { name: 'pop' }));
    expect(cardTitles().length).toBe(ALL.length);
  });

  it('genre chips render from facets.genres and the chip label filters the grid', async () => {
    const DREAMY = {
      slug: 'dreamy-bed', path: 'chord-progressions/dreamy-bed.mid', type: 'chord-progression',
      roman: ['I'], title: 'Dreamy Bed', genre: ['lofi'], emotion: ['dreamy'], tags: ['lofi'], quality: 'best',
      timeline: [[0, 4, 7]], timelineRoot: 0, specificity: 'triad',
    };
    const HOUSE = {
      slug: 'house-lead', path: 'melodies/house-lead.mid', type: 'melody',
      title: 'House Lead', genre: ['house'], emotion: [], tags: ['house'], quality: 'best',
      timeline: [[0], [4]], timelineRoot: 0, specificity: 'root',
    };
    renderBrowser({ lib: makeLib([DREAMY, HOUSE]) });
    await screen.findByRole('button', { name: 'Dreamy Bed' });
    fireEvent.click(screen.getByRole('button', { name: /^lofi$/i }));
    // Assert card presence by accessible name, not visible text: 'Dreamy Bed'
    // is a chord-progression, whose keyed title renders only as the aria-label.
    expect(screen.getByRole('button', { name: 'Dreamy Bed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'House Lead' })).not.toBeInTheDocument();
  });

  it('quality toggle defaults to Best; All reveals non-best entries', async () => {
    const DRAFT = {
      slug: 'draft-loop', path: 'chord-progressions/draft-loop.mid', type: 'chord-progression',
      roman: ['I', 'V'], title: 'Draft Loop', genre: ['pop'], emotion: [], quality: '',
      timeline: [[0, 4, 7], [2, 7, 11]], timelineRoot: 0, specificity: 'triad',
    };
    renderBrowser({ lib: makeLib([...ALL, DRAFT]) });
    await screen.findByRole('button', { name: 'Basic Rock' });
    expect(screen.queryByRole('button', { name: 'Draft Loop' })).toBeNull();
    const qualityGroup = screen.getByRole('group', { name: 'quality' });
    fireEvent.click(within(qualityGroup).getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: 'Draft Loop' })).toBeInTheDocument();
    fireEvent.click(within(qualityGroup).getByRole('button', { name: 'Best' }));
    expect(screen.queryByRole('button', { name: 'Draft Loop' })).toBeNull();
  });

  it('grooves stay visible under the Best default (no quality tier) — drums must be addable', async () => {
    renderBrowser(); // quality defaults to Best; GROOVE has quality ''
    fireEvent.click(screen.getByRole('button', { name: 'Grooves' }));
    expect(await screen.findByRole('button', { name: 'Basic Rock' })).toBeInTheDocument();
  });

  it('ideas stay visible under the Best default — no idea is graded "best", so the whole Ideas category must not vanish', async () => {
    // Same class as grooves: the `idea` type has NO 'best'-tier members in the
    // real library, so a Best default that hard-filtered by tier emptied the
    // entire Ideas kind. The quality facet must no-op for such a type.
    const IDEA = {
      slug: 'spark', path: 'ideas/spark.mid', type: 'idea', title: 'Bright Spark',
      genre: ['jazz'], emotion: ['bright'], quality: '',
      timeline: [[0, 4, 7], [2, 7, 11]], timelineRoot: 0, specificity: 'triad',
    };
    renderBrowser({ lib: makeLib([...ALL, IDEA]) }); // quality defaults to Best
    fireEvent.click(screen.getByRole('button', { name: 'Ideas' }));
    expect(await screen.findByRole('button', { name: 'Bright Spark' })).toBeInTheDocument();
  });

  it('basslines show in FULL under the Best default — a small line category is never tier-curated (more bass options)', async () => {
    // Unlike ideas/grooves, basslines DO have a few 'best' entries — but curating
    // a 23-item category to its 3 graded ones is counterproductive. Only the big
    // families (chords/melodies) are tier-curated; bass always shows in full.
    const BASS = {
      slug: 'walk-1', path: 'basslines/walk-1.mid', type: 'bassline', title: 'Walking One',
      roman: ['I', 'IV', 'V', 'I'], genre: ['funk'], emotion: ['groovy'], quality: '', // ungraded
      timeline: [[0], [5], [7], [0]], timelineRoot: 0, specificity: 'root',
    };
    renderBrowser({ lib: makeLib([...ALL, BASS]) }); // quality defaults to Best
    fireEvent.click(screen.getByRole('button', { name: 'Bass' }));
    expect(await screen.findByRole('button', { name: 'Walking One' })).toBeInTheDocument();
  });

  it('the Chords kind chip is de-emphasised (is-dim) once a chord layer is already stacked', () => {
    // No chord layer yet → the Chords chip reads normally.
    const { unmount } = renderBrowser({ layers: [] });
    expect(screen.getByRole('button', { name: 'Chords' }).className).not.toMatch(/is-dim/);
    unmount();
    // A chord layer in the stack (layerFor sets role 'chords') → dimmed + titled.
    renderBrowser({ layers: [layerFor(BASE)] });
    const chip = screen.getByRole('button', { name: 'Chords' });
    expect(chip.className).toMatch(/is-dim/);
    expect(chip).toHaveAttribute('title');
  });

  it('feel chips appear for the groove kind and filter by feel', async () => {
    const swing = { ...GROOVE, slug: 'swing-brush', path: 'grooves/swing-brush.mid', feel: 'swing', title: 'Swing Brush' };
    renderBrowser({ lib: makeLib([...ALL, swing]) });
    await screen.findByRole('button', { name: 'Basic Rock' });
    expect(screen.queryByRole('group', { name: 'feel' })).toBeNull(); // only for groove kind
    fireEvent.click(screen.getByRole('button', { name: 'Grooves' }));
    const feelGroup = screen.getByRole('group', { name: 'feel' });
    fireEvent.click(within(feelGroup).getByRole('button', { name: 'swing' }));
    expect(cardTitles()).toEqual(['Swing Brush']);
  });

  it('no results → friendly empty state; clear-filters chip restores everything', async () => {
    // No search box (kiosk has no text input) — an empty state is reached by an
    // impossible facet combo: genre "rock" (only the chord-progression Dim Wall)
    // intersected with kind "Grooves" leaves nothing.
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    const genreGroup = screen.getByRole('group', { name: 'genre' });
    fireEvent.click(within(genreGroup).getByRole('button', { name: 'rock' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'kind' })).getByRole('button', { name: 'Grooves' }));
    expect(screen.getByText(/no loops match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cardTitles().length).toBe(ALL.length);
  });

  it("'Ours' facet shows an honest empty state when nothing is kept", async () => {
    renderBrowser();
    fireEvent.click(await screen.findByRole('button', { name: 'Ours' }));
    expect(screen.getByText(/nothing kept yet/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.piano-loop').length).toBe(0);
  });

  it("'Ours' facet renders kept loops + stacks and picks them (sections excluded)", async () => {
    const onPickOurs = vi.fn();
    renderBrowser({
      ours: {
        loops: [{ id: 'l1', kind: 'bass', title: 'My Bass', author: 'kc' }],
        crate: [
          { id: 'c1', kind: 'stack', title: 'My Stack', layerCount: 3 },
          { id: 'c2', kind: 'section', title: 'Should Not Show' },
        ],
      },
      onPickOurs,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Ours' }));
    expect(screen.getByText('My Bass')).toBeInTheDocument();
    expect(screen.getByText('My Stack')).toBeInTheDocument();
    expect(screen.queryByText('Should Not Show')).toBeNull(); // section excluded
    fireEvent.click(screen.getByRole('button', { name: 'My Stack' }));
    expect(onPickOurs).toHaveBeenCalledWith('stack', expect.objectContaining({ id: 'c1' }));
    fireEvent.click(screen.getByRole('button', { name: 'My Bass' }));
    expect(onPickOurs).toHaveBeenCalledWith('loop', expect.objectContaining({ id: 'l1' }));
  });

  it("'Prefabs' facet renders curated stacks (never an empty state) and picks them", async () => {
    const onPickPrefab = vi.fn();
    renderBrowser({
      prefabs: {
        stacks: [
          { id: 'pop-1-5-6-4', title: 'Pop I–V–vi–IV', layerCount: 2 },
          { id: 'lofi-groove-bed', title: 'Lo-fi groove bed', layerCount: 2 },
        ],
      },
      onPickPrefab,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Prefabs' }));
    // curated content ALWAYS ships → cards, never the "coming soon" stub
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByText('Pop I–V–vi–IV')).toBeInTheDocument();
    expect(screen.getByText('Lo-fi groove bed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pop I–V–vi–IV' }));
    expect(onPickPrefab).toHaveBeenCalledWith(expect.objectContaining({ id: 'pop-1-5-6-4' }));
  });

  it("'Prefabs' facet shows all curated stacks (no search box to filter them)", async () => {
    // The kiosk has no text input, so prefabs are never text-filtered — every
    // curated stack stays visible under the Prefabs facet.
    renderBrowser({
      prefabs: {
        stacks: [
          { id: 'pop-1-5-6-4', title: 'Pop I–V–vi–IV', layerCount: 2 },
          { id: 'lofi-groove-bed', title: 'Lo-fi groove bed', layerCount: 2 },
        ],
      },
      onPickPrefab: vi.fn(),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Prefabs' }));
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    expect(screen.getByText('Pop I–V–vi–IV')).toBeInTheDocument();
    expect(screen.getByText('Lo-fi groove bed')).toBeInTheDocument();
  });

  it('caps the grid at 120 cards with a "refine to see more" footer', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      slug: `loop-${i}`, path: `chord-progressions/loop-${i}.mid`, type: 'chord-progression',
      roman: ['I', 'V'], title: `Loop ${i}`, quality: 'best',
      timeline: [[0, 4, 7], [2, 7, 11]], timelineRoot: 0, specificity: 'triad',
    }));
    renderBrowser({ lib: makeLib(many) });
    await screen.findByRole('button', { name: 'Loop 0' });
    expect(document.querySelectorAll('.piano-loop').length).toBe(120);
    expect(screen.getByText(/30 more — refine your search or facets/i)).toBeInTheDocument();
  });
});

describe('LibraryBrowser — chrome', () => {
  it('close button fires onClose; now-playing pill shows while the jam loops (tap = close)', async () => {
    const { props } = renderBrowser({
      isPlaying: true,
      positionRef: { current: { bar: 2, beat: 1 } },
      pillMaterials: [BASE],
    });
    await screen.findByRole('button', { name: 'Basic Rock' });
    fireEvent.click(screen.getByRole('button', { name: 'now playing' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'close library' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});

// ── press-and-hold audition (Task 5.2) ───────────────────────────────────────
// Pointer choreography only — the peek ENGINE (channels, transpose, metronome,
// token guard) is covered in usePeek.test.js. Assertions here lean on the
// engine's synchronous side effects: configureLayer(15, …) proves a peek
// started; allNotesOff(15) proves it was silenced.

describe('LibraryBrowser — press-and-hold audition', () => {
  const makeRouter = () => ({
    noteOn: vi.fn(), noteOff: vi.fn(), allNotesOff: vi.fn(), configureLayer: vi.fn(), panic: vi.fn(),
  });

  /**
   * This jsdom has no PointerEvent — fireEvent.pointerDown would construct a
   * plain Event and silently DROP clientX/pointerId (GainStrip.test.jsx has
   * the same workaround). Build the Event and assign the pointer props.
   */
  function pointerEvent(type, { pointerId = 1, clientX = 50, clientY = 50 } = {}) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerId, clientX, clientY });
    return ev;
  }
  const down = (el, opts) => fireEvent(el, pointerEvent('pointerdown', opts));
  const up = (el, opts) => fireEvent(el, pointerEvent('pointerup', opts));

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function renderPeek(overrides = {}) {
    const router = makeRouter();
    return { router, ...renderBrowser({ router, bpm: 120, keyShift: 0, ...overrides }) };
  }

  const hold = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

  it('hold 150ms → the peek starts and the card pulses (is-peeking)', async () => {
    const { router, props } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    expect(card.classList.contains('is-peeking')).toBe(false); // still arming
    await hold(150);
    expect(card.classList.contains('is-peeking')).toBe(true);
    expect(router.configureLayer).toHaveBeenCalledWith(15, { program: 0, gain: 1 });
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('quick tap (release inside the arm window) → onPick, no peek ever starts', async () => {
    const { router, props } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    await hold(100);
    up(card);
    expect(props.onPick).toHaveBeenCalledWith(FRIEND);
    await hold(200); // the armed timer must be dead
    expect(router.configureLayer).not.toHaveBeenCalled();
    expect(card.classList.contains('is-peeking')).toBe(false);
  });

  it('hold-release → silence, and the release must NOT add the loop (add takes a fresh tap)', async () => {
    const { router, props } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    await hold(200);
    up(card);
    expect(router.allNotesOff).toHaveBeenCalledWith(15);
    expect(props.onPick).not.toHaveBeenCalled();
    expect(card.classList.contains('is-peeking')).toBe(false);
  });

  it('move > 12px during the arm window → neither peek nor pick (it was a scroll)', async () => {
    const { router, props } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    fireEvent(card, pointerEvent('pointermove', { clientX: 70 })); // 20px drift
    await hold(300);
    expect(card.classList.contains('is-peeking')).toBe(false);
    expect(router.configureLayer).not.toHaveBeenCalled();
    up(card);
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('small drift (< 12px) does not cancel the arm — the peek still starts', async () => {
    const { router } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    fireEvent(card, pointerEvent('pointermove', { clientX: 58 })); // 8px jitter
    await hold(150);
    expect(card.classList.contains('is-peeking')).toBe(true);
    expect(router.configureLayer).toHaveBeenCalledWith(15, { program: 0, gain: 1 });
  });

  it('pointercancel mid-peek (browser claimed the gesture) silences it', async () => {
    const { router, props } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    await hold(150);
    expect(card.classList.contains('is-peeking')).toBe(true);
    fireEvent(card, pointerEvent('pointercancel'));
    expect(router.allNotesOff).toHaveBeenCalledWith(15);
    expect(card.classList.contains('is-peeking')).toBe(false);
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('pressing a second card while peeking stops the first; the stale release cannot kill the second', async () => {
    const { router, props } = renderPeek();
    const first = screen.getByRole('button', { name: 'Root Notes' });
    const second = screen.getByRole('button', { name: 'Basic Rock' });
    down(first, { pointerId: 1 });
    await hold(150);
    expect(first.classList.contains('is-peeking')).toBe(true);

    down(second, { pointerId: 2, clientX: 200 });
    await hold(150);
    expect(router.allNotesOff).toHaveBeenCalledWith(15); // first peek silenced
    expect(first.classList.contains('is-peeking')).toBe(false);
    expect(second.classList.contains('is-peeking')).toBe(true);

    // The first finger lifts late — a stale release, not a stop for the second.
    up(first, { pointerId: 1 });
    expect(second.classList.contains('is-peeking')).toBe(true);
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('keyboard activation (click with detail 0, no pointer gesture) still picks', async () => {
    const { props } = renderPeek();
    fireEvent.click(screen.getByRole('button', { name: 'Root Notes' }), { detail: 0 });
    expect(props.onPick).toHaveBeenCalledWith(FRIEND);
  });

  it('the ghost click after a touch tap (detail > 0) does not double-pick', async () => {
    const { props } = renderPeek();
    const card = screen.getByRole('button', { name: 'Root Notes' });
    down(card);
    up(card); // tap picked once
    fireEvent.click(card, { detail: 1 }); // browser compatibility click
    expect(props.onPick).toHaveBeenCalledTimes(1);
  });
});
