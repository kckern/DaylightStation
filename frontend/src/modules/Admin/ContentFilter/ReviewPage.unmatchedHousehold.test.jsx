import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// A key holding household work (override, audit, review marks) that is not matched to Plex:
// the review stays readable; only runs are blocked.
const payload = {
  title: 'Back to the Future', certification: { level: 'machine' }, audit: { ok: true, fresh: true, failures: [] },
  rows: [{ id: 'cue:w1', peekId: 'w1', kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 70, out: 70.5, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null, verdict: { verdict: 'redo' } }],
  reviewed: 0, total: 1, redo: 1, job: null, signOff: { ready: false, missing: [], parent: null },
  match: 'unmatched', unmatched: { reason: 'duplicate', text: 'another entry has this film' },
};
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div data-testid="player" /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');

describe('Content filter review page, household key not matched to Plex', () => {
  it('shows the review and says runs are blocked', () => {
    render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/filter/662170']}><Routes>
      <Route path="/admin/content/filter/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
    expect(screen.getByText('damn')).toBeTruthy();
    expect(screen.getByText(/Not matched to Plex: another entry has this film\. The review and override here are kept; runs are blocked\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rework 1 flagged/ }).disabled).toBe(true);
  });
});
