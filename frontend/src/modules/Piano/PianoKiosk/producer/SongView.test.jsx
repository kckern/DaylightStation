/**
 * SongView tests — empty-state template picker, the structure rail, slot
 * sheets (fill + section actions), scene-launch jump wiring (tap = repeat,
 * hold = bar), and the entry→block index math.
 *
 * The component is DUMB: draft comes in as a prop, verbs go out through the
 * dispatch spy — tests assert dispatched ACTIONS, and reducer behavior is
 * covered in draftReducer.test.js.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SongView, entryStartBlock, entryIndexOfBlock } from './SongView.jsx';
import { STRUCTURE_TEMPLATES } from './structureTemplates.js';
import {
  draftReducer, promote, applyTemplate, setArrangement, ActionTypes,
} from './draftReducer.js';

const mkDraft = (...actions) => actions.reduce((s, a) => draftReducer(s, a), null);

const wsLayer = (id, role, channel, extra = {}) => ({
  id,
  source: { kind: 'library', entry: { path: id, slug: id, barSpan: 2 } },
  role,
  channel,
  gmProgram: role === 'groove' ? null : 0,
  gain: 1,
  muted: false,
  soloed: false,
  carried: false,
  ...extra,
});

const ws = (layers) => ({ layers, keyShift: 0, bpm: 100, metronome: false, editingSectionId: null, lastError: null });

/** Two filled sections; arrangement A×2, B×3 (entry 1 starts at block 2). */
const filledDraft = () => mkDraft(
  promote({ workspaceState: ws([wsLayer('loops/a.mid', 'chords', 0)]), name: 'Verse' }),
  promote({ workspaceState: ws([wsLayer('loops/b.mid', 'chords', 0)]), name: 'Chorus' }),
  setArrangement([
    { sectionId: 'sec-1', repeats: 2 },
    { sectionId: 'sec-2', repeats: 3 },
  ]),
);

/** Pop template applied → all-empty slots. */
const POP = STRUCTURE_TEMPLATES.find((t) => t.id === 'pop');
const templatedDraft = () => mkDraft(applyTemplate(POP, ws([])));

function renderView(draft, props = {}) {
  const handlers = {
    dispatch: vi.fn(),
    onStartFromJam: vi.fn(),
    onApplyTemplate: vi.fn(),
    onUseJam: vi.fn(),
    onOpenSection: vi.fn(),
    onQueueJump: vi.fn(),
  };
  const utils = render(
    <SongView draft={draft} hasJamLayers {...handlers} {...props} />,
  );
  return { ...utils, ...handlers };
}

afterEach(() => {
  vi.useRealTimers();
});

// ── block-index math ─────────────────────────────────────────────────────────

describe('entry ↔ block index math', () => {
  it('entryStartBlock is the prefix sum of coerced repeats (entry 1 behind [2,3] → block 2)', () => {
    const arr = [{ sectionId: 'a', repeats: 2 }, { sectionId: 'b', repeats: 3 }];
    expect(entryStartBlock(arr, 0)).toBe(0);
    expect(entryStartBlock(arr, 1)).toBe(2);
    expect(entryStartBlock(arr, 2)).toBe(5); // one past the end == total blocks
  });

  it('coerces malformed repeats like the scheduler (non-numeric / <1 → 1)', () => {
    const arr = [{ sectionId: 'a', repeats: 'x' }, { sectionId: 'b', repeats: 0 }, { sectionId: 'c', repeats: 2.9 }];
    expect(entryStartBlock(arr, 2)).toBe(2);
    expect(entryIndexOfBlock(arr, 3)).toBe(2);
  });

  it('entryIndexOfBlock inverts it (and returns −1 out of range)', () => {
    const arr = [{ sectionId: 'a', repeats: 2 }, { sectionId: 'b', repeats: 3 }];
    expect(entryIndexOfBlock(arr, 0)).toBe(0);
    expect(entryIndexOfBlock(arr, 1)).toBe(0);
    expect(entryIndexOfBlock(arr, 2)).toBe(1);
    expect(entryIndexOfBlock(arr, 4)).toBe(1);
    expect(entryIndexOfBlock(arr, 5)).toBe(-1);
    expect(entryIndexOfBlock(arr, -1)).toBe(-1);
  });
});

