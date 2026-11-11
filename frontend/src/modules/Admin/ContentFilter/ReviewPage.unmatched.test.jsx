import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const payload = { title: 'Casino Royale', year: 2006, match: 'unmatched', unmatched: { reason: 'year-mismatch', text: 'Plex has the 1954 film' } };
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div data-testid="player" /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');

describe('Content filter review page, film not matched to Plex', () => {
  it('opens, names the film and says why it cannot be reviewed against a file; no player, no rows', () => {
    render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/filter/657136']}><Routes>
      <Route path="/admin/content/filter/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
    expect(screen.getByText('Casino Royale (2006)')).toBeTruthy();
    expect(screen.getByText(/Not matched to Plex: Plex has the 1954 film\./)).toBeTruthy();
    expect(screen.getByText(/can't be reviewed against a file/)).toBeTruthy();
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByRole('link', { name: 'All films' }).getAttribute('href')).toBe('/admin/content/filter');
  });
});
