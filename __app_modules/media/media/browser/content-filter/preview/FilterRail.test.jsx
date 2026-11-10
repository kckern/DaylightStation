import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import FilterRail from './FilterRail.jsx';
import { previewStore } from './previewStore.js';

// A film shaped like the live one: dense words, a tracked blur in many pieces,
// one skipped scene (draft card), one scene that plays.
const WORDS = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, in: 60 + i * 10, out: 60.4 + i * 10, effect: 'mute', label: i === 3 ? 'h*ll' : `word ${i}`, category: 'language/profanity' }));
const BLUR = [0, 1, 2].map((k) => ({ id: `va9@${k}`, in: 400 + k * 0.5, out: 400.5 + k * 0.5, effect: 'blur', label: 'A billboard shows a rude word.', category: 'language/profanity' }));
const SKIP = { id: 'sc-a', scene: 'sc-a', in: 900, out: 960, effect: 'skip-card', category: 'scene/violence_blood_gore' };
const CUES = [...WORDS, ...BLUR, SKIP];
const SCENES = [
  { id: 'sc-a', in: 900, out: 960, groups: ['violence_blood_gore'], level: { violence_blood_gore: { situation: 2, picture: 1 } }, card: { text: 'Biff gets what he deserves.' } },
  { id: 'sc-b', in: 1500, out: 1530, groups: ['sex_any'], level: { sex_any: { situation: 1, picture: 0 } } },
];

function setup(partial = {}, position = 50) {
  act(() => previewStore.publish({
    ratingKey: '77', cues: CUES, scenes: SCENES, override: {},
    certification: { level: 'parent' }, open: true, ...partial,
  }));
  return render(<FilterRail position={position} duration={6000} />);
}
const kind = (k) => screen.getAllByTestId('filter-rail-kind').find((b) => b.dataset.kind === k);