// ── empty state ──────────────────────────────────────────────────────────────

describe('empty state (no draft / no sections)', () => {
  it('offers the five structure templates as cards; picking one calls onApplyTemplate', () => {
    const { onApplyTemplate } = renderView(null);
    for (const t of STRUCTURE_TEMPLATES) {
      expect(screen.getByRole('button', { name: new RegExp(t.name, 'i') })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /pop/i }));
    expect(onApplyTemplate).toHaveBeenCalledWith(POP);
  });

  it('"Start from your jam" promotes; disabled when the workspace is empty', () => {
    const { onStartFromJam } = renderView(null);
    fireEvent.click(screen.getByRole('button', { name: /start from your jam/i }));
    expect(onStartFromJam).toHaveBeenCalledTimes(1);

    renderView(null, { hasJamLayers: false });
    const doors = screen.getAllByRole('button', { name: /start from your jam/i });
    expect(doors[doors.length - 1]).toBeDisabled();
  });

  it('a draft whose sections were all deleted counts as empty too', () => {
    const emptied = draftReducer(
      mkDraft(promote({ workspaceState: ws([wsLayer('loops/a.mid', 'chords', 0)]) })),
      { type: ActionTypes.DELETE_SECTION, sectionId: 'sec-1' },
    );
    renderView(emptied);
    expect(screen.getByRole('button', { name: /start from your jam/i })).toBeInTheDocument();
  });
});

// ── structure rail ───────────────────────────────────────────────────────────

describe('structure rail', () => {
  it('renders one slot card per ARRANGEMENT entry: name, ×repeats, bars, composite glyph + stack thumbnails', () => {
    const { container } = renderView(filledDraft());
    const slots = screen.getAllByRole('listitem');
    expect(slots).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Verse slot 1' }).textContent).toContain('×2 · 2 bars');
    expect(screen.getByRole('button', { name: 'Chorus slot 2' }).textContent).toContain('×3 · 2 bars');
    expect(container.querySelectorAll('.piano-song-view__slot-glyph')).toHaveLength(2);
    expect(container.querySelectorAll('.piano-song-view__slot-stack .piano-material-glyph')).toHaveLength(2);
  });

  it('a section referenced twice renders two slots sharing one identity glyph seed', () => {
    const draft = draftReducer(filledDraft(), setArrangement([
      { sectionId: 'sec-1', repeats: 1 },
      { sectionId: 'sec-1', repeats: 2 },
    ]));
    const { container } = renderView(draft);
    const seeds = [...container.querySelectorAll('.piano-song-view__slot-glyph')].map((el) => el.dataset.seed);
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toBe(seeds[1]);
  });

  it('empty template sections render as dashed fillable slots with the Save stub in the footer', () => {
    const { container } = renderView(templatedDraft());
    expect(screen.getAllByRole('listitem')).toHaveLength(POP.arrangement.length);
    expect(container.querySelectorAll('.piano-song-view__slot--empty')).toHaveLength(POP.arrangement.length);
    expect(screen.getAllByText('fill me').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /save song — coming soon/i })).toBeDisabled();
  });
});

// ── fill sheet (empty slot) ──────────────────────────────────────────────────

describe('fill sheet', () => {
  it('tap on an empty slot opens the fill menu; "Use current jam" fills THAT section', () => {
    const { onUseJam } = renderView(templatedDraft());
    fireEvent.click(screen.getByRole('button', { name: 'Verse slot 2' }));
    const sheet = screen.getByRole('dialog', { name: 'fill Verse' });
    expect(sheet).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use current jam' }));
    expect(onUseJam).toHaveBeenCalledWith('sec-2');
    expect(screen.queryByRole('dialog')).toBeNull(); // sheet closes
  });

  it('"Use current jam" is disabled without jam layers; "From Crate" is a disabled stub', () => {
    renderView(templatedDraft(), { hasJamLayers: false });
    fireEvent.click(screen.getByRole('button', { name: 'Intro slot 1' }));
    expect(screen.getByRole('button', { name: 'Use current jam' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'From Crate' })).toBeDisabled();
  });

  it('"Open in Mix to build" hands the section to the shell', () => {
    const { onOpenSection } = renderView(templatedDraft());
    fireEvent.click(screen.getByRole('button', { name: 'Intro slot 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Mix to build' }));
    expect(onOpenSection).toHaveBeenCalledWith('sec-1');
  });
});

