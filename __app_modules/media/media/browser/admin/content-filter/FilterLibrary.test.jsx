import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const calls = [];
let failNext = null;
const films = [
  { ratingKey: '77', title: 'Annie', year: 1982, stage: 'rough', job: null, reviewed: null },
  { ratingKey: '78', title: 'Back to the Future', year: 1985, stage: 'running', job: { status: 'running', step: 'refine', error: null }, reviewed: null },
  { ratingKey: '79', title: 'Matilda', year: 1996, stage: 'audited', job: { status: 'failed', step: 'scenes', error: 'Jev timed out' }, reviewed: { n: 3, m: 40 } },
];
vi.mock('../../../../../../frontend/src/lib/hooks/useApiResource.js', () => ({
  useApiResource: () => ({ data: { films }, loading: false, error: null, reload: () => {} }),
}));
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: async (path, body, method) => {
    calls.push({ path, body, method });
    if (failNext) { const e = new Error(failNext); failNext = null; throw e; }
    return { run: { id: 'r1' } };
  },
}));

const { FilterLibrary } = await import('./FilterLibrary.jsx');
const show = () => render(<MantineProvider><MemoryRouter><FilterLibrary /></MemoryRouter></MantineProvider>);
const row = (title) => screen.getByRole('link', { name: title }).closest('tr');

describe('FilterLibrary', () => {
  beforeEach(() => { calls.length = 0; failNext = null; });

  it('shows each film with its stage, run and reviewed count', () => {
    show();
    expect(within(row('Back to the Future')).getByText('Running: refine')).toBeTruthy();
    expect(within(row('Matilda')).getByText('Failed at scenes: Jev timed out')).toBeTruthy();
    expect(within(row('Matilda')).getByText('3 of 40')).toBeTruthy();
    expect(within(row('Annie')).getByText('Rough')).toBeTruthy();
    expect(row('Annie').querySelector('a').getAttribute('href')).toBe('/admin/content/filter/77');
  });
  it('"Make filter" queues a make run for a rough film', async () => {
    show();
    fireEvent.click(within(row('Annie')).getByRole('button', { name: 'Make filter' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/jobs', body: { kind: 'make' }, method: 'POST' });
  });
  it('the button is disabled for a running film and reads "Run again" after a failure', () => {
    show();
    expect(within(row('Back to the Future')).getByRole('button', { name: 'Run again' }).disabled).toBe(true);
    expect(within(row('Matilda')).getByRole('button', { name: 'Run again' }).disabled).toBe(false);
  });
  it('a refused run shows its message', async () => {
    failNext = 'This film already has a run queued or running.';
    show();
    fireEvent.click(within(row('Annie')).getByRole('button', { name: 'Make filter' }));
    expect(await screen.findByText('This film already has a run queued or running.')).toBeTruthy();
  });
  it('the title search narrows the rows', () => {
    show();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search titles' }), { target: { value: 'mat' } });
    expect(screen.queryByRole('link', { name: 'Annie' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Matilda' })).toBeTruthy();
  });
});
