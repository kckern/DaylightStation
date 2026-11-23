import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { clearToken, setToken } from '../../../lib/auth.js';

const calls = [];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(), child: () => log };
// The mocked server: a reload re-serves `payload`, which effect writes have updated (as the audit
// does once it catches up), so a held effect settles the way it does for real.
let rerender = () => {};
let deferRerender = false;
const reload = vi.fn(async () => { if (deferRerender) return; payload = { ...payload }; rerender(); });
let payload;
let failNext = null;
let pendingWrite;
let ignoreEffects = false;
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => log }));
const React = await import('react');
vi.mock('../../../lib/hooks/useApiResource.js', () => ({
  useApiResource: () => {
    const [, setN] = React.useState(0);
    rerender = () => setN((n) => n + 1);
    return { data: payload, loading: false, error: null, reload, refresh: reload };
  },
  invalidateApiResources: vi.fn(),
}));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => {
  calls.push({ path, body, method });
  if (failNext && failNext(path, method)) throw new Error('nope');
  const cue = /\/cues\/([^/]+)$/.exec(path);
  if (!ignoreEffects && method === 'PUT' && cue && body?.effect && body.effect !== 'profile') {
    payload = { ...payload, rows: payload.rows.map((r) => (r.members?.includes(cue[1]) ? { ...r, effect: body.effect, acts: true } : r)) };
  }
  return pendingWrite ?? {};
} }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
let toneLevels = [];
vi.mock('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs', async (orig) => ({
  ...(await orig()),
  createBleepTone: ({ level }) => ({ start: () => { toneLevels.push(level); return true; }, stop: () => {} }),
}));
const { previewStore } = await import('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs');
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const { resetWriteQueues } = await import('./effectHolds.js');

const row = (id, label, over = {}) => ({ id, peekId: id.split(':')[1], members: [id.split(':')[1]], kind: 'words', group: 'profanity', label, modality: 'said', in: 10, out: 10.5, effect: 'bleep', card: null, handFixed: false, unsure: [], reviewed: null, verdict: null, ...over });
const base = (rows) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true }, wordRulings: {}, rows,
  reviewed: rows.filter((r) => r.reviewed).length, total: rows.length, job: null, signOff: { ready: false, missing: [], parent: null } });
