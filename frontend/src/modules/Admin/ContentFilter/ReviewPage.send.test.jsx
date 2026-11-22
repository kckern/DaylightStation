import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Refine (design cf-journey, owner 2026-11-21): R refines the part in hand, Shift+R every filtered
// part still on rough timing, as one send-back of their member cues; presses during an open run
// queue on the page and go out when it closes.
const calls = [];
let payload;
const reloads = { n: 0 };
const row = (id, label, members, o = {}) => ({ id, peekId: members[0] || id, members, kind: 'words', group: 'profanity', label, modality: 'said', in: 10, out: 11, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null, timing: 'rough', ...o });
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => { reloads.n++; } }) }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); return {}; } }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const ui = () => <MantineProvider><MemoryRouter initialEntries={['/admin/content/filter/77']}><Routes>
  <Route path="/admin/content/filter/:ratingKey/:rowId?" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>;
const base = (rows, extra = {}) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true, running: false }, wordRulings: {},
  rows, reviewed: 0, total: rows.length, job: null, signOff: { ready: false, missing: [], parent: null }, ...extra });
const rows = [
  row('cue:a', 'damn', ['a'], { in: 5, out: 5.5 }),
  row('cue:l', 'L*rd', ['l'], { kind: 'scenes', effect: 'skip-card', in: 20, out: 26, unsure: ['exchange-by-length'] }),
  row('subject:s', 'Billboard', ['b', 'c'], { kind: 'picture', modality: 'shown', effect: 'blur', in: 30, out: 32, timing: 'refined' }),
  row('scene:x', 'Fight', [], { kind: 'scenes', modality: null, effect: 'skip-card', in: 40, out: 60 }),
  row('cue:k', 'stinky', ['k'], { in: 50, out: 50.5, acts: false, why: 'settings', effect: 'off' }),
];
const key = (k, o = {}) => fireEvent.keyDown(document.body, { key: k, ...o });

beforeEach(() => { calls.length = 0; reloads.n = 0; });

describe('refine from the review page', () => {
  it('R refines the part in hand: one send-back of its member cues', async () => {
    payload = base(rows);
    render(ui());
    key('R');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/jobs', body: { kind: 'send-back', cues: ['a'] }, method: 'POST' });
  });
  it('a word skipped as an exchange refines as a word (its members), from its card\'s button', async () => {
    payload = base(rows);
    render(ui());
    fireEvent.click(screen.getByRole('button', { name: 'L*rd' }));
    fireEvent.click(screen.getByRole('button', { name: /^Refine this part/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'send-back', cues: ['l'] });
  });
  it('Shift+R sends every filtered, non-scene part not yet refined, never the ones that play', async () => {
    payload = base(rows);
    render(ui());
    key('R', { shiftKey: true });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'send-back', cues: ['a', 'l'] });
  });
  it('the header offers Refine all N for the rough filtered parts', async () => {
    payload = base(rows);
    render(ui());
    fireEvent.click(screen.getByRole('button', { name: /^Refine all 2/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'send-back', cues: ['a', 'l'] });
  });
  it('while a run is open, R queues; the queue goes out as one send-back when the run closes', async () => {
    payload = base(rows, { job: { id: 'r1', kind: 'send-back', status: 'running', step: 'refine', cues: ['b'] } });
    const { rerender } = render(ui());
    key('R');
    expect(await screen.findByText(/Queued: "damn" refines when the current run finishes/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(within(document.querySelector('[data-row-id="cue:a"]')).getByText('Queued')).toBeTruthy();
    expect(within(document.querySelector('[data-row-id="subject:s"]')).getByText('Refining…')).toBeTruthy();
    payload = base(rows, { job: { id: 'r1', kind: 'send-back', status: 'done', step: 'audit', cues: ['b'] } });
    rerender(ui());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'send-back', cues: ['a'] });
  });
});
