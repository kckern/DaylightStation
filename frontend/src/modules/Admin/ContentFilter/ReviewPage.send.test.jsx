import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
const row = (id, label, members) => ({ id, peekId: members[0] || id, members, kind: 'words', group: 'profanity', label, modality: 'said', in: 10, out: 11, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null });
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const firstFilm = 'api/v1/content-filter/77';
const nextFilm = 'api/v1/content-filter/88';
const reviewRead = (film) => [`${film}/review`, {}, 'GET', { signal: expect.any(AbortSignal) }];
const show = () => render(
  <MantineProvider>
    <MemoryRouter initialEntries={['/admin/content/filter/77']}>
      <Link to="/admin/content/filter/88">Next film</Link>
      <Routes><Route path="/admin/content/filter/:ratingKey/:rowId?" element={<ContentFilterReview />} /></Routes>
    </MemoryRouter>
  </MantineProvider>
);
const base = (extra = {}) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true, running: false }, wordRulings: {},
  rows: [row('cue:a', 'damn', ['a']), row('subject:s', 'Billboard', ['b', 'c'])], reviewed: 0, total: 2, job: null, signOff: { ready: false, missing: [], parent: null }, ...extra });

describe('review page send-back', () => {
  it('sends the selected rows back together', async () => {
    api.mockReset().mockResolvedValue(base());
    show();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select damn' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Billboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send back 2 selected' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${firstFilm}/jobs`, { kind: 'send-back', cues: ['a', 'b', 'c'] }, 'POST'));
  });
  it('labels the rows of a running send-back with its step', async () => {
    api.mockReset().mockResolvedValue(base({ job: { kind: 'send-back', status: 'running', step: 'refine', cues: ['b'] } }));
    show();
    expect(within((await screen.findByText('Billboard')).closest('[data-row-id]')).getByText('Sent back: refine')).toBeTruthy();
  });

  it('keeps picks on row permalink changes and clears them when the film changes', async () => {
    api.mockReset().mockResolvedValue(base());
    show();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select damn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Billboard', exact: true }));
    expect(screen.getByRole('button', { name: 'Billboard', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: 'Select damn' })).toBeChecked();
    fireEvent.click(screen.getByRole('link', { name: 'Next film' }));
    expect(await screen.findByRole('checkbox', { name: 'Select damn' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Send back .* selected/ })).toBeNull();
    expect(api.mock.calls).toEqual([reviewRead(firstFilm), reviewRead(nextFilm)]);
  });

  it('submits once and leaves the next film alone when the prior request finishes', async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    api.mockReset().mockImplementation(path => path.endsWith('/jobs') ? pending : Promise.resolve(base()));
    show();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select damn' }));
    const submit = screen.getByRole('button', { name: 'Send back 1 selected' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole('link', { name: 'Next film' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Billboard' }));
    await act(async () => { finish({}); });
    expect(screen.getByRole('checkbox', { name: 'Select Billboard' })).toBeChecked();
    expect(screen.queryByText(/back to the pipeline/)).toBeNull();
    expect(api.mock.calls).toEqual([
      reviewRead(firstFilm),
      [`${firstFilm}/jobs`, { kind: 'send-back', cues: ['a'] }, 'POST'],
      reviewRead(nextFilm),
    ]);
  });
});