const three = () => base([row('cue:w1', 'alpha', { in: 10, out: 10.5 }), row('cue:w2', 'bravo', { in: 20, out: 20.5 }), row('subject:p1', 'poster', { kind: 'picture', modality: 'shown', effect: 'blur', in: 30, out: 34, members: ['p1'] })]);
function FilmNavigation() {
  const { pathname } = useLocation();
  return <><Link to="/admin/content/filter/88">Next film</Link><Link to="/admin/content/filter/77">Previous film</Link><span aria-label="Review path">{pathname}</span></>;
}
const show = (path = '/admin/content/filter/77') => render(<MantineProvider><MemoryRouter initialEntries={[path]}><FilmNavigation /><Routes><Route path="/admin/content/filter/:ratingKey/:rowId?" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
const press = (key, init = {}, target = document.body) => fireEvent.keyDown(target, { key, ...init });
const selected = () => document.querySelector('.is-selected')?.getAttribute('data-row-id') ?? null;
const cardFx = (name) => within(document.querySelector('.cf-card-part')).getByRole('button', { name });
const reviewCalls = () => calls.filter((c) => c.path.includes('/review/'));
const verdictLogs = () => log.info.mock.calls.filter((c) => c[0] === 'content_filter.review.verdict');

beforeEach(() => { resetWriteQueues(); toneLevels = []; calls.length = 0; vi.clearAllMocks(); failNext = null; pendingWrite = null; ignoreEffects = false; deferRerender = false; previewStore.reset(); payload = three(); });

describe('review station keys', () => {
  it('arrow keys move the cursor, seek 4 s ahead of it, and log it', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    // Arriving, the first part still to review is already in hand.
    expect(selected()).toBe('cue:w1');
    press('ArrowRight'); expect(selected()).toBe('cue:w2');
    expect(jump).toHaveBeenLastCalledWith({ in: 20 });
    press('ArrowLeft'); expect(selected()).toBe('cue:w1');
    expect(log.debug).toHaveBeenCalledWith('content_filter.review.cursor', expect.objectContaining({ rk: '77', rowId: 'cue:w2', via: 'key' }));
  });
  it('keys work while the video element has focus (Review Focus 1)', () => {
    show();
    const video = document.createElement('video'); video.tabIndex = 0; document.body.appendChild(video); video.focus();
    fireEvent.keyDown(video, { key: 'ArrowRight' });
    expect(selected()).toBe('cue:w2');
    video.remove();
  });
  it('A approves the row with span, dwell and replays, then auto-advances to the next without a verdict', async () => {
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    show();
    now = 4200; press('Enter'); press('Enter'); now = 6000;
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0]).toEqual({ path: 'api/v1/content-filter/77/review/cue%3Aw1', method: 'PUT',
      body: expect.objectContaining({ span: [10, 10.5], verdict: 'approve', dwellMs: 5000, replays: 2 }) });
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    expect(reload).toHaveBeenCalled();
    expect(verdictLogs()[0][1]).toEqual(expect.objectContaining({ rk: '77', rowId: 'cue:w1', kind: 'words', category: 'profanity', effect: 'bleep', verdict: 'approve', dwellMs: 5000, replays: 2 }));
  });
  it('auto-advance skips rows that already have a verdict (a verdict cleared by a moved span is open again)', async () => {
    payload = base([row('cue:w1', 'alpha'), row('cue:w2', 'bravo', { verdict: { verdict: 'approve' }, reviewed: { by: 'x' } }), row('cue:w3', 'charlie')]);
    show(); press('a');
    await waitFor(() => expect(selected()).toBe('cue:w3'));
  });
  it('X lets the part play (remove), D then a number is a redo with its reason', async () => {
    show(); press('x');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0].body.verdict).toBe('remove');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    press('d'); expect(document.querySelector('[data-key="1"]')).toBeTruthy(); press('3');
    await waitFor(() => expect(reviewCalls()).toHaveLength(2));
    expect(reviewCalls()[1].body).toEqual(expect.objectContaining({ verdict: 'redo', reason: 'action' }));
  });
  it('discards a redo reason when selection changes and accepts a fresh reason on the new row', async () => {
    let finish;
    pendingWrite = new Promise(resolve => { finish = resolve; });
    show();
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    press('d');
    expect(document.querySelector('[data-key="1"]')).toBeTruthy();

    await act(async () => { finish({}); });
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    press('3');
    expect(reviewCalls()).toHaveLength(1);

    press('d'); press('3');
    await waitFor(() => expect(reviewCalls()).toHaveLength(2));
    expect(reviewCalls()[1]).toEqual(expect.objectContaining({
      path: 'api/v1/content-filter/77/review/cue%3Aw2',
      body: expect.objectContaining({ verdict: 'redo', reason: 'action' }),
    }));
  });
  it('I and Tab are not review keys any more', async () => {
    show(); press('i'); press('Tab');
    await new Promise((r) => setTimeout(r, 20));
    expect(reviewCalls()).toHaveLength(0); expect(selected()).toBe('cue:w1');
  });
  it('Space plays and pauses the film, even with a button focused; Enter replays the part; W plays it without', () => {
    const toggle = vi.spyOn(previewStore, 'togglePlay');
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    const peek = vi.spyOn(previewStore, 'peek');
    show();
    press(' ');
    expect(toggle).toHaveBeenCalledTimes(1);
    const btn = screen.getByRole('button', { name: 'Next part' }); btn.focus();
    const notPrevented = fireEvent.keyDown(btn, { key: ' ' });
    expect(notPrevented).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(selected()).toBe('cue:w1');
    press('Enter'); expect(jump).toHaveBeenLastCalledWith({ in: 10 });
    press('w'); expect(peek).toHaveBeenCalledWith('w1');
  });
  it('an effect key applies the effect, replays the part with it, and records no verdict: the part waits for A', async () => {
    const refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show(); jump.mockClear(); press('m');
    await waitFor(() => expect(jump).toHaveBeenCalledWith({ in: 10 }));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT api/v1/content-filter/77/cues/w1']);
    expect(calls[0].body).toEqual({ effect: 'mute' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalled();
    // No verdict, no advance: the same part is in hand, and the card says what to do next.
    expect(reviewCalls()).toHaveLength(0);
    expect(selected()).toBe('cue:w1');
    expect(screen.getByText('Mute applied. Watch it, then press A to approve.')).toBeTruthy();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.effect', expect.objectContaining({ rk: '77', rowId: 'cue:w1', from: 'bleep', to: 'mute' }));
    // The verdict waits for the audit to confirm the effect.
    await waitFor(() => expect(log.info).toHaveBeenCalledWith('content_filter.review.effect_settled', expect.objectContaining({ rowId: 'cue:w1', to: 'mute' })));
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0].body).toEqual(expect.objectContaining({ verdict: 'approve' }));
    refresh.mockRestore();
  });
  it('an effect shows on the card at once, and a second click while the first save is out is queued, not dropped (review 2026-11-23)', async () => {
    let finish;
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    show();
    press('m');
    // Before the server answers, the card already says Mute.
    await waitFor(() => expect(cardFx(/^Effect: Mute/)).toBeTruthy());
    press('k');
    await waitFor(() => expect(cardFx(/^Effect: Skip/)).toBeTruthy());
    expect(calls).toHaveLength(1);
    pendingWrite = null; finish({});
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.body)).toEqual([{ effect: 'mute' }, { effect: 'skip' }]);
    expect(cardFx(/^Effect: Skip/)).toBeTruthy();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.effect', expect.objectContaining({ rowId: 'cue:w1', to: 'skip', waited: true }));
  });
  it('a failed effect save puts the card back on what the server has, and says so', async () => {
    failNext = (path, method) => method === 'PUT' && path.includes('/cues/');
    show(); press('m');
    expect(await screen.findByText('nope')).toBeTruthy();
    expect(cardFx(/^Effect: Bleep/)).toBeTruthy();
  });
  it('A during an effect hold waits for the effect (review 2026-11-23)', async () => {
    let finish;
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    show();
    press('m');
    await waitFor(() => expect(cardFx(/^Effect: Mute/)).toBeTruthy());
    press('a');
    expect(await screen.findByText('Saving the effect: one moment, then approve.')).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(reviewCalls()).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith('content_filter.review.verdict_refused', expect.objectContaining({ rk: '77', rowId: 'cue:w1', reason: 'effect-saving' }));
    pendingWrite = null; finish({});
  });
  it('X and D wait with "try again" while an effect is held', async () => {
    let finish;
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    show();
    press('m');
    await waitFor(() => expect(cardFx(/^Effect: Mute/)).toBeTruthy());
    press('x');
    expect(await screen.findByText('Saving the effect: one moment, then try again.')).toBeTruthy();
    press('d');
    expect(reviewCalls()).toHaveLength(0);
    expect(calls).toHaveLength(1);
    pendingWrite = null; finish({});
  });
  it('an old effect failure does not let a later effect success overwrite a newer message', async () => {
    const refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    let first = true;
    failNext = (path, method) => { if (method === 'PUT' && first) { first = false; return true; } return false; };
    let finish;
    show();
    press('m');
    expect(await screen.findByText('nope')).toBeTruthy();
    // Hold the next save, then a verdict refusal becomes the newest message.
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    press('k');
    await waitFor(() => expect(calls).toHaveLength(2));
    press('a');
    expect(await screen.findByText('Saving the effect: one moment, then approve.')).toBeTruthy();
    pendingWrite = null; finish({});
    await waitFor(() => expect(log.info).toHaveBeenCalledWith('content_filter.review.effect', expect.objectContaining({ to: 'skip' })));
    expect(screen.getByText('Saving the effect: one moment, then approve.')).toBeTruthy();
    refresh.mockRestore();
  });
  it('two notes pending at once both show', async () => {
    const refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    ignoreEffects = true; deferRerender = true;
    show();
    press('m');
    await waitFor(() => expect(calls).toHaveLength(1));
    press('ArrowRight');
    press('k');
    await waitFor(() => expect(calls).toHaveLength(2));
    // The audit answers both parts with something other than what was asked.
    await waitFor(() => expect(log.info).toHaveBeenCalledWith('content_filter.review.effect', expect.objectContaining({ to: 'skip' })));
    // Both answers land in one render.
    await act(async () => { payload = { ...payload }; rerender(); });
    expect(await screen.findByText(/Mute plays as bleeped on "alpha"\. Skip plays as bleeped on "bravo"\./)).toBeTruthy();
    refresh.mockRestore();
  });
  it('an effect save still lands after the cursor moves on, and the part keeps the new effect', async () => {
    let finish;
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    show();
    press('m');
    await waitFor(() => expect(calls).toHaveLength(1));
    press('ArrowRight');
    expect(selected()).toBe('cue:w2');
    pendingWrite = null; finish({});
    await waitFor(() => expect(log.info).toHaveBeenCalledWith('content_filter.review.effect', expect.objectContaining({ rowId: 'cue:w1', to: 'mute' })));
    expect(calls[0].body).toEqual({ effect: 'mute' });
    press('ArrowLeft');
    expect(selected()).toBe('cue:w1');
    expect(cardFx(/^Effect: Mute/)).toBeTruthy();
  });
  it('a failed click followed by a successful one ends on the success message', async () => {
    const refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(true);
    let first = true;
    failNext = (path, method) => { if (method === 'PUT' && first) { first = false; return true; } return false; };
    show();
    press('m');
    await waitFor(() => expect(calls).toHaveLength(1));
    press('k');
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(log.info).toHaveBeenCalledWith('content_filter.review.effect', expect.objectContaining({ to: 'skip' })));
    expect(screen.queryByText('nope')).toBeNull();
    expect(screen.getByText('Skip applied. Watch it, then press A to approve.')).toBeTruthy();
    refresh.mockRestore();
  });
  it('a saved timing draft releases the cursor before the audit catches up', async () => {
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    await waitFor(() => expect(log.info).toHaveBeenCalledWith('content_filter.review.timing_autosaved', expect.anything()), { timeout: 4000 });
    // The static audit still shows the old span, so the draft differs from it: saved, not unsaved.
    press('ArrowRight');
    expect(selected()).toBe('cue:w2');
    expect(log.info).not.toHaveBeenCalledWith('content_filter.review.unsaved_timing_blocked', expect.anything());
  });
  it('the effect button stays enabled while a timing autosave is out', async () => {
    let finish;
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 4000 });
    expect(cardFx(/^Effect:/).hasAttribute('disabled')).toBe(false);
    pendingWrite = null; finish({});
  });
  it('an effect change whose preview cannot refresh says so instead of replaying the old effect', async () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show(); jump.mockClear(); press('m');
    expect(await screen.findByText(/Mute applied, but the preview could not refresh/)).toBeTruthy();
    expect(jump).not.toHaveBeenCalled();
    expect(reviewCalls()).toHaveLength(0);
  });
  it('a full-blur part lights Blur; a shown part can have its picture hidden (H)', async () => {
    payload = base([row('subject:p1', 'poster', { kind: 'picture', modality: 'shown', effect: 'full-blur', in: 30, out: 34, members: ['p1'] })]);
    show();
    // The effects are a menu on the effect button (E); the current one is checked.
    press('e');
    expect((await screen.findByRole('menuitem', { name: /^Blur/ })).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /^Hide picture/ }).getAttribute('aria-checked')).toBe('false');
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    press('b');
    expect(await screen.findByText('Already blur.')).toBeTruthy();
    expect(calls).toHaveLength(0);
    press('h');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/cues/p1', body: { effect: 'blackout' } }));
  });
  it('a timing change not yet autosaved holds the cursor and the verdict until it lands or is dropped with Esc', async () => {
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    press('ArrowRight');
    expect(selected()).toBe('cue:w1');
    expect(screen.getByText('Timing is saving: one moment, or press Esc to drop it')).toBeTruthy();
    press('a');
    fireEvent.click(screen.getByRole('button', { name: 'bravo' }));
    expect(selected()).toBe('cue:w1');
    expect(calls).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith('content_filter.review.unsaved_timing_blocked', expect.objectContaining({ rk: '77', rowId: 'cue:w1', what: 'step' }));
    press('Escape');
    expect(await screen.findByText('Timing change dropped.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Save timing/ })).toBeNull();
    press('ArrowRight');
    expect(selected()).toBe('cue:w2');
  });
  it('Esc with the effect menu open closes the menu and keeps a timing change still waiting to autosave (review 2026-11-22)', async () => {
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    press('e');
    await screen.findByRole('menu');
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.queryByText('Timing change dropped.')).toBeNull();
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/Saving/);
  });
  it('arriving puts the film at the part in hand, paused', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledWith({ in: 10 }, { play: false });
  });
  it('the Redo button opens the same reason prompt as D; a reason is a click or a key', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
    expect(calls).toHaveLength(0);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Redo reason' })).getByRole('button', { name: /timing/ }));
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0].body).toEqual(expect.objectContaining({ verdict: 'redo', reason: 'timing' }));
  });
  it('action keys follow the channel: a said part takes no B; a shown part no M or P, and takes K', async () => {
    show(); press('b');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    press('ArrowRight'); press('ArrowRight'); press('m'); press('p');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    press('k');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/cues/p1', body: { effect: 'skip' } }));
  });
  it('keeps the new film open when a prior verdict finishes', async () => {
    let finish;
    pendingWrite = new Promise(resolve => { finish = resolve; });
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    press('a');
    expect(reviewCalls()).toEqual([expect.objectContaining({
      path: 'api/v1/content-filter/77/review/cue%3Aw1', method: 'PUT',
      body: expect.objectContaining({ verdict: 'approve' }),
    })]);
    fireEvent.click(screen.getByRole('link', { name: 'Next film' }));
    jump.mockClear();
    await act(async () => { finish({}); });
    expect(screen.getByLabelText('Review path')).toHaveTextContent('/admin/content/filter/88');
    expect(jump).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it('a failed action does not record a verdict or advance', async () => {
    failNext = (p) => p.includes('/cues/');
    show(); press('m');
    await waitFor(() => expect(log.warn).toHaveBeenCalled());
    expect(reviewCalls()).toHaveLength(0); expect(selected()).toBe('cue:w1');
  });
  it('at the end of scope it stops, no wrap, and says all are reviewed (Review Focus 3)', async () => {
    payload = base([row('cue:w1', 'alpha', { verdict: { verdict: 'approve' }, reviewed: { by: 'x' } }), row('cue:w2', 'bravo')]);
    show(); expect(selected()).toBe('cue:w2'); // the first part still open
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All 2 in this view reviewed'));
    expect(selected()).toBe('cue:w2');
  });
  it('at the end with open rows above, says how many are still open instead', async () => {
    show(); press('ArrowRight'); press('ArrowRight'); press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 .*still open/));
    expect(selected()).toBe('subject:p1');
  });
  it('U undoes the last verdict with a DELETE and returns the cursor to that row', async () => {
    show(); press('a');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    press('u');
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: 'api/v1/content-filter/77/review/cue%3Aw1', body: {}, method: 'DELETE' }));
    await waitFor(() => expect(selected()).toBe('cue:w1'));
    expect(log.info).toHaveBeenCalledWith('content_filter.review.undo', expect.objectContaining({ rk: '77', rowId: 'cue:w1', undid: 'approve' }));
  });
  it('undo after an in-place change and its approval is one DELETE; the server restores the earlier effect (Review Focus 4)', async () => {
    show(); press('m');
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/Mute applied/)).toBeTruthy());
    press('a');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    calls.length = 0; press('u');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe('DELETE');
  });
  it('a failed undo keeps the same row at the top so retry does not undo the previous verdict', async () => {
    show();
    press('a');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    press('a');
    await waitFor(() => expect(verdictLogs()).toHaveLength(2));

    failNext = (path, method) => path.includes('/review/') && method === 'DELETE';
    press('u');
    await waitFor(() => expect(log.warn).toHaveBeenCalledWith('content_filter.review.action_failed', expect.objectContaining({ rk: '77', key: 'undo', error: 'nope' })));
    const failedUndo = reviewCalls().at(-1);
    expect(failedUndo).toEqual({ path: 'api/v1/content-filter/77/review/cue%3Aw2', body: {}, method: 'DELETE' });

    failNext = null;
    press('u');
    await waitFor(() => expect(reviewCalls()).toHaveLength(4));
    expect(reviewCalls().at(-1)).toEqual(failedUndo);
    press('u');
    await waitFor(() => expect(reviewCalls()).toHaveLength(5));
    expect(reviewCalls().at(-1)).toEqual({ path: 'api/v1/content-filter/77/review/cue%3Aw1', body: {}, method: 'DELETE' });
  });
  it('undo is withdrawn once a removed row is gone after the re-audit', async () => {
    show(); press('x');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    payload = base(payload.rows.filter((r) => r.id !== 'cue:w1'));
    press('ArrowRight'); // re-render with the new payload
    calls.length = 0; press('u');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/already gone/));
    expect(calls).toHaveLength(0);
  });
  it('the header counts the filtered parts with a verdict; the card shows the keys for the part\'s channel', async () => {
    payload = base([row('cue:w1', 'alpha', { verdict: { verdict: 'redo' }, reviewed: { by: 'x' } }), row('cue:w2', 'bravo'), row('subject:p1', 'poster', { kind: 'picture', modality: 'shown', effect: 'blur' })]);
    show(); expect(screen.getByText('1 of 3 reviewed', { selector: '.cf-rail__text' })).toBeTruthy();
    // The effect keys live in the effect menu (E); the card's own buttons carry the rest.
    const menuKeys = async () => { press('e'); await screen.findByRole('menu'); const k = [...document.querySelectorAll('[role="menu"] kbd')].map((n) => n.textContent); press('Escape'); await waitFor(() => expect(screen.queryByRole('menu')).toBeNull()); return k; };
    expect(selected()).toBe('cue:w2');
    expect([...document.querySelectorAll('.cf-card-part button kbd')].map((n) => n.textContent)).toEqual(expect.arrayContaining(['E', 'A', 'X', 'D', 'W']));
    let keys = await menuKeys();
    expect(keys).toEqual(expect.arrayContaining(['M', 'P'])); expect(keys).not.toContain('B');
    press('ArrowRight');
    keys = await menuKeys();
    expect(keys).toEqual(expect.arrayContaining(['B', 'K'])); expect(keys).not.toContain('M');
  });
  it('emits session start on load and end on leaving, with the reviewed count', () => {
    const { unmount } = show();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.session.start', expect.objectContaining({ rk: '77', rows: 3, reviewed: 0 }));
    unmount();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.session.end', expect.objectContaining({ rk: '77', rows: 3, durationMs: expect.any(Number) }));
  });
  it('clicking a row is a cursor move too (via click)', () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'bravo' }));
    expect(selected()).toBe('cue:w2');
    expect(log.debug).toHaveBeenCalledWith('content_filter.review.cursor', expect.objectContaining({ rowId: 'cue:w2', via: 'click' }));
  });
  it('a timeline click moves the cursor AND seeks (once)', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show(); jump.mockClear(); fireEvent.click(document.querySelector('[data-lane="film"] [data-mark="cue:w2"]'));
    expect(selected()).toBe('cue:w2');
    expect(jump).toHaveBeenCalledTimes(1); expect(jump).toHaveBeenCalledWith({ in: 20 });
  });
  it('a list click seeks exactly once', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show(); jump.mockClear(); fireEvent.click(screen.getByRole('button', { name: 'bravo' }));
    expect(jump).toHaveBeenCalledTimes(1);
  });
  it('does not drag the cursor back when the user moved while a verdict was saving', async () => {
    let finish;
    pendingWrite = new Promise(resolve => { finish = resolve; });
    show();
    press('a'); fireEvent.click(screen.getByRole('button', { name: 'poster' }));
    await act(async () => { finish({}); });
    expect(reviewCalls()).toHaveLength(1);
    expect(selected()).toBe('subject:p1');
  });
  it('keys are ignored inside a modal dialog, and a focused button keeps Enter', () => {
    show();
    const dlg = document.createElement('div'); dlg.setAttribute('role', 'dialog');
    const inner = document.createElement('div'); inner.tabIndex = 0; dlg.appendChild(inner); document.body.appendChild(dlg); inner.focus();
    fireEvent.keyDown(inner, { key: 'ArrowRight' });
    expect(selected()).toBe('cue:w1'); dlg.remove();
    const btn = document.createElement('button'); document.body.appendChild(btn); btn.focus();
    const notPrevented = fireEvent.keyDown(btn, { key: 'Enter' });
    expect(notPrevented).toBe(true); btn.remove();
  });
});

