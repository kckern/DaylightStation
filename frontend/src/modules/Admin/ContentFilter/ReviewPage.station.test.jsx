import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const calls = [];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(), child: () => log };
const reload = vi.fn();
let payload;
let failNext = null;
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => log }));
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload }) }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => {
  calls.push({ path, body, method });
  if (failNext && failNext(path, method)) throw new Error('nope');
  return {};
} }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { previewStore } = await import('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs');
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');

const row = (id, label, over = {}) => ({ id, peekId: id.split(':')[1], members: [id.split(':')[1]], kind: 'words', group: 'profanity', label, modality: 'said', in: 10, out: 10.5, effect: 'bleep', card: null, handFixed: false, unsure: [], reviewed: null, verdict: null, ...over });
const base = (rows) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true }, wordRulings: {}, rows,
  reviewed: rows.filter((r) => r.reviewed).length, total: rows.length, job: null, signOff: { ready: false, missing: [], parent: null } });
const three = () => base([row('cue:w1', 'alpha', { in: 10, out: 10.5 }), row('cue:w2', 'bravo', { in: 20, out: 20.5 }), row('subject:p1', 'poster', { kind: 'picture', modality: 'shown', effect: 'blur', in: 30, out: 34, members: ['p1'] })]);
const show = (path = '/admin/content/filter/77') => render(<MantineProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/content/filter/:ratingKey/:rowId?" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
const press = (key, init = {}, target = document.body) => fireEvent.keyDown(target, { key, ...init });
const selected = () => document.querySelector('.is-selected')?.getAttribute('data-row-id') ?? null;
const reviewCalls = () => calls.filter((c) => c.path.includes('/review/'));
const verdictLogs = () => log.info.mock.calls.filter((c) => c[0] === 'content_filter.review.verdict');

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); failNext = null; previewStore.reset(); payload = three(); });

