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
  winnerName: 'User_3',
  participants: [
    { id: 'user_3', displayName: 'User_3', avatarSrc: '/api/v1/static/img/users/user_3',
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

  it('shows a km/h hero derived from the recorded distance series', () => {
    const { getAllByTestId } = render(<RaceRecap candidate={candidate} onClose={() => {}} />);
    // t=0: first sample = 20 m over 1 s → 72 km/h
    expect(getAllByTestId('cycle-speedometer-speed')[0].textContent).toContain('72');
  });

  it('applies ghost styling and resolves the source avatar for ghost participants', () => {
    const ghostCand = {
      ...candidate,
      participants: [
        candidate.participants[0],
        { id: 'ghost:20260601090000:ghost:20260501080000:dad', displayName: 'Dad 👻',
          distanceSeries: JSON.stringify([10, 50, 90]), hrSeries: JSON.stringify([]),
          finalDistanceM: 90, finalTimeS: null, placement: 2 }
        // no avatarSrc, no isGhost → recap must fall back to resolveParticipantIdentity,
        // which takes the FINAL segment of a nested ghost id ('dad'), never [2] ('ghost').
      ]
    };
    const { container } = render(<RaceRecap candidate={ghostCand} onClose={() => {}} />);
    expect(container.querySelector('.cycle-speedometer__avatar.cg-ghost')).toBeTruthy();
    const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') || '');
    expect(srcs.some((s) => s.endsWith('/users/dad'))).toBe(true);
    expect(srcs.some((s) => s.endsWith('/users/ghost'))).toBe(false);
  });

  it('parks a rider whose series ended: 0 km/h and 0 rpm while others ride on', () => {
    const mixed = {
      ...candidate,
      participants: [
        { ...candidate.participants[0], rpmSeries: JSON.stringify([40, 80, 95]) }, // 3 ticks
        { id: 'dad', displayName: 'Dad', avatarSrc: '/api/v1/static/img/users/dad',
          distanceSeries: JSON.stringify([30, 60]), rpmSeries: JSON.stringify([70, 75]),
          hrSeries: JSON.stringify([]), finalDistanceM: 60, finalTimeS: 2, placement: 2 } // 2 ticks
      ]
    };
    const { getByTestId, getAllByTestId } = render(<RaceRecap candidate={mixed} onClose={() => {}} />);
    fireEvent.click(getByTestId('race-recap-play'));
    act(() => { vi.advanceTimersByTime(12000); }); // run replay to the end (t = maxLen-1 = 2)
    const speeds = getAllByTestId('cycle-speedometer-speed').map((el) => el.textContent);
    const rpms = getAllByTestId('cycle-speedometer-rpm').map((el) => el.textContent);
    // User_3 (3 samples) still shows live values at t=2; Dad (2 samples) is parked.
    expect(speeds[1]).toContain('0 km/h');
    expect(rpms[1]).toContain('0 rpm');
    expect(rpms[0]).toContain('95');
    expect(speeds[0]).not.toBe('0 km/h');
  });

  it('threads the per-equipment gauge max into the recap speedometers', () => {
    const cand = { ...candidate, participants: [{ ...candidate.participants[0], gaugeMaxRpm: 250 }] };
    const { container } = render(<RaceRecap candidate={cand} onClose={() => {}} />);
    const labels = [...container.querySelectorAll('.cycle-speedometer__tick-label')]
      .map((el) => Number(el.textContent));
    expect(labels.some((n) => n > 120)).toBe(true); // 120-default dial never labels past 120
  });
});