describe('bleep level keys', () => {
  const settingsPuts = () => calls.filter((c) => c.path.endsWith('/77/settings'));
  it('] and [ step the per-film level by 0.05, one debounced write, replaying the cue', async () => {
    payload = { ...three(), bleepLevel: { film: null, profile: 0.3 } };
    previewStore.bind({ refresh: async () => true });
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    jump.mockClear();
    press(']'); press(']'); press('[');
    expect(settingsPuts()).toHaveLength(0);
    await waitFor(() => expect(settingsPuts()).toHaveLength(1));
    expect(settingsPuts()[0]).toEqual({ path: 'api/v1/content-filter/77/settings', method: 'PUT', body: { settings: { bleepLevel: 0.35 } } });
    expect(screen.getByRole('status').textContent).toMatch(/Bleep level 35%/);
    await waitFor(() => expect(jump).toHaveBeenCalledWith({ in: 10 }));
  });
  it.each(['debounced', 'flushed on departure'])('saves the prior film level once (%s) without refreshing the new player', async mode => {
    let finish;
    pendingWrite = new Promise(resolve => { finish = resolve; });
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    const refresh = vi.spyOn(previewStore, 'refresh');
    show();
    press(']');
    if (mode === 'debounced') await waitFor(() => expect(settingsPuts()).toHaveLength(1));
    fireEvent.click(screen.getByRole('link', { name: 'Next film' }));
    jump.mockClear();
    await act(async () => { finish({}); });
    expect(refresh).not.toHaveBeenCalled();
    expect(jump).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(calls).toEqual([{
      path: 'api/v1/content-filter/77/settings', method: 'PUT', body: { settings: { bleepLevel: 0.3 } },
    }]);
  });
  it('leaves the new player alone when an active refresh finishes after departure', async () => {
    let finish;
    const pendingRefresh = new Promise(resolve => { finish = resolve; });
    const refresh = vi.spyOn(previewStore, 'refresh').mockReturnValueOnce(pendingRefresh);
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    press(']');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'Next film' }));
    jump.mockClear();
    reload.mockClear();
    await act(async () => { finish(); });
    expect(jump).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(settingsPuts()).toHaveLength(1);
  });
  it('keeps the newer cursor when the saved preview refresh returns', async () => {
    const held = Promise.withResolvers();
    const refresh = vi.fn(() => held.promise);
    previewStore.bind({ refresh });
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    press(']');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    press('ArrowRight');
    expect(selected()).toBe('cue:w2');
    jump.mockClear();
    await act(async () => { held.resolve(true); });
    expect(jump).not.toHaveBeenCalled();
    expect(settingsPuts()).toHaveLength(1);
  });
  it('serializes another settings write behind a held write', async () => {
    vi.useFakeTimers();
    try {
      const held = Promise.withResolvers();
      pendingWrite = held.promise;
      const refresh = vi.fn(async () => true);
      previewStore.bind({ refresh });
      show();
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3]);
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(settingsPuts()).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled();
      pendingWrite = null;
      await act(async () => { held.resolve({}); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3, 0.35]);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('continues stepping from the saved level while the review read is pending', async () => {
    vi.useFakeTimers();
    const held = Promise.withResolvers();
    try {
      reload.mockReturnValueOnce(held.promise);
      previewStore.bind({ refresh: async () => true });
      show();
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(reload).toHaveBeenCalledTimes(1);
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3, 0.35]);
    } finally {
      await act(async () => { held.resolve(); });
      vi.useRealTimers();
    }
  });
  it('reads back the earlier commit when a newer bleep write fails', async () => {
    vi.useFakeTimers();
    const held = Promise.withResolvers();
    try {
      pendingWrite = held.promise;
      const refresh = vi.fn(async () => true);
      previewStore.bind({ refresh });
      const jump = vi.spyOn(previewStore, 'jumpToCue');
      show();
      jump.mockClear();
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      failNext = path => path.endsWith('/77/settings');
      await act(async () => { held.resolve({}); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3, 0.35]);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(jump).not.toHaveBeenCalled();
    } finally {
      held.resolve({});
      vi.useRealTimers();
    }
  });
  it('keeps settings writes ordered after reopening the same film', async () => {
    vi.useFakeTimers();
    const held = Promise.withResolvers();
    try {
      pendingWrite = held.promise;
      show();
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      fireEvent.click(screen.getByRole('link', { name: 'Next film' }));
      payload = { ...three(), bleepLevel: { film: 0.4 } };
      fireEvent.click(screen.getByRole('link', { name: 'Previous film' }));
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3]);
      pendingWrite = null;
      await act(async () => { held.resolve({}); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3, 0.35, 0.45]);
    } finally {
      await act(async () => { held.resolve({}); });
      vi.useRealTimers();
    }
  });
  it('leaves a queued prior-owner level out of the new session', async () => {
    vi.useFakeTimers();
    const held = Promise.withResolvers();
    try {
      setToken('first-fixture-session');
      pendingWrite = held.promise;
      show();
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      press(']');
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      setToken('second-fixture-session');
      await act(async () => { held.resolve({}); });
      expect(settingsPuts().map(request => request.body.settings.bleepLevel)).toEqual([0.3]);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      await act(async () => { held.resolve({}); });
      clearToken();
      vi.useRealTimers();
    }
  });
  it('starts from the film level, else the household level, else 0.25, and clamps', async () => {
    payload = { ...three(), bleepLevel: { film: 0.98, profile: 0.3 } };
    show();
    press(']'); press(']');
    await waitFor(() => expect(settingsPuts()).toHaveLength(1));
    expect(settingsPuts()[0].body.settings.bleepLevel).toBe(1);
  });
});

