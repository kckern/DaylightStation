/**
 * LibraryBrowser tests (Task 5.1) — the full-screen library surface with
 * consonance guardrails. Pure-ranking behavior lives in libraryRanking.test.js;
 * these cover the SURFACE: cards, facets, guardrail indicator + Show-all lift,
 * "goes with →" pivot, honest naming, the 120-card cap, and the pick seam.
 *
 * Timelines reuse the hand-built consonance-vocabulary fixtures: I-I-V-I base,
 * roots-only stackable candidate, dim7 wall dissonant against it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { facets } from '@shared-music/loopQuery.mjs';
import { LibraryBrowser } from './LibraryBrowser.jsx';

// ── timeline fixtures (root-relative pc sets) ────────────────────────────────
const TL_I_V = [[0, 4, 7], [0, 4, 7], [2, 7, 11], [0, 4, 7]];
const TL_ROOTS = [[0], [0], [7], [0]];
const TL_DIM7 = [[0, 3, 6, 9], [0, 3, 6, 9], [0, 3, 6, 9], [0, 3, 6, 9]];

// ── entries ──────────────────────────────────────────────────────────────────
const BASE = {
  slug: 'base-loop', path: 'chord-progressions/base-loop.mid', type: 'chord-progression',
  roman: ['I', 'I', 'V', 'I'], title: 'C · G', mood: 'Happy', bpm: 120,
  timeline: TL_I_V, timelineRoot: 0, specificity: 'triad',
};
const FRIEND = {
  slug: 'friendly-roots', path: 'chord-progressions/friendly-roots.mid', type: 'chord-progression',
  roman: ['I', 'I', 'V', 'I'], title: 'Root Notes', mood: 'Happy', bpm: 120,
  timeline: TL_ROOTS, timelineRoot: 0, specificity: 'root',
};
const CLASH = {
  slug: 'dim-wall', path: 'chord-progressions/dim-wall.mid', type: 'chord-progression',
  roman: ['viio7'], title: 'Dim Wall', mood: 'Dark',
  timeline: TL_DIM7, timelineRoot: 0, specificity: 'extended',
};
const UNTITLED_MELODY = {
  slug: 'nameless-tune', path: 'melodies/nameless-tune.mid', type: 'melody',
  degrees: [1, 2, 3], mood: 'Catchy',
  timeline: [[0], [4], [7], [0]], timelineRoot: 0, specificity: 'triad',
};
const GROOVE = {
  slug: 'basic-rock', path: 'grooves/basic-rock.mid', type: 'groove',
  feel: 'straight', bpm: 96, title: 'Basic Rock',
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

describe('LibraryBrowser — "goes with →" pivot', () => {
  it('pivot re-anchors the browse (works without a workspace base) and breadcrumb ✕ restores', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Dim Wall' });
    fireEvent.click(screen.getByRole('button', { name: 'goes with C · G' }));
    // Re-anchored: gate now runs against C · G — the clash disappears.
    expect(screen.queryByRole('button', { name: 'Dim Wall' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Root Notes' })).toBeInTheDocument();
    expect(screen.getByText(/showing what fits your jam/i)).toBeInTheDocument();
    // Breadcrumb shows the pivot; ✕ returns to the unanchored browse.
    expect(screen.getByText('Goes with')).toBeInTheDocument();
    expect(screen.getByText('C · G')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'clear pivot' }));
    expect(screen.queryByText('Goes with')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Dim Wall' })).toBeInTheDocument();
  });

  it('pivot overrides the workspace base (and resets a lifted gate)', async () => {
    renderBrowser({ layers: [layerFor(BASE)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    await screen.findByRole('button', { name: 'Dim Wall' });
    fireEvent.click(screen.getByRole('button', { name: 'goes with Root Notes' }));
    // Anchored to Root Notes now, gate re-armed: dim wall gated out again.
    expect(screen.queryByRole('button', { name: 'Dim Wall' })).toBeNull();
    expect(screen.getByText('Root Notes', { selector: '.piano-producer-mode__crumb-name' })).toBeInTheDocument();
  });
});

describe('LibraryBrowser — facets, search, stubs, cap', () => {
  it('kind facet filters (Grooves shows only grooves; All restores)', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    fireEvent.click(screen.getByRole('button', { name: 'Grooves' }));
    expect(cardTitles()).toEqual(['Basic Rock']);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(cardTitles().length).toBe(ALL.length);
  });

  it('initialRole pre-filters kind (the "Start from a loop" door)', async () => {
    renderBrowser({ initialRole: 'chords' });
    await screen.findByRole('button', { name: 'C · G' });
    expect(cardTitles()).toEqual(expect.arrayContaining(['C · G', 'Root Notes', 'Dim Wall']));
    expect(screen.queryByRole('button', { name: 'Basic Rock' })).toBeNull();
  });

  it('mood facet chips filter and toggle off', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    const moodGroup = screen.getByRole('group', { name: 'mood' });
    fireEvent.click(within(moodGroup).getByRole('button', { name: 'Happy' }));
    expect(cardTitles()).toEqual(expect.arrayContaining(['C · G', 'Root Notes']));
    expect(cardTitles()).toHaveLength(2);
    fireEvent.click(within(moodGroup).getByRole('button', { name: 'Happy' }));
    expect(cardTitles().length).toBe(ALL.length);
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

  it('search filters the already-built set (title/slug match)', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    fireEvent.change(screen.getByPlaceholderText(/search loops/i), { target: { value: 'nameless' } });
    expect(cardTitles()).toEqual(['nameless-tune']);
  });

  it('no results → friendly empty state; clear-filters chip restores everything', async () => {
    renderBrowser();
    await screen.findByRole('button', { name: 'Basic Rock' });
    fireEvent.change(screen.getByPlaceholderText(/search loops/i), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText(/no loops match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cardTitles().length).toBe(ALL.length);
  });

  it("'Ours' facet is a stub with an honest empty state", async () => {
    renderBrowser();
    fireEvent.click(await screen.findByRole('button', { name: 'Ours' }));
    expect(screen.getByText(/nothing kept yet — record or save something/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.piano-loop').length).toBe(0);
  });

  it("'Prefabs' facet is a stub marked coming soon", async () => {
    renderBrowser();
    fireEvent.click(await screen.findByRole('button', { name: 'Prefabs' }));
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('caps the grid at 120 cards with a "refine to see more" footer', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      slug: `loop-${i}`, path: `chord-progressions/loop-${i}.mid`, type: 'chord-progression',
      roman: ['I', 'V'], title: `Loop ${i}`,
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
