import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockCtx;
vi.mock('@/context/FitnessContext.jsx', () => ({ useFitnessContext: () => mockCtx }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }) }));
import SkylineGlider from './SkylineGlider.jsx';

const course = { schema: 'skyline-glider-course/v1', id: 'mountain-pass', version: 1, name: 'Mountain Pass', description: 'A five minute alpine flight.', duration_s: 300, motion: { filter_s: .75, deadband_rpm: 2, response_s: 1.5, max_climb_rate: .3, max_descent_rate: .22, coast_s: 1, disconnect_grace_s: .75 }, rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 }, segments: [{ id: 'open', type: 'open', start_s: 0, end_s: 300 }, { id: 'finish', type: 'finish', start_s: 300 }] };

beforeEach(() => {
  localStorage.clear();
  mockCtx = { equipment: [{ id: 'bike', name: 'Bike', cadence: 7, rpm: { min: 30, max: 100 } }], fitnessSessionInstance: { getEquipmentRider: () => 'dad', getEquipmentCadence: () => ({ rpm: 60, connected: true }) }, getDisplayName: () => 'Dad', setGovernanceSuspended: vi.fn() };
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [course] }) }));
});

describe('SkylineGlider', () => {
  it('loads the lobby and begins with a countdown', async () => {
    vi.useFakeTimers();
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('Mountain Pass');
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    expect(screen.getByTestId('skyline-glider-countdown')).toHaveTextContent('3');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('skyline-glider-flight')).toBeTruthy();
    vi.useRealTimers();
  });

  it('offers resume and start over for a saved checkpoint', async () => {
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', JSON.stringify({ courseTime: 75, altitude: .5, collectedIds: ['a'], checkpoint: { id: 'cp', time: 75, collectedIds: ['a'] } }));
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('button', { name: /resume/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /start over/i })).toBeTruthy();
  });

  it('shows a reconnect overlay when cadence transport is absent', async () => {
    vi.useFakeTimers();
    mockCtx.fitnessSessionInstance.getEquipmentCadence = () => ({ rpm: 0, connected: false });
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('skyline-glider-reconnect')).toBeTruthy();
    vi.useRealTimers();
  });
});
