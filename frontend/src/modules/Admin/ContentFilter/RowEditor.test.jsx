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

describe('RowEditor', () => {
  beforeEach(() => { calls.length = 0; fail = null; vi.restoreAllMocks(); });
  it('a shown row offers no Mute or Bleep', () => {
    show(shown);
    expect(screen.queryByRole('radio', { name: 'Mute' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Bleep' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Blur' })).toBeTruthy();
  });
  it('Set start / Set end take the player time and Save posts the nudge', async () => {
    vi.spyOn(previewStore, 'currentTime').mockReturnValueOnce(70.1).mockReturnValueOnce(70.8);
    const onChanged = show(word);
    fireEvent.click(screen.getByRole('button', { name: 'Set start here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set end here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { nudge: { in: 70.1, out: 70.8 } }, method: 'PUT' });
    expect(onChanged).toHaveBeenCalled();
  });
  it('Send back posts the row\'s cue ids', async () => {
    show(word);
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/jobs', body: { kind: 'send-back', cues: ['w1'] }, method: 'POST' });
  });
  it('Mark reviewed posts the row span', async () => {
    show(word);
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/review/cue%3Aw1', body: { span: [70.2, 70.6] }, method: 'PUT' });
  });
  it('a refused write shows its message and does not reload', async () => {
    fail = 'This part moved. Reload the list.';
    const onChanged = show(word);
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText('This part moved. Reload the list.')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('the word ruling writes this film\'s word setting', async () => {
    show(word);
    fireEvent.click(screen.getByRole('radio', { name: 'Bleep this word' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/words/damn', body: { value: 'bleep' }, method: 'PUT' });
  });
  it('everything is disabled while a run writes the film', () => {
    show(word, { busyText: 'Running: refine' });
    expect(screen.getByText('Running: refine')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark reviewed' }).disabled).toBe(true);
  });
});

describe('RowEditor states', () => {
  beforeEach(() => { calls.length = 0; });
  it('Mark reviewed waits for a current audit', () => {
    show(word, { auditFresh: false });
    expect(screen.getByRole('button', { name: 'Mark reviewed' }).disabled).toBe(true);
    expect(screen.getByText('Mark reviewed once the audit is current.')).toBeTruthy();
  });
  it('the word control shows this film\'s ruling for the word', () => {
    show(word, { wordRulings: { damn: 'bleep' } });
    expect(screen.getByRole('radio', { name: 'Bleep this word' }).checked).toBe(true);
  });
});

describe('SignOffPanel', () => {
  beforeEach(() => { calls.length = 0; });
  it('lists what is missing and keeps Approve disabled', () => {
    render(<MantineProvider><SignOffPanel ratingKey="77" signOff={{ ready: false, missing: ['3 of 9 parts not reviewed'], parent: null }} onChanged={() => {}} /></MantineProvider>);
    expect(screen.getByText('3 of 9 parts not reviewed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve for family' }).disabled).toBe(true);
  });
  it('posts the sign-off only when ready, and offers Withdraw once approved', async () => {
    const { unmount } = render(<MantineProvider><SignOffPanel ratingKey="77" signOff={{ ready: true, missing: [], parent: null }} onChanged={() => {}} /></MantineProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Approve for family' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/signoff', body: {}, method: 'POST' });
    unmount();
    render(<MantineProvider><SignOffPanel ratingKey="77" signOff={{ ready: false, missing: [], parent: { by: 'p', at: 'x' } }} onChanged={() => {}} /></MantineProvider>);
    expect(screen.getByRole('button', { name: 'Withdraw approval' })).toBeTruthy();
  });
});
