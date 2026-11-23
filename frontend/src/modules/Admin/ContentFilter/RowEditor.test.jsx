import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const btn = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
// The effects live in a menu on the effect button (Fable design 2026-11-22).
const openEffects = async () => { fireEvent.click(screen.getByRole('button', { name: /^Effect:/ })); return screen.findByRole('menu'); };
// An effect item reads "Mute M"; the word rulings below it read "Mute this word", so match the key too.
const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}( [A-Z])?$`) });

describe('RowEditor (the part card)', () => {
  beforeEach(() => { calls.length = 0; fail = null; vi.restoreAllMocks(); });
  it('a word refine did not find is never a green "Safe window": amber, in words, with a quiet Refine again', () => {
    show({ ...word, timing: 'safe-window', unsure: ['refine-giveup', 'safe-window'] });
    expect(screen.queryByText('Safe window')).toBeNull();
    const chip = screen.getByText('Word not found').closest('[data-timing]');
    expect(chip.getAttribute('data-timing')).toBe('unsure');
    expect(screen.getByText(/Refine could not find this word/)).toBeTruthy();
    expect(btn('Refine again').getAttribute('data-variant')).toBe('light');
  });
  it('a rough part refine already tried offers a quiet "Refine again", not a filled Refine', () => {
    show({ ...shown, timing: 'rough', unsure: ['refine-coarse-edges'] });
    expect(screen.getByText(/Refine couldn't pin this; drag the handles to fit it by eye/)).toBeTruthy();
    expect(btn('Refine again').getAttribute('data-variant')).toBe('light');
  });
  it('a rough part not refined yet keeps a filled Refine', () => {
    show({ ...shown, timing: 'rough', unsure: [] });
    expect(btn('Refine R').getAttribute('data-variant')).toBe('filled');
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
    expect(kbds).toEqual(expect.arrayContaining(['E', 'A', 'X', 'D', 'W', 'Space', 'S', 'R']));
    await openEffects();
    const menuKeys = [...document.querySelectorAll('[role="menu"] kbd')].map((n) => n.textContent);
    expect(menuKeys).toEqual(expect.arrayContaining(['M', 'P', 'K', 'O']));
    fireEvent.click(item('Bleep'));
    expect(handlers.effect).toHaveBeenCalledWith('p');
  });
  it('the effect menu checks the effect the part has now', async () => {
    show(word);
    await openEffects();
    expect(item('Mute').getAttribute('aria-checked')).toBe('true');
    expect(item('Bleep').getAttribute('aria-checked')).toBe('false');
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
  it('Home on the start handle and End on the end handle take the player time, and Save posts the nudge', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(null);
    const onChanged = show(word);
    expect(btn('Save timing').disabled).toBe(true);
    previewStore.currentTime.mockReturnValue(70.1);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start' }), { key: 'Home' });
    previewStore.currentTime.mockReturnValue(70.8);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End' }), { key: 'End' });
    expect(screen.getByRole('slider', { name: 'End' }).getAttribute('aria-valuetext')).toBe('1:10.80');
    fireEvent.click(btn('Save timing'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { nudge: { in: 70.1, out: 70.8 } }, method: 'PUT' });
    expect(onChanged).toHaveBeenCalled();
  });
  it('dragging a neighbour too saves both timings with one Save', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValue(71.4);
    const near = { ...word, id: 'cue:w2', peekId: 'w2', members: ['w2'], label: 'heck', in: 71.0, out: 71.5 };
    show(word, { neighbours: [word, near] });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'heck: End' }), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End' }), { key: 'ArrowRight' });
    fireEvent.click(btn('Save 2 timings'));
    await waitFor(() => expect(calls).toHaveLength(2));
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
  it('the word ruling, in the effect menu, writes this film\'s word setting', async () => {
    show(word);
    await openEffects();
    fireEvent.click(item('Bleep this word'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/words/damn', body: { value: 'bleep' }, method: 'PUT' });
  });
  it('effects and timing are disabled while a run holds the film; the verdicts are not', () => {
    show(word, { busyText: 'A run holds this film: effects and timing can change when it finishes.' });
    expect(screen.getByText(/A run holds this film/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Effect:/ }).disabled).toBe(true);
    expect(btn('Save timing').disabled).toBe(true);
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
    expect(item('Bleep this word').getAttribute('aria-checked')).toBe('true');
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
