import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const calls = [];
const reload = vi.fn();
const poll = vi.fn();
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
vi.mock('../../../lib/hooks/useApiResource.js', async original => ({
  ...await original(),
  useApiResource: () => ({ data: { films, worker, meta: { indexedAt: '2026-06-30T00:00:00.000Z', total: 8, unlinked: 1, verified: 6, unmatched: 2 } }, hasResult: true, loading: false, error: null, reload, poll, revalidating: false }),
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: async (path, body, method) => {
    calls.push({ path, body, method });
    if (failNext) { const e = new Error(failNext); failNext = null; throw e; }
    return { run: { id: 'r1' } };
  },
}));

const { FilterLibrary, SECTIONS } = await import('./FilterLibrary.jsx');
const { cardStep } = await import('./railStages.js');
const show = (all = true) => {
  try { if (all) localStorage.setItem('cf-library-open', JSON.stringify(['ready', 'review', 'audited', 'scenes', 'refined', 'running', 'rough'])); } catch { /* none */ }
  return render(<MantineProvider><MemoryRouter><FilterLibrary /></MemoryRouter></MantineProvider>);
};
const row = (title) => screen.getByRole('link', { name: new RegExp(title) }).closest('.cf-card');

describe('FilterLibrary', () => {
  beforeEach(() => { calls.length = 0; failNext = null; try { localStorage.clear(); } catch { /* none */ } });

  it('uses the default sections for a non-array preference and preserves an explicitly empty selection', () => {
    localStorage.setItem('cf-library-open', '{}');
    const first = show(false);
    expect(screen.getByRole('button', { name: /^Ready tonight/ })).toHaveAttribute('aria-expanded', 'true');
    first.unmount();
    localStorage.setItem('cf-library-open', '[]');
    show(false);
    expect(screen.getByRole('button', { name: /^Ready tonight/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('pauses active job polling while hidden and immediately reloads on foreground return', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    reload.mockClear();
    poll.mockClear();
    try {
      const { unmount } = show();
      act(() => vi.advanceTimersByTime(10_000));
      expect(reload).not.toHaveBeenCalled();
      expect(poll).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible');
      fireEvent(document, new Event('visibilitychange'));
      expect(reload).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(5000));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(poll).toHaveBeenCalledTimes(1);
      unmount();
      act(() => vi.advanceTimersByTime(5000));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('sections follow the review rail: only an approved film is Ready tonight; every refined film is To review (owner, 2026-11-21/22)', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Ready tonight', 'To review', 'Refining', 'Started', 'Not started']);
    expect(SECTIONS.find((s) => s.id === 'ready').stages).toEqual(['parent']);
    expect(SECTIONS.find((s) => s.id === 'review').stages).toEqual(['machine', 'audited', 'scenes', 'refined']);
  });
  it('groups films by readiness with Ready tonight first and rough collapsed', () => {
    show(false);
    const heads = screen.getAllByRole('button', { name: /^(Ready tonight|To review|Refining|Started|Not started)/ }).map((b) => b.textContent);
    expect(heads.map((h) => h.split(/\d/)[0].trim())).toEqual(['Ready tonight', 'To review', 'Refining', 'Not started']);
    expect(screen.getByRole('link', { name: /Ready One/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Annie/ })).toBeNull();
  });
  it('films not matched to Plex sit in one collapsed section at the bottom, never in a stage group', async () => {
    show();
    const heads = screen.getAllByRole('button', { name: /^(Ready tonight|To review|Refining|Started|Not started|Not matched to Plex)/ }).map((b) => b.textContent);
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
    expect(within(row('Almost Famous')).getByRole('link', { name: 'Start' })).toBeTruthy();
  });
  it('a search counts both sections and keeps the not-matched films apart', () => {
    show(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search titles' }), { target: { value: 'cinder' } });
    expect(screen.getByText('1 of 8 films')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Not matched to Plex\s*1/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Cinderella/ })).toBeNull();
  });
  it('a search flattens to one grid; each card keeps its next step', () => {
    show(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search titles' }), { target: { value: 'annie' } });
    expect(screen.queryByRole('button', { name: /^Not started/ })).toBeNull();
    expect(within(row('Annie')).getByText('Not refined yet')).toBeTruthy();
  });
  it('a card says the film page rail\'s next step, never a pipeline badge', () => {
    const f = (o) => ({ stage: 'machine', job: null, reviewed: { n: 0, m: 18 }, rail: { toRefine: 0, toCheck: 0, redo: 0 }, ...o });
    expect(cardStep(f({ rail: { toRefine: 15, toCheck: 0, redo: 0 } })).text).toBe('15 to refine');
    expect(cardStep(f({})).text).toBe('0 of 18 reviewed');
    expect(cardStep(f({ reviewed: { n: 4, m: 18 }, rail: { toRefine: 0, toCheck: 7, redo: 0 } }))).toMatchObject({ text: '4 of 18 reviewed', note: '7 to check' });
    expect(cardStep(f({ reviewed: { n: 18, m: 18 } }))).toMatchObject({ text: 'Ready', tone: 'ready' });
    expect(cardStep(f({ reviewed: { n: 18, m: 18 }, rail: { toRefine: 0, toCheck: 0, redo: 2 } })).text).toBe('2 marked Redo');
    expect(cardStep(f({ reviewed: { n: 18, m: 18 }, stage: 'audited' })).text).toBe('Not ready yet');
    expect(cardStep(f({ stage: 'parent' })).text).toBe('Approved');
    expect(cardStep(f({ stage: 'running', job: { status: 'running' } })).text).toBe('Refining…');
    show();
    expect(screen.queryByText('Auto-checked')).toBeNull();
    const matilda = row('Matilda');
    expect(matilda.querySelector('.cf-card__step').textContent).toBe('3 of 40 reviewed');
    expect(row('Ready One').querySelector('.cf-card__step').textContent).toBe('Approved');
  });

  it('shows each film with its stage, run and reviewed count', () => {
    show();
    expect(within(row('Back to the Future')).getByText('Running: refine')).toBeTruthy();
    expect(within(row('Matilda')).getByText('Failed at scenes: Jev timed out')).toBeTruthy();
    expect(within(row('Matilda')).getByText('3 of 40 reviewed')).toBeTruthy();
    expect(row('Annie').querySelector('a').getAttribute('href')).toBe('/admin/content/filter/77');
  });
  it('the card button opens the film: Start untouched, Review once started or machine-checked; no run from here', () => {
    show();
    expect(within(row('Annie')).getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/admin/content/filter/77');
    expect(within(row('Matilda')).getByRole('link', { name: 'Review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Make filter|Run again/ })).toBeNull();
  });
  it('a rough film you have opened or run sits in Started, apart from the untouched ones', () => {
    expect(SECTIONS.find((s) => s.id === 'started')).toMatchObject({ stages: ['rough'] });
    const started = SECTIONS.find((s) => s.id === 'started');
    expect(started.when({ stage: 'rough', reviewed: { n: 0, m: 17 } })).toBe(true);
    expect(started.when({ stage: 'rough', reviewed: null, job: null })).toBe(false);
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
