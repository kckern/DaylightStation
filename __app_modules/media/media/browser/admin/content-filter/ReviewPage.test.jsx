import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const payload = {
  title: 'Back to the Future', certification: { level: 'machine' }, audit: { ok: true, fresh: true, failures: [] },
  rows: [{ id: 'cue:w1', peekId: 'w1', kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 70, out: 70.5, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null }],
  reviewed: 0, total: 1, job: { status: 'failed', step: 'scenes', error: 'boom' }, signOff: { ready: false, missing: ['1 of 1 parts not reviewed'], parent: null },
};
vi.mock('../../../../../../frontend/src/lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../playback.mjs', () => ({ default: () => <div data-testid="player" /> }));
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
});