describe('review station keys', () => {
  it('arrow keys move the cursor, seek 4 s ahead of it, and log it', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    press('ArrowRight'); expect(selected()).toBe('cue:w1');
    press('ArrowRight'); expect(selected()).toBe('cue:w2');
    expect(jump).toHaveBeenLastCalledWith({ in: 20 });
    press('ArrowLeft'); expect(selected()).toBe('cue:w1');
    expect(log.debug).toHaveBeenCalledWith('content_filter.review.cursor', expect.objectContaining({ rk: '77', rowId: 'cue:w2', via: 'key' }));
  });
  it('keys work while the video element has focus (Review Focus 1)', () => {
    show();
    const video = document.createElement('video'); video.tabIndex = 0; document.body.appendChild(video); video.focus();
    fireEvent.keyDown(video, { key: 'ArrowRight' });
    expect(selected()).toBe('cue:w1');
    video.remove();
  });
  it('A approves the row with span, dwell and replays, then auto-advances to the next without a verdict', async () => {
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    show();
    press('ArrowRight'); now = 4200; press(' '); press(' '); now = 6000;
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
    show(); press('ArrowRight'); press('a');
    await waitFor(() => expect(selected()).toBe('cue:w3'));
  });
  it('R removes, I ignores, D then a number is a redo with its reason', async () => {
    show(); press('ArrowRight'); press('r');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewCalls()[0].body.verdict).toBe('remove');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    press('i'); await waitFor(() => expect(reviewCalls()).toHaveLength(2));
    expect(reviewCalls()[1].body.verdict).toBe('ignore');
    await waitFor(() => expect(selected()).toBe('subject:p1'));
    press('d'); expect(document.querySelector('[data-key="1"]')).toBeTruthy(); press('3');
    await waitFor(() => expect(reviewCalls()).toHaveLength(3));
    expect(reviewCalls()[2].body).toEqual(expect.objectContaining({ verdict: 'redo', reason: 'action' }));
  });
  it('an action key changes the effect in place, THEN approves with the change', async () => {
    show(); press('ArrowRight'); press('m');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT api/v1/content-filter/77/cues/w1', 'PUT api/v1/content-filter/77/review/cue%3Aw1']);
    expect(calls[0].body).toEqual({ effect: 'mute' });
    expect(calls[1].body).toEqual(expect.objectContaining({ verdict: 'approve', change: { from: 'bleep', to: 'mute' } }));
  });
  it('action keys not for this kind do nothing; picture rows take B and K', async () => {
    show(); press('ArrowRight'); press('b'); press('k');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    press('ArrowRight'); press('ArrowRight'); press('k');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(calls[0]).toEqual(expect.objectContaining({ path: 'api/v1/content-filter/77/cues/p1', body: { effect: 'skip' } }));
  });
  it('W widens both edges by half a second through a nudge, then approves with the change', async () => {
    show(); press('ArrowRight'); press('w');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(calls[0].body).toEqual({ nudge: { in: 9.5, out: 11 } });
    expect(calls[1].body).toEqual(expect.objectContaining({ verdict: 'approve', change: { from: { in: 10, out: 10.5 }, to: { in: 9.5, out: 11 } } }));
  });
  it('a failed action does not record a verdict or advance', async () => {
    failNext = (p) => p.includes('/cues/');
    show(); press('ArrowRight'); press('m');
    await waitFor(() => expect(log.warn).toHaveBeenCalled());
    expect(reviewCalls()).toHaveLength(0); expect(selected()).toBe('cue:w1');
  });
  it('at the end of scope it stops, no wrap, and says all are reviewed (Review Focus 3)', async () => {
    payload = base([row('cue:w1', 'alpha', { verdict: { verdict: 'approve' }, reviewed: { by: 'x' } }), row('cue:w2', 'bravo')]);
    show(); press('ArrowRight'); press('ArrowRight'); expect(selected()).toBe('cue:w2');
    press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All 2 in this view reviewed'));
    expect(selected()).toBe('cue:w2');
  });
  it('at the end with open rows above, says how many are still open instead', async () => {
    show(); press('ArrowRight'); press('ArrowRight'); press('ArrowRight'); press('a');
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 .*still open/));
    expect(selected()).toBe('subject:p1');
  });
  it('F narrows scope to a kind: list, timeline and stepping all follow', () => {
    show();
    press('f'); // words
    expect([...document.querySelectorAll('.cf-review__list [data-row-id]')].map((n) => n.getAttribute('data-row-id'))).toEqual(['cue:w1', 'cue:w2']);
    expect([...document.querySelectorAll('[data-lane="film"] [data-mark]')].map((n) => n.getAttribute('data-mark'))).toEqual(['cue:w1', 'cue:w2']);
    press('ArrowRight'); press('ArrowRight'); press('ArrowRight');
    expect(selected()).toBe('cue:w2');
    expect(log.info).toHaveBeenCalledWith('content_filter.review.scope', expect.objectContaining({ rk: '77', kind: 'words' }));
  });
  it('the action filter narrows the same scope', () => {
    show();
    fireEvent.click(screen.getByRole('textbox', { name: 'Action' })); fireEvent.click(screen.getByRole('option', { name: 'Blur' }));
    expect([...document.querySelectorAll('.cf-review__list [data-row-id]')].map((n) => n.getAttribute('data-row-id'))).toEqual(['subject:p1']);
  });
  it('U undoes the last verdict with a DELETE and returns the cursor to that row', async () => {
    show(); press('ArrowRight'); press('a');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    press('u');
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: 'api/v1/content-filter/77/review/cue%3Aw1', body: {}, method: 'DELETE' }));
    await waitFor(() => expect(selected()).toBe('cue:w1'));
    expect(log.info).toHaveBeenCalledWith('content_filter.review.undo', expect.objectContaining({ rk: '77', rowId: 'cue:w1', undid: 'approve' }));
  });
  it('undo after an in-place change is one DELETE; the server restores the earlier effect (Review Focus 4)', async () => {
    show(); press('ArrowRight'); press('m');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    calls.length = 0; press('u');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe('DELETE');
  });
  it('undo is withdrawn once a removed row is gone after the re-audit', async () => {
    show(); press('ArrowRight'); press('r');
    await waitFor(() => expect(selected()).toBe('cue:w2'));
    payload = base(payload.rows.filter((r) => r.id !== 'cue:w1'));
    press('ArrowRight'); // re-render with the new payload
    calls.length = 0; press('u');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/already gone/));
    expect(calls).toHaveLength(0);
  });
  it('shows the tally and only the current kind\'s keys in the key bar', () => {
    payload = base([row('cue:w1', 'alpha', { verdict: { verdict: 'redo' }, reviewed: { by: 'x' } }), row('cue:w2', 'bravo'), row('subject:p1', 'poster', { kind: 'picture', effect: 'blur' })]);
    show(); expect(screen.getByText('1/3 · 1 redo')).toBeTruthy();
    press('ArrowRight'); press('ArrowRight');
    expect(document.querySelector('[data-key="M"]')).toBeTruthy(); expect(document.querySelector('[data-key="K"]')).toBeNull();
  });
  it('emits session start on load and end on leaving, with the reviewed count', () => {
    const { unmount } = show();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.session.start', expect.objectContaining({ rk: '77', rows: 3, reviewed: 0 }));
    unmount();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.session.end', expect.objectContaining({ rk: '77', rows: 3, durationMs: expect.any(Number) }));
  });
  it('clicking a row is a cursor move too (via click)', () => {
    show(); fireEvent.click(screen.getByText('bravo'));
    expect(selected()).toBe('cue:w2');
    expect(log.debug).toHaveBeenCalledWith('content_filter.review.cursor', expect.objectContaining({ rowId: 'cue:w2', via: 'click' }));
  });
  it('a timeline click moves the cursor AND seeks (once)', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show(); fireEvent.click(document.querySelector('[data-lane="film"] [data-mark="cue:w2"]'));
    expect(selected()).toBe('cue:w2');
    expect(jump).toHaveBeenCalledTimes(1); expect(jump).toHaveBeenCalledWith({ in: 20 });
  });
  it('a list click seeks exactly once', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show(); fireEvent.click(screen.getByText('bravo'));
    expect(jump).toHaveBeenCalledTimes(1);
  });
  it('does not drag the cursor back when the user moved while a verdict was saving', async () => {
    let release; failNext = null;
    show(); press('ArrowRight');
    const gate = new Promise((r) => { release = r; });
    const orig = calls.push.bind(calls);
    calls.push = (c) => { orig(c); return 0; };
    // hold the PUT open via a slow response
    failNext = () => false;
    press('a'); fireEvent.click(screen.getByText('poster')); // user jumps to the picture row at once
    release();
    await gate;
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(selected()).toBe('subject:p1');
  });
  it('keys are ignored inside a modal dialog, and a focused button keeps Space', () => {
    show();
    const dlg = document.createElement('div'); dlg.setAttribute('role', 'dialog');
    const inner = document.createElement('div'); inner.tabIndex = 0; dlg.appendChild(inner); document.body.appendChild(dlg); inner.focus();
    fireEvent.keyDown(inner, { key: 'ArrowRight' });
    expect(selected()).toBeNull(); dlg.remove();
    const btn = document.createElement('button'); document.body.appendChild(btn); btn.focus();
    const notPrevented = fireEvent.keyDown(btn, { key: ' ' });
    expect(notPrevented).toBe(true); btn.remove();
  });
});

describe('bleep level keys', () => {
  const settingsPuts = () => calls.filter((c) => c.path.endsWith('/77/settings'));
  it('] and [ step the per-film level by 0.05, one debounced write, replaying the cue', async () => {
    payload = { ...three(), bleepLevel: { film: null, profile: 0.3 } };
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    show();
    press('ArrowRight');
    jump.mockClear();
    press(']'); press(']'); press('[');
    expect(settingsPuts()).toHaveLength(0);
    await waitFor(() => expect(settingsPuts()).toHaveLength(1));
    expect(settingsPuts()[0]).toEqual({ path: 'api/v1/content-filter/77/settings', method: 'PUT', body: { settings: { bleepLevel: 0.35 } } });
    expect(screen.getByRole('status').textContent).toMatch(/Bleep level 35%/);
    await waitFor(() => expect(jump).toHaveBeenCalledWith({ in: 10 }));
  });
  it('starts from the film level, else the household level, else 0.25, and clamps', async () => {
    payload = { ...three(), bleepLevel: { film: 0.98, profile: 0.3 } };
    show();
    press(']'); press(']');
    await waitFor(() => expect(settingsPuts()).toHaveLength(1));
    expect(settingsPuts()[0].body.settings.bleepLevel).toBe(1);
  });
});
