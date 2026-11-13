import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn(async () => ({}));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
const { FilmStatusCard } = await import('./FilmStatusCard.jsx');

const show = (props) => render(<MantineProvider><FilmStatusCard ratingKey="699056" onChanged={() => {}} onReview={() => {}} {...props} /></MantineProvider>);
const t2 = { filters: { present: true, parts: 243 }, refined: { present: true, measured: 95, of: 243 }, certified: 'machine', next: 'checking' };

beforeEach(() => api.mockClear());

describe('FilmStatusCard', () => {
  it('T2: filters yes, refined 95 of 243, machine-certified, checking', () => {
    show({ status: t2 });
    expect(screen.getByText('Filters: Yes — 243 parts')).toBeTruthy();
    expect(screen.getByText('Refined: Yes — 95 of 243 measured to the millisecond')).toBeTruthy();
    expect(screen.getByText('Machine-certified')).toBeTruthy();
    expect(screen.getByText('Checking the result…')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('a rough film: Refine queues the whole pipeline', async () => {
    show({ status: { filters: { present: true, parts: 220 }, refined: { present: false, measured: 0, of: 220 }, certified: 'none', next: 'refine' } });
    expect(screen.getByText('Refined: No')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refine' })); });
    expect(api).toHaveBeenCalledWith('api/v1/content-filter/699056/jobs', { kind: 'make' }, 'POST');
  });
  it('no filters at all says so and offers nothing', () => {
    show({ status: { filters: { present: false, parts: 0 }, refined: { present: false, measured: 0, of: 0 }, certified: 'none', next: 'none' } });
    expect(screen.getByText('Filters: None for this film yet')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('review and approve', async () => {
    const onReview = vi.fn();
    const { unmount } = show({ status: { ...t2, next: 'review' }, onReview });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onReview).toHaveBeenCalled();
    unmount();
    show({ status: { ...t2, next: 'approve' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve for family' })); });
    expect(api).toHaveBeenCalledWith('api/v1/content-filter/699056/signoff', {}, 'POST');
  });
  it('parent-certified shows who approved', () => {
    show({ status: { ...t2, certified: 'parent', next: 'done' }, approvedBy: 'Dad' });
    expect(screen.getByText('Approved for family by Dad')).toBeTruthy();
  });
  it('running: phases, measured n of N, ETA, latest parts in words, and Stop with a confirm', async () => {
    const now = Date.parse('2026-11-12T23:10:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const job = { id: 'r1', kind: 'make', status: 'running', step: 'refine', steps: [
      { name: 'preflight', status: 'done' },
      { name: 'refine', status: 'running', progress: { phase: 'measure', done: 6, total: 220, firstAt: '2026-11-12T23:00:00Z', recent: [
        { cue: 'va2', kind: 'visual', status: 'unknown', detail: 'edge-all-unsure' }, { cue: 'va1', kind: 'visual', status: 'refined', detail: '396.897–400.609' }] } }] };
    show({ status: { ...t2, next: 'running' }, job });
    expect(screen.getByText('Measuring each part — 6 of 220')).toBeTruthy();
    expect(screen.getByText('ETA about 5 h 57 min')).toBeTruthy();
    expect(screen.getByText("va2 picture: couldn't pin the edges (edge-all-unsure)")).toBeTruthy();
    expect(screen.getByText('va1 picture: 396.897–400.609')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Stop this run? Nothing from this run is saved.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop run' })); });
    expect(api).toHaveBeenCalledWith('api/v1/content-filter/699056/jobs/r1/cancel', {}, 'POST');
    vi.restoreAllMocks();
  });
  it('never offers a stage dropdown', () => {
    show({ status: t2 });
    expect(screen.queryByText(/Stage again/)).toBeNull();
  });
});