// ── action sheet (filled slot) ───────────────────────────────────────────────

describe('section action sheet', () => {
  const open = (name = 'Verse slot 1') => fireEvent.click(screen.getByRole('button', { name }));

  it('Edit in Mix hands the section to the shell', () => {
    const { onOpenSection } = renderView(filledDraft());
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Mix' }));
    expect(onOpenSection).toHaveBeenCalledWith('sec-1');
  });

  it('repeats steppers dispatch SET_REPEATS on THIS entry; down disabled at ×1', () => {
    const { dispatch } = renderView(filledDraft());
    open('Chorus slot 2');
    fireEvent.click(screen.getByRole('button', { name: 'repeats up' }));
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.SET_REPEATS, index: 1, repeats: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'repeats down' }));
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.SET_REPEATS, index: 1, repeats: 2 });

    const oneRepeat = draftReducer(filledDraft(), setArrangement([{ sectionId: 'sec-1', repeats: 1 }]));
    renderView(oneRepeat);
    fireEvent.click(screen.getAllByRole('button', { name: 'Verse slot 1' }).pop());
    expect(screen.getAllByRole('button', { name: 'repeats down' }).pop()).toBeDisabled();
  });

  it('bars steppers dispatch SET_SECTION_LENGTH; rename commits on Enter and blur', () => {
    const { dispatch } = renderView(filledDraft());
    open();
    fireEvent.click(screen.getByRole('button', { name: 'bars up' }));
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.SET_SECTION_LENGTH, sectionId: 'sec-1', lengthBars: 3 });

    const input = screen.getByLabelText('section name');
    fireEvent.change(input, { target: { value: 'Bridge' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.RENAME_SECTION, sectionId: 'sec-1', name: 'Bridge' });
    fireEvent.change(input, { target: { value: 'Hook' } });
    fireEvent.blur(input);
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.RENAME_SECTION, sectionId: 'sec-1', name: 'Hook' });
  });

  it('Clone dispatches CLONE_SECTION + ADD_ENTRY for the predicted id, right after this slot', () => {
    const { dispatch } = renderView(filledDraft());
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: ActionTypes.CLONE_SECTION, sectionId: 'sec-1' });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: ActionTypes.ADD_ENTRY, sectionId: 'sec-3', at: 1 });
  });

  it('Delete is a 2-tap confirm removing THIS entry; the section goes too only when unreferenced elsewhere', () => {
    // sec-1 appears once → entry removal + section delete.
    const { dispatch } = renderView(filledDraft());
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(dispatch).not.toHaveBeenCalled(); // armed, not yet destructive
    fireEvent.click(screen.getByRole('button', { name: 'Sure?' }));
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.REMOVE_ENTRY, index: 0 });
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.DELETE_SECTION, sectionId: 'sec-1' });
  });

  it('Delete keeps the section when another slot still references it', () => {
    const draft = draftReducer(filledDraft(), setArrangement([
      { sectionId: 'sec-1', repeats: 1 },
      { sectionId: 'sec-1', repeats: 2 },
    ]));
    const { dispatch } = renderView(draft);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sure?' }));
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.REMOVE_ENTRY, index: 0 });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: ActionTypes.DELETE_SECTION }));
  });

  it('Move ←/→ dispatch MOVE_ENTRY; ← disabled on the first slot, → on the last', () => {
    const { dispatch } = renderView(filledDraft());
    open();
    expect(screen.getByRole('button', { name: 'move left' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'move right' }));
    expect(dispatch).toHaveBeenCalledWith({ type: ActionTypes.MOVE_ENTRY, from: 0, to: 1 });
  });
});

// ── scene launch (playback) ──────────────────────────────────────────────────

