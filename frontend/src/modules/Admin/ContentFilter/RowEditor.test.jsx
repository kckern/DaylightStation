import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

const calls = [];
let fail = null;
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); if (fail) { const e = new Error(fail); fail = null; throw e; } return {}; },
}));
const { RowEditor } = await import('./RowEditor.jsx');
const { SignOffPanel } = await import('./SignOffPanel.jsx');

const word = { id: 'cue:w1', peekId: 'w1', members: ['w1'], kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 70.2, out: 70.6, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null };
const shown = { id: 'cue:v1', peekId: 'v1', members: ['v1'], kind: 'picture', group: 'sex_any', label: 'Billboard', modality: 'shown', in: 50, out: 58, effect: 'blur', card: null, handFixed: false, unsure: [], reviewed: null };
const show = (row, extra = {}) => { const onChanged = vi.fn(); render(<MantineProvider><RowEditor ratingKey="77" row={row} onChanged={onChanged} {...extra} /></MantineProvider>); return onChanged; };

const skippedWord = { id: 'cue:l1', peekId: 'l1', members: ['l1'], kind: 'scenes', group: 'blasphemy', label: 'L*rd', modality: 'said', in: 2664, out: 2670, effect: 'skip-card', card: null, handFixed: false, unsure: ['exchange-by-length'], timing: 'rough', reviewed: null };
beforeEach(() => { calls.length = 0; fail = null; });
const btn = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
// The effects live in a menu on the effect button (Fable design 2026-11-22).
const openEffects = async () => { fireEvent.click(screen.getByRole('button', { name: /^Effect:/ })); return screen.findByRole('menu'); };
// An effect item reads "Mute M"; the word rulings below it read "Mute this word", so match the key too.
const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}( [A-Z])?$`) });

describe('RowEditor (the part card)', () => {
  beforeEach(() => { calls.length = 0; fail = null; vi.restoreAllMocks(); });
  it('the timing chip is neutral text with a coloured icon', () => {
    show({ ...word, timing: 'refined', unsure: [] });
    const chip = screen.getByText('Refined').closest('.cf-card-part__chip');
    expect(chip.querySelector('.cf-ico--timing.is-refined')).toBeTruthy();
    expect(screen.getByText('Refined').className).toContain('cf-card-part__chiptext');
  });
  it('a word refine did not find is never a green "Safe window": amber, in words, with a quiet Refine again', () => {
    show({ ...word, timing: 'safe-window', unsure: ['refine-giveup', 'safe-window'] });
    expect(screen.queryByText('Safe window')).toBeNull();
    const chip = screen.getByText('Word not found').closest('[data-timing]');
    expect(chip.getAttribute('data-timing')).toBe('unsure');
    expect(chip.querySelector('.cf-ico--timing.is-unsure')).toBeTruthy();
    expect(screen.getByText(/Refine could not find this word/)).toBeTruthy();
    expect(btn('Refine again').getAttribute('data-variant')).toBe('subtle');
  });
  it('a rough part refine already tried offers a quiet "Refine again", not a filled Refine', () => {
    show({ ...shown, timing: 'rough', unsure: ['refine-coarse-edges'] });
    expect(screen.getByText(/Refine couldn't pin this; drag the handles to fit it by eye/)).toBeTruthy();
    expect(btn('Refine again').getAttribute('data-variant')).toBe('subtle');
  });
  it('a rough part not refined yet gets the light Refine', () => {
    show({ ...shown, timing: 'rough', unsure: [] });
    expect(btn('Refine R').getAttribute('data-variant')).toBe('light');
  });
  it('the timing row carries no timecode readout (it changed width and shook the strip)', () => {
    show(word, { position: { index: 0, total: 3 } });
    expect(screen.queryByText(/1:10\.20–1:10\.60/)).toBeNull();
    expect(screen.getByLabelText('Part 1 of 3').textContent).toBe('1/3');
  });
  it('on the Refine tab the card has no verdict buttons', () => {
    show(word, { stage: 'refine' });
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.getByText(/Verdicts are given on the Review tab/)).toBeTruthy();
  });
  it('a shown row offers no Mute or Bleep in its effect menu', async () => {
    show(shown);
    await openEffects();
    expect(screen.queryByRole('menuitem', { name: /^Mute/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Bleep/ })).toBeNull();
    expect(item('Blur')).toBeTruthy();
  });
  it('says where the part sits; ‹ › step through the handlers', () => {
    const handlers = { prev: vi.fn(), next: vi.fn() };
    show(word, { position: { index: 4, total: 17 }, handlers });
    expect(screen.getByLabelText('Part 5 of 17').textContent).toBe('5/17');
    fireEvent.click(screen.getByRole('button', { name: 'Next part' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous part' }));
    expect(handlers.next).toHaveBeenCalled(); expect(handlers.prev).toHaveBeenCalled();
  });
  it('every button carries its key; verdicts, effects and the three ways to play go through the station', async () => {
    const handlers = { verdict: vi.fn(), effect: vi.fn(), refine: vi.fn(), togglePlay: vi.fn(), replay: vi.fn(), playWithout: vi.fn() };
    show(word, { handlers });
    fireEvent.click(btn('Approve')); fireEvent.click(btn('Let it play')); fireEvent.click(btn('Redo'));
    expect(handlers.verdict.mock.calls.map((c) => c[0])).toEqual(['approve', 'remove', 'redo']);
    fireEvent.click(btn('Play or pause')); fireEvent.click(btn('Filtered')); fireEvent.click(btn('Unfiltered'));
    expect(handlers.togglePlay).toHaveBeenCalled(); expect(handlers.replay).toHaveBeenCalled(); expect(handlers.playWithout).toHaveBeenCalled();
    const kbds = [...document.querySelectorAll('.cf-card-part button kbd')].map((n) => n.textContent);
    expect(kbds).toEqual(expect.arrayContaining(['E', 'A', 'X', 'D', 'W', 'Space', 'R']));
    await openEffects();
    const menuKeys = [...document.querySelectorAll('[role="menu"] kbd')].map((n) => n.textContent);
    expect(menuKeys).toEqual(expect.arrayContaining(['M', 'P', 'K', 'F']));
    fireEvent.click(item('Bleep'));
    expect(handlers.effect).toHaveBeenCalledWith('p');
  });
  it('the effect menu checks the effect the part has now', async () => {
    show(word);
    await openEffects();
    expect(item('Mute').getAttribute('aria-checked')).toBe('true');
    expect(item('Bleep').getAttribute('aria-checked')).toBe('false');
  });
  it('the Blur item says when it plays as the whole picture or hidden', async () => {
    const long = { ...shown, tracked: false, in: 3801.6, out: 3840.2 };
    const { unmount } = render(<MantineProvider><RowEditor ratingKey="77" row={long} maxHideSec={20} /></MantineProvider>);
    await openEffects();
    expect(item('Blur · plays as hide picture \\(not tracked, 39 s\\)')).toBeTruthy();
    unmount(); cleanup();
    render(<MantineProvider><RowEditor ratingKey="77" row={{ ...long, out: 3810 }} maxHideSec={20} /></MantineProvider>);
    await openEffects();
    expect(item('Blur · whole picture \\(not tracked\\)')).toBeTruthy();
    cleanup();
    render(<MantineProvider><RowEditor ratingKey="77" row={{ ...long, tracked: true }} maxHideSec={20} /></MantineProvider>);
    await openEffects();
    expect(item('Blur')).toBeTruthy();
  });
  it('a word skipped for being long on rough timing says why, and Refine is the primary action', async () => {
    const handlers = { refine: vi.fn() };
    show(skippedWord, { handlers });
    expect(screen.getByText(/Rough timing makes this a 6.0 s part, too long to bleep/)).toBeTruthy();
    fireEvent.click(btn('Refine R'));
    expect(handlers.refine).toHaveBeenCalled();
    await openEffects();
    expect(item('Mute')).toBeTruthy(); expect(item('Bleep')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Hide picture/ })).toBeNull();
  });
  it('a part being refined shows its state instead of the button', () => {
    show(skippedWord, { refineState: { state: 'Refining…' } });
    expect(screen.getByText('Refining…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Refine/ })).toBeNull();
  });
  it('Home on the start handle and End on the end handle take the player time, and the nudge saves itself', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(null);
    const onChanged = show(word);
    expect(screen.queryByRole('button', { name: /^Save timing/ })).toBeNull();
    previewStore.currentTime.mockReturnValue(70.1);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start' }), { key: 'Home' });
    previewStore.currentTime.mockReturnValue(70.8);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End' }), { key: 'End' });
    expect(screen.getByRole('slider', { name: 'End' }).getAttribute('aria-valuetext')).toBe('1:10.80');
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { nudge: { in: 70.1, out: 70.8 } }, method: 'PUT' });
    expect(onChanged).toHaveBeenCalled();
  });
  it('dragging a neighbour too saves both timings together, with no Save press', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(71.4);
    const near = { ...word, id: 'cue:w2', peekId: 'w2', members: ['w2'], label: 'heck', in: 71.0, out: 71.5 };
    show(word, { neighbours: [word, near] });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'heck: End' }), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End' }), { key: 'ArrowRight' });
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 3000 });
    expect(calls.map((c) => c.path).sort()).toEqual(['api/v1/content-filter/77/cues/w1', 'api/v1/content-filter/77/cues/w2']);
    expect(calls.find((c) => c.path.endsWith('w2')).body).toEqual({ nudge: { in: 71, out: 71.4 } });
  });
  it('Use household settings puts the part back on the household settings', async () => {
    show(word);
    await openEffects();
    fireEvent.click(item('Use household settings'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { effect: 'profile', disabled: false }, method: 'PUT' });
  });
  it('a refused write shows its message and does not reload', async () => {
    fail = 'A filter run is writing this film. Effects and timing can change when it finishes.';
    const onChanged = show(word);
    await openEffects();
    fireEvent.click(item('Use household settings'));
    expect(await screen.findByText(/Effects and timing can change when it finishes/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('the word ruling, under More for this word, writes this film\'s word setting', async () => {
    show(word);
    await openEffects();
    fireEvent.click(screen.getByRole('menuitem', { name: 'More for this word…' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Bleep', hidden: true }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/words/damn', body: { value: 'bleep' }, method: 'PUT' });
  });
  it('effects and timing are disabled while a run holds the film; the verdicts are not', () => {
    show(word, { busyText: 'A run holds this film: effects and timing can change when it finishes.' });
    expect(screen.getByText(/A run holds this film/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Effect:/ }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Save timing/ })).toBeNull();
    expect(btn('Approve').disabled).toBe(false);
  });
  it('a part that plays under the settings reads Plays, offers no Refine, no verdicts and no timing', () => {
    show({ ...word, acts: false, why: 'settings', effect: 'off' });
    expect(screen.getByRole('button', { name: /^Effect: Plays/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Refine/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Start' })).toBeNull();
    expect(screen.getByText(/your settings let this kind of part play/)).toBeTruthy();
  });
});

describe('RowEditor states', () => {
  beforeEach(() => { calls.length = 0; });
  it('the word control shows this film\'s ruling for the word', async () => {
    show(word, { wordRulings: { damn: 'bleep' } });
    await openEffects();
    fireEvent.click(screen.getByRole('menuitem', { name: 'More for this word…' }));
    expect((await screen.findByRole('radio', { name: 'Bleep', hidden: true })).checked).toBe(true);
  });
});

describe('SignOffPanel', () => {
  beforeEach(() => { calls.length = 0; });
  it('lists what is missing; approving is the status card\'s (no button here, no stage dropdown)', () => {
    render(<MantineProvider><SignOffPanel signOff={{ ready: false, missing: ['3 of 9 parts not reviewed'], parent: null }} approval={{}} /></MantineProvider>);
    expect(screen.getByText('3 of 9 parts not reviewed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve for family' })).toBeNull();
    expect(screen.queryByText('Stage again')).toBeNull();
  });
  it('offers Withdraw once approved and delegates it to the approval owner', () => {
    const submit = vi.fn();
    render(<MantineProvider><SignOffPanel signOff={{ ready: false, missing: [], parent: { by: 'p', at: 'x' } }} approval={{ submit }} /></MantineProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw approval' }));
    expect(submit).toHaveBeenCalledWith('withdraw');
  });
});

describe('the effect menu stays short (review 2026-11-22)', () => {
  it('lists the effects, one settings item, and the word rulings behind one item', async () => {
    show(word);
    await openEffects();
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent.trim());
    expect(items).toEqual(['MuteM', 'BleepP', 'SkipK', 'Let it play (off)F', 'Use household settings', 'More for this word…']);
  });
  it('a letter in the open menu picks that effect and closes it', async () => {
    const handlers = { effect: vi.fn() };
    show(word, { handlers });
    const menu = await openEffects();
    fireEvent.keyDown(menu, { key: 'p' });
    expect(handlers.effect).toHaveBeenCalledWith('p');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('button hierarchy on the part card (2026-11-22)', () => {
  const variant = (n) => btn(n).getAttribute('data-variant');
  it('only Approve is filled; Let it play and Redo are outlined', () => {
    show(word);
    expect(variant('Approve')).toBe('filled');
    expect(variant('Let it play')).toBe('outline');
    expect(variant('Redo')).toBe('outline');
  });
  it('a chosen verdict shows a check and a ring, and Approve is no longer filled', () => {
    show({ ...word, verdict: { verdict: 'remove' } });
    const chosen = btn('Let it play');
    expect(chosen.className).toContain('is-chosen');
    expect(chosen.querySelector('svg')).toBeTruthy();
    expect(variant('Approve')).toBe('outline');
    expect(btn('Redo').className).not.toContain('is-chosen');
  });
  it('Refine is a quiet tool, light only when refining is the fix', () => {
    show(skippedWord);
    expect(variant('Refine')).toBe('light');
    cleanup();
    show({ ...skippedWord, timing: 'refined' });
    expect(variant('Refine again')).toBe('subtle');
  });
  it('a draft shows Saving… and writes itself after a pause; there is no Save button', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(70.0);
    const ports = { current: {} };
    show(word, { ports });
    act(() => ports.current.markIn());
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/Saving/);
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(calls).toHaveLength(0);
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls[0].body).toEqual({ nudge: { in: 70, out: 70.6 } });
  });
  it('waits for the pointer to let go before saving a drag', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(70.1);
    show(word);
    const start = screen.getByRole('slider', { name: 'Start' });
    fireEvent.keyDown(start, { key: 'Home' });
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls).toHaveLength(1);
  });
  it('a refused autosave shows its message and does not retry the same draft', async () => {
    fail = 'A filter run is writing this film.';
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(70.1);
    show(word);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start' }), { key: 'Home' });
    expect(await screen.findByText(/A filter run is writing this film/, {}, { timeout: 3000 })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 900));
    expect(calls).toHaveLength(1);
  });
  it('Undo puts back what the last autosave replaced: the measured timing when there was no hand fix', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(70.1);
    const { rerender } = render(<MantineProvider><RowEditor ratingKey="77" row={word} onChanged={() => {}} /></MantineProvider>);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start' }), { key: 'Home' });
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    // the film refreshes the row to the saved timing
    rerender(<MantineProvider><RowEditor ratingKey="77" row={{ ...word, in: 70.1, handFixed: true }} onChanged={() => {}} /></MantineProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo the last timing change' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { nudge: null }, method: 'PUT' });
  });
  it('Reset is an icon button shown only on a hand-fixed part with no draft', () => {
    show({ ...word, handFixed: true });
    expect(screen.getByRole('button', { name: 'Drop the hand fix' })).toBeTruthy();
    cleanup();
    show(word);
    expect(screen.queryByRole('button', { name: 'Drop the hand fix' })).toBeNull();
  });
});

describe('I and O set the in and out points at the playhead (owner, 2026-11-22)', () => {
  it('mark the start and end of the part in hand as a draft that saves itself', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(70.0);
    const ports = { current: {} };
    show(word, { ports });
    act(() => ports.current.markIn());
    previewStore.currentTime.mockReturnValue(70.9);
    act(() => ports.current.markOut());
    expect(screen.getByRole('slider', { name: 'Start' }).getAttribute('aria-valuenow')).toBe('70');
    expect(screen.getByRole('slider', { name: 'End' }).getAttribute('aria-valuenow')).toBe('70.9');
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });
    expect(calls[0].body).toEqual({ nudge: { in: 70, out: 70.9 } });
  });
  it('an in point past the out point (or an out before the in) is refused with a word, and nothing moves', () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(75);
    const ports = { current: {} };
    show(word, { ports });
    act(() => ports.current.markIn());
    expect(screen.getByText(/after this part's end/)).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Start' }).getAttribute('aria-valuenow')).toBe('70.2');
  });
  it('with no film playing it says so', () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(null);
    const ports = { current: {} };
    show(word, { ports });
    act(() => ports.current.markOut());
    expect(screen.getByText('Play the film first.')).toBeTruthy();
  });
});

describe('a dragged timing plays before it is saved (owner, 2026-11-22)', () => {
  it('publishes every unsaved span to the preview as a draft, and clears them when the card goes', () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(70.0);
    const setDrafts = vi.spyOn(previewStore, 'setDrafts');
    const ports = { current: {} };
    const { unmount } = render(<MantineProvider><RowEditor ratingKey="77" row={word} ports={ports} /></MantineProvider>);
    act(() => ports.current.markIn());
    expect(setDrafts).toHaveBeenLastCalledWith({ w1: [70, 70.6] });
    unmount();
    expect(setDrafts).toHaveBeenLastCalledWith(null);
  });
});


describe('a bleep level for one cue (owner, 2026-11-22: "the global / movie / cue bleep volume")', () => {
  const bleeped = { ...word, effect: 'bleep' };
  beforeEach(() => { calls.length = 0; fail = null; vi.restoreAllMocks(); });
  const openLevel = async () => { await openEffects(); fireEvent.click(screen.getByRole('menuitem', { name: /^Bleep volume for this cue/ })); return screen.findByRole('group', { name: 'Bleep volume for this cue' }); };
  it('the cue level control writes PUT /cues/:id { bleepLevel }', async () => {
    vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    const onChanged = show(bleeped, { filmLevel: 0.4 });
    await openLevel();
    // No level of its own: it follows the film, and a step starts from the film's level.
    expect(screen.getByLabelText('This cue level').textContent).toBe('Follows film (40 %)');
    expect(screen.getByRole('button', { name: 'Follow film' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'This cue louder' }));
    expect(screen.getByLabelText('This cue level').textContent).toBe('45 %');
    fireEvent.click(screen.getByRole('button', { name: 'This cue louder' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      { path: 'api/v1/content-filter/77/cues/w1', body: { bleepLevel: 0.45 }, method: 'PUT' },
      { path: 'api/v1/content-filter/77/cues/w1', body: { bleepLevel: 0.5 }, method: 'PUT' },
    ]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('Follow film writes null; a cue with its own level shows it', async () => {
    vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    show({ ...bleeped, bleepLevel: 0.7 }, { filmLevel: 0.4 });
    await openLevel();
    expect(screen.getByLabelText('This cue level').textContent).toBe('70 %');
    fireEvent.click(screen.getByRole('button', { name: 'This cue quieter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Follow film' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.body)).toEqual([{ bleepLevel: 0.65 }, { bleepLevel: null }]);
    expect(screen.getByLabelText('This cue level').textContent).toBe('Follows film (40 %)');
  });
  it('only a single bleeped cue offers it', async () => {
    show(word, { filmLevel: 0.4 });
    await openEffects();
    expect(screen.queryByRole('menuitem', { name: /^Bleep volume for this cue/ })).toBeNull();
    cleanup();
    show({ ...bleeped, members: ['w1', 'w2'], id: 'subject:x' }, { filmLevel: 0.4 });
    await openEffects();
    expect(screen.queryByRole('menuitem', { name: /^Bleep volume for this cue/ })).toBeNull();
  });
  it('a muted cue that still holds a level offers the control in its effect menu', async () => {
    show({ ...word, effect: 'mute', bleepLevel: 0.7 }, { filmLevel: 0.4 });
    await openEffects();
    expect(screen.getByRole('menuitem', { name: /^Bleep volume for this cue/ })).toBeTruthy();
  });
  it('the port opens it (the part menu item)', async () => {
    const ports = { current: {} };
    show(bleeped, { ports, filmLevel: 0.4 });
    act(() => ports.current.openBleepLevel());
    expect(await screen.findByRole('group', { name: 'Bleep volume for this cue' })).toBeTruthy();
  });
  it('a failed save says so and shows the saved level again', async () => {
    vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    show(bleeped, { filmLevel: 0.4 });
    await openLevel();
    fail = 'nope';
    fireEvent.click(screen.getByRole('button', { name: 'This cue louder' }));
    expect(await screen.findByText('nope')).toBeTruthy();
    expect(screen.getByLabelText('This cue level').textContent).toBe('Follows film (40 %)');
  });
});

describe('the part menu offers the cue bleep level on a single bleeped cue', async () => {
  const { partMenuItems } = await import('./PartMenu.jsx');
  it('a bleep cue has it, a mute or a group does not', () => {
    const has = (r) => partMenuItems(r).effectExtras.some(([, , action]) => action === 'bleep-level');
    expect(has({ ...word, effect: 'bleep' })).toBe(true);
    expect(has(word)).toBe(false);
    expect(has({ ...word, effect: 'bleep', members: ['a', 'b'], id: 'subject:x' })).toBe(false);
  });
  it('a cue holding a level keeps the control after it stops being a bleep, so it can be cleared', () => {
    const has = (r) => partMenuItems(r).effectExtras.some(([, , action]) => action === 'bleep-level');
    expect(has({ ...word, effect: 'mute', bleepLevel: 0.6 })).toBe(true);
    expect(has({ ...word, effect: 'mute', bleepLevel: null })).toBe(false);
  });
});
