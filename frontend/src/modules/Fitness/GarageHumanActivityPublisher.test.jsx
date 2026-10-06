import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { GarageHumanActivityPublisher } from './GarageHumanActivityPublisher.jsx';

const mocks = vi.hoisted(() => ({
  api: vi.fn().mockResolvedValue({ ok: true }),
  context: { isSessionActive: false, activeHeartRateParticipants: [] },
}));
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => mocks.context }));
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: mocks.api }));
vi.mock('../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, warn() {} }) }) }));

describe('GarageHumanActivityPublisher', () => {
  beforeEach(() => {
    mocks.api.mockClear();
    mocks.context = { isSessionActive: false, activeHeartRateParticipants: [] };
  });
  afterEach(cleanup);

  it('keeps protection on while Emulation is open and clears it on exit', async () => {
    const view = render(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('api/v1/fitness/garage-human-activity',
      { deviceId: 'garage-tv', emulationOpen: true, hrSessionActive: false }, 'POST'));
    view.rerender(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen={false} />);
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith('api/v1/fitness/garage-human-activity',
      { deviceId: 'garage-tv', emulationOpen: false, hrSessionActive: false }, 'POST'));
  });

  it('protects Emulation launched as a Fitness overlay', async () => {
    mocks.context = { isSessionActive: false, activeHeartRateParticipants: [], overlayApp: { id: 'emulator' } };
    render(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen={false} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('api/v1/fitness/garage-human-activity',
      { deviceId: 'garage-tv', emulationOpen: true, hrSessionActive: false }, 'POST'));
  });

  it('latches an HR session through a temporary participant dropout until the session ends', async () => {
    mocks.context = { isSessionActive: true, activeHeartRateParticipants: [{ isActive: true }] };
    const view = render(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen={false} />);
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith('api/v1/fitness/garage-human-activity',
      { deviceId: 'garage-tv', emulationOpen: false, hrSessionActive: true }, 'POST'));
    mocks.context = { isSessionActive: true, activeHeartRateParticipants: [] };
    view.rerender(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen={false} />);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    mocks.context = { isSessionActive: false, activeHeartRateParticipants: [] };
    view.rerender(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen={false} />);
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith('api/v1/fitness/garage-human-activity',
      { deviceId: 'garage-tv', emulationOpen: false, hrSessionActive: false }, 'POST'));
  });

  it('does not let a non-garage Fitness tab change garage protection', () => {
    render(<GarageHumanActivityPublisher deviceId={null} emulationOpen />);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('holds the fail-safe guard during initial idle hydration', async () => {
    vi.useFakeTimers();
    try {
      render(<GarageHumanActivityPublisher deviceId="garage-tv" emulationOpen={false} />);
      expect(mocks.api).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(mocks.api).toHaveBeenCalledWith('api/v1/fitness/garage-human-activity',
        { deviceId: 'garage-tv', emulationOpen: false, hrSessionActive: false }, 'POST');
    } finally {
      vi.useRealTimers();
    }
  });
});
