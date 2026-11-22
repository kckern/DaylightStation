import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));
const { ReviewHeader, runLine } = await import('./ReviewHeader.jsx');

const data = (o = {}) => ({ title: 'Sonic the Hedgehog', certification: { level: 'none' }, job: null, status: { next: 'review' }, signOff: { parent: null }, ...o });
const show = (props = {}) => render(<MantineProvider><MemoryRouter>
  <ReviewHeader ratingKey="775444" data={data()} tally={{ done: 4, total: 17 }} roughFiltered={13} handlers={{}} approval={{}} {...props} />
</MemoryRouter></MantineProvider>);

describe('runLine', () => {
  const refine = (progress) => ({ status: 'running', step: 'refine', steps: [{ name: 'refine', progress }] });
  it('says how far a refine is, part by part', () => {
    expect(runLine(refine({ phase: 'measure', done: 5, total: 17 }))).toBe('Refining 5 of 17');
  });
  it('the first refine of a film prepares it (transcript and clock) once', () => {
    expect(runLine(refine({ phase: 'transcribe' }))).toBe('Preparing the film (one time)…');
    expect(runLine(refine({ phase: 'sync' }))).toBe('Preparing the film (one time)…');
  });
  it('a queued run waits for the worker, and says when no worker runs', () => {
    expect(runLine({ status: 'queued' })).toBe('Waiting for the worker');
    expect(runLine({ status: 'queued' }, { alive: false })).toMatch(/not running/);
  });
  it('a finished run says nothing', () => { expect(runLine({ status: 'done' })).toBeNull(); expect(runLine(null)).toBeNull(); });
});

describe('ReviewHeader', () => {
  it('is one line: back, title, the count and the rough parts, and Refine all N', () => {
    const refineAll = vi.fn();
    show({ handlers: { refineAll } });
    expect(screen.getByText('‹ Films')).toBeTruthy();
    expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy();
    expect(screen.getByText('4 of 17 reviewed · 13 rough')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Refine all 13/ }));
    expect(refineAll).toHaveBeenCalled();
  });
  it('while a run is open it shows its progress and Stop instead', () => {
    show({ data: data({ job: { id: 'r1', status: 'running', step: 'refine', steps: [{ name: 'refine', progress: { phase: 'measure', done: 2, total: 17 } }] } }) });
    expect(screen.getByText('Refining 2 of 17')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Refine all/ })).toBeNull();
  });
  it('an interrupted run is a red chip, not a banner', () => {
    show({ data: data({ job: { id: 'r1', status: 'interrupted', step: 'refine' } }) });
    expect(screen.getByText('Last refine stopped early; nothing was kept')).toBeTruthy();
  });
  it('once nothing is rough and the sign-off would be accepted, Approve for family is the action', () => {
    show({ roughFiltered: 0, data: data({ status: { next: 'approve' } }), approval: { blocked: false } });
    expect(screen.getByRole('button', { name: 'Approve for family' })).toBeTruthy();
  });
  it('a film not matched to Plex offers no run', () => {
    show({ blocked: true });
    expect(screen.queryByRole('button', { name: /^Refine all/ })).toBeNull();
  });
});