describe('FilterRail', () => {
  let refresh;
  beforeEach(() => {
    act(() => previewStore.reset());
    vi.restoreAllMocks();
    DaylightAPI.mockReset();
    refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(undefined);
  });

  it('shows the certification; close calls close()', () => {
    const spy = vi.spyOn(previewStore, 'close');
    setup();
    expect(screen.getByText('parent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close preview/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('the kind switch counts moments, not pieces: a tracked blur is one, a scene is one', () => {
    setup();
    expect(kind('all').textContent).toBe('All10');
    expect(kind('words').textContent).toBe('Words8');
    expect(kind('picture').textContent).toBe('Picture1');
    expect(kind('scenes').textContent).toBe('Scenes1');
  });

  it('All pins the next of each kind, however dense the words are', () => {
    setup();
    const rows = screen.getAllByTestId('filter-rail-next');
    expect(rows.map((r) => r.dataset.group)).toEqual(['words', 'picture', 'scenes']);
    expect(rows[0].textContent).toMatch(/word 0/);
    expect(rows[0].textContent).toMatch(/7 more after it/);
    expect(rows[1].textContent).toMatch(/billboard/);
    expect(rows[2].textContent).toMatch(/Violence scene/);
    expect(rows[2].textContent).toMatch(/in 14:10/);
  });

  it('All says when a kind has nothing left, and when a film has none of it', () => {
    setup({}, 1000);
    const none = screen.getAllByTestId('filter-rail-none');
    expect(none.map((n) => n.textContent)).toEqual([
      'No more muted words from here.', 'No more blurred moments from here.', 'No more skipped or hidden parts from here.',
    ]);
    act(() => previewStore.publish({ cues: WORDS }));
    expect(screen.getAllByTestId('filter-rail-none').find((n) => n.dataset.group === 'picture').textContent).toBe('No blurred moments in this film.');
  });

  it('shows the last fired item and replays it', () => {
    const spy = vi.spyOn(previewStore, 'replayLast');
    setup({ lastFired: { id: 'w0', label: 'word 0', effect: 'mute', in: 60 } });
    expect(screen.getByText('Muted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /replay last/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('Words lists the next five words only; Show all lists the whole film in order', () => {
    setup({}, 75);
    fireEvent.click(kind('words'));
    const rows = screen.getAllByTestId('filter-rail-next');
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.dataset.group === 'words')).toBe(true);
    expect(rows[0].textContent).toMatch(/word 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8 in film order' }));
    const all = within(screen.getByTestId('filter-rail-all')).getAllByRole('button');
    expect(all).toHaveLength(8);
    expect(all[0].className).toMatch(/is-past/);
    expect(all[7].className).not.toMatch(/is-past/);
  });

  it('Picture shows one row for a blur tracked in many pieces', () => {
    setup();
    fireEvent.click(kind('picture'));
    const rows = screen.getAllByTestId('filter-rail-next');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/Blurred, Language: profanity/);
  });

  it('a kind with none in the film says so and leads to Settings', () => {
    setup({ cues: WORDS });
    fireEvent.click(kind('picture'));
    expect(screen.getByText(/Nothing on screen is blurred in this film/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByTestId('settings-panel')).toBeTruthy();
  });

  it('Scenes lists every cut scene with its levels and card status, then the scenes that play', () => {
    setup();
    fireEvent.click(kind('scenes'));
    const cut = screen.getAllByTestId('filter-rail-scene');
    expect(cut).toHaveLength(1);
    expect(cut[0].textContent).toMatch(/Skipped, 15:00 to 16:00, 1 min/);
    expect(cut[0].textContent).toMatch(/Violence: people hurt or killed, mild on screen/);
    expect(within(cut[0]).getByTestId('filter-rail-card-status').textContent).toBe('Card drafted, not approved');
    expect(cut[0].textContent).toMatch(/Biff gets what he deserves/);
    const shown = within(screen.getByTestId('filter-rail-shown')).getAllByRole('button');
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toMatch(/Sexual content scene/);
    expect(shown[0].textContent).toMatch(/flirting or kissing/);
  });

  it('Approve card in the scenes list PUTs the drafted text and refreshes', async () => {
    DaylightAPI.mockResolvedValue({ ruling: {} });
    setup();
    fireEvent.click(kind('scenes'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve card' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/scenes/sc-a', { card: { approve: true, text: 'Biff gets what he deserves.' } }, 'PUT');
  });

  it('an approved card reads as approved, with no Approve button', () => {
    setup({ override: { sceneOverrides: { 'sc-a': { card: { text: 'Done.' } } } } });
    fireEvent.click(kind('scenes'));
    expect(screen.getByTestId('filter-rail-card-status').textContent).toBe('Card approved');
    expect(screen.queryByRole('button', { name: 'Approve card' })).toBeNull();
  });

  it('a scene with no card offers Draft card', async () => {
    DaylightAPI.mockResolvedValue({ card: { text: 'x' } });
    setup({ scenes: [{ ...SCENES[0], card: undefined }, SCENES[1]] });
    fireEvent.click(kind('scenes'));
    fireEvent.click(screen.getByRole('button', { name: 'Draft card' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/scenes/sc-a/card', {}, 'POST');
  });

  it('choosing a scene that plays selects it so it can be cut', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    setup();
    fireEvent.click(kind('scenes'));
    fireEvent.click(within(screen.getByTestId('filter-rail-shown')).getByRole('button'));
    expect(previewStore.getSnapshot().selected).toEqual({ id: 'sc-b', kind: 'scene', in: 1500 });
    expect(jump).toHaveBeenCalledWith({ in: 1500 });
    const block = screen.getByTestId('filter-rail-selected');
    expect(block.textContent).toMatch(/The scene plays/);
    expect(within(block).queryByRole('button', { name: /peek/i })).toBeNull();
    expect(within(block).getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('a chosen row jumps, selects and shows its details; peek uses the base id', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    const peek = vi.spyOn(previewStore, 'peek');
    setup();
    fireEvent.click(screen.getAllByTestId('filter-rail-next')[1]);
    expect(jump).toHaveBeenCalledWith({ in: 400 });
    const block = screen.getByTestId('filter-rail-selected');
    expect(block.textContent).toMatch(/6:40 to 6:41/);
    expect(block.textContent).toMatch(/The picture is blurred/);
    fireEvent.click(within(block).getByRole('button', { name: /peek unfiltered/i }));
    expect(peek).toHaveBeenCalledWith('va9');
    fireEvent.click(within(block).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByTestId('filter-rail-selected')).toBeNull();
  });

  it('a timeline selection (any piece) shows in the selected block and marks its row', () => {
    setup();
    act(() => previewStore.publish({ selected: BLUR[2] }));
    expect(screen.getByTestId('filter-rail-selected').textContent).toMatch(/billboard/);
    expect(screen.getAllByTestId('filter-rail-next')[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('Find matches censored words by their letters and descriptions across the film', () => {
    setup({}, 5000);
    fireEvent.change(screen.getByPlaceholderText('Find a word or moment'), { target: { value: 'hell' } });
    let found = within(screen.getByTestId('filter-rail-found')).getAllByRole('button');
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toMatch(/h\*ll/);
    fireEvent.change(screen.getByPlaceholderText('Find a word or moment'), { target: { value: 'billboard' } });
    found = within(screen.getByTestId('filter-rail-found')).getAllByRole('button');
    expect(found).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('Find a word or moment'), { target: { value: 'zebra' } });
    expect(screen.getByText(/Nothing the filter changes matches "zebra"/)).toBeTruthy();
  });

  it('labels a scene piece with no label by its groups', () => {
    setup({ lastFired: { id: 's1', effect: 'blur', in: 100, scene: 'sc1' } });
    expect(screen.getAllByText('Scene blurred').length).toBeGreaterThan(0);
  });
});

describe('FilterRail tabs', () => {
  beforeEach(() => { act(() => previewStore.reset()); });
  it('switches between Review and Settings', () => {
    setup();
    expect(screen.queryByTestId('settings-panel')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByTestId('settings-panel')).toBeTruthy();
    expect(screen.queryByText('Just filtered')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('Just filtered')).toBeTruthy();
  });
});
