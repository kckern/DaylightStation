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

describe('RowEditor (the part card)', () => {
  beforeEach(() => { calls.length = 0; fail = null; vi.restoreAllMocks(); });
  it('a shown row offers no Mute or Bleep', () => {
    show(shown);
    expect(screen.queryByRole('button', { name: /^Mute/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Bleep/ })).toBeNull();
    expect(btn('Blur')).toBeTruthy();
  });
  it('says where the part sits; Prev / Next step through the handlers', () => {
    const handlers = { prev: vi.fn(), next: vi.fn() };
    show(word, { position: { index: 4, total: 17 }, handlers });
    expect(screen.getByText(/Part 5 of 17/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next part' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous part' }));
    expect(handlers.next).toHaveBeenCalled(); expect(handlers.prev).toHaveBeenCalled();
  });
  it('every action button carries its key; verdicts and effects go through the station', () => {
    const handlers = { verdict: vi.fn(), effect: vi.fn(), refine: vi.fn() };
    show(word, { handlers });
    fireEvent.click(btn('Approve')); fireEvent.click(btn('Let it play')); fireEvent.click(btn('Redo'));
    expect(handlers.verdict.mock.calls.map((c) => c[0])).toEqual(['approve', 'remove', 'redo']);
    fireEvent.click(btn('Bleep'));
    expect(handlers.effect).toHaveBeenCalledWith('p');
    const kbds = [...document.querySelectorAll('.cf-card-part button kbd')].map((n) => n.textContent);
    expect(kbds).toEqual(expect.arrayContaining(['A', 'X', 'D', 'M', 'P', 'K', 'O', 'R']));
  });
  it('a word skipped for being long on rough timing says why, and Refine this part is the primary action', () => {
    const handlers = { refine: vi.fn() };
    show(skippedWord, { handlers });
    expect(screen.getByText(/Rough timing makes this a 6.0 s part, too long to bleep/)).toBeTruthy();
    expect(btn('Mute')).toBeTruthy(); expect(btn('Bleep')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Hide picture/ })).toBeNull();
    fireEvent.click(btn('Refine this part'));
    expect(handlers.refine).toHaveBeenCalled();
  });
  it('a part being refined shows its state instead of the button', () => {
    show(skippedWord, { refineState: { state: 'Refining…' } });
    expect(screen.getByText('Refining…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Refine this part/ })).toBeNull();
  });
  it('Start here / End here take the player time and Save posts the nudge', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValueOnce(70.1).mockReturnValueOnce(70.8);
    const onChanged = show(word);
    fireEvent.click(screen.getByRole('button', { name: 'Start here' }));
    fireEvent.click(screen.getByRole('button', { name: 'End here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { nudge: { in: 70.1, out: 70.8 } }, method: 'PUT' });
    expect(onChanged).toHaveBeenCalled();
  });
  it('Settings puts the part back on the household settings', async () => {
    show(word);
    fireEvent.click(btn('Settings'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { effect: 'profile', disabled: false }, method: 'PUT' });
  });
  it('a refused write shows its message and does not reload', async () => {
    fail = 'A filter run is writing this film. Effects and timing can change when it finishes.';
    const onChanged = show(word);
    fireEvent.click(btn('Settings'));
    expect(await screen.findByText(/Effects and timing can change when it finishes/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('the word ruling, under More for this word, writes this film\'s word setting', async () => {
    show(word);
    fireEvent.click(screen.getByText(/More for this word/));
    fireEvent.click(screen.getByRole('radio', { name: 'Bleep this word', hidden: true }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/words/damn', body: { value: 'bleep' }, method: 'PUT' });
  });
  it('effects and timing are disabled while a run holds the film; the verdicts are not', () => {
    show(word, { busyText: 'A run holds this film: effects and timing can change when it finishes.' });
    expect(screen.getByText(/A run holds this film/)).toBeTruthy();
    expect(btn('Mute').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save timing' }).disabled).toBe(true);
  });
  it('a part that plays under the settings reads Settings (plays) and offers no Refine', () => {
    show({ ...word, acts: false, why: 'settings', effect: 'off' });
    expect(btn('Settings \\(plays\\)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Refine/ })).toBeNull();
    expect(screen.getByText(/your settings let this kind of part play/)).toBeTruthy();
  });
});

describe('RowEditor states', () => {
  beforeEach(() => { calls.length = 0; });
  it('the word control shows this film\'s ruling for the word', () => {
    show(word, { wordRulings: { damn: 'bleep' } });
    fireEvent.click(screen.getByText(/More for this word/));
    expect(screen.getByRole('radio', { name: 'Bleep this word', hidden: true }).checked).toBe(true);
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
