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
  mockCtx = { equipment: [{ id: 'bike', name: 'Bike', cadence: 7, rpm: { min: 30, max: 100 } }], fitnessSessionInstance: { sessionId: 'fs-test', treasureBox: { awardBonus: vi.fn() }, getEquipmentRider: () => 'dad', getEquipmentCadence: () => ({ rpm: 60, connected: true, ts: Date.now() + 1 }) }, getDisplayName: () => ({ displayName: 'Dad', source: 'userProfile', preferredGroupLabel: false }), setGovernanceSuspended: vi.fn() };
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [course] }) }));
});

describe('SkylineGlider', () => {
  it('renders actual course geometry scrolling past a right-facing pitched glider', () => {
    const { container } = render(<FlightScene state={flightState} course={course} />);

    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-facing', 'right');
    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-front-seconds', '0.8');
    expect(screen.getByTestId('skyline-glider-craft')).toHaveAttribute('data-rear-seconds', '0.67');
    expect(screen.getByTestId('skyline-glider-craft').getAttribute('transform')).toContain('translate(240 ');
    expect(screen.getByTestId('skyline-glider-craft').getAttribute('transform')).toContain('rotate(-');
    expect(screen.getByTestId('course-segment-hill')).toHaveAttribute('data-type', 'lower-terrain');
    expect(screen.getByTestId('course-segment-ceiling')).toHaveAttribute('data-type', 'upper-terrain');
    expect(screen.getByTestId('course-segment-tunnel')).toHaveAttribute('data-type', 'corridor');
    expect(container.querySelectorAll('.skyline-glider__parallax')).toHaveLength(3);
    expect(screen.getByTestId('skyline-glider-collision-effect')).toBeTruthy();
  });

  it('removes a collected bell from the course scene', () => {
    render(<FlightScene state={{ ...flightState, collectedIds: ['bell'] }} course={course} />);

    expect(screen.queryByTestId('course-collectible-bell')).toBeNull();
  });

  it('shows a vertical calibrated RPM gauge whose chevron mirrors craft altitude', () => {
    render(<RpmGauge state={{ ...flightState, altitude: 0.18, targetAltitude: 0.78 }} />);

    const gauge = screen.getByRole('meter', { name: /cadence altitude/i });
    expect(gauge).toHaveAttribute('aria-valuemin', '30');
    expect(gauge).toHaveAttribute('aria-valuemax', '100');
    expect(gauge).toHaveAttribute('aria-valuenow', '64');
    expect(screen.getByTestId('rpm-chevron')).toHaveAttribute('data-altitude', '0.18');
    expect(screen.getByTestId('rpm-chevron')).toHaveStyle({ top: '0%' });
    expect(screen.getByTestId('rpm-target')).toHaveStyle({ top: '100%' });
    expect(screen.getByText('64')).toBeTruthy();
  });

  it('drives flight presentation with animation frames instead of a 100ms interval', async () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3000));

    expect(raf).toHaveBeenCalled();
    raf.mockRestore();
    vi.useRealTimers();
  });

  it('waits at course time zero for a cadence packet newer than Start', async () => {
    vi.useFakeTimers();
    mockCtx.fitnessSessionInstance.getEquipmentCadence = () => ({ rpm: 60, connected: true, ts: Date.now() - 1 });
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3500));

    expect(screen.getByTestId('skyline-glider-flight')).toHaveAttribute('data-course-time', '0');
    expect(screen.getByTestId('skyline-glider-waiting-input')).toHaveTextContent(/pedal/i);
    vi.useRealTimers();
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

  it('logs resumable flight state when the game unmounts mid-flight', async () => {
    vi.useFakeTimers();
    const view = render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3100));

    view.unmount();

    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.flight.suspended', expect.objectContaining({
      runId: expect.any(String), courseTime: expect.any(Number), inputMode: expect.any(String), reason: 'unmount',
    }));
    expect(mockLog.info.mock.calls.some(([event]) => event === 'skyline_glider.flight.saved')).toBe(false);
    vi.useRealTimers();
  });

  it('logs aggregate render health once per ten-second window without frame logs', async () => {
    vi.useFakeTimers();
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(10050));
    const health = mockLog.info.mock.calls.filter(([event]) => event === 'skyline_glider.render.health');
    expect(health).toHaveLength(1);
    expect(health[0][1]).toMatchObject({ frameCount: expect.any(Number), updateRateHz: expect.any(Number), longFrameCount: expect.any(Number), windowMs: expect.any(Number) });
    expect(mockLog.info.mock.calls.some(([event]) => event === 'skyline_glider.render.frame')).toBe(false);
    vi.useRealTimers();
  });

  it('executes and logs a bell pop once, then removes the transient presentation', async () => {
    vi.useFakeTimers();
    const { container } = render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(6600));

    expect(container.querySelectorAll('.skyline-glider__bell-pop')).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.effect.executed', expect.objectContaining({ effectId: 'bell-pop', eventType: 'collectible' }));
    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.effect.skipped', expect.objectContaining({ effectId: 'bell-cue', reason: 'audio-unavailable' }));

    act(() => vi.advanceTimersByTime(700));
    expect(container.querySelectorAll('.skyline-glider__bell-pop')).toHaveLength(0);
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
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', JSON.stringify({ schema: 'skyline-glider-checkpoint/v3', course: { id: 'mountain-pass', version: 1 }, lifecycle: 'active', identity: { fitnessSessionId: 'fs-test', riderId: 'dad', equipmentId: 'bike', calibration: { lowRpm: 30, highRpm: 100 }, runId: 'original-run', startedAt: '2026-10-07T18:00:00Z' }, state: { courseTime: 75, altitude: .5, collectedIds: ['a'], checkpoint: { id: 'cp', time: 75, collectedIds: ['a'] } } }));
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('button', { name: /resume/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /start over/i })).toBeTruthy();
  });

  it('re-arms input freshness when resuming and preserves the original run identity', async () => {
    vi.useFakeTimers();
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', JSON.stringify({ schema: 'skyline-glider-checkpoint/v3', course: { id: 'mountain-pass', version: 1 }, lifecycle: 'active', identity: { fitnessSessionId: 'fs-test', riderId: 'dad', equipmentId: 'bike', calibration: { lowRpm: 30, highRpm: 100 }, runId: 'original-run', startedAt: '2026-10-07T18:00:00Z' }, state: { courseTime: 75, altitude: .5, inputReady: true, armedAtMs: 1, collectedIds: [], checkpoint: { id: 'cp', time: 75, collectedIds: [] }, phase: 'playing' } }));
    mockCtx.fitnessSessionInstance.getEquipmentCadence = () => ({ rpm: 60, connected: true, ts: 2 });
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /resume flight/i }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('skyline-glider-waiting-input')).toBeTruthy();
    expect(screen.getByTestId('skyline-glider-flight')).toHaveAttribute('data-course-time', '75');
    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.flight.started', expect.objectContaining({ runId: 'original-run', resumed: true }));
    vi.useRealTimers();
  });

  it('persists the saved attempt as abandoned before Start Over begins a new run', async () => {
    vi.useFakeTimers();
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', JSON.stringify({ schema: 'skyline-glider-checkpoint/v3', course: { id: 'mountain-pass', version: 1 }, lifecycle: 'active', identity: { fitnessSessionId: 'fs-test', riderId: 'dad', equipmentId: 'bike', calibration: { lowRpm: 30, highRpm: 100 }, runId: 'old-run', startedAt: '2026-10-07T18:00:00Z' }, state: { courseTime: 75, altitude: .5, collisions: 1, restarts: 0, collectedIds: [], checkpoint: { id: 'cp', time: 75, collectedIds: [] }, phase: 'playing', calibration: { lowRpm: 30, highRpm: 100 } } }));
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start over/i }));
    await act(async () => Promise.resolve());
    const savedRecord = JSON.parse(global.fetch.mock.calls[1][1].body).record;
    expect(savedRecord).toMatchObject({ run: { id: 'old-run', status: 'abandoned', duration_s: 75 } });
    expect(screen.getByTestId('skyline-glider-countdown')).toBeTruthy();
    vi.useRealTimers();
  });

  it('falls back to connected CycleAce when configured NiceDay is unusable', async () => {
    mockCtx.equipment = [
      { id: 'niceday', name: 'NiceDay', cadence: 20, rpm: { min: 30, max: 100 } },
      { id: 'cycle_ace', name: 'CycleAce', cadence: 10, rpm: { min: 30, max: 100 } },
    ];
    mockCtx.fitnessSessionInstance.getEquipmentRider = () => 'dad';
    mockCtx.fitnessSessionInstance.getEquipmentCadence = (id) => id === 'cycle_ace'
      ? { rpm: 60, connected: true, ts: Date.now() + 1 }
      : { rpm: 0, connected: false };
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('skyline-glider-lobby')).toHaveTextContent('CycleAce');
  });

  it('enables Start when a bike becomes live after the lobby mounts', async () => {
    vi.useFakeTimers();
    let connected = false;
    mockCtx.fitnessSessionInstance.getEquipmentCadence = () => ({ rpm: connected ? 60 : 0, connected, ts: Date.now() + 1 });
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('button', { name: /start flight/i })).toBeDisabled();
    connected = true;
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('button', { name: /start flight/i })).toBeEnabled();
    vi.useRealTimers();
  });

  it('lets the rider choose another usable bike and locks it for the attempt', async () => {
    vi.useFakeTimers();
    mockCtx.equipment = [
      { id: 'niceday', name: 'NiceDay', cadence: 20, rpm: { min: 30, max: 100 } },
      { id: 'cycle_ace', name: 'CycleAce', cadence: 10, rpm: { min: 30, max: 100 } },
    ];
    mockCtx.fitnessSessionInstance.getEquipmentRider = (id) => id === 'niceday' ? 'test-rider' : 'dad';
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByRole('combobox', { name: 'Bike' }), { target: { value: 'cycle_ace' } });
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    expect(mockLog.info).toHaveBeenCalledWith('skyline_glider.flight.started', expect.objectContaining({ equipmentId: 'cycle_ace', riderId: 'dad' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('skyline-glider-flight')).toBeTruthy();
    vi.useRealTimers();
  });

  it('freezes immediately and preserves an exact pending terminal record when saving fails', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ courses: [course] }) })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('button', { name: /end flight/i }));
    expect(screen.getByTestId('skyline-glider-result')).toHaveTextContent('Saving flight');
    await act(async () => Promise.resolve());
    expect(screen.getByRole('button', { name: /retry save/i })).toBeTruthy();
    const pending = JSON.parse(localStorage.getItem('fitness:skyline-glider:dad:mountain-pass'));
    expect(pending).toMatchObject({ schema: 'skyline-glider-checkpoint/v3', lifecycle: 'pending_terminal', terminalRecord: { run: { status: 'abandoned' } } });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).record).toEqual(pending.terminalRecord);
    vi.useRealTimers();
  });

  it('saves an old-session terminal record without awarding it into the current session', async () => {
    const terminalRecord = { schema: 'skyline-glider-run/v1', run: { id: 'old-complete', course_id: 'mountain-pass', course_version: 1, started_at: '2026-10-07T18:00:00Z', ended_at: '2026-10-07T18:05:00Z', status: 'completed', duration_s: 300, collisions: 0, restarts: 0, reward_rings: 10, fitness_session_id: 'fs-old', equipment_id: 'bike', calibration: { low_rpm: 30, high_rpm: 100 } }, rider: { user_id: 'dad' }, collectibles: [], result: { schema: 'gaming-result/v1' } };
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', JSON.stringify({ schema: 'skyline-glider-checkpoint/v3', course: { id: 'mountain-pass', version: 1 }, lifecycle: 'pending_terminal', identity: { fitnessSessionId: 'fs-old', riderId: 'dad', equipmentId: 'bike', calibration: { lowRpm: 30, highRpm: 100 }, runId: 'old-complete', startedAt: '2026-10-07T18:00:00Z' }, state: { courseTime: 300, altitude: .5, collisions: 0, restarts: 0, collectedIds: [], calibration: { lowRpm: 30, highRpm: 100 } }, terminalRecord }));
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /retry saving previous flight/i }));
    fireEvent.click(screen.getByRole('button', { name: /^retry save$/i }));
    await act(async () => Promise.resolve());
    expect(mockCtx.fitnessSessionInstance.treasureBox.awardBonus).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith('skyline_glider.reward.skipped', expect.objectContaining({ runId: 'old-complete', fitnessSessionId: 'fs-old', reason: 'terminal-identity-changed' }));
  });

  it('does not offer resume for a legacy unversioned checkpoint', async () => {
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', JSON.stringify({ courseTime: 75, altitude: .5 }));
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
    expect(screen.getByRole('button', { name: /start flight/i })).toBeEnabled();
  });

  it('shows a reconnect overlay only after the inferred-slowdown grace expires', async () => {
    vi.useFakeTimers();
    let cadence = { rpm: 60, connected: true, ts: Date.now() + 1 };
    mockCtx.fitnessSessionInstance.getEquipmentCadence = () => cadence;
    render(<SkylineGlider />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /start flight/i }));
    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(20));
    cadence = { rpm: 0, connected: false };
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('skyline-glider-reconnect')).toBeNull();
    act(() => vi.advanceTimersByTime(4500));
    expect(screen.getByTestId('skyline-glider-reconnect')).toBeTruthy();
    vi.useRealTimers();
  });
});
