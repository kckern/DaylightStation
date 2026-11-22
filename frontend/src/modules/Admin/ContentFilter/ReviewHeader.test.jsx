import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));
const { ReviewHeader, runLine, runState } = await import('./ReviewHeader.jsx');

const data = (o = {}) => ({ title: 'Sonic the Hedgehog', certification: { level: 'none' }, job: null, status: { next: 'review' }, signOff: { parent: null }, ...o });
const show = (props = {}) => render(<MantineProvider><MemoryRouter>
  <ReviewHeader ratingKey="775444" data={data()} stage="refine" roughFiltered={13} handlers={{}} {...props} />
</MemoryRouter></MantineProvider>);

describe('runLine', () => {
  const refine = (progress) => ({ status: 'running', step: 'refine', steps: [{ name: 'refine', progress }] });
  it('says how far a refine is, part by part', () => {
    expect(runLine(refine({ phase: 'measure', done: 5, total: 17 }))).toBe('Refining 5 of 17');
  });
  it('the first refine of a film prepares it (transcript and clock) once', () => {
    expect(runLine(refine({ phase: 'transcribe' }))).toBe('Transcribing the film (one time)…');
    expect(runLine(refine({ phase: 'sync' }))).toBe('Lining up the film\'s clock…');
  });
  it('a queued run waits for the worker, and says when no worker runs', () => {
    expect(runLine({ status: 'queued' })).toBe('Waiting for the worker');
    expect(runLine({ status: 'queued' }, { alive: false })).toMatch(/not running/);
  });
  it('a finished run says nothing', () => { expect(runLine({ status: 'done' })).toBeNull(); expect(runLine(null)).toBeNull(); });
});

describe('ReviewHeader', () => {
  it('is one line: back, title, and on the Refine tab Refine all N (the counts live in the rail)', () => {
    const refineAll = vi.fn();
    show({ handlers: { refineAll } });
    expect(screen.getByText('‹ Films')).toBeTruthy();
    expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy();
    expect(screen.queryByText(/reviewed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Refine all 13/ }));
    expect(refineAll).toHaveBeenCalled();
  });
  it('Refine all belongs to the Refine tab: the other tabs do not offer it', () => {
    show({ stage: 'review' });
    expect(screen.queryByRole('button', { name: /^Refine all/ })).toBeNull();
  });
  it('while a run is open it offers Stop instead (the rail says how far the run is)', () => {
    show({ data: data({ job: { id: 'r1', status: 'running', step: 'refine', steps: [{ name: 'refine', progress: { phase: 'measure', done: 2, total: 17 } }] } }) });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Refine all/ })).toBeNull();
  });
  it('an interrupted run is a red chip, not a banner', () => {
    show({ data: data({ job: { id: 'r1', status: 'interrupted', step: 'refine' } }) });
    expect(screen.getByText('Last refine stopped early; nothing was kept')).toBeTruthy();
  });
  it('a run that may be stuck is spelled out in the header', () => {
    const at = new Date(Date.now() - 40 * 60000).toISOString();
    show({ data: data({ job: { id: 'r1', status: 'running', step: 'refine', steps: [{ name: 'refine', startedAt: at, progress: { phase: 'measure', done: 2, total: 17, at } }] } }) });
    expect(screen.getByRole('alert').textContent).toMatch(/Refining 2 of 17: no progress for 40 min\. It may be stuck/);
  });
  it('approval is not a header action: it lives in the Approve tab', () => {
    show({ stage: 'approve', roughFiltered: 0, data: data({ status: { next: 'approve' } }) });
    expect(screen.queryByRole('button', { name: 'Approve for family' })).toBeNull();
  });
  it('a film not matched to Plex offers no run', () => {
    show({ blocked: true });
    expect(screen.queryByRole('button', { name: /^Refine all/ })).toBeNull();
  });
});

describe('runState never lies (owner, 2026-11-22)', () => {
  const at = (min) => new Date(Date.parse('2026-11-22T12:00:00Z') + min * 60000).toISOString();
  const now = Date.parse('2026-11-22T12:00:00Z') + 149 * 60000;
  const job = (progress) => ({ status: 'running', step: 'refine', steps: [{ name: 'refine', status: 'running', startedAt: at(0), progress }] });
  it('names the real step and how long it has been in it', () => {
    expect(runState(job({ phase: 'transcribe', at: at(100) }), null, now).text).toBe('Transcribing the film (one time) · 49 min');
    expect(runState(job({ phase: 'copy-wait', at: at(140) }), null, now).text).toBe('Waiting for the film copy · 9 min');
  });
  it('says it may be stuck once a step runs past what it ever takes', () => {
    const r = runState(job({ phase: 'copy-wait', at: at(0) }), null, now);
    expect(r.stuck).toBe(true);
    expect(r.text).toBe('Waiting for the film copy: no progress for 2 h 29 min. It may be stuck; Stop it and refine again.');
  });
  it('a queued run with no worker is flagged, not "waiting" forever', () => {
    expect(runState({ status: 'queued' }, { alive: false }, now)).toEqual({ text: 'Waiting for the filter worker (not running)', stuck: true, brief: 'Filter worker not running' });
  });
});
