import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import RaceRecap from './RaceRecap.jsx';

const candidate = {
  raceId: '20260603120000',
  winCondition: 'distance',
  goalM: 100,
  timeCapS: null,
  intervalSeconds: 1,
  day: '2026-06-03',
  timeOfDay: '12:00 pm',
  winnerName: 'Milo',
  participants: [
    { id: 'milo', displayName: 'Milo', avatarSrc: '/api/v1/static/img/users/milo',
      distanceSeries: JSON.stringify([20, 60, 100]), hrSeries: JSON.stringify([150, 158, 165]),
      finalDistanceM: 100, finalTimeS: 3, placement: 1 }
  ]
};

describe('RaceRecap', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the recap with the race screen + playback controls (no results panel), and closes', () => {
    const onClose = vi.fn();
    const { getByTestId, queryByTestId } = render(<RaceRecap candidate={candidate} onClose={onClose} />);
    expect(getByTestId('race-recap')).toBeTruthy();
    expect(getByTestId('cycle-race-screen')).toBeTruthy();
    expect(getByTestId('race-recap-play')).toBeTruthy();
    // results panel removed — the playback scrubber is the bottom of the recap
    expect(queryByTestId('race-results')).toBeNull();
    fireEvent.click(getByTestId('race-recap-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows speedometers in playback, fed from the recorded rpm series', () => {
    const withRpm = {
      ...candidate,
      participants: [{ ...candidate.participants[0], rpmSeries: JSON.stringify([40, 80, 95]) }]
    };
    const { getByTestId, getAllByTestId } = render(<RaceRecap candidate={withRpm} onClose={() => {}} />);
    // The recap used to hide the speedos (showSpeedos=false); now it renders one
    // gauge per rider, reading the recorded cadence.
    const rpm = getAllByTestId('cycle-speedometer-rpm');
    expect(rpm.length).toBe(1);
    expect(rpm[0].textContent).toContain('40'); // sample at t=0
    fireEvent.click(getByTestId('race-recap-play'));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(getAllByTestId('cycle-speedometer-rpm')[0].textContent).toContain('80'); // sample at t=1
  });

  it('advances the replay clock on play and reveals more of the line', () => {
    const { getByTestId, getAllByTestId } = render(<RaceRecap candidate={candidate} onClose={() => {}} />);
    // starts paused at t=0 → first line point only
    const before = getAllByTestId('race-line')[0].getAttribute('points').trim().split(' ').length;
    fireEvent.click(getByTestId('race-recap-play'));
    // A 3-tick series replays at ~4s/step (REPLAY_TARGET_MS / maxLen), so advance
    // a full step to guarantee the replay clock ticks at least once.
    act(() => { vi.advanceTimersByTime(4000); });
    const after = getAllByTestId('race-line')[0].getAttribute('points').trim().split(' ').length;
    expect(after).toBeGreaterThan(before);
  });
});
