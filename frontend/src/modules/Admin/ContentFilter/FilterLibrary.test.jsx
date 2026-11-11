import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const calls = [];
let failNext = null;
let worker = { alive: true };
const films = [
  { ratingKey: '77', title: 'Annie', year: 1982, stage: 'rough', job: null, reviewed: null, linked: true, thumb: '/t/77' },
  { ratingKey: '66', title: 'Lost Film', year: 1970, stage: 'rough', job: null, reviewed: null, linked: false, thumb: null, match: 'unmatched', unmatched: { reason: 'not-in-plex', text: 'no Plex film' } },
  { ratingKey: '67', title: 'Cinderella', year: 2021, stage: 'rough', job: null, reviewed: null, linked: true, thumb: null, match: 'unmatched', unmatched: { reason: 'year-mismatch', text: 'Plex has the 1950 film' } },
  { ratingKey: '68', title: 'Almost Famous', year: 2000, stage: 'rough', job: null, reviewed: null, linked: true, thumb: '/t/68', match: 'verified', unmatched: null, runtimeWarning: { edlMin: 124, plexMin: 162 } },
  { ratingKey: '55', title: 'Ready One', year: 2000, stage: 'parent', job: null, reviewed: null, linked: true, thumb: '/t/55' },
  { ratingKey: '80', title: 'Zorro', year: 1998, stage: 'running', job: { status: 'queued', step: null, error: null }, reviewed: null },
  { ratingKey: '78', title: 'Back to the Future', year: 1985, stage: 'running', job: { status: 'running', step: 'refine', error: null }, reviewed: null },
  { ratingKey: '79', title: 'Matilda', year: 1996, stage: 'audited', job: { status: 'failed', step: 'scenes', error: 'Jev timed out' }, reviewed: { n: 3, m: 40 } },
];
vi.mock('../../../lib/hooks/useApiResource.js', () => ({
  useApiResource: () => ({ data: { films, worker, meta: { indexedAt: '2026-06-30T00:00:00.000Z', total: 8, unlinked: 1, verified: 6, unmatched: 2 } }, loading: false, error: null, reload: () => {} }),
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: async (path, body, method) => {
    calls.push({ path, body, method });
    if (failNext) { const e = new Error(failNext); failNext = null; throw e; }
    return { run: { id: 'r1' } };
  },
}));

const { FilterLibrary } = await import('./FilterLibrary.jsx');
const show = (all = true) => {
  try { if (all) localStorage.setItem('cf-library-open', JSON.stringify(['ready', 'audited', 'scenes', 'refined', 'running', 'rough'])); } catch { /* none */ }
  return render(<MantineProvider><MemoryRouter><FilterLibrary /></MemoryRouter></MantineProvider>);
};
const row = (title) => screen.getByRole('link', { name: new RegExp(title) }).closest('.cf-card');

describe('FilterLibrary', () => {
  beforeEach(() => { calls.length = 0; failNext = null; try { localStorage.clear(); } catch { /* none */ } });

  it('groups films by readiness with Ready tonight first and rough collapsed', () => {
    show(false);
    const heads = screen.getAllByRole('button', { name: /^(Ready tonight|Running|Audited|Rough)/ }).map((b) => b.textContent);
    expect(heads.map((h) => h.split(/\d/)[0].trim())).toEqual(['Ready tonight', 'Audited', 'Running', 'Rough']);
    expect(screen.getByRole('link', { name: /Ready One/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Annie/ })).toBeNull();
  });
  it('films not matched to Plex sit in one collapsed section at the bottom, never in a stage group', async () => {
    show();
    const heads = screen.getAllByRole('button', { name: /^(Ready tonight|Running|Audited|Rough|Not matched to Plex)/ }).map((b) => b.textContent);
    expect(heads.at(-1)).toMatch(/^Not matched to Plex\s*2/);
    expect(screen.queryByRole('link', { name: /Lost Film/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Cinderella/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Not matched to Plex/ }));
    const item = (await screen.findByRole('link', { name: /Cinderella/ })).closest('.cf-unmatched__row');
    expect(within(item).getByText('Plex has the 1950 film')).toBeTruthy();
    expect(within(item).queryByRole('button', { name: /Make filter|Run again/ })).toBeNull();
    expect(item.querySelector('a').getAttribute('href')).toBe('/admin/content/filter/67');
    expect(screen.getByText(/Index from .*8 titles · 6 matched to Plex · 2 not/)).toBeTruthy();
  });
  it('a runtime that differs by more than 5 minutes is a small note on a verified card', () => {
    show();
    expect(within(row('Almost Famous')).getByText('Runtime 162 min (VidAngel 124)')).toBeTruthy();
    expect(within(row('Almost Famous')).getByRole('button', { name: 'Make filter' }).disabled).toBe(false);
  });
  it('a search counts both sections and keeps the not-matched films apart', () => {
    show(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search titles' }), { target: { value: 'cinder' } });
    expect(screen.getByText('1 of 8 films')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Not matched to Plex\s*1/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Cinderella/ })).toBeNull();
  });
  it('a search flattens to one grid with stage chips', () => {
    show(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search titles' }), { target: { value: 'annie' } });
    expect(screen.queryByRole('button', { name: /^Rough/ })).toBeNull();
    expect(within(row('Annie')).getByText('Rough')).toBeTruthy();
  });

  it('shows each film with its stage, run and reviewed count', () => {
    show();
    expect(within(row('Back to the Future')).getByText('Running: refine')).toBeTruthy();
    expect(within(row('Matilda')).getByText('Failed at scenes: Jev timed out')).toBeTruthy();
    expect(within(row('Matilda')).getByText('3 of 40')).toBeTruthy();
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
    expect(screen.queryByRole('link', { name: /Annie/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Matilda/ })).toBeTruthy();
  });
  it('a queued run waits visibly when no filter worker is running', () => {
    worker = { alive: false };
    show();
    expect(within(row('Zorro')).getByText('Waiting for a filter worker')).toBeTruthy();
    expect(screen.getByText(/No filter worker is running/)).toBeTruthy();
    worker = { alive: true };
  });
});