describe('persistence wiring (Task 8.2)', () => {
  it('footer Save enabled when onSaveSong is provided; passes the inline title', () => {
    const onSaveSong = vi.fn();
    const { getByRole } = renderView(filledDraft(), { onSaveSong });
    const input = getByRole('textbox', { name: 'song title' });
    fireEvent.change(input, { target: { value: '  My Tune  ' } });
    fireEvent.click(getByRole('button', { name: 'Save song' }));
    expect(onSaveSong).toHaveBeenCalledWith('My Tune'); // trimmed
  });

  it('keeps the disabled "coming soon" stub when onSaveSong is absent', () => {
    const { getByRole } = renderView(filledDraft());
    expect(getByRole('button', { name: /save song — coming soon/i })).toBeDisabled();
  });

  it('a filled section exposes "Keep to Crate" when onKeepSection is provided', () => {
    const onKeepSection = vi.fn();
    const { getByRole } = renderView(filledDraft(), { onKeepSection });
    fireEvent.click(getByRole('button', { name: 'Verse slot 1' }));
    fireEvent.click(getByRole('button', { name: 'Keep to Crate' }));
    expect(onKeepSection).toHaveBeenCalledWith('sec-1');
  });

  it('the empty state offers "Load a saved song" when a picker is wired', () => {
    const onOpenSongPicker = vi.fn();
    const { getByRole } = renderView(null, { onOpenSongPicker });
    fireEvent.click(getByRole('button', { name: 'Load a saved song' }));
    expect(onOpenSongPicker).toHaveBeenCalled();
  });
});

describe('scene launch during arrangement playback', () => {
  it('the slot containing activeBlockIndex glows (entry 1 owns blocks 2..4 under repeats [2,3])', () => {
    const { container } = renderView(filledDraft(), { isSongPlaying: true, activeBlockIndex: 2 });
    const slots = container.querySelectorAll('.piano-song-view__slot');
    expect(slots[0].className).not.toContain('is-active');
    expect(slots[1].className).toContain('is-active');
    expect(slots[1]).toHaveAttribute('aria-current');
  });

  it('tap on a filled slot queues a REPEAT-mode jump to the entry’s FIRST block', () => {
    const { onQueueJump } = renderView(filledDraft(), { isSongPlaying: true, activeBlockIndex: 0 });
    const slot = screen.getByRole('button', { name: 'Chorus slot 2' });
    fireEvent.pointerDown(slot);
    fireEvent.pointerUp(slot);
    expect(onQueueJump).toHaveBeenCalledTimes(1);
    expect(onQueueJump).toHaveBeenCalledWith(2, 'repeat');
    // No action sheet while playing — the tap was a scene launch.
    fireEvent.click(slot);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tap-and-hold ≥500ms fires a BAR-mode jump instead (no trailing repeat jump on release)', () => {
    vi.useFakeTimers();
    const { onQueueJump } = renderView(filledDraft(), { isSongPlaying: true, activeBlockIndex: 0 });
    const slot = screen.getByRole('button', { name: 'Chorus slot 2' });
    fireEvent.pointerDown(slot);
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(slot);
    expect(onQueueJump).toHaveBeenCalledTimes(1);
    expect(onQueueJump).toHaveBeenCalledWith(2, 'bar');
  });

  it('a queued jump renders the "next →" chip on the target slot', () => {
    renderView(filledDraft(), { isSongPlaying: true, activeBlockIndex: 0, pendingBlockIndex: 2 });
    const chip = screen.getByText('next →');
    expect(chip.closest('.piano-song-view__slot-wrap').textContent).toContain('Chorus');
  });

  it('tapping an EMPTY slot while playing still opens the fill menu (fill live, join at the next swap)', () => {
    const draft = templatedDraft();
    renderView(draft, { isSongPlaying: true, activeBlockIndex: 0 });
    const slot = screen.getByRole('button', { name: 'Verse slot 2' });
    fireEvent.pointerDown(slot);
    fireEvent.pointerUp(slot);
    fireEvent.click(slot);
    expect(screen.getByRole('dialog', { name: 'fill Verse' })).toBeInTheDocument();
  });
});
