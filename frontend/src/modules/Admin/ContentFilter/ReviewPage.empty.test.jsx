import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// A film with no parts listed yet says why, instead of "change the filters" (2026-11-12 render).
let payload;
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div data-testid="player" /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const base = { title: 'The Terminator', certification: { level: 'none' }, audit: null, rows: [], reviewed: 0, total: 0, job: null, signOff: { ready: false, missing: [], parent: null } };
const show = () => render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/filter/700804']}><Routes>
  <Route path="/admin/content/filter/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);

describe('review page with no parts listed', () => {
  it.each([
    ['refine', 'No parts to review until the film is refined.'],
    ['checking', 'The list appears when the check finishes.'],
    ['running', 'The list appears when the run finishes.'],
  ])('next %s says why the list is empty', (next, text) => {
    payload = { ...base, status: { filters: { present: true, parts: 220 }, refined: { present: false, measured: 0, of: 220 }, certified: 'none', next } };
    show();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/Change the filters/)).toBeNull();
  });
  it('checking shows its words beside the spinner', () => {
    payload = { ...base, status: { filters: { present: true, parts: 243 }, refined: { present: true, measured: 95, of: 243 }, certified: 'machine', next: 'checking' } };
    show();
    expect(screen.getByText('Checking the result…')).toBeTruthy();
  });
});
