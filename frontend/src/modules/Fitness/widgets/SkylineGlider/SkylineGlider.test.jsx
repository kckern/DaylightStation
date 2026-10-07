import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockCtx;
const { mockLog } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() },
}));
vi.mock('@/context/FitnessContext.jsx', () => ({ useFitnessContext: () => mockCtx }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));
import SkylineGlider from './SkylineGlider.jsx';
import { FlightScene, RpmGauge } from './SkylineGlider.jsx';

const course = { schema: 'skyline-glider-course/v1', id: 'mountain-pass', version: 1, name: 'Mountain Pass', description: 'A five minute alpine flight.', duration_s: 300, motion: { filter_s: .75, deadband_rpm: 2, response_s: 1.5, max_climb_rate: .3, max_descent_rate: .22, coast_s: 1, disconnect_grace_s: .75 }, rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 }, segments: [
  { id: 'open', type: 'open', start_s: 0, end_s: 300 },
  { id: 'bells', type: 'collectible-path', start_s: 2, end_s: 10, collectibles: [{ id: 'bell', at_s: 7, altitude: .5 }] },
  { id: 'hill', type: 'lower-terrain', start_s: 5, end_s: 12, top: .62 },
  { id: 'ceiling', type: 'upper-terrain', start_s: 13, end_s: 18, bottom: .38 },
  { id: 'tunnel', type: 'corridor', start_s: 19, end_s: 26, ceiling: .28, floor: .66 },
  { id: 'finish', type: 'finish', start_s: 300 },
] };

const flightState = {
  courseTime: 8,
  altitude: .5,
  targetAltitude: .35,
  rawRpm: 64,
  filteredRpm: 60,
  verticalRate: -.2,
  calibration: { lowRpm: 30, highRpm: 100 },
  invincibleRemaining: 1,
  phase: 'playing',
};

beforeEach(() => {
  localStorage.clear();
  mockLog.info.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
  mockLog.sampled.mockClear();
  mockCtx = { equipment: [{ id: 'bike', name: 'Bike', cadence: 7, rpm: { min: 30, max: 100 } }], fitnessSessionInstance: { getEquipmentRider: () => 'dad', getEquipmentCadence: () => ({ rpm: 60, connected: true }) }, getDisplayName: () => ({ displayName: 'Dad', source: 'userProfile', preferredGroupLabel: false }), setGovernanceSuspended: vi.fn() };
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [course] }) }));
});

describe('SkylineGlider', () => {
  it('renders actual course geometry scrolling past a right-facing pitched glider', () => {
    const { container } = render(<FlightScene state={flightState} course={course} />);

    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-facing', 'right');
    expect(screen.getByTestId('skyline-glider-craft').getAttribute('transform')).toContain('rotate(-');
    expect(screen.getByTestId('course-segment-hill')).toHaveAttribute('data-type', 'lower-terrain');
    expect(screen.getByTestId('course-segment-ceiling')).toHaveAttribute('data-type', 'upper-terrain');
    expect(screen.getByTestId('course-segment-tunnel')).toHaveAttribute('data-type', 'corridor');
    expect(container.querySelectorAll('.skyline-glider__parallax')).toHaveLength(3);
    expect(screen.getByTestId('skyline-glider-collision-effect')).toBeTruthy();
  });

  it('shows a vertical calibrated RPM gauge whose chevron mirrors craft altitude', () => {
    render(<RpmGauge state={flightState} />);

    const gauge = screen.getByRole('meter', { name: /cadence altitude/i });
    expect(gauge).toHaveAttribute('aria-valuemin', '30');
    expect(gauge).toHaveAttribute('aria-valuemax', '100');
    expect(gauge).toHaveAttribute('aria-valuenow', '64');
    expect(screen.getByTestId('rpm-chevron')).toHaveAttribute('data-altitude', '0.5');
    expect(screen.getByText('64')).toBeTruthy();
  });

  it('loads the lobby and begins with a countdown', async () => {
    vi.useFakeTimers();
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('Mountain Pass');
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    expect(screen.getByTestId('skyline-glider-countdown')).toHaveTextContent('3');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('skyline-glider-flight')).toBeTruthy();
    const mute = screen.getByRole('button', { name: 'Mute' });
    fireEvent.click(mute);
    expect(screen.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-pressed', 'true');
    vi.useRealTimers();
  });

  it('correlates one-second flight samples and explicit exit/save events to the run', async () => {
    vi.useFakeTimers();
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));

    const started = mockLog.info.mock.calls.find(([event]) => event === 'skyline_glider.flight.started');
    expect(started[1]).toMatchObject({ runId: expect.any(String), equipmentId: 'bike', courseId: 'mountain-pass', courseVersion: 1 });

    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(1100));
    const samples = mockLog.info.mock.calls.filter(([event]) => event === 'skyline_glider.flight.sample');
    expect(samples).toHaveLength(2);
    expect(samples[1][1]).toMatchObject({ runId: started[1].runId, courseSecond: 1, rawRpm: 60 });

    fireEvent.click(screen.getByRole('button', { name: /end flight/i }));
    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.flight.exited', expect.objectContaining({ runId: started[1].runId }));
    await act(async () => Promise.resolve());
    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.flight.saved', expect.objectContaining({ runId: started[1].runId, status: 'abandoned' }));
    vi.useRealTimers();
  });

  it('prefers NiceDay over CycleAce regardless of equipment order', async () => {
    mockCtx.equipment = [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 10, rpm: { min: 30, max: 100 } },
      { id: 'niceday', name: 'NiceDay', cadence: 20, rpm: { min: 30, max: 100 } },
    ];
    mockCtx.fitnessSessionInstance.getEquipmentRider = (id) => id === 'niceday' ? 'dad' : 'other';
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('NiceDay');
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('Dad');
  });

  it('uses CycleAce when NiceDay is unavailable', async () => {
    mockCtx.equipment = [
      { id: 'other-bike', name: 'Other Bike', cadence: 10, rpm: { min: 30, max: 100 } },
      { id: 'cycle_ace', name: 'CycleAce', cadence: 20, rpm: { min: 30, max: 100 } },
    ];
    mockCtx.fitnessSessionInstance.getEquipmentRider = (id) => id === 'cycle_ace' ? 'dad' : 'other';
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('CycleAce');
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('Dad');
  });

  it('renders the display name from the canonical identity result', async () => {
    mockCtx.getDisplayName = () => ({
      displayName: 'Test Rider',
      source: 'userProfile',
      preferredGroupLabel: false,
    });

    render(<SkylineGlider />);
    await act(async () => Promise.resolve());

    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('Test Rider');
    expect(screen.getByRole('button', { name: /start flight/i })).toBeEnabled();
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