describe('the part menu (owner, 2026-11-22: "right-click and I can change what it is or how it\'s handled")', () => {
  const menuItem = (name) => screen.queryByRole('menuitem', { name: new RegExp(`^${name}( \\S+)?$`) });
  const rightClick = (name) => fireEvent.contextMenu(screen.getByRole('button', { name }), { clientX: 400, clientY: 300 });
  it('a part menu lists play, effects, verdicts, refine and in/out, and Approve there gives that part its verdict', async () => {
    show();
    rightClick('bravo');
    await screen.findByRole('menu');
    expect(selected()).toBe('cue:w2');
    for (const name of ['Play filtered', 'Play unfiltered', 'Mute', 'Approve', 'Let it play', 'Redo', 'Refine', 'Set in point here', 'Set out point here']) {
      expect(menuItem(name), name).toBeTruthy();
    }
    expect(log.info).toHaveBeenCalledWith('content_filter.review.part_menu', expect.objectContaining({ rowId: 'cue:w2', from: 'list' }));
    fireEvent.click(menuItem('Approve'));
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/review/cue%3Aw2', body: expect.objectContaining({ verdict: 'approve' }) }));
    expect(log.info).toHaveBeenCalledWith('content_filter.review.part_menu.action', expect.objectContaining({ action: 'verdict', value: 'approve' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
  it('an effect from the part menu goes to that part; Use household settings puts it back on the settings', async () => {
    show();
    rightClick('bravo');
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Mute/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/cues/w2', body: { effect: 'mute' } }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    rightClick('alpha');
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Use household settings/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/cues/w1', body: { effect: 'profile', disabled: false }, method: 'PUT' }));
  });
  it('Let it play from the part menu lets that part play (verdict remove)', async () => {
    show();
    rightClick('bravo');
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Let it play/ }));
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/review/cue%3Aw2', body: expect.objectContaining({ verdict: 'remove' }) }));
  });
  it('an action whose part is no longer in hand is dropped, not run on a later visit (review 2026-11-22)', async () => {
    let finish;
    pendingWrite = new Promise((resolve) => { finish = resolve; });
    show();
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    // The menu opens on the part in hand while its verdict saves; the save then moves the cursor on.
    rightClick('alpha');
    await screen.findByRole('menu');
    await act(async () => { finish({}); });
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    pendingWrite = null;
    fireEvent.click(screen.getByRole('menuitem', { name: /^Approve/ }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    press('ArrowLeft');
    expect(selected()).toBe('cue:w1');
    await new Promise((r) => setTimeout(r, 30));
    expect(reviewCalls()).toHaveLength(1);
    expect(log.info).toHaveBeenCalledWith('content_filter.review.part_menu.dropped', expect.objectContaining({ rowId: 'cue:w1', action: 'verdict', cursor: 'cue:w2' }));
  });
  it('the context-menu key that also raises contextmenu opens the menu once', async () => {
    show();
    const btn = screen.getByRole('button', { name: 'bravo' });
    fireEvent.keyDown(btn, { key: 'ContextMenu' });
    fireEvent.contextMenu(btn, { clientX: 0, clientY: 0 });
    await screen.findByRole('menu');
    expect(log.info.mock.calls.filter((c) => c[0] === 'content_filter.review.part_menu')).toHaveLength(1);
  });
  it('Enter in the open menu plays the part filtered', async () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    rightClick('bravo');
    await screen.findByRole('menu');
    jump.mockClear();
    press('Enter');
    await waitFor(() => expect(jump).toHaveBeenCalledWith({ in: 20 }));
    expect(log.info).toHaveBeenCalledWith('content_filter.review.part_menu.action', expect.objectContaining({ action: 'play' }));
  });
  it('a part that plays gets effects but no verdicts in its menu', async () => {
    payload = base([row('cue:w1', 'alpha'), row('cue:k1', 'kiss', { acts: false, effect: 'off', why: 'settings', in: 40, out: 41 })]);
    show();
    fireEvent.click(document.querySelector('[data-stage="plays"]'));
    rightClick('kiss');
    await screen.findByRole('menu');
    expect(menuItem('Mute')).toBeTruthy();
    for (const name of ['Approve', 'Let it play', 'Redo', 'Refine', 'Set in point here']) expect(menuItem(name), name).toBeNull();
  });
  it('a part menu on another part is refused while a timing change is still saving', async () => {
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    rightClick('bravo');
    expect(screen.getByText('Timing is saving: one moment, or press Esc to drop it')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(selected()).toBe('cue:w1');
  });
});

describe('bleep volume panel wiring', () => {
  const openPanel = async (film, profile) => {
    payload = { ...three(), bleepLevel: { film, profile } };
    show();
    return screen.findByRole('button', { name: /^Bleep \d+ %$/ }).then((b) => { fireEvent.click(b); return b; });
  };
  it.each([[0.5, 0.3, 'Bleep 50 %'], [null, 0.3, 'Bleep 30 %'], [null, undefined, 'Bleep 25 %']])('the header button shows the effective level (film %s, household %s)', async (film, profile, label) => {
    payload = { ...three(), bleepLevel: { film, profile } };
    show();
    expect((await screen.findByRole('button', { name: /^Bleep \d+ %$/ })).textContent).toBe(label);
  });
  it('Follow household PUTs bleepLevel null to this film\'s settings', async () => {
    await openPanel(0.5, 0.3);
    fireEvent.click(await screen.findByRole('button', { name: 'Follow household' }));
    await waitFor(() => expect(calls.filter((c) => c.path === 'api/v1/content-filter/77/settings')).toEqual([
      { path: 'api/v1/content-filter/77/settings', method: 'PUT', body: { settings: { bleepLevel: null } } }]));
  });
  it('the household stepper PUTs to the household profile, and two quick + clicks end at 0.35 (shown at once)', async () => {
    await openPanel(null, 0.25);
    const plus = await screen.findByRole('button', { name: 'Household louder' });
    fireEvent.click(plus); fireEvent.click(plus);
    expect(screen.getByLabelText('Household level').textContent).toBe('35 %');
    const puts = () => calls.filter((c) => c.path === 'api/v1/content-filter/profiles/family/settings');
    await waitFor(() => expect(puts().length).toBe(2));
    expect(puts().map((c) => c.method)).toEqual(['PUT', 'PUT']);
    expect(puts()[1].body).toEqual({ settings: { bleepLevel: 0.35 } });
    expect(log.info).toHaveBeenCalledWith('content_filter.review.bleep_level', expect.objectContaining({ scope: 'household', value: 0.35 }));
  });
  it('a household write whose session changed is not sent and not logged as saved', async () => {
    setToken('first-fixture-session');
    try {
      await openPanel(null, 0.25);
      fireEvent.click(await screen.findByRole('button', { name: 'Household louder' }));
      setToken('second-fixture-session');
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(calls.filter((c) => c.path === 'api/v1/content-filter/profiles/family/settings')).toEqual([]);
      expect(log.info).not.toHaveBeenCalledWith('content_filter.review.bleep_level', expect.objectContaining({ scope: 'household' }));
    } finally { clearToken(); }
  });
  it('Test bleep sounds at the effective level', async () => {
    await openPanel(0.5, 0.3);
    fireEvent.click(await screen.findByRole('button', { name: 'Test bleep' }));
    expect(toneLevels).toEqual([0.5]);
  });
});
