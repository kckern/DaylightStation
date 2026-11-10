import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

const payload = {
  title: 'Back to the Future', certification: { level: 'machine' }, audit: { ok: true, fresh: true, failures: [] },
  rows: [{ id: 'cue:w1', peekId: 'w1', kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 70, out: 70.5, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null }],
  reviewed: 0, total: 1, job: { status: 'failed', step: 'scenes', error: 'boom' }, signOff: { ready: false, missing: ['1 of 1 parts not reviewed'], parent: null },
};
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div data-testid="player" /> }));
const { previewStore } = await import('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs');
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');

describe('Content filter review page', () => {
  it('shows the film, its certification, the run state, the player and the rows', async () => {
    render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/filter/77']}><Routes>
      <Route path="/admin/content/filter/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
    expect(screen.getByText('Back to the Future')).toBeTruthy();
    expect(screen.getByText('Machine-certified')).toBeTruthy();
    expect(screen.getByText('Failed at scenes: boom')).toBeTruthy();
    expect(screen.getByText('0 of 1 reviewed')).toBeTruthy();
    expect(await screen.findByTestId('player')).toBeTruthy();
  });
  const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;
  const at = (path) => render(<MantineProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/content/filter/:ratingKey/:rowId?" element={<><ContentFilterReview /><Loc /></>} /></Routes></MemoryRouter></MantineProvider>);

  it('clicking a row seeks, selects, and replaces the URL with its permalink', () => {
    previewStore.reset();
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    at('/admin/content/filter/77');
    fireEvent.click(screen.getByText('damn'));
    expect(jump).toHaveBeenCalledWith({ in: 70 });
    expect(screen.getByTestId('loc').textContent).toBe('/admin/content/filter/77/cue%3Aw1');
    expect(document.querySelector('[data-row-id="cue:w1"]').className).toContain('is-selected');
  });
  it('opening a permalink selects the row and seeks once the player binds', () => {
    previewStore.reset();
    at('/admin/content/filter/77/cue%3Aw1');
    expect(document.querySelector('[data-row-id="cue:w1"]').className).toContain('is-selected');
    const seek = vi.fn(); const play = vi.fn();
    previewStore.bind({ seek, play });
    expect(seek).toHaveBeenCalledWith(66);
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('an unknown filter id says so and does not crash', () => {
    previewStore.reset();
    at('/admin/content/filter/77/cue%3Agone');
    expect(screen.getByText("That filter isn't in this film any more")).toBeTruthy();
  });
});
