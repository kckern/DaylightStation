import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { clearToken, setToken } from '../../../lib/auth.js';

const calls = [];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(), child: () => log };
const reload = vi.fn(async () => {});
let payload;
let failNext = null;
let pendingWrite;
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => log }));
vi.mock('../../../lib/hooks/useApiResource.js', () => ({
  useApiResource: () => ({ data: payload, loading: false, error: null, reload, refresh: reload }),
  invalidateApiResources: vi.fn(),
}));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => {
  calls.push({ path, body, method });
  if (failNext && failNext(path, method)) throw new Error('nope');
  return pendingWrite ?? {};
} }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { previewStore } = await import('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs');
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');

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
const reviewCalls = () => calls.filter((c) => c.path.includes('/review/'));
const verdictLogs = () => log.info.mock.calls.filter((c) => c[0] === 'content_filter.review.verdict');

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); failNext = null; pendingWrite = null; previewStore.reset(); payload = three(); });

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
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0].body).toEqual(expect.objectContaining({ verdict: 'approve' }));
    refresh.mockRestore();
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
  it('an unsaved timing change holds the cursor and the verdict until it is saved or dropped with Esc', async () => {
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    press('ArrowRight');
    expect(selected()).toBe('cue:w1');
    expect(screen.getByText('Unsaved timing: Save or press Esc to drop it')).toBeTruthy();
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
  it('Esc with the effect menu open closes the menu and keeps an unsaved timing change (review 2026-11-22)', async () => {
    show();
    const start = screen.getByRole('slider', { name: 'Start' });
    start.focus(); fireEvent.keyDown(start, { key: 'ArrowLeft' }); start.blur();
    press('e');
    await screen.findByRole('menu');
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.queryByText('Timing change dropped.')).toBeNull();
    expect(screen.getByRole('button', { name: /^Save timing/ })).toBeTruthy();
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
